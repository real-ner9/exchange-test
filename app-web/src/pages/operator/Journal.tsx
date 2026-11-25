import { useState } from 'react'
import { Select, Text } from '@gravity-ui/uikit'
import { api, type TaskEvent } from '../../api'
import { EVENT_LABELS } from '../../labels'
import { DataTable, ErrorNote, fmtDate, Loading, PageHead, Pager, usePolling, type Column } from '../../ui'
import { EventsTable } from './OpTask'

type Invalid = { id: number; receivedAt: string; raw: string; error: string }

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
          value={kind ? [kind] : []}
          placeholder="Все события"
          hasClear
          options={Object.entries(EVENT_LABELS).map(([value, content]) => ({ value, content }))}
          onUpdate={(v) => {
            setKind(v[0] ?? '')
            setPage(0)
          }}
        />
      </div>
      <ErrorNote text={error} />
      {!data && !error && <Loading />}
      {data && <EventsTable events={data.items} showTask />}
      {data && (
        <Pager
          page={page}
          size={data.size}
          total={data.items.length < data.size ? page * data.size + data.items.length : (page + 2) * data.size}
          onPage={setPage}
        />
      )}

      {invalid.data && invalid.data.length > 0 && (
        <>
          <Text as="h2" variant="subheader-2" className="section-title">
            Неразобранные входящие сообщения
          </Text>
          <Text as="p" color="secondary" className="block">
            Сообщения, которые не удалось разобрать. Сохранены как есть, статусы заданий не меняли.
          </Text>
          <DataTable rows={invalid.data} columns={INVALID_COLUMNS} rowKey={(m) => String(m.id)} />
        </>
      )}
    </section>
  )
}
