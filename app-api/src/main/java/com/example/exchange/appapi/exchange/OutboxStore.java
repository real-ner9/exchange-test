package com.example.exchange.appapi.exchange;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.example.exchange.appapi.exchange.EmulatorClient.Accepted;
import com.example.exchange.appapi.exchange.EmulatorClient.ContractError;
import com.example.exchange.appapi.exchange.EmulatorClient.OperationView;
import com.example.exchange.appapi.exchange.EmulatorClient.Rejected;
import com.example.exchange.appapi.exchange.EmulatorClient.SendResult;
import com.example.exchange.appapi.exchange.EmulatorClient.Transient;
import com.example.exchange.appapi.exchange.EmulatorClient.Unparseable;
import com.example.exchange.appapi.tasks.ExternalStateApplier;
import com.example.exchange.appapi.tasks.Journal;
import com.example.exchange.appapi.tasks.TaskRepository;
import com.example.exchange.appapi.tasks.TaskRow;
import com.example.exchange.appapi.tasks.TaskStatus;

/**
 * Транзакционные шаги отправщика. HTTP-вызовы делаются вне транзакций (в Dispatcher),
 * здесь — только короткие изменения БД до и после вызова.
 *
 * Порядок блокировок везде одинаковый: сначала строка outbox, потом строка задания —
 * так отправщик, приём результатов и действия оператора не взаимоблокируются.
 */
@Component
public class OutboxStore {

    public record Claim(long outboxId, UUID taskId, String trigger, UUID requestedBy) {}

    private final JdbcClient jdbc;
    private final TaskRepository tasks;
    private final ExternalStateApplier applier;
    private final Journal journal;
    private final long baseMs;
    private final long maxMs;
    private final int attentionAttempts;
    private final int attentionMinutes;

    public OutboxStore(JdbcClient jdbc, TaskRepository tasks, ExternalStateApplier applier, Journal journal,
                       @Value("${app.retry.base-ms}") long baseMs,
                       @Value("${app.retry.max-ms}") long maxMs,
                       @Value("${app.retry.attention-attempts}") int attentionAttempts,
                       @Value("${app.retry.attention-minutes}") int attentionMinutes) {
        this.jdbc = jdbc;
        this.tasks = tasks;
        this.applier = applier;
        this.journal = journal;
        this.baseMs = baseMs;
        this.maxMs = maxMs;
        this.attentionAttempts = attentionAttempts;
        this.attentionMinutes = attentionMinutes;
    }

    /**
     * Забирает созревшие записи outbox. FOR UPDATE SKIP LOCKED — несколько отправщиков
     * (или потоков) не возьмут одну запись. Взятая запись «арендуется»: available_at сдвигается
     * на lease секунд. Если отправщик упадёт посреди отправки, по истечении аренды запись
     * возьмут снова, и перед повторной отправкой будет проверен статус (D07).
     */
    @Transactional
    public List<Claim> claim(int batch, int leaseSeconds) {
        List<Claim> claimed = jdbc.sql("""
                WITH due AS (
                    SELECT id FROM outbox
                    WHERE processed_at IS NULL AND available_at <= now()
                    ORDER BY available_at
                    LIMIT :batch
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE outbox o SET available_at = now() + make_interval(secs => :lease)
                FROM due WHERE o.id = due.id
                RETURNING o.id, o.task_id, o.trigger, o.requested_by
                """)
                .param("batch", batch)
                .param("lease", (double) leaseSeconds)
                .query((rs, i) -> new Claim(rs.getLong("id"), rs.getObject("task_id", UUID.class),
                        rs.getString("trigger"), rs.getObject("requested_by", UUID.class)))
                .list();
        if (claimed.isEmpty()) {
            return claimed;
        }
        List<UUID> ids = claimed.stream().map(Claim::taskId).toList();
        Set<UUID> sendable = Set.copyOf(jdbc.sql("""
                UPDATE tasks SET status = 'SENDING', version = version + 1, updated_at = now()
                WHERE id IN (:ids) AND status IN ('QUEUED', 'RETRY_WAIT', 'SENDING')
                RETURNING id
                """)
                .param("ids", ids)
                .query(UUID.class)
                .list());
        // Задание уже не нужно отправлять (пришёл результат, закрыто оператором) — запись outbox закрываем.
        List<Long> obsolete = claimed.stream().filter(c -> !sendable.contains(c.taskId())).map(Claim::outboxId).toList();
        if (!obsolete.isEmpty()) {
            jdbc.sql("UPDATE outbox SET processed_at = now() WHERE id IN (:ids)").param("ids", obsolete).update();
        }
        return claimed.stream().filter(c -> sendable.contains(c.taskId())).toList();
    }

    /**
     * Нужно ли перед отправкой спросить статус: прошлая попытка закончилась неопределённо
     * (таймаут, обрыв, неразбираемый ответ) или не закончилась вовсе (отправщик упал).
     */
    public boolean needsStatusCheck(UUID taskId) {
        return jdbc.sql("""
                SELECT outcome IS NULL OR outcome IN ('UNCERTAIN', 'UNPARSEABLE')
                FROM attempts WHERE task_id = :id ORDER BY started_at DESC LIMIT 1
                """)
                .param("id", taskId)
                .query(Boolean.class)
                .optional()
                .orElse(false);
    }

    /** Начинает попытку доставки. attemptId — новый на каждую попытку (D04, трассировка). */
    @Transactional
    public UUID startAttempt(Claim claim, TaskRow task) {
        UUID attemptId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO attempts (id, task_id, operation_key, trigger) VALUES (:id, :task, :key, :trigger)
                """)
                .param("id", attemptId)
                .param("task", task.id())
                .param("key", task.operationKey())
                .param("trigger", claim.trigger())
                .update();
        jdbc.sql("""
                UPDATE tasks SET attempts_count = attempts_count + 1, first_attempt_at = coalesce(first_attempt_at, now())
                WHERE id = :id
                """)
                .param("id", task.id())
                .update();
        return attemptId;
    }

    /** Проверка статуса показала, что операция у внешней системы уже есть: повторно не отправляем. */
    @Transactional
    public void finishKnown(Claim claim, UUID attemptId, OperationView op) {
        lockOutbox(claim.outboxId());
        TaskRow task = tasks.lock(claim.taskId()).orElseThrow();
        finishAttempt(attemptId, "CHECKED_KNOWN", 200, null,
                "GET /operations: status=" + op.status() + ", version=" + op.version());
        applier.apply(task, op.status(), op.version(), op.executedAt(), "STATUS_CHECK",
                Map.of("attemptId", attemptId, "note", "операция уже известна внешней системе — повторно не отправлялась"));
        closeOutboxIfDone(claim);
    }

    /** Фиксирует исход отправки (D05). */
    @Transactional
    public void finish(Claim claim, UUID attemptId, SendResult result) {
        lockOutbox(claim.outboxId());
        TaskRow task = tasks.lock(claim.taskId()).orElseThrow();
        boolean sending = task.status() == TaskStatus.SENDING;

        switch (result) {
            case Accepted a -> {
                finishAttempt(attemptId, a.alreadyKnown() ? "ALREADY_KNOWN" : "ACCEPTED", a.httpStatus(), null, a.raw());
                applier.apply(task, a.status(), a.version(), null, "SEND_RESPONSE",
                        Map.of("attemptId", attemptId, "httpStatus", a.httpStatus()));
            }
            case Rejected r -> {
                finishAttempt(attemptId, "REJECTED", r.httpStatus(), r.reason(), r.raw());
                if (sending) {
                    setStatus(task, TaskStatus.REJECTED, null, r.reason());
                    journal.system(task.id(), "REJECTED_BY_EXTERNAL", task.status(), TaskStatus.REJECTED,
                            Map.of("attemptId", attemptId, "reason", r.reason()));
                }
            }
            case Unparseable u -> {
                finishAttempt(attemptId, "UNPARSEABLE", u.httpStatus(), u.error(), u.raw());
                if (sending) {
                    setStatus(task, TaskStatus.NEEDS_ATTENTION, "UNPARSEABLE", "Неразбираемый ответ: " + u.error());
                    journal.system(task.id(), "NEEDS_ATTENTION", task.status(), TaskStatus.NEEDS_ATTENTION,
                            Map.of("attemptId", attemptId, "reason", "UNPARSEABLE", "error", u.error()));
                }
            }
            case ContractError c -> {
                finishAttempt(attemptId, "CONTRACT_ERROR", c.httpStatus(), "HTTP " + c.httpStatus(), c.raw());
                if (sending) {
                    setStatus(task, TaskStatus.NEEDS_ATTENTION, "CONTRACT_ERROR", "Неожиданный ответ HTTP " + c.httpStatus());
                    journal.system(task.id(), "NEEDS_ATTENTION", task.status(), TaskStatus.NEEDS_ATTENTION,
                            Map.of("attemptId", attemptId, "reason", "CONTRACT_ERROR", "httpStatus", c.httpStatus()));
                }
            }
            case Transient t -> {
                finishAttempt(attemptId, t.uncertain() ? "UNCERTAIN" : "TRANSIENT", t.httpStatus(), t.error(), t.raw());
                if (sending) {
                    scheduleRetry(claim, task, t);
                    return; // запись outbox остаётся в работе с новым временем
                }
            }
        }
        closeOutboxIfDone(claim);
    }

    /** Отправщик упал на задании (исключение в коде) — откладываем как временную ошибку. */
    @Transactional
    public void failUnexpected(Claim claim, UUID attemptId, String error) {
        finish(claim, attemptId, new Transient(null, "internal: " + error, null, true, null));
    }

    private void scheduleRetry(Claim claim, TaskRow task, Transient t) {
        int attempts = task.attemptsCount(); // уже включает текущую попытку
        long delayMs;
        if (t.retryAfterSeconds() != null) {
            delayMs = t.retryAfterSeconds() * 1000; // 429: уважаем Retry-After
        } else {
            long exp = baseMs * (1L << Math.min(Math.max(attempts - 1, 0), 20));
            delayMs = (long) (Math.min(exp, maxMs) * ThreadLocalRandom.current().nextDouble(0.8, 1.2));
        }
        Instant next = Instant.now().plusMillis(delayMs);

        boolean longRetry = task.attentionReason() == null
                && (attempts >= attentionAttempts
                || (task.firstAttemptAt() != null
                && task.firstAttemptAt().isBefore(Instant.now().minusSeconds(attentionMinutes * 60L))));

        jdbc.sql("""
                UPDATE tasks
                SET status = 'RETRY_WAIT', next_attempt_at = :next, last_error = :error,
                    attention_reason = CASE WHEN :longRetry THEN 'LONG_RETRY' ELSE attention_reason END,
                    version = version + 1, updated_at = now()
                WHERE id = :id
                """)
                .param("next", java.sql.Timestamp.from(next))
                .param("error", t.error())
                .param("longRetry", longRetry)
                .param("id", task.id())
                .update();
        jdbc.sql("UPDATE outbox SET available_at = :next, trigger = 'AUTO', requested_by = NULL WHERE id = :id")
                .param("next", java.sql.Timestamp.from(next))
                .param("id", claim.outboxId())
                .update();
        if (longRetry) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("attempts", attempts);
            d.put("firstAttemptAt", task.firstAttemptAt());
            d.put("note", "повтор продолжается автоматически");
            journal.system(task.id(), "ATTENTION_LONG_RETRY", TaskStatus.SENDING, TaskStatus.RETRY_WAIT, d);
        }
    }

    private void setStatus(TaskRow task, TaskStatus status, String attentionReason, String error) {
        jdbc.sql("""
                UPDATE tasks
                SET status = :status, attention_reason = :reason, last_error = :error, next_attempt_at = NULL,
                    version = version + 1, updated_at = now()
                WHERE id = :id
                """)
                .param("status", status.name())
                .param("reason", attentionReason)
                .param("error", error)
                .param("id", task.id())
                .update();
    }

    private void finishAttempt(UUID attemptId, String outcome, Integer httpStatus, String error, String raw) {
        jdbc.sql("""
                UPDATE attempts SET finished_at = now(), outcome = :outcome, http_status = :http,
                                    error = :error, raw_response = :raw
                WHERE id = :id
                """)
                .param("outcome", outcome)
                .param("http", httpStatus)
                .param("error", error)
                .param("raw", raw == null ? null : raw.length() > 4000 ? raw.substring(0, 4000) : raw)
                .param("id", attemptId)
                .update();
    }

    private void lockOutbox(long outboxId) {
        jdbc.sql("SELECT id FROM outbox WHERE id = :id FOR UPDATE").param("id", outboxId).query(Long.class).single();
    }

    private void closeOutboxIfDone(Claim claim) {
        TaskRow task = tasks.find(claim.taskId()).orElseThrow();
        if (task.status() == TaskStatus.SENDING) {
            // Внешняя система ответила, что операция у неё есть, но версия не новее уже применённой
            // (например, повторная отправка после ручного закрытия). Доставка завершена — операция принята.
            jdbc.sql("""
                    UPDATE tasks SET status = 'ACCEPTED', next_attempt_at = NULL, attention_reason = NULL,
                                     version = version + 1, updated_at = now()
                    WHERE id = :id
                    """)
                    .param("id", task.id()).update();
            journal.system(task.id(), "EXTERNAL_STATUS", TaskStatus.SENDING, TaskStatus.ACCEPTED,
                    Map.of("source", "SEND_RESPONSE", "note", "операция уже известна внешней системе",
                            "externalStatus", String.valueOf(task.extStatus()), "externalVersion", task.extVersion()));
        }
        jdbc.sql("UPDATE outbox SET processed_at = now() WHERE id = :id").param("id", claim.outboxId()).update();
    }
}
