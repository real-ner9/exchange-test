package com.example.exchange.appapi.exchange;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Точка приёма результатов от внешней системы (POST {callbackUrl}/results).
 * На дубликаты и устаревшие сообщения отвечаем 200 — иначе внешняя система будет слать их вечно.
 * 400 — только если сообщение нельзя разобрать (оно сохранено в inbox_invalid).
 */
@RestController
public class InboxController {

    private final InboxService inbox;

    public InboxController(InboxService inbox) {
        this.inbox = inbox;
    }

    @PostMapping(path = "/integration/results", consumes = "application/json")
    public ResponseEntity<Map<String, String>> receive(@RequestBody String raw) {
        var outcome = inbox.receive(raw);
        if (outcome == InboxService.Outcome.INVALID) {
            return ResponseEntity.badRequest().body(Map.of("status", outcome.name()));
        }
        return ResponseEntity.ok(Map.of("status", outcome.name()));
    }
}
