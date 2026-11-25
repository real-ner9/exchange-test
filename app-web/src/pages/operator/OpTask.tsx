import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError, type OperatorTaskDetail, type TaskEvent } from '../../api'
import {
  ATTEMPT_LABELS,
  ATTENTION_LABELS,
  DISCREPANCY_LABELS,
  DISPOSITION_LABELS,
  EVENT_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  label,
} from '../../labels'
import { Badge, ErrorNote, fmtDate, fmtMoney, Modal, rowProps, SkeletonCard, useToast, usePolling } from '../../ui'

const LIVE = new Set(['QUEUED', 'SENDING', 'RETRY_WAIT', 'ACCEPTED'])


type Executions = { operationKey: string; status: string | null; executions: number; receivedAttempts: number }

export default function OpTask() {
  const { id } = useParams()
  const { data: t, error, reload } = usePolling(() => api.get<OperatorTaskDetail>('/api/operator/tasks/' + id), [id])
  const [tab, setTab] = useState<'events' | 'attempts' | 'results'>('events')
  const [dialog, setDialog] = useState<'close' | 'retry' | null>(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exec, setExec] = useState<Executions | null>(null)
  const toast = useToast()

  if (error && !t) return <ErrorNote text={error} />
  if (!t) return <SkeletonCard />

  async function act(kind: 'close' | 'retry') {
    if (!t) return
    setBusy(true)
    setActionError(null)
    try {
      await api.post(`/api/operator/tasks/${t.id}/${kind}`, { version: t.version, reason })
      toast(kind === 'close' ? 'Задание закрыто без подтверждения — записано в журнал' : 'Повтор поставлен в очередь — отправка начнётся сразу')
      setDialog(null)
      setReason('')
      await reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg)
      toast(msg, 'error')
      if (e instanceof ApiError && e.status === 409) await reload()
    } finally {
      setBusy(false)
    }
  }

  async function checkExecutions() {
    if (!t) return
    try {
      setExec(await api.get<Executions>('/api/operator/demo/executions/' + t.operationKey))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section>
      <Link to="/op/queue" className="back">
        ← Очередь
      </Link>
      <div className="card">
        <div className="page-head">
          <div>
            <h2>{t.title}</h2>
            <div className="muted small">
              {t.initiator} · создано {fmtDate(t.createdAt)} · инициатор видит: «{t.userStatus}»
            </div>
          </div>
          <Badge tone={STATUS_TONE[t.status]} live={LIVE.has(t.status)}>
            <span key={t.status} className="pop">{label(STATUS_LABELS, t.status)}</span>
          </Badge>
        </div>

        {t.attentionReason && <div className="note note-warn">{label(ATTENTION_LABELS, t.attentionReason)}</div>}
        {t.status === 'MANUALLY_CLOSED' && (
          <div className="note note-purple">
            Закрыто без подтверждения внешней системы. Причина: «{t.closedReason}». В отчёт о выполнении не входит;
            сверка покажет фактическое состояние.
          </div>
        )}
        {t.confirmedAfterManualClose && (
          <div className="note note-info">Исполнение подтверждено внешней системой после ручного закрытия.</div>
        )}

        <div className="actions">
          <button disabled={!t.canRetry} onClick={() => { setDialog('retry'); setActionError(null) }}
            title="Отправить сейчас, не дожидаясь паузы между повторами. Ключ операции тот же — двойного исполнения не будет.">
            Повторить сейчас
          </button>
          <button className="danger" disabled={!t.canClose} onClick={() => { setDialog('close'); setActionError(null) }}
            title="Бывшее «Считать выполненным». Останавливает повторы, но не отмечает задание выполненным.">
            Закрыть без подтверждения
          </button>
          <button className="secondary" onClick={checkExecutions} title="Спросить у эмулятора, сколько раз операция фактически исполнялась">
            Сколько раз исполнено?
          </button>
          {exec && (
            <span className={'exec-chip ' + (exec.executions > 1 ? 'exec-bad' : 'exec-ok')} key={exec.receivedAttempts + '-' + exec.executions}>
              Эмулятор: исполнений {exec.executions}, получено отправок {exec.receivedAttempts}, статус {exec.status ?? 'нет операции'}
            </span>
          )}
        </div>
        <ErrorNote text={dialog ? null : actionError} />

        <dl className="fields two">
          <dt>Ключ операции</dt>
          <dd className="mono">{t.operationKey}</dd>
          <dt>Сумма</dt>
          <dd>{fmtMoney(t.payload.amount)}</dd>
          <dt>У внешней системы</dt>
          <dd>{t.externalStatus ? `${t.externalStatus} (версия ${t.externalVersion})` : 'нет сведений'}</dd>
          <dt>Попыток доставки</dt>
          <dd>{t.attemptsCount}{t.firstAttemptAt && `, первая ${fmtDate(t.firstAttemptAt)}`}</dd>
          <dt>Следующая попытка</dt>
          <dd>{t.status === 'RETRY_WAIT' ? fmtDate(t.nextAttemptAt) : '—'}</dd>
          <dt>Последняя ошибка</dt>
          <dd>{t.lastError ?? '—'}</dd>
          <dt>Ключ формы</dt>
          <dd className="mono small">{t.clientRequestId}</dd>
          <dt>Версия записи</dt>
          <dd>{t.version}</dd>
        </dl>

        {t.discrepancies.length > 0 && (
          <>
            <h3>Сверка</h3>
            <ul className="plain">
              {t.discrepancies.map((d) => (
                <li key={d.id}>
                  <Badge tone={d.resolvedAt ? 'gray' : 'yellow'}>{d.resolvedAt ? 'разобрано' : 'открыто'}</Badge>{' '}
                  {label(DISCREPANCY_LABELS, d.kind)} {d.resolution && <span className="muted">— {d.resolution}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="tabs">
          <button className={'tab' + (tab === 'events' ? ' active' : '')} onClick={() => setTab('events')}>
            Журнал <span className="count">{t.events.length}</span>
          </button>
          <button className={'tab' + (tab === 'attempts' ? ' active' : '')} onClick={() => setTab('attempts')}>
            Попытки доставки <span className="count">{t.attempts.length}</span>
          </button>
          <button className={'tab' + (tab === 'results' ? ' active' : '')} onClick={() => setTab('results')}>
            Входящие результаты <span className="count">{t.results.length}</span>
          </button>
        </div>

        <div className="tab-body" key={tab}>
        {tab === 'events' && <EventsTable events={t.events} />}
        {tab === 'attempts' && (
          <table className="table">
            <thead>
              <tr>
                <th>Начата</th>
                <th>Запуск</th>
                <th>Исход</th>
                <th>HTTP</th>
                <th>Ошибка / ответ</th>
                <th>ID попытки</th>
              </tr>
            </thead>
            <tbody>
              {t.attempts.map((a, i) => (
                <tr key={a.attemptId} {...rowProps(i, false)}>
                  <td>{fmtDate(a.startedAt)}</td>
                  <td>{a.trigger === 'MANUAL' ? 'вручную' : 'авто'}</td>
                  <td>{a.outcome ? label(ATTEMPT_LABELS, a.outcome) : 'в процессе…'}</td>
                  <td>{a.httpStatus ?? '—'}</td>
                  <td className="small">
                    {a.error}
                    {a.rawResponse && <pre className="raw">{a.rawResponse}</pre>}
                  </td>
                  <td className="mono small">{a.attemptId.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'results' && (
          <table className="table">
            <thead>
              <tr>
                <th>Получен</th>
                <th>Версия</th>
                <th>Исход</th>
                <th>Обработка</th>
                <th>ID результата</th>
              </tr>
            </thead>
            <tbody>
              {t.results.map((r, i) => (
                <tr key={r.resultId} {...rowProps(i, false)}>
                  <td>{fmtDate(r.receivedAt)}</td>
                  <td>{r.version}</td>
                  <td>{r.outcome}</td>
                  <td>{label(DISPOSITION_LABELS, r.disposition)}</td>
                  <td className="mono small">{r.resultId.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>

      {dialog === 'close' && (
        <Modal title="Закрыть без подтверждения" onClose={() => setDialog(null)}>
          <p>
            Это бывшая кнопка «Считать выполненным». Задание уйдёт из рабочей очереди и повторы остановятся, но оно{' '}
            <b>не будет</b> отмечено выполненным и не попадёт в отчёт: подтверждения исполнения нет. Если внешняя система
            позже сообщит об исполнении, статус обновится автоматически; если нет — сверка покажет расхождение.
          </p>
          <label>
            Причина (обязательно, видна в журнале)
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
          <ErrorNote text={actionError} />
          <div className="actions">
            <button className="danger" disabled={busy || reason.trim().length < 5} onClick={() => act('close')}>
              Закрыть
            </button>
            <button className="secondary" onClick={() => setDialog(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'retry' && (
        <Modal title="Повторить отправку сейчас" onClose={() => setDialog(null)}>
          <p>
            Новая попытка уйдёт сразу, без паузы между повторами. Ключ операции тот же, поэтому внешняя система не исполнит
            её второй раз. Если исход прошлой попытки неизвестен, сначала будет запрошен статус.
          </p>
          <label>
            Комментарий (необязательно)
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
          <ErrorNote text={actionError} />
          <div className="actions">
            <button disabled={busy} onClick={() => act('retry')}>
              Повторить
            </button>
            <button className="secondary" onClick={() => setDialog(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

export function EventsTable({ events, showTask }: { events: TaskEvent[]; showTask?: boolean }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Когда</th>
          {showTask && <th>Задание</th>}
          <th>Событие</th>
          <th>Статус</th>
          <th>Кто</th>
          <th>Причина / детали</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={e.id} {...rowProps(i, false)}>
            <td className="nowrap">{fmtDate(e.at)}</td>
            {showTask && (
              <td>
                <Link to={'/op/tasks/' + e.taskId}>{e.taskTitle}</Link>
              </td>
            )}
            <td>{label(EVENT_LABELS, e.kind)}</td>
            <td className="small nowrap">
              {e.fromStatus || e.toStatus ? `${label(STATUS_LABELS, e.fromStatus)} → ${label(STATUS_LABELS, e.toStatus)}` : '—'}
            </td>
            <td>{e.actor}</td>
            <td className="small">
              {e.reason && <div>«{e.reason}»</div>}
              <Details d={e.details} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Details({ d }: { d: Record<string, unknown> | null }) {
  if (!d) return null
  const parts: string[] = []
  if (d.source) parts.push('источник: ' + label(SOURCE_LABELS, String(d.source)))
  if (d.externalStatus) parts.push(`у них: ${d.externalStatus} v${d.externalVersion}`)
  if (d.note) parts.push(String(d.note))
  if (d.version !== undefined && d.outcome) parts.push(`результат v${d.version} ${d.outcome}`)
  if (d.appliedVersion !== undefined) parts.push(`применена v${d.appliedVersion}`)
  if (d.attempts !== undefined) parts.push(`попыток: ${d.attempts}`)
  if (d.kind) parts.push(label(DISCREPANCY_LABELS, String(d.kind)))
  if (d.reason && typeof d.reason === 'string') parts.push(d.reason)
  return <div className="muted">{parts.join(' · ')}</div>
}
