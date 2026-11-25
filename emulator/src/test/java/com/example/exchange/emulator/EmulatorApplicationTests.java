package com.example.exchange.emulator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** Проверки контракта эмулятора на реальном PostgreSQL (Testcontainers). */
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"emulator.exec-delay-ms=200", "emulator.poll-ms=100"})
class EmulatorApplicationTests {

    @LocalServerPort
    int port;

    RestClient http;

    @BeforeEach
    void setUp() {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newHttpClient());
        factory.setReadTimeout(Duration.ofSeconds(1));
        http = RestClient.builder()
                .baseUrl("http://localhost:" + port)
                .requestFactory(factory)
                .defaultStatusHandler(HttpStatusCode::isError, (req, res) -> {})
                .build();
        resetFaults();
    }

    @AfterEach
    void tearDown() {
        resetFaults();
    }

    @Test
    void concurrentRepeatsOfOneOperationExecuteOnce() throws Exception {
        UUID key = UUID.randomUUID();
        List<Callable<Integer>> sends = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            sends.add(() -> submit(key, "pay #" + key).getStatusCode().value());
        }
        List<Integer> codes = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(20)) {
            for (Future<Integer> f : pool.invokeAll(sends)) {
                codes.add(f.get());
            }
        }

        assertThat(codes).containsOnly(200, 202);
        assertThat(codes).filteredOn(c -> c == 202).hasSize(1);
        awaitStatus(key, "EXECUTED");
        assertThat(executions(key)).containsEntry("executions", 1).containsEntry("receivedAttempts", 20);
    }

    @Test
    void lostResponseThenRetryDoesNotExecuteTwice() throws Exception {
        setFault("lose_response", true, Map.of("rate", 1.0, "hangSeconds", 3));
        UUID key = UUID.randomUUID();

        assertThatThrownBy(() -> submit(key, "lost"))
                .hasRootCauseInstanceOf(java.net.http.HttpTimeoutException.class);

        setFault("lose_response", false, null);
        awaitStatus(key, "EXECUTED");
        var retry = submit(key, "lost");

        assertThat(retry.getStatusCode().value()).isEqualTo(200);
        assertThat(retry.getBody()).containsEntry("alreadyKnown", true);
        assertThat(executions(key)).containsEntry("executions", 1);
    }

    @Test
    void unavailableReturns503AndDoesNotAccept() {
        setFault("unavailable", true, null);
        UUID key = UUID.randomUUID();

        assertThat(submit(key, "x").getStatusCode().value()).isEqualTo(503);

        setFault("unavailable", false, null);
        assertThat(http.get().uri("/operations/{k}", key).retrieve().toBodilessEntity().getStatusCode().value())
                .isEqualTo(404);
    }

    @Test
    void contentRejectionReturns422() {
        setFault("reject_content", true, null);
        var res = submit(UUID.randomUUID(), "bad #reject");

        assertThat(res.getStatusCode().value()).isEqualTo(422);
        assertThat(res.getBody()).containsEntry("error", "REJECTED_CONTENT");
    }

    @Test
    void failExecutionMarksOperationFailed() throws Exception {
        setFault("fail_execution", true, null);
        UUID key = UUID.randomUUID();
        submit(key, "boom #fail");

        var op = awaitStatus(key, "FAILED");
        assertThat(op).containsEntry("outcome", "FAILED").containsEntry("version", 2);
    }

    @Test
    @SuppressWarnings("unchecked")
    void listForReconciliationReturnsOperationsUpdatedSince() throws Exception {
        java.time.Instant before = java.time.Instant.now().minusSeconds(1);
        UUID key = UUID.randomUUID();
        submit(key, "для сверки");
        awaitStatus(key, "EXECUTED");

        Map<String, Object> page = http.get().uri("/operations?updatedSince={s}&limit=1000", before)
                .retrieve().body(Map.class);
        var items = (List<Map<String, Object>>) page.get("items");
        assertThat(items).extracting(m -> m.get("operationKey")).contains(key.toString());
        assertThat(page.get("nextSince")).isNotNull();
    }

    // --- helpers ---

    @SuppressWarnings("unchecked")
    private org.springframework.http.ResponseEntity<Map<String, Object>> submit(UUID key, String title) {
        var body = Map.of("operationKey", key, "attemptId", UUID.randomUUID(),
                "callbackUrl", "http://127.0.0.1:1/unreachable", "payload", Map.of("title", title));
        return (org.springframework.http.ResponseEntity<Map<String, Object>>) (Object)
                http.post().uri("/operations").body(body).retrieve().toEntity(Map.class);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> awaitStatus(UUID key, String status) throws InterruptedException {
        Map<String, Object> op = null;
        for (int i = 0; i < 50; i++) {
            op = http.get().uri("/operations/{k}", key).retrieve().body(Map.class);
            if (op != null && status.equals(op.get("status"))) {
                return op;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("operation " + key + " did not reach " + status + ", last: " + op);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> executions(UUID key) {
        return http.get().uri("/admin/operations/{k}/executions", key).retrieve().body(Map.class);
    }

    private void setFault(String mode, boolean enabled, Map<String, Object> params) {
        var body = new java.util.HashMap<String, Object>();
        body.put("mode", mode);
        body.put("enabled", enabled);
        if (params != null) {
            body.put("params", params);
        }
        http.post().uri("/admin/faults").body(body).retrieve().toBodilessEntity();
    }

    private void resetFaults() {
        http.post().uri("/admin/faults").body(Map.of("reset", true)).retrieve().toBodilessEntity();
    }
}
