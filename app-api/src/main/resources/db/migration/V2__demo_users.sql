-- Демонстрационные пользователи. Пароль у всех: demo
-- Хеш bcrypt считает pgcrypto; Spring BCryptPasswordEncoder его принимает.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (login, display_name, role, password_hash) VALUES
  ('ivanov',    'Иванов И. (инициатор)',   'INITIATOR', crypt('demo', gen_salt('bf', 10))),
  ('petrova',   'Петрова А. (инициатор)',  'INITIATOR', crypt('demo', gen_salt('bf', 10))),
  ('operator',  'Сидоров С. (оператор)',   'OPERATOR',  crypt('demo', gen_salt('bf', 10))),
  ('operator2', 'Кузнецова Е. (оператор)', 'OPERATOR',  crypt('demo', gen_salt('bf', 10)));

-- Пользователи нагрузочного прогона: 20 инициаторов (load01..load20)
INSERT INTO users (login, display_name, role, password_hash)
SELECT 'load' || lpad(n::text, 2, '0'), 'Нагрузочный ' || n, 'INITIATOR', crypt('demo', gen_salt('bf', 10))
FROM generate_series(1, 20) AS n;
