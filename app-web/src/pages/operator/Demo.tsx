import { useState } from 'react'
import { api, type Fault } from '../../api'
import { Button, Checkbox, Stats, Switch, TextInput, useToast } from '../../components'
import { FAULT_LABELS } from '../../labels'
import { ErrorNote, PageHead, usePolling } from '../../ui'

type EmuStats = {
  operations: number
  pending: number
  executions: number
  receivedAttempts: number
  duplicateExecutions: number
  undeliveredResults: number
}

export default function Demo() {
  const faults = usePolling(() => api.get<Fault[]>('/api/operator/demo/faults'), [], 3000)
  const stats = usePolling(() => api.get<EmuStats>('/api/operator/demo/stats'), [], 3000)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  async function set(body: unknown, message?: string) {
    setError(null)
    try {
      await api.post('/api/operator/demo/faults', body)
      if (message) toast(message, 'info')
      await faults.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const s = stats.data
  const n = (v: number) => v.toLocaleString('ru-RU')
  return (
    <section>
      <PageHead
        title="Демо-панель: сбои внешней системы"
        sub="Режимы переключаются в отдельном эмуляторе внешнего сервиса (своя БД, свой процесс). Основное приложение о них не знает и видит только последствия."
      >
        <Button onClick={() => set({ reset: true }, 'Все сбои выключены')}>Выключить все сбои</Button>
      </PageHead>
      <ErrorNote text={error ?? faults.error} />

      {s && (
        <Stats
          items={[
            { label: 'Операций у эмулятора', value: n(s.operations) },
            { label: 'Получено отправок (с повторами)', value: n(s.receivedAttempts) },
            { label: 'Фактических исполнений', value: n(s.executions) },
            { label: 'Исполнено дважды', value: n(s.duplicateExecutions), warn: s.duplicateExecutions > 0 },
            { label: 'Недоставленных результатов', value: n(s.undeliveredResults) },
          ]}
        />
      )}

      <div className="table-wrap block">
        <table className="table faults">
          <thead>
            <tr>
              <th>Режим</th>
              <th>Что происходит</th>
              <th>Параметры</th>
              <th>Включён</th>
            </tr>
          </thead>
          <tbody>
            {faults.data?.map((f) => (
              <FaultRow key={f.mode} fault={f} onChange={set} />
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Сценарии для демонстрации</h2>
      <ol className="scenarios">
        <li>
          <b>Недоступность.</b> Включите «Недоступность», создайте задание от инициатора: оно «Отправляется», у оператора — в
          повторах с растущей паузой. Выключите — задание уйдёт само или по кнопке «Повторить сейчас».
        </li>
        <li>
          <b>Потеря ответа после исполнения.</b> Включите режим и создайте задание. Отправщик не дождётся ответа, перед повтором
          спросит статус и не отправит повторно. «Сколько раз исполнено?» в карточке — 1.
        </li>
        <li>
          <b>Повтор и задержка результата.</b> Включите оба режима (с перестановкой). Итоговый результат придёт раньше
          «принято», дубли и устаревшее сообщение видны во «Входящих результатах» и журнале, статус не откатывается.
        </li>
        <li>
          <b>«Закрыть без подтверждения».</b> Во время недоступности закройте задание с причиной. После восстановления запустите
          сверку: расхождение «закрыто вручную, у них не исполнялось», решение — переотправить или закрыть окончательно.
        </li>
        <li>
          <b>Отказы.</b> «#reject» в названии — отказ по содержанию (инициатору «Требует решения»), «#fail» — отказ исполнения
          («Не выполнено»).
        </li>
      </ol>
    </section>
  )
}

function FaultRow({ fault, onChange }: { fault: Fault; onChange: (body: unknown, message?: string) => void }) {
  const meta = FAULT_LABELS[fault.mode] ?? { title: fault.mode, text: '' }
  const p = fault.params
  const toggle = (on: boolean) => onChange({ mode: fault.mode, enabled: on }, `${meta.title}: ${on ? 'включено' : 'выключено'}`)
  const setParam = (key: string, value: unknown) => onChange({ mode: fault.mode, enabled: fault.enabled, params: { [key]: value } })

  return (
    <tr className={fault.enabled ? 'fault-on' : undefined}>
      <td>
        <span className="strong">{meta.title}</span>
        <div className="mono muted">{fault.mode}</div>
      </td>
      <td>{meta.text}</td>
      <td className="fault-params">
        {fault.mode === 'lose_response' && (
          <TextInput
            size="sm"
            prefix="зависание, с"
            type="number"
            defaultValue={String(p.hangSeconds ?? 15)}
            onBlur={(e) => setParam('hangSeconds', Number(e.target.value))}
          />
        )}
        {fault.mode === 'delay_result' && (
          <>
            <TextInput
              size="sm"
              prefix="задержка, с"
              type="number"
              defaultValue={String(p.seconds ?? 10)}
              onBlur={(e) => setParam('seconds', Number(e.target.value))}
            />
            <Checkbox checked={p.reorder !== false} onChange={(v) => setParam('reorder', v)}>
              переставлять порядок
            </Checkbox>
          </>
        )}
        {(fault.mode === 'reject_content' || fault.mode === 'fail_execution') && (
          <TextInput
            size="sm"
            prefix="маркер"
            defaultValue={String(p.marker ?? '')}
            onBlur={(e) => setParam('marker', e.target.value)}
          />
        )}
      </td>
      <td>
        <Switch checked={fault.enabled} onChange={toggle} label={fault.enabled ? 'вкл' : 'выкл'} />
      </td>
    </tr>
  )
}
