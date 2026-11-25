import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, type User } from './api'

type AuthState = {
  user: User | null
  loading: boolean
  login: (login: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    api
      .get<User>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const value: AuthState = {
    user,
    loading,
    login: async (login, password) => {
      const u = await api.post<User>('/api/auth/login', { login, password })
      setUser(u)
      return u
    },
    logout: async () => {
      await api.post('/api/auth/logout').catch(() => {})
      setUser(null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider missing')
  return ctx
}
