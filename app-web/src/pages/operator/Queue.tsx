import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SegmentedRadioGroup, Select, TextInput } from '@gravity-ui/uikit'
import { api, type OperatorTask, type Page } from '../../api'
import { ATTENTION_LABELS, STATUS_LABELS, STATUS_TONE, label } from '../../labels'
import {
  Counters,
  DataTable,
  ErrorNote,
  fmtAgo,
  Loading,
  PageHead,
  Pager,
  StatusLabel,
  useChangedIds,
  usePolling,
  type Column,
} from '../../ui'

type Summary = {
  byStatus: Record<string, number>
  attention: number
  openDiscrepancies: number
  invalidMessages: number
  outboxPending: number
}

const VIEWS = [
  { value: 'attention', content: 'Требуют внимания' },
  { value: 'retrying', content: 'В повторах' },
  { value: 'closed', content: 'Закрыты без подтверждения' },
  { value: 'all', content: 'Все задания' },
]

const COLUMNS: Column<OperatorTask>[] = [
  {
    id: 'title',
    header: 'Задание',
    cell: (t) => (
      <>
        {t.title}
        <div className="muted">{t.initiator}</div>
      </>
    ),
  },
  {
    id: 'status',
    header: 'Статус',
    width: 230,
    cell: (t) => (
      <>
        <StatusLabel tone={STATUS_TONE[t.status]}>{label(STATUS_LABELS, t.status)}</StatusLabel>
        {t.attentionReason && <div className="warn-text">{label(ATTENTION_LABELS, t.attentionReason)}</div>}
      </>
    ),
  },
  { id: 'attempts', header: 'Попыток', num: true, width: 80, cell: (t) => t.attemptsCount },
  { id: 'error', header: 'Последняя ошибка', cell: (t) => t.lastError ?? '—' },
  { id: 'next', header: 'След. попытка', width: 120, nowrap: true, cell: (t) => (t.status === 'RETRY_WAIT' ? fmtAgo(t.nextAttemptAt) : '—') },
  { id: 'updated', header: 'Изменено', width: 120, nowrap: true, cell: (t) => fmtAgo(t.updatedAt) },
]

export default function Queue() {
  const navigate = useNavigate()
  const [view, setView] = useState('attention')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const summary = usePolling(() => api.get<Summary>('/api/operator/summary'), [])
  const list = usePolling(
    () =>
      api.get<Page<OperatorTask>>(
        `/api/operator/tasks?view=${view}&status=${status}&q=${encodeURIComponent(q)}&page=${page}&size=50`,
      ),
    [view, status, q, page],
  )
  const s = summary.data
  const changed = useChangedIds(list.data?.items, (t) => t.id, (t) => t.status)
  const n = (v: number | undefined) => (v ?? 0).toLocaleString('ru-RU')

  return (
    <section>
      <PageHead title="Очередь обмена" sub="Проблемы обмена, повторы и закрытые вручную задания. Обновляется каждые 3 секунды." />
      {s && (
        <Counters
          items={[
            { label: 'Требуют внимания', value: n(s.attention), warn: s.attention > 0, onClick: () => setView('attention') },
            { label: 'Ожидают повтора', value: n(s.byStatus.RETRY_WAIT), warn: s.byStatus.RETRY_WAIT > 0, onClick: () => setView('retrying') },
            { label: 'Отправляются', value: n((s.byStatus.QUEUED ?? 0) + (s.byStatus.SENDING ?? 0)) },
            { label: 'Ждём результат', value: n(s.byStatus.ACCEPTED) },
            { label: 'Выполнено', value: n(s.byStatus.COMPLETED) },
            { label: 'Закрыто без подтв.', value: n(s.byStatus.MANUALLY_CLOSED), onClick: () => setView('closed') },
            { label: 'Расхождений', value: n(s.openDiscrepancies), warn: s.openDiscrepancies > 0, onClick: () => navigate('/op/reconcile') },
            { label: 'Неразобранных сообщений', value: n(s.invalidMessages), warn: s.invalidMessages > 0, onClick: () => navigate('/op/journal') },
          ]}
        />
      )}
      <div className="toolbar">
        <SegmentedRadioGroup
          value={view}
          options={VIEWS}
          onUpdate={(v) => {
            setView(v)
            setPage(0)
          }}
        />
        <TextInput
          className="search"
          placeholder="Название, id или ключ операции"
          value={q}
          hasClear
          onUpdate={(v) => {
            setQ(v)
            setPage(0)
          }}
        />
        <Select
          width={240}
          value={status ? [status] : []}
          placeholder="Любой статус"
          hasClear
          options={Object.entries(STATUS_LABELS).map(([value, content]) => ({ value, content }))}
          onUpdate={(v) => {
            setStatus(v[0] ?? '')
            setPage(0)
          }}
        />
      </div>
      <ErrorNote text={list.error} />
      {!list.data && !list.error && <Loading />}
      {list.data && (
        <DataTable
          rows={list.data.items}
          columns={COLUMNS}
          rowKey={(t) => t.id}
          changed={changed}
          onRowClick={(t) => navigate('/op/tasks/' + t.id)}
          empty={view === 'attention' ? 'Заданий, требующих внимания, нет.' : 'Ничего не найдено.'}
        />
      )}
      {list.data && <Pager page={page} size={list.data.size} total={list.data.total} onPage={setPage} />}
    </section>
  )
}
