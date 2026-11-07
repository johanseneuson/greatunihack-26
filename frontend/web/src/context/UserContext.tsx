import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { Dashboard, User } from '../lib/types'

interface Ctx {
  users: User[]
  user: User | null
  setUserId: (id: number) => void
  dashboard: Dashboard | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  reloadUsers: () => Promise<User[]>
  version: number // bumps on every refresh so pages can refetch their own data
}

const UserCtx = createContext<Ctx | null>(null)
const KEY = 'fb.userId'

const readStored = () => {
  try { return Number(localStorage.getItem(KEY)) || null } catch { return null }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([])
  const [userId, setUserIdState] = useState<number | null>(readStored)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reloadUsers = useCallback(async () => {
    const list = await api.users()
    setUsers(list)
    return list
  }, [])

  const setUserId = useCallback((id: number) => {
    setUserIdState(id)
    try { localStorage.setItem(KEY, String(id)) } catch { /* private mode */ }
  }, [])

  // Initial load: users, then pick the stored user or the first one.
  useEffect(() => {
    reloadUsers()
      .then((list) => {
        if (!list.length) { setLoading(false); return }
        setUserIdState((cur) => (cur && list.some((u) => u.id === cur) ? cur : list[0].id))
      })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [reloadUsers])

  const load = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      setDashboard(await api.dashboard(id))
      setVersion((v) => v + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (userId) load(userId) }, [userId, load])

  const refresh = useCallback(async () => {
    await reloadUsers()
    if (userId) await load(userId)
  }, [userId, load, reloadUsers])

  const user = users.find((u) => u.id === userId) ?? null
  return (
    <UserCtx.Provider value={{ users, user, setUserId, dashboard, loading, error, refresh, reloadUsers, version }}>
      {children}
    </UserCtx.Provider>
  )
}

export function useUser() {
  const ctx = useContext(UserCtx)
  if (!ctx) throw new Error('useUser must be used inside <UserProvider>')
  return ctx
}
