import { useState } from 'react'
import { Link } from 'react-router'
import { api, type Discrepancy, type ReconcileRun } from '../../api'
import { DISCREPANCY_LABELS, STATUS_LABELS, label } from '../../labels'
import { Badge, Empty, ErrorNote, fmtDate, Modal, usePolling } from '../../ui'

const ACTIONS: Record<string, string> = {
  RESEND: 'Переотправить',
  CLOSE_FINAL: 'Оставить закрытым окончательно',
  ACKNOWLEDGE: 'Принято к сведению',
}

export default function Reconcile() {
  const [open, setOpen] = useState(true)
  const runs = usePolling(() => api.get<ReconcileRun[]>('/api/operator/reconcile/runs'), [], 5000)
  const list = usePolling(() => api.get<{ items: Discrepancy[]; total: number }>(`/api/operator/discrepancies?open=${open}`), [open], 5000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<{ d: Discrepancy; action: string } | null>(null)
  const [comment, setComment] = useState('')

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/operator/reconcile')
      await Promise.all([runs.reload(), list.reload()])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function resolve() {
    if (!resolving) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/operator/discrepancies/${resolving.d.id}/resolve`, { action: resolving.action, comment })
      setResolving(null)
      setComment('')
      await list.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const last = runs.data?.[0]
  return (
    <section>
      <div className="page-head">
        <h2>Сверка с внешней системой</h2>
        <button onClick={run} disabled={busy}>
          {busy ? 'Сверяем…' : 'Запустить сверку'}
        </button>
      </div>
      <p className="muted">
        Сверка сравнивает наши задания со списком операций внешней системы. Если у них состояние новее (ответ или результат
        потерялся), оно применяется автоматически и фиксируется. Остальные расхождения ждут решения оператора. Сверка также
        выполняется автоматически каждые 5 минут.
      </p>
      <ErrorNote text={error} />
      {last && (
        <div className={'note ' + (last.error ? 'note-error' : 'note-info')}>
          Последняя сверка №{last.id}: {fmtDate(last.startedAt)} ({last.startedBy}).{' '}
          {last.error ? last.error : `Проверено заданий: ${last.checked}, расхождений: ${last.mismatches}.`}
        </div>
      )}

      <div className="tabs">
        <button className={'tab' + (open ? ' active' : '')} onClick={() => setOpen(true)}>
          Открытые
        </button>
        <button className={'tab' + (!open ? ' active' : '')} onClick={() => setOpen(false)}>
          Все, включая разобранные
        </button>
      </div>
      {list.data && list.data.items.length === 0 && <Empty>Расхождений нет.</Empty>}
      {list.data && list.data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Найдено</th>
              <th>Задание</th>
              <th>Расхождение</th>
              <th>У нас</th>
              <th>У них</th>
              <th>Решение</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((d) => (
              <tr key={d.id}>
                <td className="nowrap">{fmtDate(d.foundAt)}</td>
                <td>
                  {d.taskId ? <Link to={'/op/tasks/' + d.taskId}>{d.taskTitle}</Link> : <span className="mono small">{d.operationKey.slice(0, 8)}…</span>}
                </td>
                <td>{label(DISCREPANCY_LABELS, d.kind)}</td>
                <td>{label(STATUS_LABELS, d.ourStatus)}</td>
                <td>{d.theirStatus ?? 'нет операции'}</td>
                <td>
                  {d.resolvedAt ? (
                    <div className="small">
                      <Badge tone="gray">разобрано</Badge> {d.resolution} {d.resolvedBy && <span className="muted">({d.resolvedBy})</span>}
                    </div>
                  ) : (
                    <div className="actions compact">
                      {d.taskId && (
                        <button className="small-btn" onClick={() => setResolving({ d, action: 'RESEND' })}>
                          Переотправить
                        </button>
                      )}
                      {d.kind === 'CLOSED_NOT_EXECUTED' && (
                        <button className="small-btn secondary" onClick={() => setResolving({ d, action: 'CLOSE_FINAL' })}>
                          Закрыть окончательно
                        </button>
                      )}
                      <button className="small-btn secondary" onClick={() => setResolving({ d, action: 'ACKNOWLEDGE' })}>
                        К сведению
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {resolving && (
        <Modal title={ACTIONS[resolving.action]} onClose={() => setResolving(null)}>
          <p>
            {label(DISCREPANCY_LABELS, resolving.d.kind)}. {resolving.action === 'RESEND' &&
              'Задание будет отправлено снова с тем же ключом операции — внешняя система не исполнит его дважды.'}
          </p>
          <label>
            Комментарий (обязательно, попадёт в журнал)
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </label>
          <ErrorNote text={error} />
          <div className="actions">
            <button disabled={busy || comment.trim().length < 5} onClick={resolve}>
              Подтвердить
            </button>
            <button className="secondary" onClick={() => setResolving(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
