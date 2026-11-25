import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api, ApiError, type InitiatorTask } from '../../api'
import { Button, Field, Notice, TextArea, TextInput } from '../../components'
import { ErrorNote, fmtAgo, PageHead } from '../../ui'

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
      <PageHead title="Новое задание" back={<Link to="/tasks">← Мои задания</Link>} />
      <form className="panel form" onSubmit={submit}>
        <Field id="title" label="Что сделать">
          <TextInput id="title" value={title} onChange={setTitle} onBlur={checkSimilar} maxLength={200} required />
        </Field>
        <Field id="amount" label="Сумма, ₽" hint="Необязательно">
          <TextInput id="amount" value={amount} onChange={setAmount} inputMode="decimal" className="input-amount" />
        </Field>
        <Field id="comment" label="Комментарий">
          <TextArea id="comment" value={comment} onChange={setComment} rows={3} maxLength={1000} />
        </Field>

        {similar.length > 0 && (
          <Notice tone="warning" title="Похожее задание уже создано недавно">
            <ul className="plain-list">
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
          </Notice>
        )}

        <ErrorNote text={error} />
        <div className="actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            Создать
          </Button>
          <Button onClick={() => navigate('/tasks')}>Отмена</Button>
        </div>
      </form>
      <p className="footnote">
        Для демо: «#reject» в названии — внешняя система отвергнет содержание, «#fail» — исполнит с отказом (если оператор
        включил эти режимы).
      </p>
    </section>
  )
}
