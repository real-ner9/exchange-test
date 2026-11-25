package com.example.exchange.appapi.tasks;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Единственное место, где сведения внешней системы меняют статус задания.
 * Источник может быть любым: ответ на отправку, проверка статуса после потерянного ответа,
 * входящий результат, сверка. Правила одинаковые (D04, D06):
 * <ul>
 *   <li>применяется только версия больше уже применённой — задержанное старое сообщение не перетирает новое;</li>
 *   <li>итоговые статусы (Выполнено/Не выполнено/Отвергнуто) не откатываются;</li>
 *   <li>«Закрыто вручную» сменяется только фактом исполнения — с пометкой «подтверждено после ручного закрытия».</li>
 * </ul>
 * Вызывать внутри транзакции с уже заблокированной строкой задания.
 */
@Component
public class ExternalStateApplier {

    public enum Result { APPLIED, STALE }

    private final JdbcClient jdbc;
    private final Journal journal;

    public ExternalStateApplier(JdbcClient jdbc, Journal journal) {
        this.jdbc = jdbc;
        this.journal = journal;
    }

    /**
     * @param externalStatus статус во внешней системе: RECEIVED/ACCEPTED, EXECUTED/COMPLETED, FAILED
     * @param version        версия состояния во внешней системе
     * @param source         откуда пришли сведения: SEND_RESPONSE, STATUS_CHECK, RESULT, RECONCILE
     */
    public Result apply(TaskRow task, String externalStatus, int version, Instant executedAt, String source,
                        Map<String, ?> extraDetails) {
        if (version <= task.extVersion()) {
            return Result.STALE;
        }
        TaskStatus reported = switch (externalStatus) {
            case "RECEIVED", "ACCEPTED" -> TaskStatus.ACCEPTED;
            case "EXECUTED", "COMPLETED" -> TaskStatus.COMPLETED;
            case "FAILED" -> TaskStatus.FAILED;
            default -> throw new IllegalArgumentException("unknown external status " + externalStatus);
        };

        TaskStatus current = task.status();
        TaskStatus next;
        boolean confirmedAfterClose = false;
        if (current.terminal()) {
            next = current;
        } else if (current == TaskStatus.MANUALLY_CLOSED) {
            // ручное закрытие отменяется только фактом исполнения (D06)
            next = reported.terminal() ? reported : current;
            confirmedAfterClose = reported == TaskStatus.COMPLETED;
        } else {
            next = reported;
        }

        jdbc.sql("""
                UPDATE tasks
                SET ext_version = :extVersion,
                    ext_status = :extStatus,
                    status = :next,
                    attention_reason = CASE WHEN :changed THEN NULL ELSE attention_reason END,
                    next_attempt_at = CASE WHEN :changed THEN NULL ELSE next_attempt_at END,
                    completed_at = CASE WHEN :next = 'COMPLETED' THEN coalesce(:executedAt, now()) ELSE completed_at END,
                    confirmed_after_manual_close = confirmed_after_manual_close OR :confirmed,
                    version = version + 1,
                    updated_at = now()
                WHERE id = :id
                """)
                .param("extVersion", version)
                .param("extStatus", externalStatus)
                .param("next", next.name())
                .param("changed", next != current)
                .param("executedAt", executedAt == null ? null : java.sql.Timestamp.from(executedAt))
                .param("confirmed", confirmedAfterClose)
                .param("id", task.id())
                .update();

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("source", source);
        details.put("externalStatus", externalStatus);
        details.put("externalVersion", version);
        if (confirmedAfterClose) {
            details.put("confirmedAfterManualClose", true);
        }
        if (extraDetails != null) {
            details.putAll(extraDetails);
        }
        journal.system(task.id(), confirmedAfterClose ? "CONFIRMED_AFTER_MANUAL_CLOSE" : "EXTERNAL_STATUS",
                current, next, details);
        return Result.APPLIED;
    }
}
