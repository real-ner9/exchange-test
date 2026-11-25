package com.example.exchange.appapi.common;

import org.springframework.http.HttpStatus;

/** Ошибка, которую API отдаёт клиенту как {error, message} с нужным HTTP-статусом. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
    }

    /** Оптимистичная блокировка: задание изменилось с момента, когда пользователь его открыл. */
    public static ApiException staleVersion() {
        return new ApiException(HttpStatus.CONFLICT, "STALE_VERSION",
                "Задание уже изменилось (другой оператор или система). Обновите карточку и повторите.");
    }

    public static ApiException invalidState(String message) {
        return new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", message);
    }
}
