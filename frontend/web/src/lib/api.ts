// Thin, platform-neutral API client (uses only fetch) - the Expo app can import this unchanged
// by calling setApiBase('http://<laptop-ip>:8000/api').
import type {
  Account, Adjustment, ChatReply, CoachReply, Connector, Dashboard, ExpensesData, SupportOption, Forecast, ForecastAccuracy, Goal, ImportResult, Recurring,
  ScenarioResult, Transaction, User,
} from './types'

let BASE = (import.meta.env?.VITE_API_URL as string | undefined) ?? '/api'
export const setApiBase = (url: string) => { BASE = url.replace(/\/$/, '') }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError(0, "Can't reach the NatEast API. Is the backend running?")
  }
  if (!res.ok) {
    let msg = res.statusText
    try { const body = await res.json(); msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail) } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  users: () => req<User[]>('/users'),
  user: (id: number) => req<User>(`/users/${id}`),
  createUser: (body: Partial<User> & { name: string }) => req<User>('/users', json('POST', body)),
  updateUser: (id: number, body: Partial<User>) => req<User>(`/users/${id}`, json('PATCH', body)),
  deleteUser: (id: number) => req<void>(`/users/${id}`, { method: 'DELETE' }),

  goals: (id: number) => req<Goal[]>(`/users/${id}/goals`),
  addGoal: (id: number, body: Omit<Goal, 'id'>) => req<Goal>(`/users/${id}/goals`, json('POST', body)),
  deleteGoal: (id: number, goalId: number) => req<void>(`/users/${id}/goals/${goalId}`, { method: 'DELETE' }),

  accounts: (id: number) => req<Account[]>(`/users/${id}/accounts`),
  transactions: (id: number, params: Record<string, string | number | boolean | undefined> = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    return req<Transaction[]>(`/users/${id}/transactions?${q}`)
  },
  upload: (id: number, file: File | Blob, accountName = 'Main account') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('account_name', accountName)
    return req<ImportResult>(`/users/${id}/uploads`, { method: 'POST', body: fd })
  },
  clearData: (id: number) => req<{ deleted_transactions: number }>(`/users/${id}/transactions`, { method: 'DELETE' }),
  connectors: () => req<Connector[]>('/bank-connectors'),
  linkBank: (id: number, connector: string) => req<ImportResult>(`/users/${id}/bank-connections`, json('POST', { connector })),

  dashboard: (id: number) => req<Dashboard>(`/users/${id}/insights/dashboard`),
  forecast: (id: number, horizonDays = 365, step = 2) =>
    req<Forecast>(`/users/${id}/insights/forecast?horizon_days=${horizonDays}&step=${step}`),
  forecastAccuracy: (id: number) => req<ForecastAccuracy | null>(`/users/${id}/insights/forecast-accuracy`),
  recurring: (id: number) => req<Recurring[]>(`/users/${id}/insights/recurring`),
  scenario: (id: number, adjustments: Adjustment[], horizonDays = 365) =>
    req<ScenarioResult>(`/users/${id}/insights/scenarios`, json('POST', { adjustments, horizon_days: horizonDays })),
  coach: (id: number, question?: string) => req<CoachReply>(`/users/${id}/insights/coach`, json('POST', { question })),

  // Chat assistant (RAG over the user's own data). Actions only run after the user confirms them.
  chat: (id: number, body: { messages: { role: 'user' | 'assistant'; content: string }[]; language: string; plain: boolean; voice?: boolean }) =>
    req<ChatReply>(`/users/${id}/chat`, json('POST', body)),
  action: (id: number, action: Record<string, unknown>) =>
    req<{ ok: boolean; message: string }>(`/users/${id}/actions`, json('POST', { action })),
  expenses: (id: number) => req<ExpensesData>(`/users/${id}/expenses`),
  support: (id: number) => req<SupportOption[]>(`/users/${id}/support`),

  // Call mode (voice)
  voiceStatus: () => req<{ elevenlabs: boolean; voice_id: string }>('/voice/status'),
  speak: async (text: string, language: string): Promise<Blob> => {
    let res: Response
    try { res = await fetch(`${BASE}/voice/speak`, { ...json('POST', { text, language }), headers: { 'Content-Type': 'application/json' } }) }
    catch { throw new ApiError(0, "Can't reach the NatEast API.") }
    if (!res.ok) throw new ApiError(res.status, 'Voice unavailable')
    return res.blob()
  },
}
