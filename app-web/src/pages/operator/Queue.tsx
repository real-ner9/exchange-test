import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, type OperatorTask, type Page } from '../../api'
import { ATTENTION_LABELS, STATUS_LABELS, STATUS_TONE, label } from '../../labels'
import { AnimatedNumber, Badge, Empty, ErrorNote, fmtAgo, Pager, rowProps, SkeletonRows, useChangedIds, usePolling } from '../../ui'

const LIVE = new Set(['QUEUED', 'SENDING', 'RETRY_WAIT', 'ACCEPTED'])


type Summary = {
  byStatus: Record<string, number>
  attention: number
  openDiscrepancies: number
  invalidMessages: number
  outboxPending: number
}

const VIEWS = [
  { key: 'attention', label: 'Требуют внимания' },
  { key: 'retrying', label: 'В повторах' },
  { key: 'closed', label: 'Закрыты без подтверждения' },
  { key: 'all', label: 'Все задания' },
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

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Очередь обмена</h2>
          <p className="subtitle">Проблемы обмена, повторы и закрытые вручную задания. Обновляется каждые 3 секунды.</p>
        </div>
      </div>
      {s && (
        <div className="stats">
          <Stat title="Требуют внимания" value={s.attention} tone={s.attention > 0 ? 'red' : 'green'} onClick={() => setView('attention')} />
          <Stat title="Ожидают повтора" value={s.byStatus.RETRY_WAIT} tone={s.byStatus.RETRY_WAIT > 0 ? 'orange' : 'gray'} onClick={() => setView('retrying')} />
          <Stat title="Отправляются" value={s.byStatus.QUEUED + s.byStatus.SENDING} tone="gray" />
          <Stat title="Принято, ждём результат" value={s.byStatus.ACCEPTED} tone="blue" />
          <Stat title="Выполнено" value={s.byStatus.COMPLETED} tone="green" />
          <Stat title="Закрыто без подтверждения" value={s.byStatus.MANUALLY_CLOSED} tone="purple" onClick={() => setView('closed')} />
          <Stat title="Открытых расхождений" value={s.openDiscrepancies} tone={s.openDiscrepancies > 0 ? 'yellow' : 'gray'} href="/op/reconcile" />
          <Stat title="Неразобранных сообщений" value={s.invalidMessages} tone={s.invalidMessages > 0 ? 'yellow' : 'gray'} href="/op/journal" />
        </div>
      )}
      <div className="tabs">
        {VIEWS.map((v) => (
          <button key={v.key} className={'tab' + (view === v.key ? ' active' : '')} onClick={() => { setView(v.key); setPage(0) }}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <input placeholder="Поиск: название, id или ключ операции" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="">Любой статус</option>
          {Object.keys(STATUS_LABELS).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote text={list.error} />
      {!list.data && !list.error && <SkeletonRows />}
      {list.data && list.data.items.length === 0 && (
        <Empty icon={view === 'attention' ? '🎉' : '🔍'}>{view === 'attention' ? 'Проблем нет — очередь пуста.' : 'Ничего не найдено.'}</Empty>
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="table-wrap" key={view + status + page}>
        <table className="table clickable">
          <thead>
            <tr>
              <th>Задание</th>
              <th>Статус</th>
              <th>Попыток</th>
              <th>Последняя ошибка</th>
              <th>След. попытка</th>
              <th>Изменено</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((t, i) => (
              <tr key={t.id} onClick={() => navigate('/op/tasks/' + t.id)} {...rowProps(i, changed.has(t.id))}>
                <td>
                  <div className="strong">{t.title}</div>
                  <div className="small muted">{t.initiator}</div>
                </td>
                <td>
                  <Badge tone={STATUS_TONE[t.status]} live={LIVE.has(t.status)}>{label(STATUS_LABELS, t.status)}</Badge>
                  {t.attentionReason && <div className="small warn-text">{label(ATTENTION_LABELS, t.attentionReason)}</div>}
                </td>
                <td>{t.attemptsCount}</td>
                <td className="small">{t.lastError ?? '—'}</td>
                <td>{t.status === 'RETRY_WAIT' ? fmtAgo(t.nextAttemptAt) : '—'}</td>
                <td>{fmtAgo(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {list.data && <Pager page={page} size={list.data.size} total={list.data.total} onPage={setPage} />}
    </section>
  )
}

function Stat({ title, value, tone, onClick, href }: { title: string; value: number; tone: string; onClick?: () => void; href?: string }) {
  const navigate = useNavigate()
  const act = onClick ?? (href ? () => navigate(href) : undefined)
  return (
    <button className={'stat stat-' + tone + (act ? ' stat-link' : '')} onClick={act} disabled={!act}>
      <div className="stat-value"><AnimatedNumber value={value ?? 0} /></div>
      <div className="stat-title">{title}</div>
    </button>
  )
}
