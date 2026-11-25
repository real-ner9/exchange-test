import { useState } from 'react'
import { api, type TaskEvent } from '../../api'
import { EVENT_LABELS } from '../../labels'
import { ErrorNote, fmtDate, Pager, SkeletonRows, usePolling } from '../../ui'
import { EventsTable } from './OpTask'

type Invalid = { id: number; receivedAt: string; raw: string; error: string }

export default function Journal() {
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(0)
  const { data, error } = usePolling(
    () => api.get<{ items: TaskEvent[]; size: number }>(`/api/operator/events?kind=${kind}&page=${page}&size=100`),
    [kind, page],
  )
  const invalid = usePolling(() => api.get<Invalid[]>('/api/operator/invalid-messages'), [], 10000)

  return (
    <section>
      <div className="page-head">
        <h2>Журнал обмена</h2>
      </div>
      <p className="subtitle">
        Все значимые изменения: смены статусов, ответы и результаты внешней системы (включая повторные и устаревшие),
        действия операторов с причинами.
      </p>
      <div className="filters">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0) }}>
          <option value="">Все события</option>
          {Object.entries(EVENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote text={error} />
      {!data && !error && <SkeletonRows />}
      {data && (
        <div className="table-wrap" key={kind + page}>
          <EventsTable events={data.items} showTask />
        </div>
      )}
      {data && <Pager page={page} size={data.size} total={data.items.length < data.size ? page * data.size + data.items.length : (page + 2) * data.size} onPage={setPage} />}

      {invalid.data && invalid.data.length > 0 && (
        <>
          <h3>Неразобранные входящие сообщения</h3>
          <p className="muted small">Сообщения, которые не удалось разобрать. Сохранены как есть, статусы заданий не меняли.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Получено</th>
                <th>Ошибка</th>
                <th>Содержимое</th>
              </tr>
            </thead>
            <tbody>
              {invalid.data.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDate(m.receivedAt)}</td>
                  <td className="small">{m.error}</td>
                  <td>
                    <pre className="raw">{m.raw}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
