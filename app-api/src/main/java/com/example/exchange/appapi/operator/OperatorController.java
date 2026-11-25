package com.example.exchange.appapi.operator;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.exchange.appapi.auth.AppUser;
import com.example.exchange.appapi.common.ApiException;
import com.example.exchange.appapi.exchange.EmulatorClient;

/** API оператора интеграции. Доступ — только роль OPERATOR (SecurityConfig). */
@RestController
@RequestMapping("/api/operator")
public class OperatorController {

    public record RetryRequest(@NotNull Integer version, String reason) {}

    public record CloseRequest(@NotNull Integer version, @NotBlank String reason) {}

    public record ResolveRequest(@NotBlank String action, @NotBlank String comment) {}

    private final OperatorService service;
    private final ReconcileService reconcile;
    private final EmulatorClient emulator;

    public OperatorController(OperatorService service, ReconcileService reconcile, EmulatorClient emulator) {
        this.service = service;
        this.reconcile = reconcile;
        this.emulator = emulator;
    }

    @GetMapping("/summary")
    public Map<String, Object> summary() {
        return service.summary();
    }

    @GetMapping("/tasks")
    public Map<String, Object> tasks(@RequestParam(defaultValue = "attention") String view,
                                     @RequestParam(required = false) String status,
                                     @RequestParam(required = false) String q,
                                     @RequestParam(defaultValue = "0") int page,
                                     @RequestParam(defaultValue = "50") int size) {
        try {
            return service.list(view, status, q, page, size);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Неизвестный статус: " + status);
        }
    }

    @GetMapping("/tasks/{id}")
    public Map<String, Object> task(@PathVariable UUID id) {
        return service.detail(id);
    }

    @PostMapping("/tasks/{id}/retry")
    public Map<String, Object> retry(@AuthenticationPrincipal AppUser user, @PathVariable UUID id,
                                     @Valid @RequestBody RetryRequest req) {
        return service.retry(user, id, req.version(), req.reason());
    }

    /** «Закрыть без подтверждения» (бывшее «Считать выполненным»), D06. */
    @PostMapping("/tasks/{id}/close")
    public Map<String, Object> close(@AuthenticationPrincipal AppUser user, @PathVariable UUID id,
                                     @Valid @RequestBody CloseRequest req) {
        return service.close(user, id, req.version(), req.reason());
    }

    @GetMapping("/events")
    public Map<String, Object> events(@RequestParam(required = false) UUID taskId,
                                      @RequestParam(required = false) String kind,
                                      @RequestParam(defaultValue = "0") int page,
                                      @RequestParam(defaultValue = "100") int size) {
        return service.events(taskId, kind, page, size);
    }

    @GetMapping("/invalid-messages")
    public List<Map<String, Object>> invalidMessages() {
        return service.invalidMessages();
    }

    // ---------- сверка ----------

    @PostMapping("/reconcile")
    public Map<String, Object> runReconcile(@AuthenticationPrincipal AppUser user) {
        return reconcile.run(user.id());
    }

    @GetMapping("/reconcile/runs")
    public List<Map<String, Object>> runs() {
        return reconcile.runs();
    }

    @GetMapping("/discrepancies")
    public Map<String, Object> discrepancies(@RequestParam(defaultValue = "true") boolean open,
                                             @RequestParam(defaultValue = "0") int page,
                                             @RequestParam(defaultValue = "100") int size) {
        return reconcile.discrepancies(open, page, size);
    }

    @PostMapping("/discrepancies/{id}/resolve")
    public Map<String, Object> resolve(@AuthenticationPrincipal AppUser user, @PathVariable long id,
                                       @Valid @RequestBody ResolveRequest req) {
        return reconcile.resolve(user, id, req.action(), req.comment());
    }

    // ---------- демо-панель: управление эмулятором (D08) ----------

    @GetMapping(path = "/demo/faults", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> faults() {
        return proxy(() -> emulator.adminGet("/faults"));
    }

    @PostMapping(path = "/demo/faults", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> setFault(@RequestBody String body) {
        return proxy(() -> emulator.adminPost("/faults", body));
    }

    @GetMapping(path = "/demo/stats", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> stats() {
        return proxy(() -> emulator.adminGet("/stats"));
    }

    /** Сколько раз операция фактически исполнена — по данным самого эмулятора. */
    @GetMapping(path = "/demo/executions/{operationKey}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> executions(@PathVariable UUID operationKey) {
        return proxy(() -> emulator.adminGet("/operations/" + operationKey + "/executions"));
    }

    private interface Call {
        String run() throws Exception;
    }

    private static ResponseEntity<String> proxy(Call call) {
        try {
            return ResponseEntity.ok(call.run());
        } catch (Exception e) {
            return ResponseEntity.status(502)
                    .body("{\"error\":\"EMULATOR_UNREACHABLE\",\"message\":\"Эмулятор недоступен\"}");
        }
    }
}
