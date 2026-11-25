# Exchange test — обмен с внешней системой

Тестовое задание: `task/04-system-integration.md`. Решения по спорным вводным: `docs/decisions.md` — сверяться с ним перед любой реализацией статусов, повторов и действий оператора.

## Срок и сдача
- 72 часа с первого запуска агента по заданию. Сдача: Git-репозиторий (полный хеш итогового коммита) + отдельный `agent-sessions.zip`.
- Сессии собираются с самого начала: экспорты Claude Code лежат в `~/.claude/projects/<папка проекта>/*.jsonl`. Реестр сессий (id, родитель, инструмент и версия, модель, начало/конец с часовым поясом, задача, исход, коммиты) ведётся в `agent-sessions/registry.json` по ходу работы, не в конце.
- Перед упаковкой архива удалить секреты и посторонние персональные данные и указать факт очистки.
- Недоступные метрики (стоимость и т.п.) помечать как недоступные, не выдумывать.

## Стек
Java 21 (Temurin) + Spring Boot 4.2 (Maven wrapper), React + TypeScript, PostgreSQL 17, Docker Compose — предпочтительный стек заказчика.
- app-api: Spring MVC, Spring Security, JPA только для заданий (`@Version`), остальное — JdbcTemplate с явным SQL. Миграции Flyway.
- emulator: Spring MVC + JdbcTemplate, своя БД, Flyway.
- Тесты: JUnit 5 + Testcontainers (`@ServiceConnection`), нагрузка — k6.
- Код без лишней магии: отправка и приём результатов читаются сверху вниз, код будут защищать на интервью.
- JDK: `C:\Program Files\Eclipse Adoptium\jdk-21.0.13.10002-hotspot`. В PATH по умолчанию Java 8 — JAVA_HOME задавать явно.

## Состав
```
parts[4]{name,role}
app-api,"основной сервис: задания, outbox, отправщик, приём результатов, сверка, роли"
app-web,"UI: инициатор (мои задания), оператор (очередь, журнал, сверка, демо-панель сбоев)"
emulator,"внешний сервис (Spring Boot): своя БД, режимы сбоев, счётчик исполнений"
tests,"в каждом модуле: Testcontainers PostgreSQL: идемпотентность, порядок результатов, повторы, роли, конкурентность; k6 на 5000 записей и 20 VU"
```

## UI
- Компоненты Gravity UI 8 (`@gravity-ui/uikit`, `@gravity-ui/table`); свой CSS — только раскладка на переменных `--g-*`.
- Рабочий инструмент: без анимаций появления, пульсаций, счётчиков-«накруток», градиентов, свечений, эмодзи. Движение — только hover/focus внутри компонентов.
- Статус — текстом (`StatusLabel`), числа — вправо с `tabular-nums`, таблицы — через `DataTable` из `ui.tsx`.
- После правок UI: `npm run check:style` и скриншоты экранов через Playwright.

## Порядок работы
1. Схема БД и контракт эмулятора.
2. Эмулятор с режимами сбоев.
3. Создание задания + outbox + отправщик + приём результатов.
4. Экран инициатора, экран оператора, сверка.
5. Тесты на правила из `docs/decisions.md`, нагрузочный прогон, README.

Статус: шаги 1–5 выполнены (25.11.2026). Осталось только сдать: итоговый коммит, push, `python scripts/pack_sessions.py --repo-url <URL>`.

## Команды
```
commands[6]{what,command}
"весь стек","docker compose up -d --build (web :8080, api :4000, emulator :4100, БД :5442/:5443)"
"тесты api","cd app-api && JAVA_HOME=<jdk21> ./mvnw test"
"тесты эмулятора","cd emulator && JAVA_HOME=<jdk21> ./mvnw test"
"данные 5000","MSYS_NO_PATHCONV=1 docker compose --profile load run --rm k6 run /scripts/seed.js"
"нагрузка","MSYS_NO_PATHCONV=1 docker compose --profile load run --rm k6 run /scripts/load.js"
"архив сессий","python scripts/pack_sessions.py --repo-url <URL>"
```
Порт 5432 на машине занят другим проектом — поэтому БД на 5442/5443.
