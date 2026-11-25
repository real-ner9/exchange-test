package com.example.exchange.appapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** D07: инициатор видит свои задания, оператор занимается обменом; проверки на сервере. */
class RolesTest extends IntegrationTest {

    @Test
    void anonymousGets401() {
        assertThat(anonymous().get("/api/tasks").status()).isEqualTo(401);
        assertThat(anonymous().get("/api/operator/summary").status()).isEqualTo(401);
    }

    @Test
    void wrongPasswordIsRejected() {
        var res = anonymous().post("/api/auth/login", Map.of("login", "ivanov", "password", "nope"));
        assertThat(res.status()).isEqualTo(401);
    }

    @Test
    void operatorCannotCreateTasks() {
        var res = as("operator").post("/api/tasks", Map.of("clientRequestId", UUID.randomUUID(), "title", "от чужого имени"));
        assertThat(res.status()).isEqualTo(403);
        assertThat(jdbc.sql("SELECT count(*) FROM tasks").query(Long.class).single()).isZero();
    }

    @Test
    void initiatorCannotUseOperatorApi() {
        var ivanov = as("ivanov");
        UUID id = create(ivanov, "Моё задание");

        assertThat(ivanov.get("/api/operator/summary").status()).isEqualTo(403);
        assertThat(ivanov.get("/api/operator/tasks/" + id).status()).isEqualTo(403);
        assertThat(ivanov.post("/api/operator/tasks/" + id + "/close", Map.of("version", 0, "reason", "сам себе закрою"))
                .status()).isEqualTo(403);
        assertThat(ivanov.post("/api/operator/demo/faults", Map.of("reset", true)).status()).isEqualTo(403);
    }

    @Test
    void initiatorSeesOnlyOwnTasks() {
        UUID ivanovTask = create(as("ivanov"), "Задание Иванова");
        var petrova = as("petrova");
        create(petrova, "Задание Петровой");

        assertThat(petrova.get("/api/tasks/" + ivanovTask).status()).isEqualTo(404);
        var list = petrova.get("/api/tasks");
        assertThat(list.get("total")).isEqualTo(1);
    }
}
