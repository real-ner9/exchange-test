package com.example.exchange.emulator;

import java.util.Map;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Управление эмулятором для демо и тестов. Работает и в режиме unavailable —
 * иначе сбой нельзя было бы выключить.
 */
@RestController
public class AdminController {

    public record FaultRequest(String mode, Boolean enabled, Map<String, Object> params, Boolean reset) {}

    private final FaultService faults;
    private final OperationService operations;

    public AdminController(FaultService faults, OperationService operations) {
        this.faults = faults;
        this.operations = operations;
    }

    @GetMapping("/admin/faults")
    public Object faults() {
        return faults.current().byMode().values();
    }

    @PostMapping("/admin/faults")
    public ResponseEntity<?> setFault(@RequestBody FaultRequest req) {
        if (Boolean.TRUE.equals(req.reset())) {
            faults.reset();
        } else if (req.mode() == null || !FaultService.MODES.contains(req.mode())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "BAD_REQUEST", "reason", "mode must be one of " + FaultService.MODES));
        } else {
            faults.set(req.mode(), Boolean.TRUE.equals(req.enabled()), req.params());
        }
        return ResponseEntity.ok(faults.current().byMode().values());
    }

    /** Независимая от основного приложения проверка: сколько раз операция фактически исполнена (D08). */
    @GetMapping("/admin/operations/{key}/executions")
    public Map<String, Object> executions(@PathVariable UUID key) {
        return operations.executions(key);
    }

    @GetMapping("/admin/stats")
    public Map<String, Object> stats() {
        return operations.stats();
    }
}
