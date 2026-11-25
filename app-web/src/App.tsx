import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth'
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

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 12h12l-3.5-3.5M23 20H11l3.5 3.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function initials(name: string) {
  return name
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const location = useLocation()

  if (loading)
    return (
      <div className="boot">
        <Logo size={44} />
      </div>
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
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">Обмен заданиями</div>
            <div className="brand-role">{isOperator ? 'оператор интеграции' : 'инициатор'}</div>
          </div>
        </div>
        <nav>
          {isOperator ? (
            <>
              <NavLink to="/op/queue">Очередь</NavLink>
              <NavLink to="/op/journal">Журнал</NavLink>
              <NavLink to="/op/reconcile">Сверка</NavLink>
              <NavLink to="/op/demo">Демо-панель</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/tasks" end>
                Мои задания
              </NavLink>
              <NavLink to="/tasks/new">Новое задание</NavLink>
              <NavLink to="/report">Отчёт о выполнении</NavLink>
            </>
          )}
        </nav>
        <div className="who">
          <div className={'avatar ' + (isOperator ? 'avatar-op' : 'avatar-in')}>{initials(user.displayName)}</div>
          <span className="who-name">{user.displayName.replace(/\s*\(.*\)/, '')}</span>
          <button className="ghost on-dark" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>
      <main className="content">
        <div className="page" key={location.pathname}>
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
        </div>
      </main>
    </div>
  )
}
