import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { ChatReply, ChatSource, ProposedAction, SupportOption } from '../lib/types'
import { useUser } from './UserContext'

export interface Msg {
  id: number
  role: 'user' | 'assistant'
  text: string
  hidden?: boolean // notes for the model (e.g. "I confirmed ...") that are not shown in the chat
  sources?: ChatSource[]
  mode?: 'llm' | 'offline'
  grounded?: boolean
  actions?: ProposedAction[]
  applications?: SupportOption[]
}

export const LANGUAGES = ['English', 'Español', 'Polski', 'Português', 'Français', 'Italiano', 'Română', 'العربية', 'हिन्दी', 'Bengali (বাংলা)', 'Urdu (اردو)']

interface Ctx {
  messages: Msg[]
  busy: boolean
  language: string
  setLanguage: (l: string) => void
  plain: boolean
  setPlain: (p: boolean) => void
  /** Send a question. Resolves with the reply (or null if the server could not be reached). */
  ask: (text: string, opts?: { voice?: boolean }) => Promise<ChatReply | null>
  /** Run an action the assistant proposed (after the user confirmed). The server re-validates it. */
  runAction: (a: ProposedAction) => Promise<{ ok: boolean; message: string }>
  decline: (a: ProposedAction) => void
  /** Switch every paused subscription back on, so they can be cancelled (with Lydia) again. */
  resetSubscriptions: () => Promise<number>
  reset: () => void
}

const ChatCtx = createContext<Ctx | null>(null)
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useUser()
  const [messages, setMessages] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [language, setLang] = useState(store.get('fb.lang') || 'English')
  const [plain, setPlainState] = useState(store.get('fb.plain') === 'true')
  const idRef = useRef(0)
  const msgsRef = useRef<Msg[]>([])
  msgsRef.current = messages
  const uid = user?.id

  const push = useCallback((m: Omit<Msg, 'id'>) => { setMessages((cur) => [...cur, { ...m, id: ++idRef.current }]) }, [])
  const reset = useCallback(() => setMessages([]), [])
  useEffect(() => { reset() }, [uid, reset]) // a new conversation per person

  const setLanguage = (l: string) => { setLang(l); store.set('fb.lang', l) }
  const setPlain = (p: boolean) => { setPlainState(p); store.set('fb.plain', String(p)) }

  const ask: Ctx['ask'] = useCallback(async (text, opts) => {
    if (!uid || !text.trim()) return null
    push({ role: 'user', text })
    setBusy(true)
    try {
      const history = [...msgsRef.current, { role: 'user' as const, text }].slice(-20).map((m) => ({ role: m.role, content: m.text }))
      const r = await api.chat(uid, { messages: history, language, plain, voice: opts?.voice })
      push({ role: 'assistant', text: r.reply, sources: r.sources, mode: r.mode, grounded: r.grounded, actions: r.actions, applications: r.applications })
      return r
    } catch {
      push({ role: 'assistant', text: 'Sorry, I could not reach the server. Please try again.' })
      return null
    } finally { setBusy(false) }
  }, [uid, language, plain, push])

  const dropAction = (a: ProposedAction) =>
    setMessages((cur) => cur.map((m) => (m.actions ? { ...m, actions: m.actions.filter((x) => x !== a) } : m)))

  const runAction: Ctx['runAction'] = useCallback(async (a) => {
    if (!uid) return { ok: false, message: 'No user selected.' }
    dropAction(a)
    try {
      const r = await api.action(uid, a.action)
      push({ role: 'assistant', text: (r.ok ? '✓ ' : '') + r.message })
      push({ role: 'user', hidden: true, text: `[I ${r.ok ? 'confirmed and it was done' : 'tried but it failed'}: ${a.label}]` })
      if (r.ok) void refresh() // paused subscriptions / planned costs change the forecast everywhere
      return r
    } catch (e) {
      const message = (e as Error).message
      push({ role: 'assistant', text: message })
      return { ok: false, message }
    }
  }, [uid, push, refresh])

  const resetSubscriptions = useCallback(async () => {
    if (!uid) return 0
    const r = await api.resetSubscriptions(uid)
    // the model reads the conversation, so tell it (quietly) that earlier cancellations no longer stand
    push({ role: 'user', hidden: true, text: '[All my subscriptions were switched back on. Anything paused earlier is active again.]' })
    push({ role: 'assistant', text: r.switched_back_on ? `Done, ${r.switched_back_on} ${r.switched_back_on === 1 ? 'subscription is' : 'subscriptions are'} back on.` : 'Everything was already on.' })
    await refresh()
    return r.switched_back_on
  }, [uid, push, refresh])

  const decline: Ctx['decline'] = useCallback((a) => {
    dropAction(a)
    push({ role: 'user', hidden: true, text: `[I declined: ${a.label}]` })
  }, [push])

  const value = useMemo(() => ({ messages, busy, language, setLanguage, plain, setPlain, ask, runAction, decline, resetSubscriptions, reset }),
    [messages, busy, language, plain, ask, runAction, decline, resetSubscriptions, reset])
  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>
}

export function useChat() {
  const c = useContext(ChatCtx)
  if (!c) throw new Error('useChat must be used inside <ChatProvider>')
  return c
}
