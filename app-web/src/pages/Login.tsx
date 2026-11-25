import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Logo } from '../App'
import { useAuth } from '../auth'
import { ErrorNote } from '../ui'

const DEMO = [
  { login: 'ivanov', name: 'Иванов И.', role: 'Инициатор', tone: 'in' },
  { login: 'petrova', name: 'Петрова А.', role: 'Инициатор', tone: 'in' },
  { login: 'operator', name: 'Сидоров С.', role: 'Оператор', tone: 'op' },
  { login: 'operator2', name: 'Кузнецова Е.', role: 'Оператор', tone: 'op' },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function submit(l: string, p: string) {
    setBusy(l)
    setError(null)
    try {
      const u = await login(l, p)
      navigate(u.role === 'OPERATOR' ? '/op/queue' : '/tasks', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit(name, password)
  }

  return (
    <div className="login">
      <div className="login-glow g1" />
      <div className="login-glow g2" />
      <div className="login-side">
        <Logo size={52} />
        <h1>Обмен заданиями</h1>
        <p>Внутренняя система ↔ внешний сервис исполнения. Каждое задание — ровно одно исполнение, даже при сбоях связи.</p>
        <ul className="login-points">
          <li>Статус задания понятен без технических деталей</li>
          <li>Повторы, потерянные ответы и дубли — под контролем</li>
          <li>Сверка двух систем и журнал действий оператора</li>
        </ul>
      </div>
      <form className="card login-card" onSubmit={onSubmit}>
        <h2>Вход</h2>
        <label>
          Логин
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <ErrorNote text={error} />
        <button type="submit" className="wide" disabled={!!busy || !name || !password}>
          {busy === name ? <span className="spinner" /> : null}
          Войти
        </button>
        <div className="divider">
          <span>или демо-пользователь · пароль demo</span>
        </div>
        <div className="demo-users">
          {DEMO.map((d, i) => (
            <button
              type="button"
              key={d.login}
              className="demo-user"
              style={{ ['--i' as string]: i }}
              disabled={!!busy}
              onClick={() => submit(d.login, 'demo')}
            >
              <span className={'avatar avatar-' + d.tone}>{d.name[0]}</span>
              <span className="demo-text">
                <span className="strong">{d.name}</span>
                <span className="small muted">{d.role}</span>
              </span>
              {busy === d.login ? <span className="spinner dark" /> : <span className="arrow">→</span>}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
