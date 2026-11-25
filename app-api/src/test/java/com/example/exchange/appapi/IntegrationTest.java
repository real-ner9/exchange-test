package com.example.exchange.appapi;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.example.exchange.appapi.exchange.Dispatcher;
import com.example.exchange.appapi.support.Api;
import com.example.exchange.appapi.support.FakeExternal;

/**
 * База интеграционных тестов: реальный PostgreSQL (Testcontainers), реальный HTTP-стек приложения,
 * фейковая внешняя система. Отправщик и сверка по расписанию выключены — тест вызывает их явно.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.dispatcher.enabled=false",
        "app.reconcile.enabled=false",
        "app.emulator.timeout-ms=500",
        "app.retry.attention-attempts=3",
        "app.callback-url=http://localhost:1/integration"
})
public abstract class IntegrationTest {

    protected static final FakeExternal external = FakeExternal.start();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("app.emulator.url", external::url);
    }

    @LocalServerPort
    protected int port;

    @Autowired
    protected JdbcClient jdbc;

    @Autowired
    protected Dispatcher dispatcher;

    @BeforeEach
    void cleanState() {
        jdbc.sql("TRUNCATE tasks, outbox, attempts, inbox, inbox_invalid, task_events, discrepancies, reconcile_runs CASCADE")
                .update();
        external.reset();
    }

    protected String base() {
        return "http://localhost:" + port;
    }

    protected Api as(String login) {
        return Api.login(base(), login);
    }

    protected Api anonymous() {
        return new Api(base());
    }

    protected UUID create(Api api, String title) {
        var res = api.post("/api/tasks", Map.of("clientRequestId", UUID.randomUUID(), "title", title));
        if (res.status() != 201) {
            throw new IllegalStateException("create failed: " + res.raw());
        }
        return UUID.fromString(res.get("id").toString());
    }

    protected Map<String, Object> task(UUID id) {
        return jdbc.sql("SELECT * FROM tasks WHERE id = :id").param("id", id).query().singleRow();
    }

    protected String status(UUID id) {
        return task(id).get("status").toString();
    }

    protected UUID operationKey(UUID id) {
        return (UUID) task(id).get("operation_key");
    }

    /** Делает все ожидающие отправки «созревшими» — вместо ожидания backoff. */
    protected void makeDue() {
        jdbc.sql("UPDATE outbox SET available_at = now() - interval '1 second' WHERE processed_at IS NULL").update();
    }

    protected Api.Res result(UUID operationKey, int version, String outcome) {
        return result(UUID.randomUUID(), operationKey, version, outcome);
    }

    protected Api.Res result(UUID resultId, UUID operationKey, int version, String outcome) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("resultId", resultId);
        body.put("operationKey", operationKey);
        body.put("version", version);
        body.put("outcome", outcome);
        body.put("executedAt", "COMPLETED".equals(outcome) ? "2026-11-25T10:00:00Z" : null);
        return anonymous().post("/integration/results", body);
    }

    protected long events(UUID taskId, String kind) {
        return jdbc.sql("SELECT count(*) FROM task_events WHERE task_id = :id AND kind = :kind")
                .param("id", taskId).param("kind", kind).query(Long.class).single();
    }
}
