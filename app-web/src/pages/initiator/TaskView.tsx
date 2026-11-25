import { Link, useNavigate, useParams } from 'react-router'
import { api, type InitiatorTask } from '../../api'
import { Button, Notice, Props } from '../../components'
import { ErrorNote, fmtDate, fmtMoney, Loading, PageHead, StatusLabel, usePolling } from '../../ui'

export default function TaskView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: t, error } = usePolling(() => api.get<InitiatorTask>('/api/tasks/' + id), [id])

  if (error && !t) return <ErrorNote text={error} />
  if (!t) return <Loading />

  const tone = t.status.needsAction ? 'warning' : t.status.code === 'COMPLETED' ? 'success' : 'info'
  return (
    <section className="narrow">
      <PageHead title={t.title} sub={'Создано ' + fmtDate(t.createdAt)} back={<Link to="/tasks">← Мои задания</Link>}>
        <StatusLabel tone={t.status.color}>{t.status.label}</StatusLabel>
      </PageHead>

      <Notice
        className="block"
        tone={tone}
        title={t.status.needsAction ? 'Требуется ваше действие' : undefined}
        action={
          t.status.needsAction ? (
            <Button
              variant="primary"
              onClick={() =>
                navigate('/tasks/new', { state: { title: t.payload.title, amount: t.payload.amount, comment: t.payload.comment } })
              }
            >
              Создать исправленное задание
            </Button>
          ) : undefined
        }
      >
        {t.status.hint}
        {t.problem && <div>Причина: {t.problem}</div>}
      </Notice>

      <div className="panel block">
        <Props
          items={[
            { label: 'Сумма', value: <span className="num">{fmtMoney(t.payload.amount)}</span> },
            { label: 'Выполнено', value: fmtDate(t.completedAt) },
            { label: 'Комментарий', value: t.payload.comment || '—' },
          ]}
        />
      </div>

      <h2 className="section-title">История</h2>
      <ol className="timeline">
        {t.history?.map((h, i) => (
          <li key={i}>
            <span className="timeline-at">{fmtDate(h.at)}</span>
            <span>{h.label}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
