package com.example.exchange.appapi.operator;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.exchange.appapi.auth.AppUser;
import com.example.exchange.appapi.common.ApiException;
import com.example.exchange.appapi.exchange.EmulatorClient;
import com.example.exchange.appapi.exchange.EmulatorClient.OperationView;
import com.example.exchange.appapi.tasks.ExternalStateApplier;
import com.example.exchange.appapi.tasks.Journal;
import com.example.exchange.appapi.tasks.TaskRepository;
import com.example.exchange.appapi.tasks.TaskRow;
import com.example.exchange.appapi.tasks.TaskStatus;

/**
 * Сверка с внешней системой (D06, D07). Сравнивает наше состояние с GET /operations:
 * <ul>
 *   <li>у них новее (у нас «Отправляется», у них «Выполнено») — применяем их состояние, фиксируем как AUTO_FIXED;</li>
 *   <li>у нас закрыто вручную, у них не исполнялось — CLOSED_NOT_EXECUTED, решает оператор;</li>
 *   <li>у нас принято/исполнено, у них операции нет — MISSING_THERE;</li>
 *   <li>итоговые статусы противоречат друг другу — STATUS_CONFLICT;</li>
 *   <li>у них есть операция, которой нет у нас — UNKNOWN_HERE.</li>
 * </ul>
 * Открытые расхождения не дублируются между прогонами и закрываются сами, если перестали подтверждаться.
 */
@Service
public class ReconcileService {

    private static final Logger log = LoggerFactory.getLogger(ReconcileService.class);

    private record Ours(UUID id, UUID key, TaskStatus status, int extVersion) {}

    private record Mismatch(UUID taskId, UUID key, String ours, String theirs, String kind) {}

    private final JdbcClient jdbc;
    private final EmulatorClient client;
    private final TaskRepository tasks;
    private final ExternalStateApplier applier;
    private final Journal journal;
    private final OperatorService operator;
    private final TransactionTemplate tx;
    private final boolean scheduledEnabled;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public ReconcileService(JdbcClient jdbc, EmulatorClient client, TaskRepository tasks, ExternalStateApplier applier,
                            Journal journal, OperatorService operator, TransactionTemplate tx,
                            @Value("${app.reconcile.enabled}") boolean scheduledEnabled) {
        this.jdbc = jdbc;
        this.client = client;
        this.tasks = tasks;
        this.applier = applier;
        this.journal = journal;
        this.operator = operator;
        this.tx = tx;
        this.scheduledEnabled = scheduledEnabled;
    }

    @Scheduled(fixedDelayString = "${app.reconcile.interval-ms}", initialDelayString = "${app.reconcile.interval-ms}")
    public void scheduled() {
        if (scheduledEnabled) {
            try {
                run(null);
            } catch (ApiException e) {
                log.info("scheduled reconcile skipped: {}", e.getMessage());
            }
        }
    }

    public Map<String, Object> run(UUID startedBy) {
        if (!running.compareAndSet(false, true)) {
            throw ApiException.invalidState("Сверка уже выполняется.");
        }
        try {
            return doRun(startedBy);
        } finally {
            running.set(false);
        }
    }

    private Map<String, Object> doRun(UUID startedBy) {
        long runId = jdbc.sql("INSERT INTO reconcile_runs (started_by) VALUES (:by) RETURNING id")
                .param("by", startedBy).query(Long.class).single();

        // 1. Состояние внешней системы целиком (постранично).
        Map<UUID, OperationView> theirs = new HashMap<>();
        try {
            Instant since = Instant.EPOCH;
            while (true) {
                var page = client.list(since, 1000);
                page.items().forEach(op -> theirs.put(op.operationKey(), op));
                // граница включительная: повторы на стыке страниц убирает Map
                if (page.items().size() < 1000 || !page.nextSince().isAfter(since)) {
                    break;
                }
                since = page.nextSince();
            }
        } catch (Exception e) {
            jdbc.sql("UPDATE reconcile_runs SET finished_at = now(), error = :e WHERE id = :id")
                    .param("e", "внешняя система недоступна: " + e.getMessage()).param("id", runId).update();
            return runView(runId);
        }

        // 2. Наше состояние.
        List<Ours> ours = jdbc.sql("SELECT id, operation_key, status, ext_version FROM tasks")
                .query((rs, i) -> new Ours(rs.getObject("id", UUID.class), rs.getObject("operation_key", UUID.class),
                        TaskStatus.valueOf(rs.getString("status")), rs.getInt("ext_version")))
                .list();

        Set<String> current = new HashSet<>();
        int mismatches = 0;
        for (Ours o : ours) {
            OperationView op = theirs.remove(o.key());
            TaskStatus status = o.status();

            if (op != null && op.version() > o.extVersion()) {
                // У них новее — применяем по общим правилам и фиксируем как авто-исправление.
                TaskStatus before = status;
                status = tx.execute(s -> {
                    TaskRow locked = tasks.lock(o.id()).orElseThrow();
                    applier.apply(locked, op.status(), op.version(), op.executedAt(), "RECONCILE",
                            Map.of("reconcileRunId", runId));
                    return tasks.find(o.id()).orElseThrow().status();
                });
                insertResolved(runId, new Mismatch(o.id(), o.key(), before.name(), op.status(), "AUTO_FIXED"),
                        "применено состояние внешней системы: " + before + " → " + status);
                mismatches++;
            }

            Mismatch m = classify(o, status, op);
            if (m != null) {
                current.add(m.key() + "|" + m.kind());
                if (insertOpen(runId, m)) {
                    mismatches++;
                }
            }
        }
        for (OperationView op : theirs.values()) {
            Mismatch m = new Mismatch(null, op.operationKey(), null, op.status(), "UNKNOWN_HERE");
            current.add(m.key() + "|" + m.kind());
            if (insertOpen(runId, m)) {
                mismatches++;
            }
        }

        // 3. Открытые расхождения, которые больше не подтверждаются, закрываем.
        jdbc.sql("""
                SELECT id, operation_key, kind FROM discrepancies WHERE resolved_at IS NULL
                """)
                .query((rs, i) -> new Object[] {rs.getLong("id"), rs.getObject("operation_key") + "|" + rs.getString("kind")})
                .list()
                .stream()
                .filter(row -> !current.contains((String) row[1]))
                .forEach(row -> jdbc.sql("""
                        UPDATE discrepancies SET resolved_at = now(), resolution = 'не подтвердилось при сверке №' || :run
                        WHERE id = :id
                        """).param("run", runId).param("id", row[0]).update());

        jdbc.sql("UPDATE reconcile_runs SET finished_at = now(), checked = :checked, mismatches = :m WHERE id = :id")
                .param("checked", ours.size()).param("m", mismatches).param("id", runId).update();
        return runView(runId);
    }

    private static Mismatch classify(Ours o, TaskStatus status, OperationView op) {
        String theirs = op == null ? null : op.status();
        boolean executedThere = op != null && ("EXECUTED".equals(theirs) || "FAILED".equals(theirs));
        if (status == TaskStatus.MANUALLY_CLOSED && !executedThere) {
            return new Mismatch(o.id(), o.key(), status.name(), theirs, "CLOSED_NOT_EXECUTED");
        }
        if (op == null && (status == TaskStatus.ACCEPTED || status == TaskStatus.COMPLETED || status == TaskStatus.FAILED)) {
            return new Mismatch(o.id(), o.key(), status.name(), null, "MISSING_THERE");
        }
        if (op != null && (status == TaskStatus.REJECTED
                || (status == TaskStatus.COMPLETED && !"EXECUTED".equals(theirs))
                || (status == TaskStatus.FAILED && !"FAILED".equals(theirs)))) {
            return new Mismatch(o.id(), o.key(), status.name(), theirs, "STATUS_CONFLICT");
        }
        return null;
    }

    /** Новое открытое расхождение; если такое уже открыто — не дублируем. */
    private boolean insertOpen(long runId, Mismatch m) {
        boolean exists = jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM discrepancies WHERE operation_key = :key AND kind = :kind AND resolved_at IS NULL)
                """)
                .param("key", m.key()).param("kind", m.kind()).query(Boolean.class).single();
        if (exists) {
            return true;
        }
        jdbc.sql("""
                INSERT INTO discrepancies (run_id, task_id, operation_key, our_status, their_status, kind)
                VALUES (:run, :task, :key, :ours, :theirs, :kind)
                """)
                .param("run", runId).param("task", m.taskId()).param("key", m.key())
                .param("ours", m.ours()).param("theirs", m.theirs()).param("kind", m.kind())
                .update();
        if (m.taskId() != null) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("reconcileRunId", runId);
            d.put("kind", m.kind());
            d.put("theirStatus", m.theirs());
            journal.system(m.taskId(), "RECONCILE_MISMATCH", null, null, d);
        }
        return true;
    }

    private void insertResolved(long runId, Mismatch m, String resolution) {
        jdbc.sql("""
                INSERT INTO discrepancies (run_id, task_id, operation_key, our_status, their_status, kind, resolved_at, resolution)
                VALUES (:run, :task, :key, :ours, :theirs, :kind, now(), :resolution)
                """)
                .param("run", runId).param("task", m.taskId()).param("key", m.key())
                .param("ours", m.ours()).param("theirs", m.theirs()).param("kind", m.kind())
                .param("resolution", resolution)
                .update();
    }

    /**
     * Решение оператора по расхождению: RESEND — отправить заново (ручной повтор),
     * CLOSE_FINAL — оставить закрытым окончательно, ACKNOWLEDGE — принято к сведению. Комментарий обязателен.
     */
    public Map<String, Object> resolve(AppUser user, long id, String action, String comment) {
        if (comment == null || comment.trim().length() < 5) {
            throw ApiException.badRequest("Укажите комментарий к решению (не короче 5 символов).");
        }
        if (!Set.of("RESEND", "CLOSE_FINAL", "ACKNOWLEDGE").contains(action)) {
            throw ApiException.badRequest("Действие: RESEND, CLOSE_FINAL или ACKNOWLEDGE.");
        }
        return tx.execute(s -> {
            var row = jdbc.sql("SELECT task_id, kind, resolved_at FROM discrepancies WHERE id = :id FOR UPDATE")
                    .param("id", id)
                    .query((rs, i) -> new Object[] {rs.getObject("task_id", UUID.class), rs.getString("kind"),
                            rs.getTimestamp("resolved_at")})
                    .optional()
                    .orElseThrow(() -> ApiException.notFound("Расхождение не найдено"));
            if (row[2] != null) {
                throw ApiException.invalidState("Расхождение уже разобрано.");
            }
            UUID taskId = (UUID) row[0];
            if ("RESEND".equals(action)) {
                if (taskId == null) {
                    throw ApiException.invalidState("У этого расхождения нет нашего задания — переотправлять нечего.");
                }
                TaskRow t = tasks.find(taskId).orElseThrow();
                operator.retry(user, taskId, t.version(), "Сверка: " + comment.trim());
            } else if (taskId != null) {
                journal.record(taskId, user.id(), "RECONCILE_RESOLVED", null, null, comment.trim(),
                        Map.of("discrepancyId", id, "action", action, "kind", row[1]));
            }
            jdbc.sql("""
                    UPDATE discrepancies SET resolved_at = now(), resolved_by = :by, resolution = :res WHERE id = :id
                    """)
                    .param("by", user.id()).param("res", action + ": " + comment.trim()).param("id", id).update();
            return Map.<String, Object>of("id", id, "resolved", true);
        });
    }

    public Map<String, Object> discrepancies(boolean openOnly, int page, int size) {
        int limit = Math.min(Math.max(size, 1), 200);
        String where = openOnly ? " WHERE d.resolved_at IS NULL" : "";
        var items = jdbc.sql("""
                        SELECT d.id, d.run_id, d.task_id, t.title, d.operation_key, d.our_status, d.their_status, d.kind,
                               d.resolved_at, d.resolution, u.display_name AS resolved_by, r.started_at AS found_at
                        FROM discrepancies d
                        LEFT JOIN tasks t ON t.id = d.task_id
                        LEFT JOIN users u ON u.id = d.resolved_by
                        JOIN reconcile_runs r ON r.id = d.run_id
                        """ + where + " ORDER BY d.id DESC LIMIT :limit OFFSET :offset")
                .param("limit", limit).param("offset", Math.max(page, 0) * limit)
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("runId", rs.getLong("run_id"));
                    m.put("taskId", rs.getObject("task_id", UUID.class));
                    m.put("taskTitle", rs.getString("title"));
                    m.put("operationKey", rs.getObject("operation_key", UUID.class));
                    m.put("ourStatus", rs.getString("our_status"));
                    m.put("theirStatus", rs.getString("their_status"));
                    m.put("kind", rs.getString("kind"));
                    m.put("foundAt", rs.getTimestamp("found_at").toInstant());
                    m.put("resolvedAt", rs.getTimestamp("resolved_at") == null ? null : rs.getTimestamp("resolved_at").toInstant());
                    m.put("resolution", rs.getString("resolution"));
                    m.put("resolvedBy", rs.getString("resolved_by"));
                    return m;
                }).list();
        long total = jdbc.sql("SELECT count(*) FROM discrepancies d" + where).query(Long.class).single();
        return Map.of("items", items, "total", total);
    }

    public List<Map<String, Object>> runs() {
        return jdbc.sql("SELECT id FROM reconcile_runs ORDER BY id DESC LIMIT 20")
                .query(Long.class).list().stream().map(this::runView).toList();
    }

    private Map<String, Object> runView(long id) {
        return jdbc.sql("""
                        SELECT r.id, r.started_at, r.finished_at, r.checked, r.mismatches, r.error, u.display_name
                        FROM reconcile_runs r LEFT JOIN users u ON u.id = r.started_by WHERE r.id = :id
                        """)
                .param("id", id)
                .query((rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("startedAt", rs.getTimestamp("started_at").toInstant());
                    m.put("finishedAt", rs.getTimestamp("finished_at") == null ? null : rs.getTimestamp("finished_at").toInstant());
                    m.put("checked", rs.getInt("checked"));
                    m.put("mismatches", rs.getInt("mismatches"));
                    m.put("error", rs.getString("error"));
                    m.put("startedBy", rs.getString("display_name") == null ? "автоматически" : rs.getString("display_name"));
                    return m;
                }).single();
    }
}
