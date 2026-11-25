import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, Text, TextInput } from '@gravity-ui/uikit'
import { useAuth } from '../auth'
import { ErrorNote, Field } from '../ui'

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
      <form className="login-form" onSubmit={onSubmit}>
        <Text as="h1" variant="header-1">
          Обмен заданиями — вход
        </Text>
        <Field id="login" label="Логин">
          <TextInput id="login" value={name} onUpdate={setName} autoFocus autoComplete="username" size="l" />
        </Field>
        <Field id="password" label="Пароль">
          <TextInput id="password" type="password" value={password} onUpdate={setPassword} autoComplete="current-password" size="l" />
        </Field>
        <ErrorNote text={error} />
        <Button type="submit" view="action" size="l" width="max" loading={busy === name && !!name} disabled={!name || !password}>
          Войти
        </Button>

        <div className="login-demo">
          <Text color="secondary">Демо-пользователи, пароль demo:</Text>
          <table className="plain-table">
            <tbody>
              {DEMO.map((d) => (
                <tr key={d.login}>
                  <td className="mono">{d.login}</td>
                  <td>{d.name}</td>
                  <td className="muted">{d.role}</td>
                  <td>
                    <Button size="s" view="outlined" loading={busy === d.login} disabled={!!busy} onClick={() => submit(d.login, 'demo')}>
                      Войти
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  )
}
