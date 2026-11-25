import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, type InitiatorTask, type Page } from '../../api'
import { Badge, Empty, ErrorNote, fmtAgo, fmtMoney, Pager, usePolling } from '../../ui'

type ListResponse = Page<InitiatorTask> & { counts: Record<string, number> }

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'В работе' },
  { key: 'needsAction', label: 'Требуют моего действия' },
  { key: 'completed', label: 'Выполнено' },
]

export default function MyTasks() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const navigate = useNavigate()
  const { data, error } = usePolling(
    () => api.get<ListResponse>(`/api/tasks?filter=${filter}&page=${page}&size=20`),
    [filter, page],
  )

  return (
    <section>
      <div className="page-head">
        <h2>Мои задания</h2>
        <Link to="/tasks/new" className="button">
          + Новое задание
        </Link>
      </div>
      {data && data.counts.needsAction > 0 && (
        <div className="note note-warn">
          Ваше действие нужно по {data.counts.needsAction} заданиям.{' '}
          <button className="link" onClick={() => { setFilter('needsAction'); setPage(0) }}>
            Показать
          </button>
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
            {data && <span className="count">{data.counts[f.key] ?? 0}</span>}
          </button>
        ))}
      </div>
      <ErrorNote text={error} />
      {data && data.items.length === 0 && <Empty>Заданий нет.</Empty>}
      {data && data.items.length > 0 && (
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
            {data.items.map((t) => (
              <tr key={t.id} onClick={() => navigate('/tasks/' + t.id)}>
                <td>
                  <div className="strong">{t.title}</div>
                  {t.status.needsAction && <div className="small warn-text">Требуется ваше действие</div>}
                </td>
                <td>{fmtMoney(t.payload.amount)}</td>
                <td>
                  <Badge tone={t.status.color}>{t.status.label}</Badge>
                </td>
                <td>{fmtAgo(t.createdAt)}</td>
                <td>{fmtAgo(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <Pager page={page} size={data.size} total={data.total} onPage={setPage} />}
    </section>
  )
}
