import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { ErrorNote } from '../ui'

const DEMO = [
  { login: 'ivanov', who: 'Иванов — инициатор' },
  { login: 'petrova', who: 'Петрова — инициатор' },
  { login: 'operator', who: 'Сидоров — оператор' },
  { login: 'operator2', who: 'Кузнецова — оператор' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(l: string, p: string) {
    setBusy(true)
    setError(null)
    try {
      const u = await login(l, p)
      navigate(u.role === 'OPERATOR' ? '/op/queue' : '/tasks', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit(name, password)
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>Обмен заданиями</h1>
        <p className="muted">Внутренняя система ↔ внешний сервис исполнения</p>
        <label>
          Логин
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !name || !password}>
          Войти
        </button>
        <div className="demo-users">
          <div className="muted small">Демо-пользователи (пароль demo):</div>
          {DEMO.map((d) => (
            <button type="button" key={d.login} className="secondary" disabled={busy} onClick={() => submit(d.login, 'demo')}>
              {d.who}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
