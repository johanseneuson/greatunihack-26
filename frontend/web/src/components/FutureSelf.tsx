import { CalendarClock, PiggyBank, Send, Sparkles, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { compact, dayMonth, monthLong, monthShort, money0, pct } from '../lib/format'
import type { Dashboard, FutureSelfAnswer, Milestones } from '../lib/types'
import { Card, Progress, Spinner } from './ui'

const SUGGESTIONS = [
  'What will my finances look like in six months if I keep spending like this?',
  'What happens if I pay an extra £50 towards my debts each month?',
  'What if I cut eating out by 25%?',
  'What if I save £100 a month?',
]

const monthsLabel = (m: number | null) => (m == null ? '—' : m === 0 ? 'now' : `${m} month${m === 1 ? '' : 's'}`)

/** Future Self: milestone trackers that react instantly to an extra repayment, plus "ask your future self". */
export function FutureSelf({ d }: { d: Dashboard }) {
  const { user, version } = useUser()
  const [extra, setExtra] = useState(0)
  const [m, setM] = useState<Milestones | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // Debounced so dragging the slider feels instant without flooding the API
  useEffect(() => {
    if (!user) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { api.milestones(user.id, extra).then(setM).catch(() => setM(null)) }, extra ? 120 : 0)
    return () => window.clearTimeout(timer.current)
  }, [user, extra, version])

  const hasDebt = !!m?.debt
  const maxExtra = Math.max(100, Math.ceil(((m?.debt?.total ?? 600) / 3) / 50) * 50)

  return (
    <Card className="section future-self">
      <div className="row" style={{ gap: 10 }}>
        <span className="ico"><Sparkles size={18} /></span>
        <div>
          <h2>Future Self</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Move the slider and watch your milestones move. Every number comes from your own forecast.</p>
        </div>
      </div>

      {hasDebt && (
        <div className="fs-slider">
          <div className="row between">
            <label htmlFor="fs-extra" className="small" style={{ fontWeight: 600 }}>Extra towards your debts each month</label>
            <strong className="num purple">£{extra}</strong>
          </div>
          <input id="fs-extra" type="range" min={0} max={maxExtra} step={5} value={extra} onChange={(e) => setExtra(Number(e.target.value))} />
          <div className="row between tiny muted"><span>Minimum payments only</span><span>+£{maxExtra}</span></div>
        </div>
      )}

      {!m ? <div className="center" style={{ minHeight: 180 }}><Spinner /></div> : (
        <>
          <div className="grid grid-3 collapse fs-milestones">
            <DebtCountdown m={m} />
            <EmergencyFund m={m} />
            <PaydayCheck m={m} />
          </div>
          {hasDebt && m.path.length > 0 && (
            <div style={{ height: 220, marginTop: 14 }}>
              <ResponsiveContainer>
                <ComposedChart data={m.path} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compact} width={52} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => money0(Number(v))} labelFormatter={(l) => monthLong(String(l))} />
                  <Legend />
                  <Area dataKey="debt_current" name="Debt - minimum payments" stroke="var(--text-muted)" strokeDasharray="5 4" fill="var(--border)" fillOpacity={0.4} isAnimationActive={false} />
                  <Area dataKey="debt_with_plan" name={`Debt - with £${extra} extra`} stroke="var(--primary)" strokeWidth={2.5} fill="var(--primary)" fillOpacity={0.12} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <AskFutureSelf d={d} />
    </Card>
  )
}

function Ring({ fraction, children, tone }: { fraction: number; children: React.ReactNode; tone: string }) {
  const r = 54, c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, fraction))
  return (
    <div className="fs-ring">
      <svg viewBox="0 0 140 140" width={140} height={140} aria-hidden>
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--border)" strokeWidth={12} />
        <circle cx={70} cy={70} r={r} fill="none" stroke={tone} strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 70 70)" style={{ transition: 'stroke-dasharray .35s ease' }} />
      </svg>
      <div className="fs-ring-text">{children}</div>
    </div>
  )
}

function DebtCountdown({ m }: { m: Milestones }) {
  const d = m.debt
  if (!d) {
    return (
      <div className="fs-tile">
        <div className="fs-tile-title"><Timer size={16} /> Debt-free countdown</div>
        <p className="small muted">No debts added. If you have a card, loan or Klarna plan, add it to see your debt-free date.</p>
        <Link className="card-link" to="/profile">Add a debt</Link>
      </div>
    )
  }
  const base = d.months_current ?? 0
  const now = d.months_with_plan
  return (
    <div className="fs-tile" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div className="fs-tile-title"><Timer size={16} /> Debt-free countdown</div>
      <Ring fraction={now == null ? 1 : base ? now / base : 0} tone={now == null ? 'var(--danger)' : m.extra ? 'var(--success)' : 'var(--primary)'}>
        <div className="fs-ring-big num">{now == null ? '∞' : now}</div>
        <div className="tiny muted">{now == null ? 'not going down' : `month${now === 1 ? '' : 's'} to go`}</div>
      </Ring>
      <div className="small">
        {now != null ? <>Debt-free by <strong>{monthLong(d.date_with_plan!)}</strong></> : 'Minimum payments don’t cover the interest'}
      </div>
      {m.extra > 0 && d.months_saved != null && d.months_saved > 0 && (
        <div className="small pos" style={{ fontWeight: 600 }}>
          {d.months_saved} month{d.months_saved === 1 ? '' : 's'} sooner{d.interest_saved ? ` · ${money0(d.interest_saved)} less interest` : ''}
        </div>
      )}
      <div className="tiny muted">{money0(d.total)} across {d.items.length} debt{d.items.length === 1 ? '' : 's'} · minimums {money0(d.min_payments)}/mo</div>
    </div>
  )
}

function EmergencyFund({ m }: { m: Milestones }) {
  const e = m.emergency
  const reached = e.months_current === 0
  const changed = m.extra > 0 && e.months_with_plan !== e.months_current
  return (
    <div className="fs-tile">
      <div className="fs-tile-title"><PiggyBank size={16} /> Emergency fund</div>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <span className="tile-big num" style={{ fontSize: 28 }}>{money0(e.current)}</span>
        <span className="small muted">of {money0(e.target)}</span>
      </div>
      <Progress value={e.progress} tone={reached ? 'green' : 'purple'} />
      <div className="tiny muted">{e.label}</div>
      <div className="small">
        {reached ? <span className="pos" style={{ fontWeight: 600 }}>Reached - you have a cushion for surprises</span>
          : e.months_with_plan != null ? <>On track to reach it in <strong>{monthsLabel(e.months_with_plan)}</strong> ({monthLong(e.date_with_plan!)})</>
          : <>Not reached within a year on this path - small regular savings would change that</>}
      </div>
      {changed && <div className="tiny muted">Without the extra repayments: {monthsLabel(e.months_current)}</div>}
    </div>
  )
}

function PaydayCheck({ m }: { m: Milestones }) {
  const p = m.payday
  if (!p) {
    return (
      <div className="fs-tile">
        <div className="fs-tile-title"><CalendarClock size={16} /> Before payday</div>
        <p className="small muted">We couldn’t see a regular payday yet. Add your payday in your profile.</p>
      </div>
    )
  }
  const risk = p.prob_short_with_plan
  const tone = risk >= 0.3 ? 'neg' : risk >= 0.1 ? '' : 'pos'
  return (
    <div className="fs-tile">
      <div className="fs-tile-title"><CalendarClock size={16} /> Before payday</div>
      <div className="fs-timeline" aria-hidden>
        <span className="fs-dot" /><span className="fs-line" /><span className="fs-dot pay" />
      </div>
      <div className="row between tiny muted"><span>Today</span><span>Payday {dayMonth(p.date)} · {p.days} day{p.days === 1 ? '' : 's'}</span></div>
      <div className="small">Lowest point before then: <strong className={`num ${p.lowest_with_plan < 0 ? 'neg' : ''}`}>{money0(p.lowest_with_plan)}</strong></div>
      <div className={`small ${tone}`} style={{ fontWeight: 600 }}>
        {risk < 0.05 ? 'You should get to payday comfortably' : `${pct(risk)} chance of running short before payday`}
      </div>
      {p.prob_short_with_plan !== p.prob_short_current && <div className="tiny muted">Without the extra repayments: {pct(p.prob_short_current)}</div>}
    </div>
  )
}

function AskFutureSelf({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<FutureSelfAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ask = async (question: string) => {
    if (!user || !question.trim()) return
    setBusy(true); setError(null); setQ(question)
    try { setRes(await api.futureSelf(user.id, question)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const at = res?.at_horizon
  const showDebt = !!res?.path.some((p) => p.debt_current > 0 || p.debt_new > 0) && (res?.interpretation.extra_debt_payment ?? 0) > 0

  return (
    <div className="fs-ask">
      <h3>Ask your future self</h3>
      <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input className="input" placeholder="e.g. What if I pay an extra £50 towards my credit card each month?" value={q}
          onChange={(e) => setQ(e.target.value)} maxLength={400} />
        <button className="btn" type="submit" disabled={busy || q.trim().length < 3} aria-label="Ask"><Send size={16} /></button>
      </form>
      <div className="chips" style={{ marginTop: 10 }}>
        {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
      </div>

      {busy && <div className="row" style={{ marginTop: 14 }}><Spinner /><span className="small muted">Travelling to your future…</span></div>}
      {error && <p className="small neg">{error}</p>}
      {res && !busy && (
        <div className="fs-answer">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <em className="small muted">{res.interpretation.restatement}</em>
            <span className={`badge ${res.source === 'ai' ? 'purple' : 'teal'}`}>{res.source === 'ai' ? 'AI + forecast' : 'Forecast'}</span>
          </div>
          <p style={{ margin: '8px 0 12px', fontSize: 16 }}>{res.answer}</p>
          {at && (
            <div className="grid grid-3 collapse">
              <div className="fs-stat">
                <div className="tiny muted">Balance in {res.interpretation.horizon_months === 12 ? '1 year' : `${res.interpretation.horizon_months} months`}</div>
                <div className="num"><span className="muted">{money0(at.balance_current)}</span> → <strong className={at.balance_new >= at.balance_current ? 'pos' : 'neg'}>{money0(at.balance_new)}</strong></div>
              </div>
              <div className="fs-stat">
                <div className="tiny muted">Chance of going overdrawn (3 months)</div>
                <div className="num"><span className="muted">{pct(res.risk_90d.current)}</span> → <strong className={res.risk_90d.new <= res.risk_90d.current ? 'pos' : 'neg'}>{pct(res.risk_90d.new)}</strong></div>
              </div>
              {res.debt && (
                <div className="fs-stat">
                  <div className="tiny muted">Debt-free</div>
                  <div className="num"><span className="muted">{res.debt.date_current ?? 'never'}</span> → <strong className="pos">{res.debt.date_new ?? 'never'}</strong></div>
                </div>
              )}
            </div>
          )}
          {res.path.length > 0 && (
            <div style={{ height: 240, marginTop: 14 }}>
              <ResponsiveContainer>
                <ComposedChart data={res.path} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="bal" tickFormatter={compact} width={56} axisLine={false} tickLine={false} />
                  {showDebt && <YAxis yAxisId="debt" orientation="right" tickFormatter={compact} width={50} axisLine={false} tickLine={false} />}
                  <Tooltip formatter={(v) => money0(Number(v))} labelFormatter={(l) => monthLong(String(l))} />
                  <Legend />
                  <ReferenceLine yAxisId="bal" y={0} stroke="var(--danger)" strokeDasharray="4 4" />
                  <ReferenceLine yAxisId="bal" x={res.path[Math.min(res.interpretation.horizon_months, res.path.length) - 1]?.month} stroke="var(--primary)" strokeDasharray="2 4" />
                  <Line yAxisId="bal" dataKey="balance_current" name="Balance - current path" stroke="var(--text-muted)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line yAxisId="bal" dataKey="balance_new" name="Balance - with the change" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  {showDebt && <Line yAxisId="debt" dataKey="debt_new" name="Debt left" stroke="var(--ill-pink)" strokeWidth={2} dot={false} isAnimationActive={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Simulated from {d.overview.history_days} days of your history across 1,000 possible futures. Guidance, not regulated financial advice.
          </p>
        </div>
      )}
    </div>
  )
}
