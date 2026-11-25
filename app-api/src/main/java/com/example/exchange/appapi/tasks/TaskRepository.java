package com.example.exchange.appapi.tasks;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class TaskRepository {

    private final JdbcClient jdbc;

    public TaskRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<TaskRow> find(UUID id) {
        return jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + "WHERE t.id = :id")
                .param("id", id).query(TaskRow::map).optional();
    }

    /** Блокирует строку задания до конца транзакции. Вызывать внутри @Transactional. */
    public Optional<TaskRow> lock(UUID id) {
        return jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + "WHERE t.id = :id FOR UPDATE OF t")
                .param("id", id).query(TaskRow::map).optional();
    }

    public Optional<TaskRow> lockByOperationKey(UUID operationKey) {
        return jdbc.sql("SELECT " + TaskRow.COLUMNS + TaskRow.FROM + "WHERE t.operation_key = :key FOR UPDATE OF t")
                .param("key", operationKey).query(TaskRow::map).optional();
    }
}
