import { useState } from 'react'
import { Link } from 'react-router'
import { api, type InitiatorTask } from '../../api'
import { AnimatedNumber, Empty, ErrorNote, fmtDate, fmtMoney, rowProps, SkeletonRows, usePolling } from '../../ui'

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
      <div className="page-head">
        <h2>Отчёт о выполнении</h2>
      </div>
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
      </div>
      {data && (
        <div className="stats">
          <div className="stat stat-green">
            <div className="stat-value"><AnimatedNumber value={data.count} /></div>
            <div className="stat-title">Выполнено заданий</div>
          </div>
          <div className="stat stat-blue">
            <div className="stat-value small-value">{fmtMoney(total)}</div>
            <div className="stat-title">На сумму</div>
          </div>
        </div>
      )}
      <ErrorNote text={error} />
      {!data && !error && <SkeletonRows />}
      {data && data.items.length === 0 && <Empty icon="📊">За период нет выполненных заданий.</Empty>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
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
            {data.items.map((t, i) => (
              <tr key={t.id} {...rowProps(i, false)}>
                <td>
                  <Link to={'/tasks/' + t.id}>{t.title}</Link>
                </td>
                <td className="num">{fmtMoney(t.payload.amount)}</td>
                <td>{fmtDate(t.createdAt)}</td>
                <td>{fmtDate(t.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}
