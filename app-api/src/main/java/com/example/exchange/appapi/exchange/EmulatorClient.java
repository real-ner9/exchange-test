package com.example.exchange.appapi.exchange;

import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.example.exchange.appapi.common.Json;

/**
 * Клиент внешнего сервиса по контракту docs/contract.md. Ничего не решает про статусы задания —
 * только превращает HTTP-ответ в один из классов исхода (D05).
 */
@Component
public class EmulatorClient {

    /** Исход отправки POST /operations. */
    public sealed interface SendResult permits Accepted, Rejected, Transient, Unparseable, ContractError {}

    /** 202/200: операция у внешней системы есть; status/version — её состояние. */
    public record Accepted(int httpStatus, String status, int version, boolean alreadyKnown, String raw)
            implements SendResult {}

    /** 422: отказ по содержанию, повторять бессмысленно. */
    public record Rejected(int httpStatus, String reason, String raw) implements SendResult {}

    /**
     * Временная ошибка: повторять. uncertain=true — запрос мог дойти и исполниться (таймаут, обрыв),
     * поэтому перед следующей отправкой нужно спросить статус.
     */
    public record Transient(Integer httpStatus, String error, Long retryAfterSeconds, boolean uncertain, String raw)
            implements SendResult {}

    /** Ответ 2xx, который не удалось разобрать. Операция могла быть принята — нужен оператор. */
    public record Unparseable(int httpStatus, String error, String raw) implements SendResult {}

    /** Прочие 4xx: нарушение контракта с нашей стороны, автоматический повтор не поможет. */
    public record ContractError(int httpStatus, String raw) implements SendResult {}

    public record OperationView(UUID operationKey, String status, int version, String outcome, Instant executedAt,
                                Instant updatedAt) {}

    public sealed interface StatusResult permits Known, NotFound, CheckFailed {}

    public record Known(OperationView operation) implements StatusResult {}

    public record NotFound() implements StatusResult {}

    public record CheckFailed(String error) implements StatusResult {}

    public record Page(List<OperationView> items, Instant nextSince) {}

    private static final Set<Integer> TRANSIENT_CODES = Set.of(429, 500, 502, 503, 504);

    private final HttpClient http;
    private final Json json;
    private final String baseUrl;
    private final String callbackUrl;
    private final Duration timeout;

    public EmulatorClient(Json json,
                          @Value("${app.emulator.url}") String baseUrl,
                          @Value("${app.callback-url}") String callbackUrl,
                          @Value("${app.emulator.timeout-ms}") long timeoutMs) {
        this.json = json;
        this.baseUrl = baseUrl;
        this.callbackUrl = callbackUrl;
        this.timeout = Duration.ofMillis(timeoutMs);
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(timeout)
                .build();
    }

    public SendResult send(UUID operationKey, UUID attemptId, Map<String, Object> payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationKey", operationKey);
        body.put("attemptId", attemptId);
        body.put("callbackUrl", callbackUrl);
        body.put("payload", payload);

        HttpResponse<String> res;
        try {
            res = http.send(post("/operations", json.write(body)), HttpResponse.BodyHandlers.ofString());
        } catch (ConnectException e) {
            // соединение не установлено — запрос точно не дошёл
            return new Transient(null, "connect: " + e.getMessage(), null, false, null);
        } catch (HttpTimeoutException e) {
            // запрос ушёл, ответа нет — внешняя система могла принять и исполнить (D03)
            return new Transient(null, "timeout: ответ не получен за " + timeout.toMillis() + " мс", null, true, null);
        } catch (IOException e) {
            return new Transient(null, "io: " + e.getMessage(), null, true, null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Transient(null, "interrupted", null, true, null);
        }

        int code = res.statusCode();
        String raw = res.body();
        if (code == 200 || code == 202) {
            try {
                Map<String, Object> m = json.readMap(raw);
                Object status = m.get("status");
                Object version = m.get("version");
                if (!(status instanceof String s) || !Set.of("RECEIVED", "EXECUTED", "FAILED").contains(s)
                        || !(version instanceof Number v)) {
                    return new Unparseable(code, "нет корректных полей status/version", raw);
                }
                return new Accepted(code, s, v.intValue(), Boolean.TRUE.equals(m.get("alreadyKnown")), raw);
            } catch (RuntimeException e) {
                return new Unparseable(code, "тело ответа не JSON: " + e.getClass().getSimpleName(), raw);
            }
        }
        if (code == 422) {
            String reason = "отказ по содержанию";
            try {
                Object r = json.readMap(raw).get("reason");
                if (r != null) {
                    reason = r.toString();
                }
            } catch (RuntimeException ignored) {
                // причина не обязательна
            }
            return new Rejected(code, reason, raw);
        }
        if (TRANSIENT_CODES.contains(code)) {
            Long retryAfter = res.headers().firstValue("Retry-After").flatMap(EmulatorClient::parseLong).orElse(null);
            return new Transient(code, "HTTP " + code, retryAfter, false, raw);
        }
        return new ContractError(code, raw);
    }

    public StatusResult status(UUID operationKey) {
        try {
            var res = http.send(get("/operations/" + operationKey), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404) {
                return new NotFound();
            }
            if (res.statusCode() != 200) {
                return new CheckFailed("HTTP " + res.statusCode());
            }
            return new Known(view(json.readMap(res.body())));
        } catch (IOException | RuntimeException e) {
            return new CheckFailed(e.getClass().getSimpleName() + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new CheckFailed("interrupted");
        }
    }

    /** Страница операций для сверки. Бросает исключение, если внешняя система недоступна. */
    public Page list(Instant since, int limit) throws IOException, InterruptedException {
        var res = http.send(get("/operations?limit=" + limit + "&updatedSince="
                + URLEncoder.encode(since.toString(), StandardCharsets.UTF_8)), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IOException("внешняя система ответила HTTP " + res.statusCode());
        }
        Map<String, Object> m = json.readMap(res.body());
        List<OperationView> items = new ArrayList<>();
        for (Object o : (List<?>) m.get("items")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> item = (Map<String, Object>) o;
            items.add(view(item));
        }
        return new Page(items, Instant.parse(m.get("nextSince").toString()));
    }

    // --- служебные вызовы эмулятора для демо-панели оператора (не часть боевого контракта) ---

    public String adminGet(String path) throws IOException, InterruptedException {
        return http.send(get("/admin" + path), HttpResponse.BodyHandlers.ofString()).body();
    }

    public String adminPost(String path, String body) throws IOException, InterruptedException {
        return http.send(post("/admin" + path, body), HttpResponse.BodyHandlers.ofString()).body();
    }

    private HttpRequest post(String path, String body) {
        return HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
    }

    private HttpRequest get(String path) {
        return HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout).GET().build();
    }

    private static OperationView view(Map<String, Object> m) {
        return new OperationView(
                UUID.fromString(m.get("operationKey").toString()),
                m.get("status").toString(),
                ((Number) m.get("version")).intValue(),
                m.get("outcome") == null ? null : m.get("outcome").toString(),
                m.get("executedAt") == null ? null : Instant.parse(m.get("executedAt").toString()),
                m.get("updatedAt") == null ? null : Instant.parse(m.get("updatedAt").toString()));
    }

    private static java.util.Optional<Long> parseLong(String s) {
        try {
            return java.util.Optional.of(Long.parseLong(s.trim()));
        } catch (NumberFormatException e) {
            return java.util.Optional.empty();
        }
    }
}
