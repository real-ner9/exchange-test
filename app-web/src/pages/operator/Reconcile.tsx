import { useState } from 'react'
import { Link } from 'react-router'
import { Alert, Button, Dialog, SegmentedRadioGroup, Text, TextArea } from '@gravity-ui/uikit'
import { api, type Discrepancy, type ReconcileRun } from '../../api'
import { DISCREPANCY_LABELS, STATUS_LABELS, label } from '../../labels'
import { DataTable, ErrorNote, fmtDate, Loading, PageHead, useToast, usePolling, type Column } from '../../ui'

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
  const toast = useToast()

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<ReconcileRun>('/api/operator/reconcile')
      toast(
        r.error ? 'Сверка не выполнена: ' + r.error : `Сверка №${r.id}: проверено ${r.checked}, расхождений ${r.mismatches}`,
        r.error ? 'error' : 'ok',
      )
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
      toast('Решение записано: ' + ACTIONS[resolving.action].toLowerCase())
      setResolving(null)
      setComment('')
      await list.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Discrepancy>[] = [
    { id: 'found', header: 'Найдено', width: 150, nowrap: true, cell: (d) => fmtDate(d.foundAt) },
    {
      id: 'task',
      header: 'Задание',
      width: 220,
      cell: (d) =>
        d.taskId ? <Link to={'/op/tasks/' + d.taskId}>{d.taskTitle}</Link> : <span className="mono">{d.operationKey.slice(0, 8)}</span>,
    },
    { id: 'kind', header: 'Расхождение', cell: (d) => label(DISCREPANCY_LABELS, d.kind) },
    { id: 'ours', header: 'У нас', width: 190, cell: (d) => label(STATUS_LABELS, d.ourStatus) },
    { id: 'theirs', header: 'У них', width: 120, cell: (d) => d.theirStatus ?? 'нет операции' },
    {
      id: 'resolution',
      header: 'Решение',
      width: 380,
      cell: (d) =>
        d.resolvedAt ? (
          <>
            {d.resolution} {d.resolvedBy && <span className="muted">({d.resolvedBy})</span>}
          </>
        ) : (
          <div className="actions">
            {d.taskId && (
              <Button size="s" view="outlined" onClick={() => setResolving({ d, action: 'RESEND' })}>
                Переотправить
              </Button>
            )}
            {d.kind === 'CLOSED_NOT_EXECUTED' && (
              <Button size="s" view="outlined" onClick={() => setResolving({ d, action: 'CLOSE_FINAL' })}>
                Закрыть окончательно
              </Button>
            )}
            <Button size="s" view="flat" onClick={() => setResolving({ d, action: 'ACKNOWLEDGE' })}>
              К сведению
            </Button>
          </div>
        ),
    },
  ]

  const last = runs.data?.[0]
  return (
    <section>
      <PageHead
        title="Сверка с внешней системой"
        sub="Сравнивает наши задания со списком операций внешней системы. Если у них состояние новее (ответ или результат потерялся), оно применяется автоматически и фиксируется. Остальные расхождения ждут решения оператора. Автоматически — каждые 5 минут."
      >
        <Button view="action" loading={busy && !resolving} onClick={run}>
          Запустить сверку
        </Button>
      </PageHead>
      <ErrorNote text={resolving ? null : error} />
      {last && (
        <Alert
          className="block"
          view="outlined"
          theme={last.error ? 'danger' : last.mismatches > 0 ? 'warning' : 'normal'}
          message={
            `Последняя сверка №${last.id}: ${fmtDate(last.startedAt)} (${last.startedBy}). ` +
            (last.error ? last.error : `Проверено заданий: ${last.checked}, расхождений: ${last.mismatches}.`)
          }
        />
      )}

      <div className="toolbar">
        <SegmentedRadioGroup
          value={open ? 'open' : 'all'}
          onUpdate={(v) => setOpen(v === 'open')}
          options={[
            { value: 'open', content: 'Открытые' },
            { value: 'all', content: 'Все, включая разобранные' },
          ]}
        />
      </div>
      {!list.data && !list.error && <Loading />}
      <ErrorNote text={list.error} />
      {list.data && (
        <DataTable rows={list.data.items} columns={columns} rowKey={(d) => String(d.id)} empty="Расхождений нет." />
      )}

      <Dialog open={resolving !== null} onOpenChange={(o) => !o && setResolving(null)} maxWidth="m">
        <Dialog.Header caption={resolving ? ACTIONS[resolving.action] : ''} />
        <Dialog.Body>
          {resolving && (
            <p>
              {label(DISCREPANCY_LABELS, resolving.d.kind)}.{' '}
              {resolving.action === 'RESEND' &&
                'Задание будет отправлено снова с тем же ключом операции — внешняя система не исполнит его дважды.'}
            </p>
          )}
          <Text as="label" htmlFor="comment" color="secondary" className="field-label">
            Комментарий (обязательно, попадёт в журнал)
          </Text>
          <TextArea id="comment" value={comment} onUpdate={setComment} minRows={3} autoFocus />
          <ErrorNote text={error} />
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Подтвердить"
          textButtonCancel="Отмена"
          loading={busy}
          propsButtonApply={{ disabled: comment.trim().length < 5 }}
          onClickButtonApply={resolve}
          onClickButtonCancel={() => setResolving(null)}
        />
      </Dialog>
    </section>
  )
}
