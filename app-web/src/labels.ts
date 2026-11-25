// Человеческие подписи для технических значений (экран оператора).

export const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'В очереди на отправку',
  SENDING: 'Отправляется',
  RETRY_WAIT: 'Ожидает повтора',
  ACCEPTED: 'Принято внешней системой',
  COMPLETED: 'Выполнено',
  FAILED: 'Отказ исполнения',
  REJECTED: 'Отвергнуто по содержанию',
  NEEDS_ATTENTION: 'Требует оператора',
  MANUALLY_CLOSED: 'Закрыто без подтверждения',
}

export const STATUS_TONE: Record<string, string> = {
  QUEUED: 'gray',
  SENDING: 'gray',
  RETRY_WAIT: 'orange',
  ACCEPTED: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  REJECTED: 'yellow',
  NEEDS_ATTENTION: 'red',
  MANUALLY_CLOSED: 'purple',
}

export const ATTENTION_LABELS: Record<string, string> = {
  LONG_RETRY: 'Долго не проходит (повтор продолжается)',
  UNPARSEABLE: 'Ответ не удалось разобрать',
  CONTRACT_ERROR: 'Неожиданный ответ внешней системы',
}

export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Задание создано',
  EXTERNAL_STATUS: 'Статус от внешней системы',
  CONFIRMED_AFTER_MANUAL_CLOSE: 'Подтверждено после ручного закрытия',
  REJECTED_BY_EXTERNAL: 'Отказ по содержанию',
  NEEDS_ATTENTION: 'Передано оператору',
  ATTENTION_LONG_RETRY: 'Долго не проходит',
  RESULT_DUPLICATE: 'Повтор результата (проигнорирован)',
  RESULT_STALE: 'Устаревший результат (проигнорирован)',
  MANUAL_RETRY: 'Ручной повтор',
  MANUALLY_CLOSED: 'Закрыто без подтверждения',
  RECONCILE_MISMATCH: 'Сверка: расхождение',
  RECONCILE_RESOLVED: 'Сверка: решение оператора',
}

export const SOURCE_LABELS: Record<string, string> = {
  SEND_RESPONSE: 'ответ на отправку',
  STATUS_CHECK: 'проверка статуса',
  RESULT: 'входящий результат',
  RECONCILE: 'сверка',
}

export const ATTEMPT_LABELS: Record<string, string> = {
  ACCEPTED: 'Принято',
  ALREADY_KNOWN: 'Уже известно (повторно не исполнялось)',
  CHECKED_KNOWN: 'Проверка статуса: операция уже есть, не отправляли',
  REJECTED: 'Отказ по содержанию (422)',
  TRANSIENT: 'Временная ошибка',
  UNCERTAIN: 'Ответ не получен — исход неизвестен',
  UNPARSEABLE: 'Неразбираемый ответ',
  CONTRACT_ERROR: 'Неожиданный ответ',
}

export const DISPOSITION_LABELS: Record<string, string> = {
  APPLIED: 'Применён',
  STALE: 'Устаревший — проигнорирован',
  UNKNOWN_OPERATION: 'Неизвестная операция',
}

export const DISCREPANCY_LABELS: Record<string, string> = {
  AUTO_FIXED: 'У нас отставало — применено состояние внешней системы',
  CLOSED_NOT_EXECUTED: 'У нас закрыто вручную, у них не исполнялось',
  MISSING_THERE: 'У нас принято/исполнено, у них операции нет',
  STATUS_CONFLICT: 'Итоговые статусы противоречат',
  UNKNOWN_HERE: 'У них есть операция, которой нет у нас',
}

export const FAULT_LABELS: Record<string, { title: string; text: string }> = {
  unavailable: { title: 'Недоступность', text: 'На любой запрос — 503; исполнение и доставка результатов стоят.' },
  lose_response: {
    title: 'Потеря ответа после исполнения',
    text: 'Операция принимается и исполняется, но ответ на отправку не приходит (таймаут).',
  },
  duplicate_result: { title: 'Повтор результата', text: 'Каждый результат приходит дважды с одним resultId.' },
  delay_result: {
    title: 'Задержка результата',
    text: 'Результаты приходят через N секунд; с перестановкой «принято» приходит после итогового.',
  },
  reject_content: { title: 'Отказ по содержанию', text: 'Задания с маркером в названии получают 422.' },
  fail_execution: { title: 'Отказ исполнения', text: 'Задания с маркером исполняются с отказом (FAILED).' },
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—'
  return map[key] ?? key
}
