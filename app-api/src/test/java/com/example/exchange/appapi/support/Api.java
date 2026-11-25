package com.example.exchange.appapi.support;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.json.JsonMapper;

/** HTTP-клиент «пользователя» для тестов: своя cookie-сессия на каждого. */
public class Api {

    public record Res(int status, Object body, String raw) {
        @SuppressWarnings("unchecked")
        public Map<String, Object> map() {
            return (Map<String, Object>) body;
        }

        @SuppressWarnings("unchecked")
        public List<Object> list() {
            return (List<Object>) body;
        }

        public Object get(String key) {
            return map().get(key);
        }
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String base;
    private final HttpClient http;

    public Api(String base) {
        this.base = base;
        this.http = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
    }

    public static Api login(String base, String login) {
        Api api = new Api(base);
        Res res = api.post("/api/auth/login", Map.of("login", login, "password", "demo"));
        if (res.status() != 200) {
            throw new IllegalStateException("login failed: " + res.raw());
        }
        return api;
    }

    public Res get(String path) {
        return send(HttpRequest.newBuilder(URI.create(base + path)).GET());
    }

    public Res post(String path, Object body) {
        return send(HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body instanceof String s ? s : JSON.writeValueAsString(body))));
    }

    private Res send(HttpRequest.Builder req) {
        try {
            var res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
            Object body = res.body() == null || res.body().isBlank() ? null : JSON.readValue(res.body(), Object.class);
            return new Res(res.statusCode(), body, res.body());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
