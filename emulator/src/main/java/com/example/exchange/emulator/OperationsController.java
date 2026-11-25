package com.example.exchange.emulator;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.exchange.emulator.OperationService.SubmitRequest;

/** Публичный контракт внешнего сервиса — см. docs/contract.md. */
@RestController
public class OperationsController {

    private final OperationService operations;
    private final FaultService faults;

    public OperationsController(OperationService operations, FaultService faults) {
        this.operations = operations;
        this.faults = faults;
    }

    @PostMapping("/operations")
    public ResponseEntity<?> submit(@RequestBody SubmitRequest req) throws InterruptedException {
        if (req.operationKey() == null || req.attemptId() == null
                || req.callbackUrl() == null || req.callbackUrl().isBlank() || req.payload() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "BAD_REQUEST", "reason", "operationKey, attemptId, callbackUrl, payload required"));
        }
        var current = faults.current();

        // reject_content: отказ по содержанию, операция не создаётся
        if (current.on("reject_content")) {
            String marker = current.get("reject_content").str("marker", "#reject");
            if (req.title().contains(marker)) {
                operations.logAttempt(req, 422, "reject_content");
                return ResponseEntity.unprocessableContent()
                        .body(Map.of("error", "REJECTED_CONTENT", "reason", "title contains " + marker));
            }
        }

        // lose_response: решаем до приёма, чтобы отметить это в журнале попыток
        boolean loseResponse = current.on("lose_response")
                && ThreadLocalRandom.current().nextDouble() < current.get("lose_response").num("rate", 1.0);

        var received = operations.receive(req, current, loseResponse ? "lose_response" : null);
        // транзакция приёма уже зафиксирована: операция принята и будет исполнена

        if (loseResponse) {
            // Ответ «теряется»: держим соединение дольше таймаута клиента, клиент получает таймаут.
            long hangSeconds = (long) current.get("lose_response").num("hangSeconds", 15);
            Thread.sleep(hangSeconds * 1000);
        }

        var op = received.operation();
        if (received.created()) {
            return ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("operationKey", op.operationKey(), "status", op.status(), "version", op.version()));
        }
        return ResponseEntity.ok(Map.of("operationKey", op.operationKey(), "status", op.status(),
                "version", op.version(), "alreadyKnown", true));
    }

    @GetMapping("/operations/{key}")
    public ResponseEntity<?> get(@PathVariable UUID key) {
        return operations.find(key)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "NOT_FOUND", "operationKey", key)));
    }

    @GetMapping("/operations")
    public Map<String, Object> list(@RequestParam(required = false) Instant updatedSince,
                                    @RequestParam(defaultValue = "500") int limit) {
        var since = updatedSince == null ? Instant.EPOCH : updatedSince;
        var items = operations.updatedSince(since, Math.min(Math.max(limit, 1), 1000));
        var nextSince = items.isEmpty() ? since : items.getLast().updatedAt();
        return Map.of("items", items, "nextSince", nextSince);
    }
}
