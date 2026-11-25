package com.example.exchange.emulator;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import com.example.exchange.emulator.FaultService.Faults;

/**
 * Приём и исполнение операций. Дедупликация — по operationKey (D03):
 * сколько бы раз ни пришла отправка с тем же ключом, исполнение одно.
 */
@Service
public class OperationService {

    public record SubmitRequest(UUID operationKey, UUID attemptId, String callbackUrl, Map<String, Object> payload) {
        String title() {
            Object t = payload == null ? null : payload.get("title");
            return t == null ? "" : t.toString();
        }
    }

    public record OperationView(UUID operationKey, String status, int version, String outcome,
                                Instant executedAt, Instant updatedAt) {}

    /** created=true — операция новая (202), иначе ключ уже известен (200). */
    public record Received(boolean created, OperationView operation) {}

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final ResultOutbox results;
    private final long execDelayMs;

    public OperationService(JdbcClient jdbc, JsonMapper json, ResultOutbox results,
                            @Value("${emulator.exec-delay-ms}") long execDelayMs) {
        this.jdbc = jdbc;
        this.json = json;
        this.results = results;
        this.execDelayMs = execDelayMs;
    }

    @Transactional
    public Received receive(SubmitRequest req, Faults faults, String fault) {
        // ON CONFLICT DO NOTHING — атомарно при одновременных повторах с тем же ключом.
        int inserted = jdbc.sql("""
                INSERT INTO operations (operation_key, first_attempt_id, callback_url, payload, status, version, execute_after)
                VALUES (:key, :attempt, :callback, CAST(:payload AS jsonb), 'RECEIVED', 1,
                        now() + make_interval(secs => :delaySec))
                ON CONFLICT (operation_key) DO NOTHING
                """)
                .param("key", req.operationKey())
                .param("attempt", req.attemptId())
                .param("callback", req.callbackUrl())
                .param("payload", json.writeValueAsString(req.payload()))
                .param("delaySec", execDelayMs / 1000.0)
                .update();

        boolean created = inserted == 1;
        if (created) {
            results.enqueue(req.operationKey(), 1, "ACCEPTED", null, req.callbackUrl(), faults);
        }
        logAttempt(req, created ? 202 : 200, fault);
        return new Received(created, find(req.operationKey()).orElseThrow());
    }

    @Transactional
    public void logAttempt(SubmitRequest req, int code, String fault) {
        jdbc.sql("""
                INSERT INTO received_attempts (attempt_id, operation_key, response_code, fault)
                VALUES (:attempt, :key, :code, :fault)
                """)
                .param("attempt", req.attemptId())
                .param("key", req.operationKey())
                .param("code", code)
                .param("fault", fault)
                .update();
    }

    /**
     * Исполняет одну созревшую операцию. Строка блокируется FOR UPDATE SKIP LOCKED,
     * поэтому два воркера не возьмут одну операцию, а статус меняется в той же транзакции,
     * что и запись факта исполнения.
     */
    @Transactional
    public boolean executeNext(Faults faults) {
        record Due(UUID key, String callbackUrl, String title) {}
        Optional<Due> due = jdbc.sql("""
                SELECT operation_key, callback_url, payload->>'title' AS title
                FROM operations
                WHERE status = 'RECEIVED' AND execute_after <= now()
                ORDER BY execute_after
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """)
                .query((rs, i) -> new Due(rs.getObject("operation_key", UUID.class),
                        rs.getString("callback_url"), rs.getString("title")))
                .optional();
        if (due.isEmpty()) {
            return false;
        }
        Due op = due.get();
        boolean fail = faults.on("fail_execution")
                && op.title() != null
                && op.title().contains(faults.get("fail_execution").str("marker", "#fail"));
        String outcome = fail ? "FAILED" : "COMPLETED";

        jdbc.sql("INSERT INTO executions (operation_key) VALUES (:key)").param("key", op.key()).update();
        Instant executedAt = jdbc.sql("""
                UPDATE operations
                SET status = :status, version = 2, outcome = :outcome, executed_at = now(), updated_at = now()
                WHERE operation_key = :key
                RETURNING executed_at
                """)
                .param("status", fail ? "FAILED" : "EXECUTED")
                .param("outcome", outcome)
                .param("key", op.key())
                .query(Instant.class)
                .single();
        results.enqueue(op.key(), 2, outcome, executedAt, op.callbackUrl(), faults);
        return true;
    }

    public Optional<OperationView> find(UUID key) {
        return jdbc.sql(SELECT_VIEW + " WHERE operation_key = :key")
                .param("key", key)
                .query(OperationService::view)
                .optional();
    }

    public List<OperationView> updatedSince(Instant since, int limit) {
        return jdbc.sql(SELECT_VIEW + " WHERE updated_at > :since ORDER BY updated_at, operation_key LIMIT :limit")
                .param("since", since)
                .param("limit", limit)
                .query(OperationService::view)
                .list();
    }

    public Map<String, Object> executions(UUID key) {
        return jdbc.sql("""
                SELECT (SELECT count(*) FROM executions WHERE operation_key = :key) AS executions,
                       (SELECT count(*) FROM received_attempts WHERE operation_key = :key) AS received_attempts,
                       (SELECT status FROM operations WHERE operation_key = :key) AS status
                """)
                .param("key", key)
                .query((rs, i) -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("operationKey", key);
                    m.put("status", rs.getString("status"));
                    m.put("executions", rs.getLong("executions"));
                    m.put("receivedAttempts", rs.getLong("received_attempts"));
                    return (Map<String, Object>) m;
                })
                .single();
    }

    /** Сводка для демо и нагрузочного прогона: главное — duplicateExecutions всегда 0. */
    public Map<String, Object> stats() {
        return jdbc.sql("""
                SELECT (SELECT count(*) FROM operations) AS operations,
                       (SELECT count(*) FROM operations WHERE status = 'RECEIVED') AS pending,
                       (SELECT count(*) FROM executions) AS executions,
                       (SELECT count(*) FROM received_attempts) AS received_attempts,
                       (SELECT count(*) FROM (SELECT operation_key FROM executions
                                              GROUP BY operation_key HAVING count(*) > 1) d) AS duplicate_executions,
                       (SELECT count(*) FROM result_outbox WHERE delivered_at IS NULL) AS undelivered_results
                """)
                .query((rs, i) -> Map.<String, Object>of(
                        "operations", rs.getLong("operations"),
                        "pending", rs.getLong("pending"),
                        "executions", rs.getLong("executions"),
                        "receivedAttempts", rs.getLong("received_attempts"),
                        "duplicateExecutions", rs.getLong("duplicate_executions"),
                        "undeliveredResults", rs.getLong("undelivered_results")))
                .single();
    }

    private static final String SELECT_VIEW =
            "SELECT operation_key, status, version, outcome, executed_at, updated_at FROM operations";

    private static OperationView view(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        var executedAt = rs.getTimestamp("executed_at");
        return new OperationView(rs.getObject("operation_key", UUID.class), rs.getString("status"),
                rs.getInt("version"), rs.getString("outcome"),
                executedAt == null ? null : executedAt.toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }
}
