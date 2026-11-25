import { useState } from 'react'
import { Link } from 'react-router'
import { api, type InitiatorTask } from '../../api'
import { Empty, ErrorNote, fmtDate, fmtMoney, usePolling } from '../../ui'

type ReportResponse = { from: string; to: string; count: number; items: InitiatorTask[] }

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function Report() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(isoDay(new Date()))
  const { data, error } = usePolling(
    () =>
      api.get<ReportResponse>(
        `/api/tasks/report?from=${from}T00:00:00Z&to=${isoDay(new Date(new Date(to).getTime() + 86400000))}T00:00:00Z`,
      ),
    [from, to],
    10000,
  )
  const total = data?.items.reduce((s, t) => s + (t.payload.amount ?? 0), 0) ?? 0

  return (
    <section>
      <h2>Отчёт о выполнении</h2>
      <div className="note note-info">
        В отчёт попадают только задания, по которым внешняя система сообщила о фактическом исполнении. Принятые в работу,
        закрытые оператором без подтверждения и отклонённые сюда не входят.
      </div>
      <div className="filters">
        <label>
          С <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          По <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {data && (
          <span className="muted">
            Выполнено: <b>{data.count}</b>, на сумму <b>{fmtMoney(total)}</b>
          </span>
        )}
      </div>
      <ErrorNote text={error} />
      {data && data.items.length === 0 && <Empty>За период нет выполненных заданий.</Empty>}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Задание</th>
              <th>Сумма</th>
              <th>Создано</th>
              <th>Выполнено</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={'/tasks/' + t.id}>{t.title}</Link>
                </td>
                <td>{fmtMoney(t.payload.amount)}</td>
                <td>{fmtDate(t.createdAt)}</td>
                <td>{fmtDate(t.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
