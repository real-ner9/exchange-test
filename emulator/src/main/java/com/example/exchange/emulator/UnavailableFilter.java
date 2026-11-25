package com.example.exchange.emulator;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Режим unavailable: любой запрос к /operations получает 503. /admin продолжает работать. */
@Component
public class UnavailableFilter extends OncePerRequestFilter {

    private final FaultService faults;

    public UnavailableFilter(FaultService faults) {
        this.faults = faults;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/operations");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (faults.current().on("unavailable")) {
            response.setStatus(503);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"UNAVAILABLE\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
