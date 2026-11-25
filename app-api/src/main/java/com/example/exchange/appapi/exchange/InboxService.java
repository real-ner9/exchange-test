package com.example.exchange.appapi.exchange;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.exchange.appapi.common.Json;
import com.example.exchange.appapi.tasks.ExternalStateApplier;
import com.example.exchange.appapi.tasks.Journal;
import com.example.exchange.appapi.tasks.TaskRepository;
import com.example.exchange.appapi.tasks.TaskRow;

/**
 * Приём результатов от внешней системы (D04).
 * Каждое сообщение сначала фиксируется в inbox (уникальный resultId), затем применяется:
 * повтор того же resultId — «дубликат», версия не новее применённой — «устаревший»;
 * оба сохраняются в журнале и статус не меняют.
 */
@Service
public class InboxService {

    public enum Outcome { APPLIED, STALE, DUPLICATE, UNKNOWN_OPERATION, INVALID }

    private record Result(UUID resultId, UUID operationKey, int version, String outcome, Instant executedAt) {}

    private static final Set<String> OUTCOMES = Set.of("ACCEPTED", "COMPLETED", "FAILED");

    private final JdbcClient jdbc;
    private final TaskRepository tasks;
    private final ExternalStateApplier applier;
    private final Journal journal;
    private final Json json;

    public InboxService(JdbcClient jdbc, TaskRepository tasks, ExternalStateApplier applier, Journal journal,
                        Json json) {
        this.jdbc = jdbc;
        this.tasks = tasks;
        this.applier = applier;
        this.journal = journal;
        this.json = json;
    }

    @Transactional
    public Outcome receive(String raw) {
        Optional<Result> parsed = parse(raw);
        if (parsed.isEmpty()) {
            // Неразбираемое сообщение не теряем: оператор увидит его в журнале обмена (D05).
            jdbc.sql("INSERT INTO inbox_invalid (raw, error) VALUES (:raw, :error)")
                    .param("raw", raw == null ? "" : raw.length() > 4000 ? raw.substring(0, 4000) : raw)
                    .param("error", "не удалось разобрать: нужны resultId, operationKey, version, outcome")
                    .update();
            return Outcome.INVALID;
        }
        Result r = parsed.get();
        Optional<TaskRow> locked = tasks.lockByOperationKey(r.operationKey());

        String disposition = locked.isEmpty() ? "UNKNOWN_OPERATION"
                : r.version() > locked.get().extVersion() ? "APPLIED" : "STALE";

        int inserted = jdbc.sql("""
                INSERT INTO inbox (result_id, operation_key, version, outcome, executed_at, raw, disposition)
                VALUES (:rid, :key, :version, :outcome, :executedAt, CAST(:raw AS jsonb), :disposition)
                ON CONFLICT (result_id) DO NOTHING
                """)
                .param("rid", r.resultId())
                .param("key", r.operationKey())
                .param("version", r.version())
                .param("outcome", r.outcome())
                .param("executedAt", r.executedAt() == null ? null : java.sql.Timestamp.from(r.executedAt()))
                .param("raw", raw)
                .param("disposition", disposition)
                .update();

        if (locked.isEmpty()) {
            return inserted == 1 ? Outcome.UNKNOWN_OPERATION : Outcome.DUPLICATE;
        }
        TaskRow task = locked.get();
        if (inserted == 0) {
            journal.system(task.id(), "RESULT_DUPLICATE", null, null,
                    Map.of("resultId", r.resultId(), "version", r.version(), "outcome", r.outcome(),
                            "note", "повтор уже полученного сообщения — без изменений"));
            return Outcome.DUPLICATE;
        }
        if ("STALE".equals(disposition)) {
            journal.system(task.id(), "RESULT_STALE", null, null,
                    Map.of("resultId", r.resultId(), "version", r.version(), "outcome", r.outcome(),
                            "appliedVersion", task.extVersion(),
                            "note", "версия не новее уже применённой — без изменений"));
            return Outcome.STALE;
        }
        applier.apply(task, r.outcome(), r.version(), r.executedAt(), "RESULT", Map.of("resultId", r.resultId()));
        return Outcome.APPLIED;
    }

    private Optional<Result> parse(String raw) {
        try {
            Map<String, Object> m = json.readMap(raw);
            if (m == null || !(m.get("version") instanceof Number v) || !(m.get("outcome") instanceof String o)
                    || !OUTCOMES.contains(o) || m.get("resultId") == null || m.get("operationKey") == null) {
                return Optional.empty();
            }
            Object ex = m.get("executedAt");
            return Optional.of(new Result(UUID.fromString(m.get("resultId").toString()),
                    UUID.fromString(m.get("operationKey").toString()), v.intValue(), o,
                    ex == null ? null : Instant.parse(ex.toString())));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}
