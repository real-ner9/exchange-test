package com.example.exchange.emulator;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Режимы сбоев хранятся в БД эмулятора, поэтому переживают перезапуск
 * и одинаково видны всем потокам. Читаются на каждый запрос — таблица из шести строк.
 */
@Service
public class FaultService {

    public static final List<String> MODES = List.of(
            "unavailable", "lose_response", "duplicate_result", "delay_result", "reject_content", "fail_execution");

    public record Fault(String mode, boolean enabled, Map<String, Object> params) {
        public double num(String key, double def) {
            Object v = params.get(key);
            return v instanceof Number n ? n.doubleValue() : def;
        }

        public String str(String key, String def) {
            Object v = params.get(key);
            return v != null ? v.toString() : def;
        }

        public boolean flag(String key, boolean def) {
            Object v = params.get(key);
            return v instanceof Boolean b ? b : def;
        }
    }

    public record Faults(Map<String, Fault> byMode) {
        public Fault get(String mode) {
            return byMode.get(mode);
        }

        public boolean on(String mode) {
            Fault f = byMode.get(mode);
            return f != null && f.enabled();
        }
    }

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public FaultService(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Faults current() {
        Map<String, Fault> map = new LinkedHashMap<>();
        jdbc.sql("SELECT mode, enabled, params::text AS params FROM faults ORDER BY mode")
                .query((rs, i) -> new Fault(rs.getString("mode"), rs.getBoolean("enabled"),
                        json.readValue(rs.getString("params"), MAP)))
                .list()
                .forEach(f -> map.put(f.mode(), f));
        return new Faults(map);
    }

    @Transactional
    public void set(String mode, boolean enabled, Map<String, Object> params) {
        if (!MODES.contains(mode)) {
            throw new IllegalArgumentException("unknown fault mode: " + mode);
        }
        if (params == null) {
            jdbc.sql("UPDATE faults SET enabled = :enabled WHERE mode = :mode")
                    .param("enabled", enabled).param("mode", mode).update();
        } else {
            jdbc.sql("UPDATE faults SET enabled = :enabled, params = params || CAST(:params AS jsonb) WHERE mode = :mode")
                    .param("enabled", enabled).param("params", json.writeValueAsString(params)).param("mode", mode)
                    .update();
        }
    }

    @Transactional
    public void reset() {
        jdbc.sql("UPDATE faults SET enabled = false").update();
    }
}
