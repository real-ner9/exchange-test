package com.example.exchange.appapi.tasks;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
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

/** API инициатора. Доступ — только роль INITIATOR (SecurityConfig), только свои задания. */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    public record CreateTaskRequest(
            @NotNull UUID clientRequestId,
            @NotBlank @Size(max = 200) String title,
            @DecimalMin(value = "0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
            @Size(max = 1000) String comment) {}

    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    /** 201 — создано новое задание; 200 — повтор той же формы, возвращено уже созданное (D01). */
    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@AuthenticationPrincipal AppUser user,
                                                      @Valid @RequestBody CreateTaskRequest req) {
        var result = service.create(user, new TaskService.CreateCommand(
                req.clientRequestId(), req.title(), req.amount(), req.comment()));
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.task());
    }

    @GetMapping
    public Map<String, Object> list(@AuthenticationPrincipal AppUser user,
                                    @RequestParam(defaultValue = "all") String filter,
                                    @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "20") int size) {
        return service.list(user, filter, page, size);
    }

    @GetMapping("/similar")
    public List<Map<String, Object>> similar(@AuthenticationPrincipal AppUser user, @RequestParam String title) {
        return service.similar(user, title);
    }

    @GetMapping("/report")
    public Map<String, Object> report(@AuthenticationPrincipal AppUser user,
                                      @RequestParam(required = false) Instant from,
                                      @RequestParam(required = false) Instant to) {
        Instant end = to == null ? Instant.now().plus(1, ChronoUnit.MINUTES) : to;
        Instant start = from == null ? end.minus(30, ChronoUnit.DAYS) : from;
        return service.report(user, start, end);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@AuthenticationPrincipal AppUser user, @PathVariable UUID id) {
        return service.get(user, id);
    }
}
