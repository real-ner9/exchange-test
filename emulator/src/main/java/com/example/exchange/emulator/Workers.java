package com.example.exchange.emulator;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Фоновые циклы эмулятора: исполнение принятых операций и доставка результатов.
 * Пока включён режим unavailable, эмулятор «лежит» целиком — не исполняет и не доставляет.
 */
@Component
public class Workers {

    private static final int BATCH = 100;

    private final FaultService faults;
    private final OperationService operations;
    private final ResultOutbox results;

    public Workers(FaultService faults, OperationService operations, ResultOutbox results) {
        this.faults = faults;
        this.operations = operations;
        this.results = results;
    }

    @Scheduled(fixedDelayString = "${emulator.poll-ms}")
    public void execute() {
        var current = faults.current();
        if (current.on("unavailable")) {
            return;
        }
        for (int i = 0; i < BATCH && operations.executeNext(current); i++) {
            // каждая операция — своя транзакция
        }
    }

    @Scheduled(fixedDelayString = "${emulator.poll-ms}")
    public void deliver() {
        if (faults.current().on("unavailable")) {
            return;
        }
        for (int i = 0; i < BATCH && results.deliverNext(); i++) {
            // каждое сообщение — своя транзакция
        }
    }
}
