import { Link, useNavigate, useParams } from 'react-router'
import { api, type InitiatorTask } from '../../api'
import { Badge, ErrorNote, fmtDate, fmtMoney, usePolling } from '../../ui'

export default function TaskView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: t, error } = usePolling(() => api.get<InitiatorTask>('/api/tasks/' + id), [id])

  if (error) return <ErrorNote text={error} />
  if (!t) return <div className="muted">Загрузка…</div>

  return (
    <section className="narrow">
      <Link to="/tasks" className="back">
        ← Мои задания
      </Link>
      <div className="card">
        <div className="page-head">
          <h2>{t.title}</h2>
          <Badge tone={t.status.color}>{t.status.label}</Badge>
        </div>
        <div className={'note ' + (t.status.needsAction ? 'note-warn' : 'note-info')}>
          {t.status.needsAction && <div className="strong">Требуется ваше действие</div>}
          {t.status.hint}
          {t.problem && <div className="problem">Причина: {t.problem}</div>}
        </div>
        {t.status.needsAction && (
          <button
            onClick={() =>
              navigate('/tasks/new', {
                state: { title: t.payload.title, amount: t.payload.amount, comment: t.payload.comment },
              })
            }
          >
            Создать исправленное задание
          </button>
        )}
        <dl className="fields">
          <dt>Сумма</dt>
          <dd>{fmtMoney(t.payload.amount)}</dd>
          <dt>Комментарий</dt>
          <dd>{t.payload.comment || '—'}</dd>
          <dt>Создано</dt>
          <dd>{fmtDate(t.createdAt)}</dd>
          <dt>Выполнено</dt>
          <dd>{fmtDate(t.completedAt)}</dd>
        </dl>
        <h3>История</h3>
        <ol className="timeline">
          {t.history?.map((h, i) => (
            <li key={i}>
              <span className={'dot dot-' + h.color} />
              <span className="when">{fmtDate(h.at)}</span>
              <span>{h.label}</span>
            </li>
          ))}
        </ol>
        <div className="muted small">Страница обновляется сама.</div>
      </div>
    </section>
  )
}
