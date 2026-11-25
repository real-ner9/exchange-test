import { Navigate, NavLink, Route, Routes } from 'react-router'
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

export default function App() {
  const { user, loading, logout } = useAuth()

  if (loading) return <div className="boot">Загрузка…</div>
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
          Обмен заданиями
          <span className="role">{isOperator ? 'оператор интеграции' : 'инициатор'}</span>
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
          <span>{user.displayName}</span>
          <button className="ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>
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
