package com.example.exchange.appapi.common;

import java.util.Map;

import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Тонкая обёртка над Jackson для jsonb-колонок. */
@Component
public class Json {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private final JsonMapper mapper;

    public Json(JsonMapper mapper) {
        this.mapper = mapper;
    }

    public String write(Object value) {
        return value == null ? null : mapper.writeValueAsString(value);
    }

    public Map<String, Object> readMap(String json) {
        return json == null ? null : mapper.readValue(json, MAP);
    }

    public JsonMapper mapper() {
        return mapper;
    }
}
