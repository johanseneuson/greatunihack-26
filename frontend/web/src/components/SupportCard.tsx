import { HandHeart, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useChat } from '../context/ChatContext'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { callName } from '../lib/format'
import type { SupportOption } from '../lib/types'
import { ApplySheet } from './ApplySheet'

/** Real UK help this person may be able to get, matched to their own data. Tapping one opens it in the chat. */
export function SupportCard() {
  const { user, version } = useUser()
  const { ask, busy } = useChat()
  const [items, setItems] = useState<SupportOption[]>([])
  const [all, setAll] = useState(false)
  const [applying, setApplying] = useState<SupportOption | null>(null)
  useEffect(() => {
    if (!user) return
    let live = true
    api.support(user.id).then((r) => { if (live) setItems(r) }).catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [user, version])
  if (!user || items.length === 0) return null
  const shown = all ? items : items.slice(0, 3)
  return (
    <div className="card support">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><span className="ico"><HandHeart size={18} /></span><h3>Help {user.address_as ? `you ${callName(user)}` : 'you'} may be able to get</h3></span>
        <span className="badge teal">{items.length} to check</span>
      </div>
      <div className="support-list">
        {shown.map((o) => (
          <div key={o.id} className="support-item">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div className="small muted clamp">{o.what}</div>
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="chip" disabled={busy} onClick={() => void ask(`Tell me about: ${o.name}`)}>Ask</button>
              <button className="btn apply-btn" onClick={() => setApplying(o)} aria-label={`Apply: ${o.name}`}><Send size={14} /> Apply</button>
            </div>
          </div>
        ))}
      </div>
      {items.length > 3 && <button className="card-link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>}
      <p className="tiny muted" style={{ marginBottom: 0 }}>These are signposts, not decisions. The organisation decides who qualifies.</p>
      {applying && <ApplySheet option={applying} onClose={() => setApplying(null)} />}
    </div>
  )
}
