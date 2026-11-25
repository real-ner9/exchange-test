import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, type InitiatorTask, type Page } from '../../api'
import { Button, DataTable, Notice, Pagination, Segmented, type Column } from '../../components'
import { ErrorNote, fmtAgo, fmtMoney, Loading, PageHead, StatusLabel, useChangedIds, usePolling } from '../../ui'

type ListResponse = Page<InitiatorTask> & { counts: Record<string, number> }
type Filter = 'all' | 'active' | 'needsAction' | 'completed'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'В работе' },
  { value: 'needsAction', label: 'Нужно моё действие' },
  { value: 'completed', label: 'Выполнено' },
]

const COLUMNS: Column<InitiatorTask>[] = [
  {
    id: 'title',
    header: 'Задание',
    cell: (t) => (
      <>
        <span className="strong">{t.title}</span>
        {t.status.needsAction && <div className="warn-text">требуется ваше действие</div>}
      </>
    ),
  },
  { id: 'amount', header: 'Сумма', num: true, width: 140, cell: (t) => fmtMoney(t.payload.amount) },
  { id: 'status', header: 'Статус', width: 230, cell: (t) => <StatusLabel tone={t.status.color}>{t.status.label}</StatusLabel> },
  { id: 'created', header: 'Создано', width: 120, nowrap: true, cell: (t) => fmtAgo(t.createdAt) },
  { id: 'updated', header: 'Изменено', width: 120, nowrap: true, cell: (t) => fmtAgo(t.updatedAt) },
]

export default function MyTasks() {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const navigate = useNavigate()
  const { data, error } = usePolling(
    () => api.get<ListResponse>(`/api/tasks?filter=${filter}&page=${page}&size=20`),
    [filter, page],
  )
  const changed = useChangedIds(data?.items, (t) => t.id, (t) => t.status.code)
  const pick = (f: Filter) => {
    setFilter(f)
    setPage(0)
  }

  return (
    <section>
      <PageHead title="Мои задания" sub="Статусы обновляются автоматически.">
        <Button variant="primary" onClick={() => navigate('/tasks/new')}>
          Новое задание
        </Button>
      </PageHead>
      {data && data.counts.needsAction > 0 && filter !== 'needsAction' && (
        <Notice
          className="block"
          tone="warning"
          action={
            <Button size="sm" onClick={() => pick('needsAction')}>
              Показать
            </Button>
          }
        >
          Ваше действие нужно по заданиям: {data.counts.needsAction}.
        </Notice>
      )}
      <div className="toolbar">
        <Segmented
          label="Фильтр"
          value={filter}
          onChange={pick}
          options={FILTERS.map((f) => ({ ...f, count: data?.counts[f.value] }))}
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
      {data && <Pagination page={page} size={data.size} total={data.total} onPage={setPage} />}
    </section>
  )
}
