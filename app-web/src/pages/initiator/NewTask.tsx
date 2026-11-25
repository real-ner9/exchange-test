import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api, ApiError, type InitiatorTask } from '../../api'
import { ErrorNote, fmtAgo } from '../../ui'

type Prefill = { title?: string; amount?: number | null; comment?: string | null }

export default function NewTask() {
  const navigate = useNavigate()
  const prefill = (useLocation().state ?? {}) as Prefill
  // D01: ключ формы создаётся при её открытии. Повторное нажатие той же формы не создаст второе задание,
  // новая форма — новое задание, даже с тем же содержанием.
  const [clientRequestId] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState(prefill.title ?? '')
  const [amount, setAmount] = useState(prefill.amount != null ? String(prefill.amount) : '')
  const [comment, setComment] = useState(prefill.comment ?? '')
  const [similar, setSimilar] = useState<InitiatorTask[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkSimilar() {
    if (!title.trim()) return setSimilar([])
    try {
      setSimilar(await api.get<InitiatorTask[]>('/api/tasks/similar?title=' + encodeURIComponent(title.trim())))
    } catch {
      setSimilar([])
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const task = await api.post<InitiatorTask>('/api/tasks', {
        clientRequestId,
        title: title.trim(),
        amount: amount.trim() ? Number(amount.replace(',', '.')) : null,
        comment: comment.trim() || null,
      })
      navigate('/tasks/' + task.id, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError('Сервер не ответил. Нажмите «Создать» ещё раз — второе задание не появится, ключ формы тот же.')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="narrow">
      <h2>Новое задание</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Что нужно сделать *
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={checkSimilar} required />
        </label>
        <label>
          Сумма, ₽
          <input value={amount} inputMode="decimal" placeholder="необязательно" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Комментарий
          <textarea value={comment} maxLength={1000} rows={3} onChange={(e) => setComment(e.target.value)} />
        </label>

        {similar.length > 0 && (
          <div className="note note-warn">
            <div className="strong">Похожее задание уже создано недавно:</div>
            <ul>
              {similar.map((s) => (
                <li key={s.id}>
                  <Link to={'/tasks/' + s.id} target="_blank">
                    {s.title}
                  </Link>{' '}
                  — {fmtAgo(s.createdAt)}, {s.status.label.toLowerCase()}
                </li>
              ))}
            </ul>
            Если это другое поручение — создавайте. Если то же самое — новое задание не нужно.
          </div>
        )}

        <ErrorNote text={error} />
        <div className="actions">
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
          <Link to="/tasks" className="button secondary">
            Отмена
          </Link>
        </div>
        <div className="muted small">
          Подсказка для демо: «#reject» в названии — внешняя система отвергнет содержание, «#fail» — исполнит с отказом
          (если оператор включил эти режимы).
        </div>
      </form>
    </section>
  )
}
