import { Link, useNavigate, useParams } from 'react-router'
import { Alert, Button, DefinitionList, Text } from '@gravity-ui/uikit'
import { api, type InitiatorTask } from '../../api'
import { ErrorNote, fmtDate, fmtMoney, Loading, PageHead, StatusLabel, usePolling } from '../../ui'

export default function TaskView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: t, error } = usePolling(() => api.get<InitiatorTask>('/api/tasks/' + id), [id])

  if (error && !t) return <ErrorNote text={error} />
  if (!t) return <Loading />

  const theme = t.status.needsAction ? 'warning' : t.status.code === 'COMPLETED' ? 'success' : 'info'
  return (
    <section className="narrow">
      <Link to="/tasks" className="back">
        ← Мои задания
      </Link>
      <PageHead title={t.title} sub={'создано ' + fmtDate(t.createdAt)}>
        <StatusLabel tone={t.status.color}>{t.status.label}</StatusLabel>
      </PageHead>

      <Alert
        className="block"
        theme={theme}
        view="outlined"
        title={t.status.needsAction ? 'Требуется ваше действие' : undefined}
        message={
          <>
            {t.status.hint}
            {t.problem && <div>Причина: {t.problem}</div>}
          </>
        }
        actions={
          t.status.needsAction ? (
            <Button
              view="action"
              onClick={() =>
                navigate('/tasks/new', { state: { title: t.payload.title, amount: t.payload.amount, comment: t.payload.comment } })
              }
            >
              Создать исправленное задание
            </Button>
          ) : undefined
        }
      />

      <DefinitionList className="block" nameMaxWidth={160}>
        <DefinitionList.Item name="Сумма">{fmtMoney(t.payload.amount)}</DefinitionList.Item>
        <DefinitionList.Item name="Выполнено">{fmtDate(t.completedAt)}</DefinitionList.Item>
        <DefinitionList.Item name="Комментарий">{t.payload.comment || '—'}</DefinitionList.Item>
      </DefinitionList>

      <Text as="h2" variant="subheader-2" className="section-title">
        История
      </Text>
      <table className="plain-table history">
        <tbody>
          {t.history?.map((h, i) => (
            <tr key={i}>
              <td className="cell-nowrap muted">{fmtDate(h.at)}</td>
              <td>{h.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
