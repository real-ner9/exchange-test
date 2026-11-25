import { useState } from 'react'
import { api, type Fault } from '../../api'
import { FAULT_LABELS } from '../../labels'
import { ErrorNote, usePolling } from '../../ui'

type Stats = {
  operations: number
  pending: number
  executions: number
  receivedAttempts: number
  duplicateExecutions: number
  undeliveredResults: number
}

export default function Demo() {
  const faults = usePolling(() => api.get<Fault[]>('/api/operator/demo/faults'), [], 3000)
  const stats = usePolling(() => api.get<Stats>('/api/operator/demo/stats'), [], 3000)
  const [error, setError] = useState<string | null>(null)

  async function set(body: unknown) {
    setError(null)
    try {
      await api.post('/api/operator/demo/faults', body)
      await faults.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const s = stats.data
  return (
    <section>
      <div className="page-head">
        <h2>Демо-панель: сбои внешней системы</h2>
        <button className="secondary" onClick={() => set({ reset: true })}>
          Выключить все сбои
        </button>
      </div>
      <p className="muted">
        Режимы переключаются в отдельном эмуляторе внешнего сервиса (своя БД, свой процесс). Основное приложение о них не
        знает и видит только последствия.
      </p>
      <ErrorNote text={error ?? faults.error} />

      {s && (
        <div className="stats">
          <div className="stat stat-gray">
            <div className="stat-value">{s.operations}</div>
            <div className="stat-title">Операций у эмулятора</div>
          </div>
          <div className="stat stat-gray">
            <div className="stat-value">{s.receivedAttempts}</div>
            <div className="stat-title">Получено отправок (с повторами)</div>
          </div>
          <div className="stat stat-green">
            <div className="stat-value">{s.executions}</div>
            <div className="stat-title">Фактических исполнений</div>
          </div>
          <div className={'stat ' + (s.duplicateExecutions > 0 ? 'stat-red' : 'stat-green')}>
            <div className="stat-value">{s.duplicateExecutions}</div>
            <div className="stat-title">Операций, исполненных дважды</div>
          </div>
          <div className="stat stat-gray">
            <div className="stat-value">{s.undeliveredResults}</div>
            <div className="stat-title">Недоставленных результатов</div>
          </div>
        </div>
      )}

      <div className="faults">
        {faults.data?.map((f) => (
          <FaultCard key={f.mode} fault={f} onChange={set} />
        ))}
      </div>

      <h3>Сценарии для демонстрации</h3>
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

function FaultCard({ fault, onChange }: { fault: Fault; onChange: (body: unknown) => void }) {
  const meta = FAULT_LABELS[fault.mode] ?? { title: fault.mode, text: '' }
  const p = fault.params
  const toggle = () => onChange({ mode: fault.mode, enabled: !fault.enabled })
  const setParam = (key: string, value: unknown) => onChange({ mode: fault.mode, enabled: fault.enabled, params: { [key]: value } })

  return (
    <div className={'card fault' + (fault.enabled ? ' on' : '')}>
      <div className="fault-head">
        <div>
          <div className="strong">{meta.title}</div>
          <div className="mono small muted">{fault.mode}</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={fault.enabled} onChange={toggle} />
          <span>{fault.enabled ? 'включён' : 'выключен'}</span>
        </label>
      </div>
      <div className="small">{meta.text}</div>
      <div className="fault-params">
        {fault.mode === 'lose_response' && (
          <label>
            держать соединение, с
            <input type="number" min={1} defaultValue={Number(p.hangSeconds ?? 15)} onBlur={(e) => setParam('hangSeconds', Number(e.target.value))} />
          </label>
        )}
        {fault.mode === 'delay_result' && (
          <>
            <label>
              задержка, с
              <input type="number" min={1} defaultValue={Number(p.seconds ?? 10)} onBlur={(e) => setParam('seconds', Number(e.target.value))} />
            </label>
            <label className="inline">
              <input type="checkbox" checked={p.reorder !== false} onChange={(e) => setParam('reorder', e.target.checked)} />
              переставлять порядок
            </label>
          </>
        )}
        {(fault.mode === 'reject_content' || fault.mode === 'fail_execution') && (
          <label>
            маркер в названии
            <input defaultValue={String(p.marker ?? '')} onBlur={(e) => setParam('marker', e.target.value)} />
          </label>
        )}
      </div>
    </div>
  )
}
