-- Основная БД приложения (app-api)

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('INITIATOR', 'OPERATOR')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Задание = основной реестр. operation_key стабилен на всё задание (D03).
CREATE TABLE tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id       uuid NOT NULL REFERENCES users(id),
  client_request_id  uuid NOT NULL,                       -- D01: ключ идемпотентности формы
  operation_key      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  payload            jsonb NOT NULL,
  status             text NOT NULL CHECK (status IN (
                       'QUEUED', 'SENDING', 'RETRY_WAIT', 'ACCEPTED',
                       'COMPLETED', 'FAILED', 'REJECTED',
                       'NEEDS_ATTENTION', 'MANUALLY_CLOSED')),
  attention_reason   text,                                 -- LONG_RETRY | UNPARSEABLE | RECONCILE_MISMATCH
  confirmed_after_manual_close boolean NOT NULL DEFAULT false,
  ext_version        int NOT NULL DEFAULT 0,               -- D04: последняя применённая версия результата
  ext_status         text,                                 -- последний известный статус у внешней системы
  attempts_count     int NOT NULL DEFAULT 0,
  first_attempt_at   timestamptz,
  next_attempt_at    timestamptz,
  last_error         text,
  completed_at       timestamptz,
  closed_reason      text,
  version            int NOT NULL DEFAULT 0,               -- оптимистичная блокировка (D07)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (initiator_id, client_request_id)
);
CREATE INDEX tasks_initiator_created_idx ON tasks (initiator_id, created_at DESC);
CREATE INDEX tasks_status_idx ON tasks (status, updated_at DESC);
CREATE INDEX tasks_similar_idx ON tasks (initiator_id, title, created_at DESC);

-- Transactional outbox (D07): одна строка = одна предстоящая отправка.
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  task_id       uuid NOT NULL REFERENCES tasks(id),
  trigger       text NOT NULL DEFAULT 'AUTO' CHECK (trigger IN ('AUTO', 'MANUAL')),
  requested_by  uuid REFERENCES users(id),
  -- когда строку можно брать; на время отправки сдвигается вперёд (аренда),
  -- поэтому упавший посреди отправки воркер не блокирует задание навсегда
  available_at  timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE processed_at IS NULL;
-- не больше одной незавершённой отправки на задание
CREATE UNIQUE INDEX outbox_one_pending_per_task ON outbox (task_id) WHERE processed_at IS NULL;

-- Каждая попытка отправки; attempt_id новый на каждую (D04, трассировка).
CREATE TABLE attempts (
  id            uuid PRIMARY KEY,                          -- attemptId
  task_id       uuid NOT NULL REFERENCES tasks(id),
  operation_key uuid NOT NULL,
  trigger       text NOT NULL CHECK (trigger IN ('AUTO', 'MANUAL')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  outcome       text,       -- ACCEPTED | ALREADY_KNOWN | REJECTED | TRANSIENT | UNCERTAIN | UNPARSEABLE | CONTRACT_ERROR | CHECKED_KNOWN
  http_status   int,
  error         text,
  raw_response  text
);
CREATE INDEX attempts_task_idx ON attempts (task_id, started_at);

-- Входящие результаты: пишутся до обработки, result_id уникален (D04, D07).
CREATE TABLE inbox (
  result_id     uuid PRIMARY KEY,
  operation_key uuid NOT NULL,
  version       int NOT NULL,
  outcome       text NOT NULL,
  executed_at   timestamptz,
  raw           jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  disposition   text NOT NULL CHECK (disposition IN ('APPLIED', 'STALE', 'UNKNOWN_OPERATION'))
);
CREATE INDEX inbox_operation_idx ON inbox (operation_key, received_at);

-- Входящие сообщения, которые не удалось разобрать: сохраняются для оператора, а не теряются (D05).
CREATE TABLE inbox_invalid (
  id           bigserial PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  raw          text NOT NULL,
  error        text NOT NULL
);

-- Журнал: все значимые изменения задания, включая действия оператора (D06).
CREATE TABLE task_events (
  id           bigserial PRIMARY KEY,
  task_id      uuid NOT NULL REFERENCES tasks(id),
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users(id),                  -- NULL = система
  kind         text NOT NULL,
  from_status  text,
  to_status    text,
  reason       text,
  details      jsonb
);
CREATE INDEX task_events_task_idx ON task_events (task_id, id);
CREATE INDEX task_events_at_idx ON task_events (at DESC);

-- Сверка с внешней системой (D06, D07).
CREATE TABLE reconcile_runs (
  id           bigserial PRIMARY KEY,
  started_by   uuid REFERENCES users(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  checked      int NOT NULL DEFAULT 0,
  mismatches   int NOT NULL DEFAULT 0,
  error        text
);

CREATE TABLE discrepancies (
  id            bigserial PRIMARY KEY,
  run_id        bigint NOT NULL REFERENCES reconcile_runs(id),
  task_id       uuid REFERENCES tasks(id),
  operation_key uuid NOT NULL,
  our_status    text,
  their_status  text,
  kind          text NOT NULL,  -- THEIRS_AHEAD | CLOSED_NOT_EXECUTED | MISSING_THERE | UNKNOWN_HERE | AUTO_FIXED
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id),
  resolution    text
);
CREATE INDEX discrepancies_open_idx ON discrepancies (resolved_at, id DESC);
