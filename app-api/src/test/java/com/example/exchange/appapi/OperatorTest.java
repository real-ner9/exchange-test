package com.example.exchange.appapi;

import static com.example.exchange.appapi.support.FakeExternal.respondWith;
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
import com.example.exchange.appapi.support.FakeExternal;

/** D05, D06, D07: ручной повтор, «Закрыть без подтверждения», сверка, одновременные действия операторов. */
class OperatorTest extends IntegrationTest {

    private int version(UUID id) {
        return (int) task(id).get("version");
    }

    private UUID stuckTask(String title) {
        external.then(respondWith(503, "{}"));
        UUID id = create(as("ivanov"), title);
        dispatcher.runOnce();
        assertThat(status(id)).isEqualTo("RETRY_WAIT");
        return id;
    }

    @Test
    void closeRequiresReason() {
        UUID id = stuckTask("Без причины");
        var res = as("operator").post("/api/operator/tasks/" + id + "/close", Map.of("version", version(id), "reason", "  "));
        assertThat(res.status()).isEqualTo(400);
        assertThat(status(id)).isEqualTo("RETRY_WAIT");
    }

    @Test
    void closeWithoutConfirmationStopsRetriesButIsNotCompleted() {
        UUID id = stuckTask("Закрыть вручную");
        Api operator = as("operator");

        var res = operator.post("/api/operator/tasks/" + id + "/close",
                Map.of("version", version(id), "reason", "партнёр подтвердил по телефону"));

        assertThat(res.status()).isEqualTo(200);
        assertThat(status(id)).isEqualTo("MANUALLY_CLOSED");
        // повторы остановлены
        makeDue();
        dispatcher.runOnce();
        assertThat(external.postsFor(operationKey(id))).isEqualTo(1);
        // не «Выполнено» и не в отчёте
        var initiator = as("ivanov");
        @SuppressWarnings("unchecked")
        var st = (Map<String, Object>) initiator.get("/api/tasks/" + id).get("status");
        assertThat(st.get("label")).isEqualTo("Решается оператором");
        assertThat(initiator.get("/api/tasks/report").get("count")).isEqualTo(0);
        // журнал: кто, когда, причина, до и после
        var ev = jdbc.sql("""
                SELECT e.from_status, e.to_status, e.reason, u.login FROM task_events e JOIN users u ON u.id = e.actor_id
                WHERE e.task_id = :id AND e.kind = 'MANUALLY_CLOSED'
                """).param("id", id).query().singleRow();
        assertThat(ev).containsEntry("from_status", "RETRY_WAIT").containsEntry("to_status", "MANUALLY_CLOSED")
                .containsEntry("reason", "партнёр подтвердил по телефону").containsEntry("login", "operator");
    }

    @Test
    void lateExecutionResultConfirmsManuallyClosedTask() {
        UUID id = create(as("ivanov"), "Принято, результата нет");
        dispatcher.runOnce();
        as("operator").post("/api/operator/tasks/" + id + "/close", Map.of("version", version(id), "reason", "долго нет результата"));

        result(operationKey(id), 2, "COMPLETED");

        var t = task(id);
        assertThat(t.get("status")).isEqualTo("COMPLETED");
        assertThat(t.get("confirmed_after_manual_close")).isEqualTo(true);
        assertThat(events(id, "CONFIRMED_AFTER_MANUAL_CLOSE")).isEqualTo(1);
        assertThat(as("ivanov").get("/api/tasks/report").get("count")).isEqualTo(1);
    }

    @Test
    void acceptedResultDoesNotReopenManuallyClosedTask() {
        UUID id = stuckTask("Закрыто, потом пришло «принято»");
        as("operator").post("/api/operator/tasks/" + id + "/close", Map.of("version", version(id), "reason", "закрываю"));

        result(operationKey(id), 1, "ACCEPTED");

        assertThat(status(id)).isEqualTo("MANUALLY_CLOSED");
    }

    @Test
    void twoOperatorsActingOnSameVersionOneWins() throws Exception {
        UUID id = stuckTask("Два оператора");
        int v = version(id);
        Api first = as("operator");
        Api second = as("operator2");

        List<Callable<Integer>> actions = List.of(
                () -> first.post("/api/operator/tasks/" + id + "/close", Map.of("version", v, "reason", "закрывает первый")).status(),
                () -> second.post("/api/operator/tasks/" + id + "/retry", Map.of("version", v, "reason", "повторяет второй")).status());
        List<Integer> codes = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(2)) {
            for (Future<Integer> f : pool.invokeAll(actions)) {
                codes.add(f.get());
            }
        }

        assertThat(codes).containsExactlyInAnyOrder(200, 409);
        long operatorEvents = jdbc.sql("SELECT count(*) FROM task_events WHERE task_id = :id AND kind IN ('MANUALLY_CLOSED', 'MANUAL_RETRY')")
                .param("id", id).query(Long.class).single();
        assertThat(operatorEvents).isEqualTo(1);
    }

    @Test
    void manualRetrySkipsBackoffAndKeepsOperationKey() {
        UUID id = stuckTask("Ручной повтор");
        UUID key = operationKey(id);

        var res = as("operator").post("/api/operator/tasks/" + id + "/retry", Map.of("version", version(id), "reason", "связь есть"));
        assertThat(res.status()).isEqualTo(200);
        dispatcher.runOnce(); // без makeDue: ручной повтор не ждёт backoff

        assertThat(status(id)).isEqualTo("ACCEPTED");
        assertThat(operationKey(id)).isEqualTo(key);
        assertThat(jdbc.sql("SELECT trigger FROM attempts WHERE task_id = :id ORDER BY started_at DESC LIMIT 1")
                .param("id", id).query(String.class).single()).isEqualTo("MANUAL");
    }

    @Test
    void manualRetryDuringSendIsRefused() {
        UUID id = create(as("ivanov"), "Идёт отправка");
        jdbc.sql("UPDATE tasks SET status = 'SENDING' WHERE id = :id").param("id", id).update();

        var res = as("operator").post("/api/operator/tasks/" + id + "/retry", Map.of("version", version(id)));
        assertThat(res.status()).isEqualTo(409);
        assertThat(res.get("error")).isEqualTo("INVALID_STATE");
    }

    @Test
    void reconciliationFixesLaggingStatusAndFlagsManualCloseWithoutExecution() {
        // 1. у нас «повторы», у них уже исполнено (ответ и результат потерялись)
        UUID lagging = stuckTask("У нас отстаёт");
        external.ops.put(operationKey(lagging), new FakeExternal.Op("EXECUTED", 2));
        // 2. закрыто вручную, у них операции нет
        UUID closed = stuckTask("Закрыто, не исполнялось");
        as("operator").post("/api/operator/tasks/" + closed + "/close", Map.of("version", version(closed), "reason", "закрываю на время сбоя"));
        // 3. операция есть только у них
        external.ops.put(UUID.randomUUID(), new FakeExternal.Op("EXECUTED", 2));

        Api operator = as("operator");
        var run = operator.post("/api/operator/reconcile", Map.of());
        assertThat(run.status()).isEqualTo(200);

        assertThat(status(lagging)).isEqualTo("COMPLETED");
        @SuppressWarnings("unchecked")
        var open = (List<Map<String, Object>>) operator.get("/api/operator/discrepancies?open=true").get("items");
        assertThat(open).extracting(m -> m.get("kind")).containsExactlyInAnyOrder("CLOSED_NOT_EXECUTED", "UNKNOWN_HERE");

        // повторный прогон не дублирует открытые расхождения
        operator.post("/api/operator/reconcile", Map.of());
        assertThat(jdbc.sql("SELECT count(*) FROM discrepancies WHERE resolved_at IS NULL").query(Long.class).single())
                .isEqualTo(2);

        // оператор решает: переотправить
        long discrepancyId = ((Number) open.stream().filter(m -> "CLOSED_NOT_EXECUTED".equals(m.get("kind")))
                .findFirst().orElseThrow().get("id")).longValue();
        var resolve = operator.post("/api/operator/discrepancies/" + discrepancyId + "/resolve",
                Map.of("action", "RESEND", "comment", "связь восстановлена, отправляем"));
        assertThat(resolve.status()).isEqualTo(200);
        assertThat(status(closed)).isEqualTo("QUEUED");
        dispatcher.runOnce();
        assertThat(status(closed)).isEqualTo("ACCEPTED");
    }

    @Test
    void reconciliationReportsUnavailableExternalSystem() {
        external.setListUnavailable(true);
        var run = as("operator").post("/api/operator/reconcile", Map.of());
        assertThat(run.status()).isEqualTo(200);
        assertThat(run.get("error").toString()).contains("недоступна");
    }
}
