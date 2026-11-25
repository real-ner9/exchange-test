# Контракт внешнего сервиса (эмулятор)

Основное приложение знает об эмуляторе только этот контракт. Базовый URL — `EMULATOR_URL` (по умолчанию `http://localhost:4100`). Тела — JSON, время — ISO 8601 UTC.

## Идентификаторы

```
ids[4]{name,owner,lifetime,purpose}
operationKey,app-api,"одно задание, не меняется","ключ бизнес-операции; эмулятор дедуплицирует исполнение по нему"
attemptId,app-api,"одна отправка","трассировка каждой попытки (D04); на исполнение не влияет"
resultId,emulator,"одно сообщение о результате","дедупликация входящих результатов в inbox"
version,emulator,"монотонный в рамках operationKey","порядок результатов: применяется только большая версия"
```

## Жизненный цикл операции в эмуляторе

```
lifecycle[4]{status,version,meaning}
RECEIVED,1,"принято, ещё не исполнено"
EXECUTED,2,"бизнес-операция исполнена (outcome=COMPLETED)"
FAILED,2,"исполнение завершилось отказом (outcome=FAILED)"
```

Получение и исполнение разнесены во времени: исполнение идёт фоновым воркером через `EXEC_DELAY_MS` (по умолчанию 2 с) после приёма.

## Эндпоинты

```
endpoints[8]{method,path,purpose}
POST,/operations,"отправка операции"
GET,/operations/{operationKey},"статус одной операции (проверка после потерянного ответа)"
GET,/operations?updatedSince=&limit=,"список для сверки, по возрастанию updatedAt"
POST,{callbackUrl}/results,"эмулятор → app-api: сообщение о результате"
GET,/admin/faults,"текущие режимы сбоев"
POST,/admin/faults,"включить/выключить режимы сбоев"
GET,/admin/operations/{operationKey}/executions,"фактическое число исполнений (независимая проверка D08)"
GET,/admin/stats,"сводка: операций, исполнений, операций с повторным исполнением (должно быть 0), недоставленных результатов"
```

### POST /operations

Запрос:
```json
{ "operationKey": "uuid", "attemptId": "uuid", "callbackUrl": "http://app-api:4000/integration", "payload": { "title": "...", "amount": 100, "comment": "..." } }
```

```
responses[5]{code,body,meaning,app_action}
202,"{status:RECEIVED, version:1}","новая операция принята","ACCEPTED"
200,"{status, version, alreadyKnown:true}","operationKey уже известен; повторно не исполняется","статус по телу"
422,"{error:REJECTED_CONTENT, reason}","отказ по содержанию","REJECTED, без повтора"
503,"{error:UNAVAILABLE}","сервис недоступен","повтор с backoff"
429,"Retry-After: n","перегрузка","повтор через n секунд"
```

Любой другой код, обрыв соединения или тело, которое не разбирается, приложение трактует по таблице классификации в `docs/decisions.md` (D05).

### GET /operations/{operationKey}

`200 {operationKey, status, version, outcome?, executedAt?, updatedAt}` или `404` — операция эмулятору неизвестна (значит, отправку можно повторять).

### GET /operations?updatedSince=

`200 {items: [...как выше], nextSince}` — страница до `limit` (по умолчанию 500) записей.

### Результат: POST {callbackUrl}/results

```json
{ "resultId": "uuid", "operationKey": "uuid", "version": 2, "outcome": "COMPLETED", "executedAt": "2026-11-25T08:00:00Z", "sentAt": "2026-11-25T08:00:01Z" }
```

`outcome` ∈ `ACCEPTED | COMPLETED | FAILED`. Приложение отвечает `200` и на новый, и на повторный, и на устаревший результат (иначе эмулятор будет слать его вечно); `400` — только если тело не разбирается. Эмулятор доставляет результаты из своего outbox с повторами до `200`.

## Режимы сбоев

`POST /admin/faults` `{ "mode": "lose_response", "enabled": true, "params": {...} }`; `{ "reset": true }` выключает все.

```
faults[6]{mode,params,behaviour}
unavailable,-,"любой запрос к /operations → 503; исполнение и доставка результатов стоят; /admin работает"
lose_response,"{rate:1.0, hangSeconds:15}","операция принимается и исполняется, а ответ не приходит: эмулятор держит соединение дольше таймаута клиента (таймаут app-api меньше hangSeconds)"
duplicate_result,-,"каждый результат доставляется дважды с одним resultId"
delay_result,"{seconds:10, reorder:true}","результаты задерживаются на seconds; при reorder задерживается только ACCEPTED, и он приходит после итогового (seconds должен быть больше EXEC_DELAY_MS)"
reject_content,"{marker:\"#reject\"}","операции с маркером в title → 422"
fail_execution,"{marker:\"#fail\"}","операции с маркером исполняются с outcome=FAILED"
```

## Инварианты, которые проверяют тесты

- На один `operationKey` — не больше одного исполнения при любом числе отправок и любых режимах (`executions == 1` у исполненных).
- `version` результатов строго растёт в рамках операции.
- Состояние эмулятора переживает перезапуск (своя БД `emulator`).
