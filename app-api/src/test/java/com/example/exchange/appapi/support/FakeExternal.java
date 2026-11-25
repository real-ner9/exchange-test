package com.example.exchange.appapi.support;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.json.JsonMapper;

/**
 * Внешняя система для тестов app-api: по умолчанию ведёт себя по контракту (дедуплицирует по operationKey),
 * а очередь шагов позволяет детерминированно подставить 503, 429, 422, мусор или потерянный ответ.
 * Настоящий эмулятор проверяется своими тестами и сквозным сценарием.
 */
public class FakeExternal {

    public record Op(String status, int version) {}

    @FunctionalInterface
    public interface Step {
        void handle(FakeExternal ext, HttpExchange ex, UUID key) throws IOException;
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final HttpServer server;
    public final Map<UUID, Op> ops = new ConcurrentHashMap<>();
    public final Map<UUID, AtomicInteger> posts = new ConcurrentHashMap<>();
    public final Map<UUID, List<UUID>> attemptIds = new ConcurrentHashMap<>();
    public final AtomicInteger statusChecks = new AtomicInteger();
    private final ConcurrentLinkedDeque<Step> script = new ConcurrentLinkedDeque<>();
    private volatile boolean listUnavailable;

    public static FakeExternal start() {
        try {
            return new FakeExternal();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private FakeExternal() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/operations", this::handle);
        server.start();
    }

    public String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    public void reset() {
        ops.clear();
        posts.clear();
        attemptIds.clear();
        statusChecks.set(0);
        script.clear();
        listUnavailable = false;
    }

    /** Следующие POST получат эти ответы по очереди; дальше — нормальное поведение. */
    public FakeExternal then(Step step) {
        script.add(step);
        return this;
    }

    public void setListUnavailable(boolean v) {
        listUnavailable = v;
    }

    public int postsFor(UUID key) {
        AtomicInteger n = posts.get(key);
        return n == null ? 0 : n.get();
    }

    // ---- готовые шаги ----

    public static Step respondWith(int code, String body) {
        return (ext, ex, key) -> respond(ex, code, body);
    }

    public static Step retryAfter(int seconds) {
        return (ext, ex, key) -> {
            ex.getResponseHeaders().add("Retry-After", String.valueOf(seconds));
            respond(ex, 429, "{\"error\":\"TOO_MANY\"}");
        };
    }

    /** Операция принимается, но ответ не приходит дольше таймаута клиента. */
    public static Step loseResponse(long hangMs) {
        return (ext, ex, key) -> {
            ext.ops.putIfAbsent(key, new Op("RECEIVED", 1));
            try {
                Thread.sleep(hangMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            respond(ex, 202, "{\"status\":\"RECEIVED\",\"version\":1}");
        };
    }

    // ---- обработка ----

    @SuppressWarnings("unchecked")
    private void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        if ("POST".equals(ex.getRequestMethod()) && "/operations".equals(path)) {
            Map<String, Object> body = JSON.readValue(ex.getRequestBody().readAllBytes(), Map.class);
            UUID key = UUID.fromString(body.get("operationKey").toString());
            posts.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet();
            attemptIds.computeIfAbsent(key, k -> java.util.Collections.synchronizedList(new ArrayList<>()))
                    .add(UUID.fromString(body.get("attemptId").toString()));
            Step step = script.poll();
            if (step != null) {
                step.handle(this, ex, key);
            } else {
                Op existing = ops.putIfAbsent(key, new Op("RECEIVED", 1));
                Op op = existing == null ? ops.get(key) : existing;
                respond(ex, existing == null ? 202 : 200, "{\"operationKey\":\"" + key + "\",\"status\":\"" + op.status()
                        + "\",\"version\":" + op.version() + (existing == null ? "" : ",\"alreadyKnown\":true") + "}");
            }
            return;
        }
        if ("GET".equals(ex.getRequestMethod()) && path.startsWith("/operations/")) {
            statusChecks.incrementAndGet();
            UUID key = UUID.fromString(path.substring("/operations/".length()));
            Op op = ops.get(key);
            if (op == null) {
                respond(ex, 404, "{\"error\":\"NOT_FOUND\"}");
            } else {
                respond(ex, 200, view(key, op));
            }
            return;
        }
        if ("GET".equals(ex.getRequestMethod()) && "/operations".equals(path)) {
            if (listUnavailable) {
                respond(ex, 503, "{\"error\":\"UNAVAILABLE\"}");
                return;
            }
            StringBuilder sb = new StringBuilder("{\"items\":[");
            boolean first = true;
            for (var e : ops.entrySet()) {
                sb.append(first ? "" : ",").append(view(e.getKey(), e.getValue()));
                first = false;
            }
            sb.append("],\"nextSince\":\"").append(Instant.now()).append("\"}");
            respond(ex, 200, sb.toString());
            return;
        }
        respond(ex, 404, "{}");
    }

    private static String view(UUID key, Op op) {
        String outcome = switch (op.status()) {
            case "EXECUTED" -> "\"COMPLETED\"";
            case "FAILED" -> "\"FAILED\"";
            default -> "null";
        };
        return "{\"operationKey\":\"" + key + "\",\"status\":\"" + op.status() + "\",\"version\":" + op.version()
                + ",\"outcome\":" + outcome + ",\"executedAt\":null,\"updatedAt\":\"" + Instant.now() + "\"}";
    }

    private static void respond(HttpExchange ex, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(code, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }
}
