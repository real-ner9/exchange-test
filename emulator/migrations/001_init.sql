-- Собственная БД эмулятора внешнего сервиса (D08)

CREATE TABLE operations (
  operation_key    uuid PRIMARY KEY,
  first_attempt_id uuid NOT NULL,
  callback_url     text NOT NULL,
  payload          jsonb NOT NULL,
  status           text NOT NULL CHECK (status IN ('RECEIVED', 'EXECUTED', 'FAILED')),
  version          int NOT NULL DEFAULT 1,
  outcome          text,
  execute_after    timestamptz NOT NULL,
  executed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_pending_idx ON operations (execute_after) WHERE status = 'RECEIVED';
CREATE INDEX operations_updated_idx ON operations (updated_at);

-- Каждый факт исполнения. Инвариант: не больше одной строки на operation_key.
-- Уникальности намеренно нет: счётчик должен уметь показать нарушение, а не скрыть его.
CREATE TABLE executions (
  id            bigserial PRIMARY KEY,
  operation_key uuid NOT NULL REFERENCES operations(operation_key),
  executed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executions_key_idx ON executions (operation_key);

-- Все входящие отправки, включая повторы (attemptId от клиента).
CREATE TABLE received_attempts (
  id            bigserial PRIMARY KEY,
  attempt_id    uuid NOT NULL,
  operation_key uuid NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  response_code int NOT NULL,
  fault         text
);
CREATE INDEX received_attempts_key_idx ON received_attempts (operation_key);

-- Исходящие результаты с повторной доставкой до 200.
CREATE TABLE result_outbox (
  id            bigserial PRIMARY KEY,
  result_id     uuid NOT NULL,
  operation_key uuid NOT NULL REFERENCES operations(operation_key),
  version       int NOT NULL,
  outcome       text NOT NULL,
  callback_url  text NOT NULL,
  body          jsonb NOT NULL,
  deliver_after timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  last_error    text
);
CREATE INDEX result_outbox_pending_idx ON result_outbox (deliver_after) WHERE delivered_at IS NULL;

CREATE TABLE faults (
  mode     text PRIMARY KEY CHECK (mode IN ('unavailable', 'lose_response', 'duplicate_result',
                                            'delay_result', 'reject_content', 'fail_execution')),
  enabled  boolean NOT NULL DEFAULT false,
  params   jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO faults (mode, params) VALUES
  ('unavailable',      '{}'),
  ('lose_response',    '{"rate": 1.0}'),
  ('duplicate_result', '{}'),
  ('delay_result',     '{"seconds": 10, "reorder": true}'),
  ('reject_content',   '{"marker": "#reject"}'),
  ('fail_execution',   '{"marker": "#fail"}');
