import { useState } from 'react'
import { Link } from 'react-router'
import { TextInput } from '@gravity-ui/uikit'
import { api, type InitiatorTask } from '../../api'
import { Counters, DataTable, Field, ErrorNote, fmtDate, fmtMoney, Loading, PageHead, usePolling, type Column } from '../../ui'

type ReportResponse = { from: string; to: string; count: number; items: InitiatorTask[] }

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10)
}

const COLUMNS: Column<InitiatorTask>[] = [
  { id: 'title', header: 'Задание', cell: (t) => <Link to={'/tasks/' + t.id}>{t.title}</Link> },
  { id: 'amount', header: 'Сумма', num: true, width: 150, cell: (t) => fmtMoney(t.payload.amount) },
  { id: 'created', header: 'Создано', width: 160, nowrap: true, cell: (t) => fmtDate(t.createdAt) },
  { id: 'completed', header: 'Выполнено', width: 160, nowrap: true, cell: (t) => fmtDate(t.completedAt) },
]

export default function Report() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(isoDay(new Date()))
  const { data, error } = usePolling(
    () =>
      api.get<ReportResponse>(
        `/api/tasks/report?from=${from}T00:00:00Z&to=${isoDay(new Date(new Date(to).getTime() + 86400000))}T00:00:00Z`,
      ),
    [from, to],
    10000,
  )
  const total = data?.items.reduce((s, t) => s + (t.payload.amount ?? 0), 0) ?? 0

  return (
    <section>
      <PageHead
        title="Отчёт о выполнении"
        sub="Только задания, исполнение которых подтвердила внешняя система. Принятые в работу, закрытые оператором без подтверждения и отклонённые не входят."
      />
      <div className="toolbar">
        <Field id="from" label="С">
          <TextInput id="from" value={from} onUpdate={setFrom} controlProps={{ type: 'date' }} />
        </Field>
        <Field id="to" label="По">
          <TextInput id="to" value={to} onUpdate={setTo} controlProps={{ type: 'date' }} />
        </Field>
      </div>
      {data && (
        <Counters
          items={[
            { label: 'Выполнено заданий', value: data.count.toLocaleString('ru-RU') },
            { label: 'На сумму', value: fmtMoney(total) },
          ]}
        />
      )}
      <ErrorNote text={error} />
      {!data && !error && <Loading />}
      {data && <DataTable rows={data.items} columns={COLUMNS} rowKey={(t) => t.id} empty="За период нет выполненных заданий." />}
    </section>
  )
}
