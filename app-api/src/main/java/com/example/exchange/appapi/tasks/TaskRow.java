package com.example.exchange.appapi.tasks;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

/** Строка таблицы tasks. */
public record TaskRow(
        UUID id,
        UUID initiatorId,
        String initiatorName,
        UUID clientRequestId,
        UUID operationKey,
        String title,
        String payloadJson,
        TaskStatus status,
        String attentionReason,
        boolean confirmedAfterManualClose,
        int extVersion,
        String extStatus,
        int attemptsCount,
        Instant firstAttemptAt,
        Instant nextAttemptAt,
        String lastError,
        Instant completedAt,
        String closedReason,
        int version,
        Instant createdAt,
        Instant updatedAt) {

    public static final String COLUMNS = """
            t.id, t.initiator_id, u.display_name AS initiator_name, t.client_request_id, t.operation_key, t.title,
            t.payload::text AS payload, t.status, t.attention_reason, t.confirmed_after_manual_close, t.ext_version,
            t.ext_status, t.attempts_count, t.first_attempt_at, t.next_attempt_at, t.last_error, t.completed_at,
            t.closed_reason, t.version, t.created_at, t.updated_at
            """;

    public static final String FROM = " FROM tasks t JOIN users u ON u.id = t.initiator_id ";

    public static TaskRow map(ResultSet rs, int i) throws SQLException {
        return new TaskRow(
                rs.getObject("id", UUID.class),
                rs.getObject("initiator_id", UUID.class),
                rs.getString("initiator_name"),
                rs.getObject("client_request_id", UUID.class),
                rs.getObject("operation_key", UUID.class),
                rs.getString("title"),
                rs.getString("payload"),
                TaskStatus.valueOf(rs.getString("status")),
                rs.getString("attention_reason"),
                rs.getBoolean("confirmed_after_manual_close"),
                rs.getInt("ext_version"),
                rs.getString("ext_status"),
                rs.getInt("attempts_count"),
                instant(rs.getTimestamp("first_attempt_at")),
                instant(rs.getTimestamp("next_attempt_at")),
                rs.getString("last_error"),
                instant(rs.getTimestamp("completed_at")),
                rs.getString("closed_reason"),
                rs.getInt("version"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")));
    }

    private static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}
