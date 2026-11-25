package com.example.exchange.appapi.exchange;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.example.exchange.appapi.common.Json;
import com.example.exchange.appapi.exchange.EmulatorClient.CheckFailed;
import com.example.exchange.appapi.exchange.EmulatorClient.Known;
import com.example.exchange.appapi.exchange.EmulatorClient.NotFound;
import com.example.exchange.appapi.exchange.EmulatorClient.Transient;
import com.example.exchange.appapi.exchange.OutboxStore.Claim;
import com.example.exchange.appapi.tasks.TaskRepository;
import com.example.exchange.appapi.tasks.TaskRow;

/**
 * Отправщик: забирает задания из outbox и доставляет их во внешнюю систему.
 *
 * Одна попытка доставки:
 * 1. если прошлая попытка закончилась неопределённо — сначала GET статуса; если операция
 *    уже известна внешней системе, повторно не отправляем (D03);
 * 2. иначе POST с тем же operationKey и новым attemptId (D04);
 * 3. исход классифицируется (D05): принято / отказ по содержанию / неразбираемо / временная ошибка.
 */
@Component
public class Dispatcher {

    private static final Logger log = LoggerFactory.getLogger(Dispatcher.class);

    private final OutboxStore store;
    private final TaskRepository tasks;
    private final EmulatorClient client;
    private final Json json;
    private final boolean enabled;
    private final int batch;
    private final int leaseSeconds;

    public Dispatcher(OutboxStore store, TaskRepository tasks, EmulatorClient client, Json json,
                      @Value("${app.dispatcher.enabled}") boolean enabled,
                      @Value("${app.dispatcher.batch}") int batch,
                      @Value("${app.dispatcher.lease-seconds}") int leaseSeconds) {
        this.store = store;
        this.tasks = tasks;
        this.client = client;
        this.json = json;
        this.enabled = enabled;
        this.batch = batch;
        this.leaseSeconds = leaseSeconds;
    }

    @Scheduled(fixedDelayString = "${app.dispatcher.poll-ms}")
    public void tick() {
        if (enabled) {
            runOnce();
        }
    }

    /** Один проход: взять пачку и обработать параллельно. Возвращает число взятых заданий. */
    public int runOnce() {
        List<Claim> claims;
        try {
            claims = store.claim(batch, leaseSeconds);
        } catch (RuntimeException e) {
            log.warn("outbox claim failed: {}", e.getMessage());
            return 0;
        }
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (Claim c : claims) {
                pool.submit(() -> process(c));
            }
        }
        return claims.size();
    }

    void process(Claim claim) {
        UUID attemptId = null;
        try {
            TaskRow task = tasks.find(claim.taskId()).orElseThrow();
            boolean checkFirst = store.needsStatusCheck(task.id());
            attemptId = store.startAttempt(claim, task);

            if (checkFirst) {
                switch (client.status(task.operationKey())) {
                    case Known k -> {
                        store.finishKnown(claim, attemptId, k.operation());
                        return;
                    }
                    case CheckFailed f -> {
                        // статус узнать не удалось — неопределённость сохраняется, повторим позже
                        store.finish(claim, attemptId, new Transient(null, "проверка статуса: " + f.error(), null, true, null));
                        return;
                    }
                    case NotFound nf -> {
                        // внешняя система операцию не получала — отправляем
                    }
                }
            }

            var result = client.send(task.operationKey(), attemptId, json.readMap(task.payloadJson()));
            store.finish(claim, attemptId, result);
        } catch (RuntimeException e) {
            log.error("dispatch failed for task {}", claim.taskId(), e);
            if (attemptId != null) {
                try {
                    store.failUnexpected(claim, attemptId, e.getClass().getSimpleName());
                } catch (RuntimeException ignored) {
                    // аренда истечёт, задание возьмут снова
                }
            }
        }
    }
}
