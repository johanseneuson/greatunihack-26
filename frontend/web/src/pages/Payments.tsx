import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Card, Segmented, Spinner } from '../components/ui'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { dayMonth, money } from '../lib/format'
import type { ExpensesData } from '../lib/types'

type View = 'upcoming' | 'subs' | 'past'

/** Payments: what is coming up, subscriptions (pause/cancel) and past transactions. The chat and call read the same data. */
export default function Payments() {
  const { user, refresh, version } = useUser()
  const [data, setData] = useState<ExpensesData | null>(null)
  const [view, setView] = useState<View>('upcoming')
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ description: '', amount: '', date: '', essential: false })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    try { setData(await api.expenses(user.id)) } catch (e) { setErr((e as Error).message) }
  }, [user])
  useEffect(() => { void load() }, [load, version])

  const run = async (action: Record<string, unknown>) => {
    if (!user) return { ok: false, message: '' }
    setBusy(true)
    try {
      const r = await api.action(user.id, action)
      if (r.ok) await refresh() // recompute the forecast, then the list reloads via `version`
      return r
    } finally { setBusy(false) }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await run({ type: 'add_planned_expense', description: form.description, amount: Number(form.amount), date: form.date, essential: form.essential })
    if (r.ok) { setForm({ description: '', amount: '', date: '', essential: false }); setErr(null) } else setErr(r.message)
  }

  if (!data) return <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Spinner /></div>
  const out30 = data.upcoming.filter((u) => u.in_days <= 30 && u.amount < 0).reduce((a, u) => a + u.amount, 0)
  const activeSubs = data.subscriptions.filter((s) => !s.paused && s.kind === 'subscription')
  const subsTotal = activeSubs.reduce((a, s) => a + s.amount, 0)

  return (
    <div className="stack">
      <Segmented<View> value={view} onChange={setView} options={[{ value: 'upcoming', label: 'Coming up' }, { value: 'subs', label: 'Subscriptions' }, { value: 'past', label: 'Past' }]} />

      {view === 'upcoming' && (
        <>
          <Card><div className="small muted">Next 30 days</div><div className="tile-big num">{money(-out30)} <span className="small muted" style={{ fontWeight: 400 }}>going out</span></div></Card>
          <Card className="flush">
            <div className="list">
              {data.upcoming.length === 0 && <div className="list-row muted">Nothing scheduled yet.</div>}
              {data.upcoming.map((u, i) => (
                <div className="list-row" key={`${u.date}-${u.name}-${i}`}>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{u.name}</div>
                    <div className="small muted">{dayMonth(u.date)} · in {u.in_days} days · {u.kind === 'planned' ? 'planned' : u.kind}{u.essential ? ' · essential' : ''}</div>
                  </div>
                  <div className={`num ${u.amount > 0 ? 'pos' : ''}`} style={{ fontWeight: 600 }}>{money(u.amount)}</div>
                  {u.planned_id && <button className="icon-btn" aria-label={`Remove ${u.name}`} disabled={busy} onClick={() => run({ type: 'remove_planned_expense', planned_id: u.planned_id })}><Trash2 size={18} /></button>}
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h3 style={{ marginBottom: 10 }}>Add a planned expense</h3>
            <form className="stack" onSubmit={add} style={{ gap: 10 }}>
              <label className="field">What for<input className="input" required maxLength={80} placeholder="e.g. Concert ticket" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <div className="grid grid-2">
                <label className="field">Amount (£)<input className="input" required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
                <label className="field">Date<input className="input" required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              </div>
              <label className="row small"><input type="checkbox" checked={form.essential} onChange={(e) => setForm({ ...form, essential: e.target.checked })} /> It is essential</label>
              {err && <div className="neg small" role="alert">{err}</div>}
              <button className="btn" disabled={busy}>Add to my forecast</button>
            </form>
          </Card>
        </>
      )}

      {view === 'subs' && (
        <>
          <Card><div className="small muted">Active subscriptions</div><div className="tile-big num">{money(subsTotal)} <span className="small muted" style={{ fontWeight: 400 }}>a month · {money(subsTotal * 12)} a year</span></div></Card>
          <Card className="flush">
            <div className="list">
              {data.subscriptions.length === 0 && <div className="list-row muted">No recurring payments detected yet.</div>}
              {data.subscriptions.map((s) => (
                <div className="list-row" key={s.series_id} style={{ opacity: s.paused ? 0.55 : 1 }}>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{s.name} {s.paused && <span className="badge amber">Paused</span>} {s.essential && <span className="badge">Essential</span>}</div>
                    <div className="small muted">{s.period} · next {dayMonth(s.next_date)}</div>
                  </div>
                  <div className="num" style={{ fontWeight: 600 }}>{money(-s.amount)}</div>
                  {!s.essential && (
                    <button className="btn secondary" disabled={busy} onClick={() => run({ type: s.paused ? 'resume_subscription' : 'pause_subscription', series_id: s.series_id })}>
                      {s.paused ? 'Switch on' : 'Pause'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <p className="tiny muted">Pausing a subscription removes it from your upcoming payments and your forecast. You can also just ask the coach: "cancel my gym".</p>
        </>
      )}

      {view === 'past' && (
        <Card className="flush">
          <div className="list">
            {data.past.map((t, i) => (
              <div className="list-row" key={`${t.date}-${t.name}-${i}`}>
                <div className="grow"><div style={{ fontWeight: 600 }}>{t.name}</div><div className="small muted">{dayMonth(t.date)} · {t.category}</div></div>
                <div className={`num ${t.amount > 0 ? 'pos' : ''}`} style={{ fontWeight: 600 }}>{money(t.amount)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
