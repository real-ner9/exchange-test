package com.example.exchange.appapi.tasks;

import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.example.exchange.appapi.common.Json;

/**
 * Журнал значимых изменений задания (task_events). Пишется в той же транзакции,
 * что и само изменение, — запись в журнале есть тогда и только тогда, когда изменение произошло.
 */
@Component
public class Journal {

    private final JdbcClient jdbc;
    private final Json json;

    public Journal(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(UUID taskId, UUID actorId, String kind, TaskStatus from, TaskStatus to, String reason,
                       Map<String, ?> details) {
        jdbc.sql("""
                INSERT INTO task_events (task_id, actor_id, kind, from_status, to_status, reason, details)
                VALUES (:task, :actor, :kind, :from, :to, :reason, CAST(:details AS jsonb))
                """)
                .param("task", taskId)
                .param("actor", actorId)
                .param("kind", kind)
                .param("from", from == null ? null : from.name())
                .param("to", to == null ? null : to.name())
                .param("reason", reason)
                .param("details", json.write(details))
                .update();
    }

    public void system(UUID taskId, String kind, TaskStatus from, TaskStatus to, Map<String, ?> details) {
        record(taskId, null, kind, from, to, null, details);
    }
}
