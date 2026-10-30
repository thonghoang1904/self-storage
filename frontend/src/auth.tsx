import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, tokenStore } from './api'
import type { LoginResponse, UserDto } from './types'

interface AuthState {
  user: UserDto | null
  loading: boolean
  login: (username: string, password: string) => Promise<UserDto>
  /** Signs in with a Google ID token (POST /api/auth/google); only works for an existing account with that email. */
  loginWithGoogle: (idToken: string) => Promise<UserDto>
  logout: () => void
  /** Re-reads GET /api/auth/me, e.g. after the user renamed themselves. */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null)
  const [loading, setLoading] = useState(() => tokenStore.get() !== null)

  useEffect(() => {
    if (!tokenStore.get()) return
    api<UserDto>('/api/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const res = await api<LoginResponse>('/api/auth/login', { body: { username, password } })
    tokenStore.set(res.token)
    setUser(res.user)
    return res.user
  }

  const loginWithGoogle = async (idToken: string) => {
    const res = await api<LoginResponse>('/api/auth/google', { body: { idToken } })
    tokenStore.set(res.token)
    setUser(res.user)
    return res.user
  }

  const logout = () => {
    tokenStore.clear()
    setUser(null)
  }

  const refresh = async () => { if (tokenStore.get()) setUser(await api<UserDto>('/api/auth/me')) }

  return <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
