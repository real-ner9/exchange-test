package com.example.exchange.appapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;

import com.example.exchange.appapi.support.Api;

/** D01: двойной клик не плодит задания, но одинаковые по содержанию заявки — разные поручения. D07: outbox. */
class CreateTaskTest extends IntegrationTest {

    @Test
    void repeatWithSameFormKeyReturnsSameTask() {
        Api ivanov = as("ivanov");
        UUID formKey = UUID.randomUUID();
        Map<String, Object> body = Map.of("clientRequestId", formKey, "title", "Оплата счёта 42", "amount", 100);

        var first = ivanov.post("/api/tasks", body);
        var second = ivanov.post("/api/tasks", body);

        assertThat(first.status()).isEqualTo(201);
        assertThat(second.status()).isEqualTo(200);
        assertThat(second.get("id")).isEqualTo(first.get("id"));
        assertThat(jdbc.sql("SELECT count(*) FROM tasks").query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void concurrentDoubleClicksCreateOneTaskAndOneOutboxRecord() throws Exception {
        Api ivanov = as("ivanov");
        UUID formKey = UUID.randomUUID();
        Map<String, Object> body = Map.of("clientRequestId", formKey, "title", "Двойной клик");

        List<Callable<Integer>> clicks = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            clicks.add(() -> ivanov.post("/api/tasks", body).status());
        }
        List<Integer> codes = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(10)) {
            for (Future<Integer> f : pool.invokeAll(clicks)) {
                codes.add(f.get());
            }
        }

        assertThat(codes).filteredOn(c -> c == 201).hasSize(1);
        assertThat(codes).filteredOn(c -> c == 200).hasSize(9);
        assertThat(jdbc.sql("SELECT count(*) FROM tasks").query(Long.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM outbox").query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void sameContentFromNewFormIsANewTask() {
        Api ivanov = as("ivanov");
        UUID a = create(ivanov, "Одинаковое поручение");
        UUID b = create(ivanov, "Одинаковое поручение");

        assertThat(a).isNotEqualTo(b);
        assertThat(operationKey(a)).isNotEqualTo(operationKey(b));
        var similar = ivanov.get("/api/tasks/similar?title=" + java.net.URLEncoder.encode("Одинаковое поручение",
                java.nio.charset.StandardCharsets.UTF_8));
        assertThat(similar.list()).hasSize(2);
    }

    @Test
    void reusingFormKeyForDifferentContentIsRejected() {
        Api ivanov = as("ivanov");
        UUID formKey = UUID.randomUUID();
        ivanov.post("/api/tasks", Map.of("clientRequestId", formKey, "title", "Первое"));

        var res = ivanov.post("/api/tasks", Map.of("clientRequestId", formKey, "title", "Совсем другое"));

        assertThat(res.status()).isEqualTo(409);
        assertThat(res.get("error")).isEqualTo("IDEMPOTENCY_KEY_REUSED");
    }

    @Test
    void createdTaskIsQueuedInOutboxInSameTransaction() {
        UUID id = create(as("ivanov"), "Не потеряется");

        assertThat(status(id)).isEqualTo("QUEUED");
        assertThat(jdbc.sql("SELECT count(*) FROM outbox WHERE task_id = :id AND processed_at IS NULL")
                .param("id", id).query(Long.class).single()).isEqualTo(1);
        assertThat(events(id, "CREATED")).isEqualTo(1);
    }

    @Test
    void validationErrorsAreReported() {
        var res = as("ivanov").post("/api/tasks", Map.of("clientRequestId", UUID.randomUUID(), "title", " "));
        assertThat(res.status()).isEqualTo(400);
    }
}
