package com.example.exchange.emulator;

import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Фоновые циклы эмулятора: исполнение принятых операций и доставка результатов.
 * Каждая операция/сообщение — своя транзакция с FOR UPDATE SKIP LOCKED, поэтому
 * параллельные потоки не возьмут одну строку дважды.
 * Пока включён режим unavailable, эмулятор «лежит» целиком — не исполняет и не доставляет.
 */
@Component
public class Workers {

    private static final int BATCH_PER_THREAD = 50;

    private final FaultService faults;
    private final OperationService operations;
    private final ResultOutbox results;
    private final int threads;

    public Workers(FaultService faults, OperationService operations, ResultOutbox results,
                   @Value("${emulator.worker-threads:8}") int threads) {
        this.faults = faults;
        this.operations = operations;
        this.results = results;
        this.threads = threads;
    }

    @Scheduled(fixedDelayString = "${emulator.poll-ms}")
    public void execute() {
        var current = faults.current();
        if (!current.on("unavailable")) {
            parallel(() -> operations.executeNext(current));
        }
    }

    @Scheduled(fixedDelayString = "${emulator.poll-ms}")
    public void deliver() {
        if (!faults.current().on("unavailable")) {
            parallel(results::deliverNext);
        }
    }

    private void parallel(BooleanSupplier step) {
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int t = 0; t < threads; t++) {
                pool.submit(() -> {
                    for (int i = 0; i < BATCH_PER_THREAD && step.getAsBoolean(); i++) {
                        // пока есть работа
                    }
                });
            }
        }
    }
}
