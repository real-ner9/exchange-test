import { useState } from 'react'
import { api, type TaskEvent } from '../../api'
import { DataTable, Pagination, Select, type Column } from '../../components'
import { EVENT_LABELS } from '../../labels'
import { ErrorNote, fmtDate, Loading, PageHead, usePolling } from '../../ui'
import { EventsTable } from './OpTask'

type Invalid = { id: number; receivedAt: string; raw: string; error: string }

const EVENT_OPTIONS = Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }))

const INVALID_COLUMNS: Column<Invalid>[] = [
  { id: 'at', header: 'Получено', width: 150, nowrap: true, cell: (m) => fmtDate(m.receivedAt) },
  { id: 'error', header: 'Ошибка', width: 280, cell: (m) => m.error },
  { id: 'raw', header: 'Содержимое', cell: (m) => <pre className="raw">{m.raw}</pre> },
]

export default function Journal() {
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(0)
  const { data, error } = usePolling(
    () => api.get<{ items: TaskEvent[]; size: number }>(`/api/operator/events?kind=${kind}&page=${page}&size=100`),
    [kind, page],
  )
  const invalid = usePolling(() => api.get<Invalid[]>('/api/operator/invalid-messages'), [], 10000)

  return (
    <section>
      <PageHead
        title="Журнал обмена"
        sub="Смены статусов, ответы и результаты внешней системы (включая повторные и устаревшие), действия операторов с причинами."
      />
      <div className="toolbar">
        <Select
          width={320}
          value={kind}
          placeholder="Все события"
          options={EVENT_OPTIONS}
          onChange={(v) => {
            setKind(v)
            setPage(0)
          }}
        />
      </div>
      <ErrorNote text={error} />
      {!data && !error && <Loading />}
      {data && <EventsTable events={data.items} showTask />}
      {data && <Pagination page={page} size={data.size} hasNext={data.items.length === data.size} onPage={setPage} />}

      {invalid.data && invalid.data.length > 0 && (
        <>
          <h2 className="section-title">Неразобранные входящие сообщения</h2>
          <p className="section-sub">Сообщения, которые не удалось разобрать. Сохранены как есть, статусы заданий не меняли.</p>
          <DataTable rows={invalid.data} columns={INVALID_COLUMNS} rowKey={(m) => String(m.id)} />
        </>
      )}
    </section>
  )
}
