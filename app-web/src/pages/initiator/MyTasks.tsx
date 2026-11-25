import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, type InitiatorTask, type Page } from '../../api'
import { AnimatedNumber, Badge, Empty, ErrorNote, fmtAgo, fmtMoney, Pager, rowProps, SkeletonRows, useChangedIds, usePolling } from '../../ui'

type ListResponse = Page<InitiatorTask> & { counts: Record<string, number> }

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'В работе' },
  { key: 'needsAction', label: 'Нужно моё действие' },
  { key: 'completed', label: 'Выполнено' },
]

export const LIVE_CODES = new Set(['SENDING', 'ACCEPTED'])

export default function MyTasks() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const navigate = useNavigate()
  const { data, error } = usePolling(
    () => api.get<ListResponse>(`/api/tasks?filter=${filter}&page=${page}&size=20`),
    [filter, page],
  )
  const changed = useChangedIds(data?.items, (t) => t.id, (t) => t.status.code)

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Мои задания</h2>
          <p className="subtitle">Статусы обновляются сами — страницу перезагружать не нужно.</p>
        </div>
        <Link to="/tasks/new" className="button">
          <span className="plus">+</span> Новое задание
        </Link>
      </div>
      {data && data.counts.needsAction > 0 && (
        <div className="note note-warn attention-in">
          <span className="note-icon">!</span>
          <div>
            Ваше действие нужно по <b>{data.counts.needsAction}</b> {plural(data.counts.needsAction)}.{' '}
            <button className="link" onClick={() => { setFilter('needsAction'); setPage(0) }}>
              Показать
            </button>
          </div>
        </div>
      )}
      <div className="tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={'tab' + (filter === f.key ? ' active' : '')}
            onClick={() => { setFilter(f.key); setPage(0) }}
          >
            {f.label}
            {data && (
              <span className={'count' + (f.key === 'needsAction' && data.counts[f.key] > 0 ? ' count-warn' : '')}>
                <AnimatedNumber value={data.counts[f.key] ?? 0} />
              </span>
            )}
          </button>
        ))}
      </div>
      <ErrorNote text={error} />
      {!data && !error && <SkeletonRows />}
      {data && data.items.length === 0 && (
        <Empty icon="📭">
          Здесь пока пусто. <Link to="/tasks/new">Создайте первое задание</Link>
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <div className="table-wrap" key={filter + page}>
          <table className="table clickable">
            <thead>
              <tr>
                <th>Задание</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Создано</th>
                <th>Изменено</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t, i) => (
                <tr key={t.id} onClick={() => navigate('/tasks/' + t.id)} {...rowProps(i, changed.has(t.id))}>
                  <td>
                    <div className="strong">{t.title}</div>
                    {t.status.needsAction && <div className="small warn-text">Требуется ваше действие</div>}
                  </td>
                  <td className="num">{fmtMoney(t.payload.amount)}</td>
                  <td>
                    <Badge tone={t.status.color} live={LIVE_CODES.has(t.status.code)}>
                      {t.status.label}
                    </Badge>
                  </td>
                  <td className="muted">{fmtAgo(t.createdAt)}</td>
                  <td className="muted">{fmtAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} size={data.size} total={data.total} onPage={setPage} />}
    </section>
  )
}

function plural(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'заданию'
  return 'заданиям'
}
