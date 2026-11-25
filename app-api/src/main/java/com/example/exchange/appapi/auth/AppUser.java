package com.example.exchange.appapi.auth;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/** Пользователь в сессии. Роль одна: INITIATOR или OPERATOR (D07 — возможности не смешиваются). */
public record AppUser(UUID id, String login, String displayName, String role, String passwordHash)
        implements UserDetails {

    public static final String INITIATOR = "INITIATOR";
    public static final String OPERATOR = "OPERATOR";

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return login;
    }
}
