package com.example.exchange.appapi.operator;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.exchange.appapi.auth.AppUser;
import com.example.exchange.appapi.common.ApiException;
import com.example.exchange.appapi.common.Json;
import com.example.exchange.appapi.tasks.Journal;
import com.example.exchange.appapi.tasks.TaskRepository;
import com.example.exchange.appapi.tasks.TaskRow;
import com.example.exchange.appapi.tasks.TaskStatus;

/**
 * Работа оператора интеграции (D05, D06). Каждое действие:
 * проверяет версию задания (оптимистичная блокировка — два оператора не перетрут друг друга),
 * пишет в журнал кто, когда, почему и состояние до/после.
 */
@Service
public class OperatorService {

    /** Откуда разрешён ручной повтор. Во время отправки (SENDING) — нельзя, она и так идёт. */
    static final Set<TaskStatus> RETRYABLE = EnumSet.of(
            TaskStatus.QUEUED, TaskStatus.RETRY_WAIT, TaskStatus.NEEDS_ATTENTION, TaskStatus.MANUALLY_CLOSED);

    /** Что можно «Закрыть без подтверждения»: всё, где нет итога внешней системы. */
    static final Set<TaskStatus> CLOSABLE = EnumSet.of(
            TaskStatus.QUEUED, TaskStatus.RETRY_WAIT, TaskStatus.ACCEPTED, TaskStatus.NEEDS_ATTENTION);

    private final JdbcClient jdbc;
    private final TaskRepository tasks;
    private final Journal journal;
    private final Json json;

    public OperatorService(JdbcClient jdbc, TaskRepository tasks, Journal journal, Json json) {
        this.jdbc = jdbc;
        this.tasks = tasks;
        this.journal = journal;
        this.json = json;
    }

    // ---------- действия ----------

    /**
     * Ручной повтор: сбрасывает ожидание backoff и ставит новую попытку с тем же operationKey (D05).
     * Если прошлая попытка закончилась неопределённо, отправщик сначала спросит статус.
     */
    @Transactional
    public Map<String, Object> retry(AppUser operator, UUID taskId, int expectedVersion, String reason) {
        // порядок блокировок: outbox, затем задание (как у отправщика)
        jdbc.sql("SELECT id FROM outbox WHERE task_id = :id AND processed_at IS NULL FOR UPDATE")
                .param("id", taskId).query(Long.class).list();
        TaskRow task = lockChecked(taskId, expectedVersion);
        if (!RETRYABLE.contains(task.status())) {
            throw ApiException.invalidState(task.status() == TaskStatus.SENDING
                    ? "Отправка идёт прямо сейчас — дождитесь её исхода."
                    : "Повтор недоступен для статуса " + task.status());
        }
        jdbc.sql("""
                UPDATE tasks SET status = 'QUEUED', attention_reason = NULL, next_attempt_at = now(),
                                 closed_reason = NULL, version = version + 1, updated_at = now()
                WHERE id = :id
                """)
                .param("id", taskId).update();
        int updated = jdbc.sql("""
                UPDATE outbox SET available_at = now(), trigger = 'MANUAL', requested_by = :op
                WHERE task_id = :id AND processed_at IS NULL
                """)
                .param("op", operator.id()).param("id", taskId).update();
        if (updated == 0) {
            jdbc.sql("INSERT INTO outbox (task_id, trigger, requested_by) VALUES (:id, 'MANUAL', :op)")
                    .param("id", taskId).param("op", operator.id()).update();
        }
        journal.record(taskId, operator.id(), "MANUAL_RETRY", task.status(), TaskStatus.QUEUED, blankToNull(reason),
                Map.of("operationKey", task.operationKey(), "attemptsBefore", task.attemptsCount()));
        return detail(taskId);
    }

    /**
     * «Закрыть без подтверждения» (бывшее «Считать выполненным», D06). Повторы останавливаются,
     * задание уходит из рабочей очереди, но НЕ становится «Выполнено» и не попадает в отчёт.
     * Если позже внешняя система сообщит об исполнении — задание станет COMPLETED с пометкой.
     */
    @Transactional
    public Map<String, Object> close(AppUser operator, UUID taskId, int expectedVersion, String reason) {
        if (reason == null || reason.trim().length() < 5) {
            throw ApiException.badRequest("Укажите причину закрытия (не короче 5 символов).");
        }
        TaskRow task = lockChecked(taskId, expectedVersion);
        if (!CLOSABLE.contains(task.status())) {
            throw ApiException.invalidState(task.status() == TaskStatus.SENDING
                    ? "Отправка идёт прямо сейчас — дождитесь её исхода."
                    : "Закрыть можно только задание без итога внешней системы (сейчас " + task.status() + ").");
        }
        jdbc.sql("""
                UPDATE tasks SET status = 'MANUALLY_CLOSED', closed_reason = :reason, next_attempt_at = NULL,
                                 attention_reason = NULL, version = version + 1, updated_at = now()
                WHERE id = :id
                """)
                .param("reason", reason.trim()).param("id", taskId).update();
        // Запись outbox не трогаем: отправщик сам закроет её, увидев статус (не нужно брать её блокировку).
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalStatus", task.extStatus());
        details.put("externalVersion", task.extVersion());
        details.put("note", "внешнего подтверждения нет; сверка покажет фактическое состояние");
        journal.record(taskId, operator.id(), "MANUALLY_CLOSED", task.status(), TaskStatus.MANUALLY_CLOSED,
                reason.trim(), details);
        return detail(taskId);
    }

    private TaskRow lockChecked(UUID taskId, int expectedVersion) {
        TaskRow task = tasks.lock(taskId).orElseThrow(() -> ApiException.notFound("Задание не найдено"));
        if (task.version() != expectedVersion) {
            throw ApiException.staleVersion();
        }
        return task;
    }

    // ---------- чтение ----------

    public Map<String, Object> list(String view, String status, String q, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        Map<String, Object> params = new LinkedHashMap<>();
        switch (view == null ? "attention" : view) {
            case "attention" -> where.append(" AND (t.status = 'NEEDS_ATTENTION' OR t.attention_reason IS NOT NULL)");
            case "retrying" -> where.append(" AND t.status = 'RETRY_WAIT'");
            case "closed" -> where.append(" AND t.status = 'MANUALLY_CLOSED'");
            default -> { }
        }
        if (status != null && !status.isBlank()) {
            TaskStatus.valueOf(status); // проверка значения
            where.append(" AND t.status = :status");
            params.put("status", status);
        }
        if (q != null && !q.isBlank()) {
            where.append(" AND (t.title ILIKE :q OR t.id::text = :exact OR t.operation_key::text = :exact)");
            params.put("q", "%" + q.trim() + "%");
            params.put("exact", q.trim().toLowerCase());
        }
        int limit = Math.min(Math.max(size, 1), 100);
        params.put("limit", limit);
        params.put("offset", Math.max(page, 0) * limit);

        var items = jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + where
                        + " ORDER BY t.updated_at DESC LIMIT :limit OFFSET :offset")
                .params(params).query(TaskRow::map).list()
                .stream().map(this::operatorView).toList();
        long total = jdbc.sql("SELECT count(*) FROM tasks t" + where)
                .params(params).query(Long.class).single();
        return Map.of("items", items, "total", total, "page", page, "size", limit);
    }

    public Map<String, Object> summary() {
        Map<String, Object> byStatus = new LinkedHashMap<>();
        for (TaskStatus s : TaskStatus.values()) {
            byStatus.put(s.name(), 0L);
        }
        jdbc.sql("SELECT status, count(*) AS n FROM tasks GROUP BY status")
                .query(rs -> {
                    byStatus.put(rs.getString("status"), rs.getLong("n"));
                });
        return Map.of(
                "byStatus", byStatus,
                "attention", jdbc.sql("SELECT count(*) FROM tasks WHERE status = 'NEEDS_ATTENTION' OR attention_reason IS NOT NULL")
                        .query(Long.class).single(),
                "openDiscrepancies", jdbc.sql("SELECT count(*) FROM discrepancies WHERE resolved_at IS NULL")
                        .query(Long.class).single(),
                "invalidMessages", jdbc.sql("SELECT count(*) FROM inbox_invalid").query(Long.class).single(),
                "outboxPending", jdbc.sql("SELECT count(*) FROM outbox WHERE processed_at IS NULL").query(Long.class).single());
    }

    public Map<String, Object> detail(UUID taskId) {
        TaskRow t = tasks.find(taskId).orElseThrow(() -> ApiException.notFound("Задание не найдено"));
        Map<String, Object> v = new LinkedHashMap<>(operatorView(t));
        v.put("attempts", jdbc.sql("""
                        SELECT id, trigger, started_at, finished_at, outcome, http_status, error, raw_response
                        FROM attempts WHERE task_id = :id ORDER BY started_at DESC LIMIT 200
                        """)
                .param("id", taskId)
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("attemptId", rs.getObject("id", UUID.class));
                    m.put("trigger", rs.getString("trigger"));
                    m.put("startedAt", ts(rs.getTimestamp("started_at")));
                    m.put("finishedAt", ts(rs.getTimestamp("finished_at")));
                    m.put("outcome", rs.getString("outcome"));
                    m.put("httpStatus", rs.getObject("http_status"));
                    m.put("error", rs.getString("error"));
                    m.put("rawResponse", rs.getString("raw_response"));
                    return m;
                }).list());
        v.put("results", jdbc.sql("""
                        SELECT result_id, version, outcome, executed_at, received_at, disposition
                        FROM inbox WHERE operation_key = :key ORDER BY received_at DESC
                        """)
                .param("key", t.operationKey())
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("resultId", rs.getObject("result_id", UUID.class));
                    m.put("version", rs.getInt("version"));
                    m.put("outcome", rs.getString("outcome"));
                    m.put("executedAt", ts(rs.getTimestamp("executed_at")));
                    m.put("receivedAt", ts(rs.getTimestamp("received_at")));
                    m.put("disposition", rs.getString("disposition"));
                    return m;
                }).list());
        v.put("events", events(taskId, null, 0, 500).get("items"));
        v.put("discrepancies", jdbc.sql("""
                        SELECT id, kind, our_status, their_status, resolved_at, resolution
                        FROM discrepancies WHERE task_id = :id ORDER BY id DESC LIMIT 20
                        """)
                .param("id", taskId)
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("kind", rs.getString("kind"));
                    m.put("ourStatus", rs.getString("our_status"));
                    m.put("theirStatus", rs.getString("their_status"));
                    m.put("resolvedAt", ts(rs.getTimestamp("resolved_at")));
                    m.put("resolution", rs.getString("resolution"));
                    return m;
                }).list());
        return v;
    }

    /** Журнал обмена: все события либо события одного задания. */
    public Map<String, Object> events(UUID taskId, String kind, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        Map<String, Object> params = new LinkedHashMap<>();
        if (taskId != null) {
            where.append(" AND e.task_id = :task");
            params.put("task", taskId);
        }
        if (kind != null && !kind.isBlank()) {
            where.append(" AND e.kind = :kind");
            params.put("kind", kind);
        }
        int limit = Math.min(Math.max(size, 1), 500);
        params.put("limit", limit);
        params.put("offset", Math.max(page, 0) * limit);
        List<Map<String, Object>> items = new ArrayList<>(jdbc.sql("""
                        SELECT e.id, e.task_id, t.title, e.at, e.kind, e.from_status, e.to_status, e.reason,
                               e.details::text AS details, u.display_name AS actor
                        FROM task_events e
                        JOIN tasks t ON t.id = e.task_id
                        LEFT JOIN users u ON u.id = e.actor_id
                        """ + where + " ORDER BY e.id DESC LIMIT :limit OFFSET :offset")
                .params(params)
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("taskId", rs.getObject("task_id", UUID.class));
                    m.put("taskTitle", rs.getString("title"));
                    m.put("at", ts(rs.getTimestamp("at")));
                    m.put("kind", rs.getString("kind"));
                    m.put("fromStatus", rs.getString("from_status"));
                    m.put("toStatus", rs.getString("to_status"));
                    m.put("reason", rs.getString("reason"));
                    m.put("actor", rs.getString("actor") == null ? "система" : rs.getString("actor"));
                    m.put("details", json.readMap(rs.getString("details")));
                    return m;
                }).list());
        return Map.of("items", items, "page", page, "size", limit);
    }

    public List<Map<String, Object>> invalidMessages() {
        return jdbc.sql("SELECT id, received_at, raw, error FROM inbox_invalid ORDER BY id DESC LIMIT 100")
                .query((rs, i) -> Map.<String, Object>of("id", rs.getLong("id"),
                        "receivedAt", ts(rs.getTimestamp("received_at")), "raw", rs.getString("raw"),
                        "error", rs.getString("error")))
                .list();
    }

    private Map<String, Object> operatorView(TaskRow t) {
        var us = t.status().userStatus();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", t.id());
        v.put("title", t.title());
        v.put("payload", json.readMap(t.payloadJson()));
        v.put("initiator", t.initiatorName());
        v.put("status", t.status().name());
        v.put("userStatus", us.label());
        v.put("attentionReason", t.attentionReason());
        v.put("operationKey", t.operationKey());
        v.put("clientRequestId", t.clientRequestId());
        v.put("externalStatus", t.extStatus());
        v.put("externalVersion", t.extVersion());
        v.put("attemptsCount", t.attemptsCount());
        v.put("firstAttemptAt", t.firstAttemptAt());
        v.put("nextAttemptAt", t.nextAttemptAt());
        v.put("lastError", t.lastError());
        v.put("closedReason", t.closedReason());
        v.put("confirmedAfterManualClose", t.confirmedAfterManualClose());
        v.put("completedAt", t.completedAt());
        v.put("version", t.version());
        v.put("createdAt", t.createdAt());
        v.put("updatedAt", t.updatedAt());
        v.put("canRetry", RETRYABLE.contains(t.status()));
        v.put("canClose", CLOSABLE.contains(t.status()));
        return v;
    }

    private static java.time.Instant ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
