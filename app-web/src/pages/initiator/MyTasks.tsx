import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Button, SegmentedRadioGroup } from '@gravity-ui/uikit'
import { api, type InitiatorTask, type Page } from '../../api'
import { DataTable, ErrorNote, fmtAgo, fmtMoney, Loading, PageHead, Pager, StatusLabel, useChangedIds, usePolling, type Column } from '../../ui'

type ListResponse = Page<InitiatorTask> & { counts: Record<string, number> }

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'В работе' },
  { key: 'needsAction', label: 'Нужно моё действие' },
  { key: 'completed', label: 'Выполнено' },
]

const COLUMNS: Column<InitiatorTask>[] = [
  {
    id: 'title',
    header: 'Задание',
    cell: (t) => (
      <>
        {t.title}
        {t.status.needsAction && <div className="warn-text">требуется ваше действие</div>}
      </>
    ),
  },
  { id: 'amount', header: 'Сумма', num: true, width: 140, cell: (t) => fmtMoney(t.payload.amount) },
  { id: 'status', header: 'Статус', width: 220, cell: (t) => <StatusLabel tone={t.status.color}>{t.status.label}</StatusLabel> },
  { id: 'created', header: 'Создано', width: 130, nowrap: true, cell: (t) => fmtAgo(t.createdAt) },
  { id: 'updated', header: 'Изменено', width: 130, nowrap: true, cell: (t) => fmtAgo(t.updatedAt) },
]

export default function MyTasks() {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const navigate = useNavigate()
  const { data, error } = usePolling(
    () => api.get<ListResponse>(`/api/tasks?filter=${filter}&page=${page}&size=20`),
    [filter, page],
  )
  const changed = useChangedIds(data?.items, (t) => t.id, (t) => t.status.code)
  const pick = (f: string) => {
    setFilter(f)
    setPage(0)
  }

  return (
    <section>
      <PageHead title="Мои задания" sub="Статусы обновляются автоматически.">
        <Button view="action" onClick={() => navigate('/tasks/new')}>
          Новое задание
        </Button>
      </PageHead>
      {data && data.counts.needsAction > 0 && filter !== 'needsAction' && (
        <Alert
          className="block"
          theme="warning"
          view="outlined"
          message={`Ваше действие нужно по заданиям: ${data.counts.needsAction}.`}
          actions={[{ text: 'Показать', handler: () => pick('needsAction') }]}
          layout="horizontal"
        />
      )}
      <div className="toolbar">
        <SegmentedRadioGroup
          value={filter}
          onUpdate={pick}
          options={FILTERS.map((f) => ({
            value: f.key,
            content: data ? `${f.label} · ${data.counts[f.key] ?? 0}` : f.label,
          }))}
        />
      </div>
      <ErrorNote text={error} />
      {!data && !error && <Loading />}
      {data && (
        <DataTable
          rows={data.items}
          columns={COLUMNS}
          rowKey={(t) => t.id}
          changed={changed}
          onRowClick={(t) => navigate('/tasks/' + t.id)}
          empty={
            <>
              Заданий нет. <Link to="/tasks/new">Создать задание</Link>
            </>
          }
        />
      )}
      {data && <Pager page={page} size={data.size} total={data.total} onPage={setPage} />}
    </section>
  )
}
