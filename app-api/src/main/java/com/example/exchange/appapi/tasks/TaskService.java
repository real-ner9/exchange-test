package com.example.exchange.appapi.tasks;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.exchange.appapi.auth.AppUser;
import com.example.exchange.appapi.common.ApiException;
import com.example.exchange.appapi.common.Json;

/** Сценарии инициатора: создать задание, понять, что с ним происходит, получить отчёт. */
@Service
public class TaskService {

    public record CreateCommand(UUID clientRequestId, String title, BigDecimal amount, String comment) {}

    public record Created(Map<String, Object> task, boolean created) {}

    private final JdbcClient jdbc;
    private final TaskRepository tasks;
    private final Journal journal;
    private final Json json;
    private final int similarWindowMinutes;

    public TaskService(JdbcClient jdbc, TaskRepository tasks, Journal journal, Json json,
                       @Value("${app.similar-window-minutes}") int similarWindowMinutes) {
        this.jdbc = jdbc;
        this.tasks = tasks;
        this.journal = journal;
        this.json = json;
        this.similarWindowMinutes = similarWindowMinutes;
    }

    /**
     * Создание задания и постановка в outbox — одна транзакция (D07): принятое задание
     * не потеряется, даже если внешняя система недоступна или сервис перезапустится.
     * Повтор с тем же clientRequestId возвращает уже созданное задание (D01).
     */
    @Transactional
    public Created create(AppUser user, CreateCommand cmd) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", cmd.title().trim());
        payload.put("amount", cmd.amount());
        payload.put("comment", cmd.comment() == null || cmd.comment().isBlank() ? null : cmd.comment().trim());

        var inserted = jdbc.sql("""
                INSERT INTO tasks (initiator_id, client_request_id, title, payload, status)
                VALUES (:initiator, :clientRequestId, :title, CAST(:payload AS jsonb), 'QUEUED')
                ON CONFLICT (initiator_id, client_request_id) DO NOTHING
                RETURNING id
                """)
                .param("initiator", user.id())
                .param("clientRequestId", cmd.clientRequestId())
                .param("title", payload.get("title"))
                .param("payload", json.write(payload))
                .query(UUID.class)
                .optional();

        if (inserted.isPresent()) {
            UUID id = inserted.get();
            jdbc.sql("INSERT INTO outbox (task_id) VALUES (:id)").param("id", id).update();
            journal.record(id, user.id(), "CREATED", null, TaskStatus.QUEUED, null,
                    Map.of("clientRequestId", cmd.clientRequestId()));
            return new Created(initiatorView(tasks.find(id).orElseThrow(), true), true);
        }

        // Повторная отправка той же формы: задание уже есть, второе не создаём.
        TaskRow existing = jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM
                        + "WHERE t.initiator_id = :initiator AND t.client_request_id = :clientRequestId")
                .param("initiator", user.id())
                .param("clientRequestId", cmd.clientRequestId())
                .query(TaskRow::map)
                .single();
        if (!samePayload(json.readMap(existing.payloadJson()), payload)) {
            throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                    "Этот ключ формы уже использован для задания с другим содержанием. Откройте новую форму.");
        }
        return new Created(initiatorView(existing, true), false);
    }

    /** Похожие задания за последние N минут — мягкое предупреждение, решает инициатор (D01). */
    public List<Map<String, Object>> similar(AppUser user, String title) {
        if (title == null || title.isBlank()) {
            return List.of();
        }
        return jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + """
                        WHERE t.initiator_id = :initiator
                          AND lower(t.title) = lower(:title)
                          AND t.created_at > now() - make_interval(mins => :window)
                        ORDER BY t.created_at DESC LIMIT 5
                        """)
                .param("initiator", user.id())
                .param("title", title.trim())
                .param("window", similarWindowMinutes)
                .query(TaskRow::map)
                .list()
                .stream()
                .map(t -> initiatorView(t, false))
                .toList();
    }

    public Map<String, Object> list(AppUser user, String filter, int page, int size) {
        String where = switch (filter == null ? "all" : filter) {
            case "active" -> " AND t.status IN ('QUEUED','SENDING','RETRY_WAIT','ACCEPTED','NEEDS_ATTENTION','MANUALLY_CLOSED')";
            case "needsAction" -> " AND t.status IN ('FAILED','REJECTED')";
            case "completed" -> " AND t.status = 'COMPLETED'";
            default -> "";
        };
        int limit = Math.min(Math.max(size, 1), 100);
        int offset = Math.max(page, 0) * limit;
        var items = jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + "WHERE t.initiator_id = :initiator"
                        + where + " ORDER BY t.created_at DESC LIMIT :limit OFFSET :offset")
                .param("initiator", user.id())
                .param("limit", limit)
                .param("offset", offset)
                .query(TaskRow::map)
                .list()
                .stream()
                .map(t -> initiatorView(t, false))
                .toList();
        long total = jdbc.sql("SELECT count(*) FROM tasks t WHERE t.initiator_id = :initiator" + where)
                .param("initiator", user.id()).query(Long.class).single();

        Map<String, Long> counts = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT count(*) FILTER (WHERE status IN ('QUEUED','SENDING','RETRY_WAIT','ACCEPTED','NEEDS_ATTENTION','MANUALLY_CLOSED')) AS active,
                       count(*) FILTER (WHERE status IN ('FAILED','REJECTED')) AS needs_action,
                       count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                       count(*) AS all_
                FROM tasks WHERE initiator_id = :initiator
                """)
                .param("initiator", user.id())
                .query(rs -> {
                    counts.put("active", rs.getLong("active"));
                    counts.put("needsAction", rs.getLong("needs_action"));
                    counts.put("completed", rs.getLong("completed"));
                    counts.put("all", rs.getLong("all_"));
                });
        return Map.of("items", items, "total", total, "page", page, "size", limit, "counts", counts);
    }

    /** Инициатор видит только свои задания; чужое — 404, чтобы не раскрывать его существование. */
    public Map<String, Object> get(AppUser user, UUID id) {
        TaskRow t = tasks.find(id)
                .filter(task -> task.initiatorId().equals(user.id()))
                .orElseThrow(() -> ApiException.notFound("Задание не найдено"));
        return initiatorView(t, true);
    }

    /** Отчёт о выполнении: только задания с полученным результатом исполнения (D02). */
    public Map<String, Object> report(AppUser user, Instant from, Instant to) {
        var items = jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + """
                        WHERE t.initiator_id = :initiator AND t.status = 'COMPLETED'
                          AND t.completed_at >= :from AND t.completed_at < :to
                        ORDER BY t.completed_at DESC LIMIT 1000
                        """)
                .param("initiator", user.id())
                .param("from", java.sql.Timestamp.from(from))
                .param("to", java.sql.Timestamp.from(to))
                .query(TaskRow::map)
                .list()
                .stream()
                .map(t -> initiatorView(t, false))
                .toList();
        return Map.of("from", from, "to", to, "count", items.size(), "items", items);
    }

    private Map<String, Object> initiatorView(TaskRow t, boolean withHistory) {
        var us = t.status().userStatus();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", t.id());
        v.put("title", t.title());
        v.put("payload", json.readMap(t.payloadJson()));
        v.put("status", Map.of("code", us.code(), "label", us.label(), "color", us.color(),
                "needsAction", us.needsAction(), "hint", us.hint()));
        v.put("createdAt", t.createdAt());
        v.put("updatedAt", t.updatedAt());
        v.put("completedAt", t.completedAt());
        if (t.status() == TaskStatus.REJECTED || t.status() == TaskStatus.FAILED) {
            v.put("problem", t.lastError());
        }
        if (withHistory) {
            v.put("history", userHistory(t.id()));
        }
        return v;
    }

    /** История для инициатора — только смены пользовательского статуса, без технических деталей. */
    private List<Map<String, Object>> userHistory(UUID taskId) {
        record Ev(Instant at, String to) {}
        var events = jdbc.sql("""
                SELECT at, to_status FROM task_events
                WHERE task_id = :id AND to_status IS NOT NULL ORDER BY id
                """)
                .param("id", taskId)
                .query((rs, i) -> new Ev(rs.getTimestamp("at").toInstant(), rs.getString("to_status")))
                .list();
        List<Map<String, Object>> out = new ArrayList<>();
        String lastLabel = null;
        for (Ev e : events) {
            var us = TaskStatus.valueOf(e.to()).userStatus();
            if (!us.label().equals(lastLabel)) {
                out.add(Map.of("at", e.at(), "label", us.label(), "color", us.color()));
                lastLabel = us.label();
            }
        }
        return out;
    }

    private static boolean samePayload(Map<String, Object> a, Map<String, Object> b) {
        return Objects.equals(str(a.get("title")), str(b.get("title")))
                && Objects.equals(num(a.get("amount")), num(b.get("amount")))
                && Objects.equals(str(a.get("comment")), str(b.get("comment")));
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    private static BigDecimal num(Object o) {
        return o == null ? null : new BigDecimal(o.toString()).stripTrailingZeros();
    }
}
