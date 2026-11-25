import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { Button, Field, TextInput } from '../components'
import { ErrorNote } from '../ui'

const DEMO = [
  { login: 'ivanov', name: 'Иванов И.', role: 'инициатор' },
  { login: 'petrova', name: 'Петрова А.', role: 'инициатор' },
  { login: 'operator', name: 'Сидоров С.', role: 'оператор' },
  { login: 'operator2', name: 'Кузнецова Е.', role: 'оператор' },
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
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden>
            ⇄
          </span>
          <span>Обмен заданиями</span>
        </div>
        <h1>Вход</h1>
        <form className="form" onSubmit={onSubmit}>
          <Field id="login" label="Логин">
            <TextInput id="login" value={name} onChange={setName} autoFocus autoComplete="username" />
          </Field>
          <Field id="password" label="Пароль">
            <TextInput id="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
          <ErrorNote text={error} />
          <Button type="submit" variant="primary" block loading={busy === name && !!name} disabled={!name || !password}>
            Войти
          </Button>
        </form>

        <div className="login-demo">
          <div className="login-demo-title">Демо-пользователи · пароль demo</div>
          <ul>
            {DEMO.map((d) => (
              <li key={d.login}>
                <span className="login-demo-who">
                  {d.name}
                  <span className="muted">
                    <span className="mono">{d.login}</span> · {d.role}
                  </span>
                </span>
                <Button size="sm" loading={busy === d.login} disabled={!!busy} onClick={() => submit(d.login, 'demo')}>
                  Войти
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
