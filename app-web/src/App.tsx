import { Navigate, NavLink, Route, Routes } from 'react-router'
import { useAuth } from './auth'
import { Button } from './components'
import Login from './pages/Login'
import MyTasks from './pages/initiator/MyTasks'
import NewTask from './pages/initiator/NewTask'
import TaskView from './pages/initiator/TaskView'
import Report from './pages/initiator/Report'
import Queue from './pages/operator/Queue'
import OpTask from './pages/operator/OpTask'
import Journal from './pages/operator/Journal'
import Reconcile from './pages/operator/Reconcile'
import Demo from './pages/operator/Demo'
import { Loading } from './ui'

const OPERATOR_NAV = [
  { to: '/op/queue', label: 'Очередь' },
  { to: '/op/journal', label: 'Журнал' },
  { to: '/op/reconcile', label: 'Сверка' },
  { to: '/op/demo', label: 'Демо-панель' },
]

const INITIATOR_NAV = [
  { to: '/tasks', label: 'Мои задания', end: true },
  { to: '/tasks/new', label: 'Новое задание' },
  { to: '/report', label: 'Отчёт о выполнении' },
]

export default function App() {
  const { user, loading, logout } = useAuth()

  if (loading)
    return (
      <main className="content">
        <Loading />
      </main>
    )
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  const isOperator = user.role === 'OPERATOR'
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ⇄
          </span>
          <span>
            Обмен заданиями
            <span className="brand-sub">{isOperator ? 'оператор' : 'инициатор'}</span>
          </span>
        </div>
        <nav className="nav">
          {(isOperator ? OPERATOR_NAV : INITIATOR_NAV).map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <div className="who-name">{user.displayName}</div>
          <Button variant="ghost" size="sm" onClick={logout}>
            Выйти
          </Button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          {isOperator ? (
            <>
              <Route path="/op/queue" element={<Queue />} />
              <Route path="/op/tasks/:id" element={<OpTask />} />
              <Route path="/op/journal" element={<Journal />} />
              <Route path="/op/reconcile" element={<Reconcile />} />
              <Route path="/op/demo" element={<Demo />} />
              <Route path="*" element={<Navigate to="/op/queue" replace />} />
            </>
          ) : (
            <>
              <Route path="/tasks" element={<MyTasks />} />
              <Route path="/tasks/new" element={<NewTask />} />
              <Route path="/tasks/:id" element={<TaskView />} />
              <Route path="/report" element={<Report />} />
              <Route path="*" element={<Navigate to="/tasks" replace />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  )
}
