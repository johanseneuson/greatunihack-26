import { Bot, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AlertCard } from '../components/AlertCard'
import { ChatPanel } from '../components/ChatPanel'
import { Card, PageHead, Segmented, Spinner } from '../components/ui'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import type { CoachReply, Dashboard, Severity } from '../lib/types'

type Filter = 'all' | Severity

// Coach replies are cached per user for the session so switching tabs doesn't re-run the model.
const cache = new Map<string, CoachReply>()

export default function Coach({ d }: { d: Dashboard }) {
  const { user, version } = useUser()
  const [reply, setReply] = useState<CoachReply | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const ask = async (q?: string) => {
    if (!user) return
    const key = `${user.id}:${version}:${q ?? ''}`
    if (cache.has(key)) { setReply(cache.get(key)!); return }
    setBusy(true); setError(null)
    try {
      const r = await api.coach(user.id, q)
      cache.set(key, r)
      setReply(r)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  useEffect(() => { ask() }, [user?.id, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const warnings = d.warnings.filter((w) => filter === 'all' || w.severity === filter)

  return (
    <div className="page">
      <PageHead title="Your money coach" />
      <div className="grid grid-2 collapse" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><span className="ico"><Bot size={18} /></span><h3>Finance Buddy</h3></span>
              {reply && <span className={`badge ${reply.source === 'ai' ? 'purple' : 'teal'}`}>{reply.source === 'ai' ? <><Sparkles size={12} /> AI</> : 'Smart summary'}</span>}
            </div>
            {busy && <div className="row" style={{ marginTop: 16 }}><Spinner /><span className="muted small">Looking at your future…</span></div>}
            {error && <p className="neg small">{error}</p>}
            {reply && !busy && (
              <div className="stack" style={{ marginTop: 14, gap: 12 }}>
                <h2 style={{ color: 'var(--primary)' }}>{reply.headline}</h2>
                <p style={{ margin: 0 }}>{reply.summary}</p>
                <div style={{ padding: 12, borderRadius: 12, background: 'var(--success-soft)' }}>
                  <div className="tiny" style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>FUTURE YOU</div>
                  {reply.future_you}
                </div>
                {reply.watch_out.length > 0 && (
                  <div>
                    <div className="tiny muted" style={{ fontWeight: 700, marginBottom: 6 }}>WATCH OUT FOR</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{reply.watch_out.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}</ul>
                  </div>
                )}
                {reply.actions.length > 0 && (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="tiny muted" style={{ fontWeight: 700 }}>YOUR NEXT STEPS</div>
                    {reply.actions.map((a, i) => (
                      <div key={i} className="row" style={{ alignItems: 'flex-start', padding: 10, borderRadius: 10, background: 'var(--surface-2)' }}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 12 }}>{i + 1}</span>
                        <div style={{ flex: 1 }}>
                          <strong>{a.title}</strong>
                          <div className="small muted">{a.detail}</div>
                          {a.impact && <div className="small pos">{a.impact}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>{reply.encouragement}</p>
              </div>
            )}
          </Card>

          <ChatPanel />
        </div>

        <div className="stack">
          <div className="section-title"><h2>Early warnings &amp; insights</h2></div>
          <Segmented<Filter> value={filter} onChange={setFilter} options={[
            { value: 'all', label: `All (${d.warnings.length})` }, { value: 'critical', label: 'Urgent' },
            { value: 'warning', label: 'Heads up' }, { value: 'positive', label: 'Wins' },
          ]} />
          {warnings.length === 0 && <Card><span className="muted">Nothing here right now.</span></Card>}
          {warnings.map((w) => <AlertCard key={w.id} w={w} />)}
        </div>
      </div>
    </div>
  )
}
