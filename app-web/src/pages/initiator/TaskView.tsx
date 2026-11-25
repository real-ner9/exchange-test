import { Link, useNavigate, useParams } from 'react-router'
import { api, type InitiatorTask } from '../../api'
import { Badge, ErrorNote, fmtDate, fmtMoney, SkeletonCard, StatusStepper, usePolling } from '../../ui'
import { LIVE_CODES } from './MyTasks'

export default function TaskView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: t, error } = usePolling(() => api.get<InitiatorTask>('/api/tasks/' + id), [id])

  if (error && !t) return <ErrorNote text={error} />
  if (!t)
    return (
      <section className="narrow">
        <SkeletonCard />
      </section>
    )

  const tone = t.status.needsAction ? 'note-warn' : t.status.code === 'COMPLETED' ? 'note-success' : 'note-info'
  return (
    <section className="narrow">
      <Link to="/tasks" className="back">
        ← Мои задания
      </Link>
      <div className="card hero-card">
        <div className="page-head">
          <div>
            <h2>{t.title}</h2>
            <div className="muted small">создано {fmtDate(t.createdAt)}</div>
          </div>
          <Badge tone={t.status.color} live={LIVE_CODES.has(t.status.code)}>
            <span key={t.status.code} className="pop">
              {t.status.label}
            </span>
          </Badge>
        </div>

        <StatusStepper code={t.status.code} />

        <div className={'note ' + tone} key={t.status.code}>
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

        <div className="detail-grid">
          <div className="detail">
            <div className="detail-label">Сумма</div>
            <div className="detail-value">{fmtMoney(t.payload.amount)}</div>
          </div>
          <div className="detail">
            <div className="detail-label">Выполнено</div>
            <div className="detail-value">{fmtDate(t.completedAt)}</div>
          </div>
          <div className="detail wide">
            <div className="detail-label">Комментарий</div>
            <div className="detail-value">{t.payload.comment || '—'}</div>
          </div>
        </div>

        <h3>История</h3>
        <ol className="timeline">
          {t.history?.map((h, i) => (
            <li key={i} style={{ ['--i' as string]: i }}>
              <span className={'dot dot-' + h.color} />
              <span className="tl-label">{h.label}</span>
              <span className="when">{fmtDate(h.at)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
