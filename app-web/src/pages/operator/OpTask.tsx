import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError, type OperatorTaskDetail, type TaskEvent } from '../../api'
import { Button, DataTable, Dialog, Field, Notice, Props, Segmented, TextArea, useToast, type Column } from '../../components'
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
import { ErrorNote, fmtDate, fmtMoney, Loading, PageHead, StatusLabel, usePolling } from '../../ui'

type Executions = { operationKey: string; status: string | null; executions: number; receivedAttempts: number }
type Attempt = OperatorTaskDetail['attempts'][number]
type Result = OperatorTaskDetail['results'][number]
type Tab = 'events' | 'attempts' | 'results'

const ATTEMPT_COLUMNS: Column<Attempt>[] = [
  { id: 'at', header: 'Начата', width: 150, nowrap: true, cell: (a) => fmtDate(a.startedAt) },
  { id: 'trigger', header: 'Запуск', width: 90, cell: (a) => (a.trigger === 'MANUAL' ? 'вручную' : 'авто') },
  { id: 'outcome', header: 'Исход', width: 260, cell: (a) => (a.outcome ? label(ATTEMPT_LABELS, a.outcome) : 'в процессе') },
  { id: 'http', header: 'HTTP', num: true, width: 70, cell: (a) => a.httpStatus ?? '—' },
  {
    id: 'error',
    header: 'Ошибка / ответ',
    cell: (a) => (
      <>
        {a.error}
        {a.rawResponse && <pre className="raw">{a.rawResponse}</pre>}
      </>
    ),
  },
  { id: 'id', header: 'ID попытки', width: 100, cell: (a) => <span className="mono">{a.attemptId.slice(0, 8)}</span> },
]

const RESULT_COLUMNS: Column<Result>[] = [
  { id: 'at', header: 'Получен', width: 150, nowrap: true, cell: (r) => fmtDate(r.receivedAt) },
  { id: 'version', header: 'Версия', num: true, width: 80, cell: (r) => r.version },
  { id: 'outcome', header: 'Исход', width: 140, cell: (r) => r.outcome },
  { id: 'disposition', header: 'Обработка', cell: (r) => label(DISPOSITION_LABELS, r.disposition) },
  { id: 'id', header: 'ID результата', width: 120, cell: (r) => <span className="mono">{r.resultId.slice(0, 8)}</span> },
]

export default function OpTask() {
  const { id } = useParams()
  const { data: t, error, reload } = usePolling(() => api.get<OperatorTaskDetail>('/api/operator/tasks/' + id), [id])
  const [tab, setTab] = useState<Tab>('events')
  const [dialog, setDialog] = useState<'close' | 'retry' | null>(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exec, setExec] = useState<Executions | null>(null)
  const toast = useToast()

  if (error && !t) return <ErrorNote text={error} />
  if (!t) return <Loading />

  function open(kind: 'close' | 'retry') {
    setDialog(kind)
    setReason('')
    setActionError(null)
  }

  async function act(kind: 'close' | 'retry') {
    if (!t) return
    setBusy(true)
    setActionError(null)
    try {
      await api.post(`/api/operator/tasks/${t.id}/${kind}`, { version: t.version, reason })
      toast(kind === 'close' ? 'Задание закрыто без подтверждения, запись в журнале' : 'Повтор поставлен в очередь')
      setDialog(null)
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
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

  const closing = dialog === 'close'
  return (
    <section>
      <PageHead
        title={t.title}
        back={<Link to="/op/queue">← Очередь</Link>}
        sub={`${t.initiator} · создано ${fmtDate(t.createdAt)} · инициатор видит: «${t.userStatus}»`}
      >
        <StatusLabel tone={STATUS_TONE[t.status]}>{label(STATUS_LABELS, t.status)}</StatusLabel>
      </PageHead>

      {t.attentionReason && (
        <Notice className="block" tone="warning">
          {label(ATTENTION_LABELS, t.attentionReason)}
        </Notice>
      )}
      {t.status === 'MANUALLY_CLOSED' && (
        <Notice className="block" tone="neutral">
          Закрыто без подтверждения внешней системы. Причина: «{t.closedReason}». В отчёт о выполнении не входит; сверка
          покажет фактическое состояние.
        </Notice>
      )}
      {t.confirmedAfterManualClose && (
        <Notice className="block" tone="info">
          Исполнение подтверждено внешней системой после ручного закрытия.
        </Notice>
      )}

      <div className="actions block">
        <Button variant="primary" disabled={!t.canRetry} onClick={() => open('retry')}>
          Повторить сейчас
        </Button>
        <Button variant="danger" disabled={!t.canClose} onClick={() => open('close')}>
          Закрыть без подтверждения
        </Button>
        <Button variant="ghost" onClick={checkExecutions}>
          Сколько раз исполнено?
        </Button>
        {exec && (
          <span className={exec.executions > 1 ? 'danger-text' : 'muted'}>
            Эмулятор: исполнений {exec.executions}, получено отправок {exec.receivedAttempts}, статус{' '}
            {exec.status ?? 'нет операции'}
          </span>
        )}
      </div>
      <ErrorNote text={dialog ? null : actionError} />

      <div className="panel block">
        <Props
          items={[
            { label: 'Ключ операции', value: <span className="mono">{t.operationKey}</span>, copy: t.operationKey },
            { label: 'Сумма', value: <span className="num">{fmtMoney(t.payload.amount)}</span> },
            {
              label: 'У внешней системы',
              value: t.externalStatus ? `${t.externalStatus} (версия ${t.externalVersion})` : 'нет сведений',
            },
            {
              label: 'Попыток доставки',
              value: (
                <>
                  {t.attemptsCount}
                  {t.firstAttemptAt && <span className="muted">, первая {fmtDate(t.firstAttemptAt)}</span>}
                </>
              ),
            },
            { label: 'Следующая попытка', value: t.status === 'RETRY_WAIT' ? fmtDate(t.nextAttemptAt) : '—' },
            { label: 'Последняя ошибка', value: t.lastError ?? '—' },
            { label: 'Ключ формы', value: <span className="mono">{t.clientRequestId}</span> },
            { label: 'Версия записи', value: t.version },
          ]}
        />
      </div>

      {t.discrepancies.length > 0 && (
        <>
          <h2 className="section-title">Сверка</h2>
          <ul className="plain-list block">
            {t.discrepancies.map((d) => (
              <li key={d.id}>
                <StatusLabel tone={d.resolvedAt ? 'gray' : 'yellow'}>{d.resolvedAt ? 'разобрано' : 'открыто'}</StatusLabel>{' '}
                {label(DISCREPANCY_LABELS, d.kind)} {d.resolution && <span className="muted">— {d.resolution}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="toolbar">
        <Segmented
          label="Раздел"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'events', label: 'Журнал', count: t.events.length },
            { value: 'attempts', label: 'Попытки доставки', count: t.attempts.length },
            { value: 'results', label: 'Входящие результаты', count: t.results.length },
          ]}
        />
      </div>
      {tab === 'events' && <EventsTable events={t.events} />}
      {tab === 'attempts' && <DataTable rows={t.attempts} columns={ATTEMPT_COLUMNS} rowKey={(a) => a.attemptId} empty="Попыток не было" />}
      {tab === 'results' && <DataTable rows={t.results} columns={RESULT_COLUMNS} rowKey={(r) => r.resultId} empty="Результатов не было" />}

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={closing ? 'Закрыть без подтверждения' : 'Повторить отправку сейчас'}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Отмена</Button>
            <Button
              variant={closing ? 'danger' : 'primary'}
              loading={busy}
              disabled={closing && reason.trim().length < 5}
              onClick={() => dialog && act(dialog)}
            >
              {closing ? 'Закрыть задание' : 'Повторить'}
            </Button>
          </>
        }
      >
        {closing ? (
          <p>
            Задание уйдёт из рабочей очереди и повторы остановятся, но оно <b>не будет</b> отмечено выполненным и не попадёт в
            отчёт: подтверждения исполнения нет. Если внешняя система позже сообщит об исполнении, статус обновится
            автоматически; если нет — сверка покажет расхождение.
          </p>
        ) : (
          <p>
            Попытка уйдёт сразу, без паузы между повторами. Ключ операции тот же, поэтому внешняя система не исполнит её второй
            раз. Если исход прошлой попытки неизвестен, сначала будет запрошен статус.
          </p>
        )}
        <Field
          id="reason"
          label={closing ? 'Причина' : 'Комментарий'}
          hint={closing ? 'Обязательно, не короче 5 символов. Попадёт в журнал.' : 'Необязательно.'}
        >
          <TextArea id="reason" value={reason} onChange={setReason} rows={3} />
        </Field>
        <ErrorNote text={actionError} />
      </Dialog>
    </section>
  )
}

const EVENT_COLUMNS: Column<TaskEvent>[] = [
  { id: 'at', header: 'Когда', width: 130, nowrap: true, cell: (e) => fmtDate(e.at) },
  { id: 'kind', header: 'Событие', width: 190, cell: (e) => label(EVENT_LABELS, e.kind) },
  {
    id: 'status',
    header: 'Статус',
    width: 210,
    cell: (e) =>
      e.fromStatus || e.toStatus ? `${label(STATUS_LABELS, e.fromStatus)} → ${label(STATUS_LABELS, e.toStatus)}` : '—',
  },
  { id: 'actor', header: 'Кто', width: 110, cell: (e) => e.actor },
  {
    id: 'details',
    header: 'Причина / детали',
    cell: (e) => (
      <>
        {e.reason && <div>«{e.reason}»</div>}
        <Details d={e.details} />
      </>
    ),
  },
]

const TASK_COLUMN: Column<TaskEvent> = {
  id: 'task',
  header: 'Задание',
  width: 190,
  cell: (e) => <Link to={'/op/tasks/' + e.taskId}>{e.taskTitle}</Link>,
}

const EVENT_COLUMNS_WITH_TASK = [EVENT_COLUMNS[0], TASK_COLUMN, ...EVENT_COLUMNS.slice(1)]

export function EventsTable({ events, showTask }: { events: TaskEvent[]; showTask?: boolean }) {
  return (
    <DataTable
      rows={events}
      columns={showTask ? EVENT_COLUMNS_WITH_TASK : EVENT_COLUMNS}
      rowKey={(e) => String(e.id)}
      empty="Событий нет"
    />
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
  if (parts.length === 0) return null
  return <div className="muted">{parts.join(' · ')}</div>
}
