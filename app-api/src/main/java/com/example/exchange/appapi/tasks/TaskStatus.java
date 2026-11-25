package com.example.exchange.appapi.tasks;

import java.util.EnumSet;
import java.util.Set;

/**
 * Внутренние статусы задания. Инициатор видит упрощённые пользовательские статусы (D02),
 * оператор — внутренние.
 */
public enum TaskStatus {
    QUEUED, SENDING, RETRY_WAIT, ACCEPTED, COMPLETED, FAILED, REJECTED, NEEDS_ATTENTION, MANUALLY_CLOSED;

    /** Задание ещё доставляется во внешнюю систему: его можно (и нужно) отправлять. */
    public static final Set<TaskStatus> IN_DELIVERY = EnumSet.of(QUEUED, SENDING, RETRY_WAIT);

    /** Итог от внешней системы получен; такие статусы не откатываются (D04). */
    public static final Set<TaskStatus> TERMINAL = EnumSet.of(COMPLETED, FAILED, REJECTED);

    public boolean inDelivery() {
        return IN_DELIVERY.contains(this);
    }

    public boolean terminal() {
        return TERMINAL.contains(this);
    }

    /** Пользовательский статус инициатора (D02): только «Выполнено» — зелёное. */
    public record UserStatus(String code, String label, String color, boolean needsAction, String hint) {}

    public UserStatus userStatus() {
        return switch (this) {
            case QUEUED, SENDING, RETRY_WAIT -> new UserStatus("SENDING", "Отправляется", "gray", false,
                    "Задание сохранено и передаётся во внешнюю систему. Ничего делать не нужно — при сбоях связи отправка повторяется автоматически.");
            case ACCEPTED -> new UserStatus("ACCEPTED", "Принято в работу", "blue", false,
                    "Внешняя система подтвердила получение. Результат исполнения ещё не пришёл.");
            case COMPLETED -> new UserStatus("COMPLETED", "Выполнено", "green", false,
                    "Внешняя система сообщила об исполнении.");
            case FAILED -> new UserStatus("FAILED", "Не выполнено", "red", true,
                    "Внешняя система исполнила задание с отказом. Проверьте данные и при необходимости создайте новое задание.");
            case REJECTED -> new UserStatus("REJECTED", "Требует решения", "yellow", true,
                    "Внешняя система отвергла содержание задания. Исправьте данные и создайте задание заново.");
            case NEEDS_ATTENTION, MANUALLY_CLOSED -> new UserStatus("OPERATOR", "Решается оператором", "yellow", false,
                    "С обменом возникла проблема, ей занимается оператор интеграции. Ваших действий не требуется.");
        };
    }
}
