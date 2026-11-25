package com.example.exchange.emulator;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import com.example.exchange.emulator.FaultService.Faults;

/**
 * Результаты уходят в основное приложение из своей очереди с повторами до 2xx —
 * так результат не теряется при недоступности приложения, а повторная доставка
 * для приложения обычна (D04: «входящие результаты могут повторяться и задерживаться»).
 */
@Service
public class ResultOutbox {

    private final JdbcClient jdbc;
    private final RestClient http;

    public ResultOutbox(JdbcClient jdbc, @Value("${emulator.callback-timeout-ms}") long timeoutMs) {
        this.jdbc = jdbc;
        var client = java.net.http.HttpClient.newBuilder().connectTimeout(Duration.ofMillis(timeoutMs)).build();
        var factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    /**
     * Ставит результат в очередь. Режимы сбоев применяются здесь:
     * delay_result — задержка (с reorder: ACCEPTED задерживается, итоговый результат — нет,
     * и промежуточный приходит позже итогового); duplicate_result — два сообщения с одним resultId.
     */
    public void enqueue(UUID key, int version, String outcome, Instant executedAt, String callbackUrl, Faults faults) {
        double delaySec = 0;
        if (faults.on("delay_result")) {
            var f = faults.get("delay_result");
            double seconds = f.num("seconds", 10);
            boolean reorder = f.flag("reorder", true);
            delaySec = !reorder || "ACCEPTED".equals(outcome) ? seconds : 0;
        }
        int copies = faults.on("duplicate_result") ? 2 : 1;
        UUID resultId = UUID.randomUUID();
        for (int i = 0; i < copies; i++) {
            jdbc.sql("""
                    INSERT INTO result_outbox (result_id, operation_key, version, outcome, callback_url, executed_at, deliver_after)
                    VALUES (:rid, :key, :version, :outcome, :callback, :executedAt, now() + make_interval(secs => :delay))
                    """)
                    .param("rid", resultId)
                    .param("key", key)
                    .param("version", version)
                    .param("outcome", outcome)
                    .param("callback", callbackUrl)
                    .param("executedAt", executedAt == null ? null : java.sql.Timestamp.from(executedAt))
                    .param("delay", delaySec)
                    .update();
        }
    }

    /** Доставляет одно созревшее сообщение. false — доставлять нечего. */
    @Transactional
    public boolean deliverNext() {
        record Pending(long id, UUID resultId, UUID key, int version, String outcome, String callbackUrl,
                       Instant executedAt, int attempts) {}
        Optional<Pending> next = jdbc.sql("""
                SELECT id, result_id, operation_key, version, outcome, callback_url, executed_at, attempts
                FROM result_outbox
                WHERE delivered_at IS NULL AND deliver_after <= now()
                ORDER BY deliver_after, id
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """)
                .query((rs, i) -> {
                    var ex = rs.getTimestamp("executed_at");
                    return new Pending(rs.getLong("id"), rs.getObject("result_id", UUID.class),
                            rs.getObject("operation_key", UUID.class), rs.getInt("version"),
                            rs.getString("outcome"), rs.getString("callback_url"),
                            ex == null ? null : ex.toInstant(), rs.getInt("attempts"));
                })
                .optional();
        if (next.isEmpty()) {
            return false;
        }
        Pending p = next.get();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("resultId", p.resultId());
        body.put("operationKey", p.key());
        body.put("version", p.version());
        body.put("outcome", p.outcome());
        body.put("executedAt", p.executedAt());
        body.put("sentAt", Instant.now());

        String error = null;
        try {
            http.post()
                    .uri(p.callbackUrl() + "/results")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            error = e.getClass().getSimpleName() + ": " + e.getMessage();
        }

        if (error == null) {
            jdbc.sql("UPDATE result_outbox SET delivered_at = now(), attempts = attempts + 1 WHERE id = :id")
                    .param("id", p.id()).update();
        } else {
            // экспоненциальная задержка 1, 2, 4 … 60 с
            long backoff = Math.min(60, 1L << Math.min(p.attempts(), 6));
            jdbc.sql("""
                    UPDATE result_outbox
                    SET attempts = attempts + 1, last_error = :error,
                        deliver_after = now() + make_interval(secs => :backoff)
                    WHERE id = :id
                    """)
                    .param("error", error.length() > 500 ? error.substring(0, 500) : error)
                    .param("backoff", (double) backoff)
                    .param("id", p.id())
                    .update();
        }
        return true;
    }
}
