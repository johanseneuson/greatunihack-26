import { Phone, Send, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, useChat, type Msg } from '../context/ChatContext'
import { useUser } from '../context/UserContext'
import { BOT_ABOUT, BOT_NAME } from '../lib/brand'
import { phrases } from '../lib/phrases'
import { Spinner } from './ui'

const SUGGESTIONS = ['I need to save money. Which subscription should I cancel?', 'Can I afford £20 this week?', 'How do I get to payday?', 'What help can I get?']
const KIND = { knowledge: 'guidance', profile: 'your profile', account: 'your account', transactions: 'your transactions' } as Record<string, string>

const URL_RX = /(https?:\/\/[^\s)]+)/g
function linkify(text: string) {
  return text.split(URL_RX).map((part, i) =>
    i % 2 === 1 ? <a key={i} href={part} target="_blank" rel="noreferrer noopener">{part.replace(/[.,;]+$/, '')}</a> : part)
}

function Bubble({ m }: { m: Msg }) {
  const { runAction, decline } = useChat()
  return (
    <>
      <div className={`msg ${m.role === 'user' ? 'me' : 'bot'}`}>
        {linkify(m.text)}
        {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
          <details className="src">
            <summary>What I looked at</summary>
            <ol>{m.sources.map((s) => <li key={s.n} value={s.n}>{s.title} <span className="muted">({KIND[s.kind] ?? s.kind})</span></li>)}</ol>
            <div className="tiny muted">
              {m.mode !== 'llm' ? 'Basic answer (AI not connected)' : m.grounded === false ? 'Numbers could not be verified, so I kept to facts' : 'AI answer · figures checked against your data'}
            </div>
          </details>
        )}
      </div>
      {m.actions?.map((a, i) => (
        <div key={i} className="msg action">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{a.label}</div>
          <div className="row">
            <button className="btn" onClick={() => runAction(a)}>Confirm</button>
            <button className="btn secondary" onClick={() => decline(a)}>No thanks</button>
          </div>
        </div>
      ))}
    </>
  )
}

export function ChatPanel({ tall = false }: { tall?: boolean }) {
  const { user } = useUser()
  const { messages, busy, ask, language, setLanguage, plain, setPlain } = useChat()
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const visible = messages.filter((m) => !m.hidden)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [visible.length, busy])

  const send = (q: string) => { if (q.trim() && !busy) { setText(''); void ask(q) } }
  return (
    <div className={`card chat ${tall ? 'tall' : ''}`}>
      <div className="row between wrap">
        <div><h3>Chat with {BOT_NAME}</h3><div className="tiny muted" style={{ maxWidth: 420 }}>{BOT_ABOUT}</div></div>
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
          <button className="btn secondary" onClick={() => window.dispatchEvent(new Event('fb:call'))} aria-label={`Call ${BOT_NAME} and talk`}><Phone size={16} /> Call</button>
        </div>
      </div>
      <label className="row small muted" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> Extra simple language
      </label>

      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        <div className="msg bot">{language === 'English'
          ? `Hi ${user?.name.split(' ')[0] ?? 'there'}, I'm ${BOT_NAME}. I can see your account, your bills and what is coming up, so my advice fits your life. What would you like help with?`
          : phrases(language).greet(user?.name.split(' ')[0] ?? '', BOT_NAME)}</div>
        {visible.map((m) => <Bubble key={m.id} m={m} />)}
        {busy && <div className="msg bot"><span className="row"><Spinner /><span className="muted small">Thinking…</span></span></div>}
      </div>

      {visible.length === 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <label className="sr-only" htmlFor="chat-input">Ask about your money</label>
        <input id="chat-input" className="input" placeholder="Ask about your money…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoComplete="off" />
        <button className="btn" type="submit" aria-label="Send" disabled={busy || !text.trim()}><Send size={16} /></button>
      </form>
      <p className="tiny muted" style={{ marginBottom: 0 }}>
        <Sparkles size={11} style={{ verticalAlign: -1 }} /> Answers use only your own data. I can pause subscriptions or add planned costs, but only after you confirm. Guidance, not regulated financial advice.
      </p>
    </div>
  )
}
