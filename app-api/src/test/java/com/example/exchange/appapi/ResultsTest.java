package com.example.exchange.appapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.example.exchange.appapi.support.Api;

/** D04: результаты повторяются и задерживаются; порядок — по версии, а не по времени прихода. D02: что видит инициатор. */
class ResultsTest extends IntegrationTest {

    @Test
    void delayedOlderResultDoesNotRollBackCompleted() {
        UUID id = create(as("ivanov"), "Перестановка");
        UUID key = operationKey(id);
        dispatcher.runOnce();

        assertThat(result(key, 2, "COMPLETED").get("status")).isEqualTo("APPLIED");
        assertThat(result(key, 1, "ACCEPTED").get("status")).isEqualTo("STALE");

        assertThat(status(id)).isEqualTo("COMPLETED");
        assertThat(events(id, "RESULT_STALE")).isEqualTo(1);
        assertThat(jdbc.sql("SELECT disposition FROM inbox WHERE operation_key = :k AND version = 1")
                .param("k", key).query(String.class).single()).isEqualTo("STALE");
    }

    @Test
    void duplicateResultIsJournaledAndIgnored() {
        UUID id = create(as("ivanov"), "Дубль");
        UUID key = operationKey(id);
        dispatcher.runOnce();
        UUID resultId = UUID.randomUUID();

        assertThat(result(resultId, key, 2, "COMPLETED").get("status")).isEqualTo("APPLIED");
        int versionAfterFirst = (int) task(id).get("version");
        assertThat(result(resultId, key, 2, "COMPLETED").get("status")).isEqualTo("DUPLICATE");

        assertThat(task(id).get("version")).isEqualTo(versionAfterFirst);
        assertThat(events(id, "RESULT_DUPLICATE")).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM inbox").query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void resultArrivingWhileRetryingStopsRetries() {
        external.then(com.example.exchange.appapi.support.FakeExternal.respondWith(503, "{}"));
        UUID id = create(as("ivanov"), "Результат пришёл во время повторов");
        dispatcher.runOnce();
        assertThat(status(id)).isEqualTo("RETRY_WAIT");

        result(operationKey(id), 2, "COMPLETED");
        makeDue();
        dispatcher.runOnce();

        assertThat(status(id)).isEqualTo("COMPLETED");
        assertThat(external.postsFor(operationKey(id))).isEqualTo(1);
        assertThat(jdbc.sql("SELECT count(*) FROM outbox WHERE processed_at IS NULL").query(Long.class).single()).isZero();
    }

    @Test
    void unparseableResultIsKeptForOperator() {
        var res = anonymous().post("/integration/results", "{\"what\":\"garbage\"}");

        assertThat(res.status()).isEqualTo(400);
        assertThat(jdbc.sql("SELECT count(*) FROM inbox_invalid").query(Long.class).single()).isEqualTo(1);
        assertThat(as("operator").get("/api/operator/invalid-messages").list()).hasSize(1);
    }

    @Test
    void resultForUnknownOperationIsAcknowledged() {
        var res = result(UUID.randomUUID(), 2, "COMPLETED");
        assertThat(res.status()).isEqualTo(200);
        assertThat(res.get("status")).isEqualTo("UNKNOWN_OPERATION");
    }

    @Test
    @SuppressWarnings("unchecked")
    void initiatorSeesAcceptedAsBlueAndOnlyCompletedInReport() {
        Api ivanov = as("ivanov");
        UUID accepted = create(ivanov, "Только принято");
        UUID done = create(ivanov, "Исполнено");
        UUID failed = create(ivanov, "Отказ");
        dispatcher.runOnce();
        result(operationKey(done), 2, "COMPLETED");
        result(operationKey(failed), 2, "FAILED");

        var acceptedView = (Map<String, Object>) ivanov.get("/api/tasks/" + accepted).get("status");
        assertThat(acceptedView).containsEntry("label", "Принято в работу").containsEntry("color", "blue");
        var failedView = (Map<String, Object>) ivanov.get("/api/tasks/" + failed).get("status");
        assertThat(failedView).containsEntry("label", "Не выполнено").containsEntry("needsAction", true);

        var report = ivanov.get("/api/tasks/report");
        assertThat(report.get("count")).isEqualTo(1);
        var items = (java.util.List<Map<String, Object>>) report.get("items");
        assertThat(items.getFirst().get("id")).isEqualTo(done.toString());
    }
}
