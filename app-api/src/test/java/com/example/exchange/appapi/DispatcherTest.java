package com.example.exchange.appapi;

import static com.example.exchange.appapi.support.FakeExternal.loseResponse;
import static com.example.exchange.appapi.support.FakeExternal.retryAfter;
import static com.example.exchange.appapi.support.FakeExternal.respondWith;
import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.Test;

import com.example.exchange.appapi.support.FakeExternal;

/** D03, D04, D05: доставка, классификация ошибок, повторы, проверка статуса после потерянного ответа. */
class DispatcherTest extends IntegrationTest {

    @Test
    void acceptedDeliveryMovesTaskToAccepted() {
        UUID id = create(as("ivanov"), "Обычное");

        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("ACCEPTED");
        assertThat(external.postsFor(operationKey(id))).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM outbox WHERE processed_at IS NULL").query(Long.class).single()).isZero();
    }

    @Test
    void transientErrorIsRetriedWithSameOperationKeyAndNewAttemptId() {
        external.then(respondWith(503, "{\"error\":\"UNAVAILABLE\"}"));
        UUID id = create(as("ivanov"), "Во время сбоя");

        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("RETRY_WAIT");
        Instant next = ((Timestamp) task(id).get("next_attempt_at")).toInstant();
        assertThat(next).isAfter(Instant.now());

        makeDue();
        dispatcher.runOnce();

        UUID key = operationKey(id);
        assertThat(status(id)).isEqualTo("ACCEPTED");
        assertThat(external.postsFor(key)).isEqualTo(2);
        List<UUID> attempts = external.attemptIds.get(key);
        assertThat(attempts).hasSize(2).doesNotHaveDuplicates();
    }

    @Test
    void retryAfterHeaderIsRespected() {
        external.then(retryAfter(120));
        UUID id = create(as("ivanov"), "Перегрузка");

        dispatcher.runOnce();

        Instant next = ((Timestamp) task(id).get("next_attempt_at")).toInstant();
        assertThat(next).isBetween(Instant.now().plusSeconds(100), Instant.now().plusSeconds(125));
    }

    @Test
    void backoffGrowsExponentially() {
        UUID id = create(as("ivanov"), "Долгий сбой");
        List<Duration> delays = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            external.then(respondWith(503, "{}"));
            makeDue();
            Instant before = Instant.now();
            dispatcher.runOnce();
            delays.add(Duration.between(before, ((Timestamp) task(id).get("next_attempt_at")).toInstant()));
        }
        // 1с, 2с, 4с, 8с с разбросом ±20%
        assertThat(delays.get(0).toMillis()).isBetween(700L, 1300L);
        assertThat(delays.get(3).toMillis()).isBetween(6200L, 9800L);
    }

    @Test
    void longRetryIsFlaggedForOperatorButRetriesContinue() {
        UUID id = create(as("ivanov"), "Не проходит");
        for (int i = 0; i < 3; i++) { // в тестах порог — 3 попытки
            external.then(respondWith(503, "{}"));
            makeDue();
            dispatcher.runOnce();
        }

        var t = task(id);
        assertThat(t.get("status")).isEqualTo("RETRY_WAIT");
        assertThat(t.get("attention_reason")).isEqualTo("LONG_RETRY");
        assertThat(events(id, "ATTENTION_LONG_RETRY")).isEqualTo(1);
        var queue = as("operator").get("/api/operator/tasks?view=attention");
        assertThat(queue.get("total")).isEqualTo(1);

        makeDue();
        dispatcher.runOnce();
        assertThat(status(id)).isEqualTo("ACCEPTED");
    }

    @Test
    void contentRejectionIsNotRetried() {
        external.then(respondWith(422, "{\"error\":\"REJECTED_CONTENT\",\"reason\":\"сумма вне лимита\"}"));
        UUID id = create(as("ivanov"), "Плохое содержание");

        dispatcher.runOnce();
        makeDue();
        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("REJECTED");
        assertThat(task(id).get("last_error")).isEqualTo("сумма вне лимита");
        assertThat(external.postsFor(operationKey(id))).isEqualTo(1);
        var view = as("ivanov").get("/api/tasks/" + id).map();
        assertThat(((java.util.Map<?, ?>) view.get("status")).get("label")).isEqualTo("Требует решения");
    }

    @Test
    void unparseableResponseGoesToOperator() {
        external.then(respondWith(200, "<html>gateway</html>"));
        UUID id = create(as("ivanov"), "Мусор в ответе");

        dispatcher.runOnce();

        var t = task(id);
        assertThat(t.get("status")).isEqualTo("NEEDS_ATTENTION");
        assertThat(t.get("attention_reason")).isEqualTo("UNPARSEABLE");
        String raw = jdbc.sql("SELECT raw_response FROM attempts WHERE task_id = :id").param("id", id)
                .query(String.class).single();
        assertThat(raw).contains("<html>");
    }

    @Test
    void lostResponseLeadsToStatusCheckInsteadOfSecondSend() {
        external.then(loseResponse(1500)); // таймаут клиента в тестах 500 мс
        UUID id = create(as("ivanov"), "Ответ потерян");
        UUID key = operationKey(id);

        dispatcher.runOnce();
        assertThat(status(id)).isEqualTo("RETRY_WAIT");
        assertThat(jdbc.sql("SELECT outcome FROM attempts WHERE task_id = :id").param("id", id)
                .query(String.class).single()).isEqualTo("UNCERTAIN");

        makeDue();
        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("ACCEPTED");
        assertThat(external.statusChecks.get()).isEqualTo(1);
        assertThat(external.postsFor(key)).isEqualTo(1); // повторной отправки не было
        assertThat(jdbc.sql("SELECT outcome FROM attempts WHERE task_id = :id ORDER BY started_at DESC LIMIT 1")
                .param("id", id).query(String.class).single()).isEqualTo("CHECKED_KNOWN");
    }

    @Test
    void lostResponseWhenOperationNeverArrivedSendsAgain() {
        external.then(respondWith(504, "{}"));
        UUID id = create(as("ivanov"), "Шлюз");
        dispatcher.runOnce();
        // 504 — запрос мог не дойти, но это определённый ответ: проверка статуса не нужна
        makeDue();
        dispatcher.runOnce();
        assertThat(external.statusChecks.get()).isZero();
        assertThat(status(id)).isEqualTo("ACCEPTED");
    }

    @Test
    void crashedSendIsRecoveredAfterLeaseWithStatusCheck() {
        UUID id = create(as("ivanov"), "Отправщик упал");
        UUID key = operationKey(id);
        // Имитация: отправщик взял задание, начал попытку, внешняя система приняла, процесс упал до фиксации.
        jdbc.sql("UPDATE tasks SET status = 'SENDING' WHERE id = :id").param("id", id).update();
        jdbc.sql("INSERT INTO attempts (id, task_id, operation_key, trigger) VALUES (:a, :id, :key, 'AUTO')")
                .param("a", UUID.randomUUID()).param("id", id).param("key", key).update();
        external.ops.put(key, new FakeExternal.Op("RECEIVED", 1));
        makeDue(); // аренда истекла

        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("ACCEPTED");
        assertThat(external.statusChecks.get()).isEqualTo(1);
        assertThat(external.postsFor(key)).isZero();
    }

    @Test
    void parallelDispatchersNeverSendTheSameTaskTwice() throws Exception {
        var ivanov = as("ivanov");
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            ids.add(create(ivanov, "Пачка " + i));
        }

        try (var pool = Executors.newFixedThreadPool(4)) {
            for (int round = 0; round < 6; round++) {
                var futures = new ArrayList<java.util.concurrent.Future<Integer>>();
                for (int w = 0; w < 4; w++) {
                    futures.add(pool.submit(dispatcher::runOnce));
                }
                for (var f : futures) {
                    f.get();
                }
            }
        }

        for (UUID id : ids) {
            assertThat(external.postsFor(operationKey(id))).as("posts for " + id).isEqualTo(1);
            assertThat(status(id)).isEqualTo("ACCEPTED");
        }
    }
}
