import { ArrowDownRight, ArrowUpRight, Plus, RotateCcw, Sparkles, Target, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CategoryIcon } from '../components/CategoryIcon'
import { Card, PageHead, Progress, Spinner } from '../components/ui'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { compact, fullDate, money, monthLong, monthShort, monthTicks, money0, pct, signed0 } from '../lib/format'
import type { Adjustment, Dashboard, Forecast, ScenarioResult } from '../lib/types'

const HORIZONS = [{ m: 1, label: '1M', long: '1 month' }, { m: 3, label: '3M', long: '3 months' },
  { m: 6, label: '6M', long: '6 months' }, { m: 12, label: '1Y', long: '1 year' }]

export default function Future({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const [fc, setFc] = useState<Forecast | null>(null)

  useEffect(() => {
    if (user) api.forecast(user.id, 366, 2).then(setFc).catch(() => setFc(null))
  }, [user, d])

  return (
    <div className="page">
      <PageHead title="Financial time travel" />
      <FutureTracker d={d} fc={fc} />

      <div className="grid grid-2 collapse section" style={{ alignItems: 'start' }}>
        <ScenarioBuilder d={d} />
        <div className="stack">
          <div className="section-title"><h2>Goals</h2></div>
          {d.time_travel.goals.length === 0 && <Card><span className="muted small">Add goals in Profile to see when you'll reach them.</span></Card>}
          {d.time_travel.goals.map((g) => (
            <Card key={g.id}>
              <div className="row between"><span className="row" style={{ gap: 8 }}><Target size={18} color="var(--primary)" /><h3>{g.name}</h3></span>
                {g.on_track != null && <span className={`badge ${g.on_track ? 'green' : 'amber'}`}>{g.on_track ? 'On track' : 'Needs a boost'}</span>}</div>
              <div style={{ margin: '10px 0 6px' }}><Progress value={g.saved_amount / g.target_amount} tone="purple" /></div>
              <div className="row between tiny muted"><span>{money0(g.saved_amount)} saved</span><span>Target {money0(g.target_amount)}{g.target_date ? ` by ${fullDate(g.target_date)}` : ''}</span></div>
              <p className="small" style={{ margin: '8px 0 0' }}>{g.message}</p>
              {g.likely_date && <div className="tiny muted">Likely {monthLong(g.likely_date)}{g.cautious_date && g.cautious_date !== g.likely_date ? ` · cautious estimate ${monthLong(g.cautious_date)}` : ''}</div>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

interface OneOff { label: string; amount: number; date: string }

function ScenarioBuilder({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const cats = d.budget.categories.filter((c) => c.group === 'discretionary').slice(0, 5)
  const [changes, setChanges] = useState<Record<string, number>>({})
  const [income, setIncome] = useState(0)
  const [oneOffs, setOneOffs] = useState<OneOff[]>([])
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const adjustments: Adjustment[] = [
    ...Object.entries(changes).filter(([, v]) => v !== 0).map(([category, v]) => ({ type: 'category' as const, category, change_pct: v })),
    ...(income ? [{ type: 'income' as const, change_pct: income }] : []),
    ...oneOffs.filter((o) => o.amount && o.date).map((o) => ({ type: 'one_off' as const, amount: -Math.abs(o.amount), date: o.date, label: o.label })),
  ]

  const run = async () => {
    if (!user || adjustments.length === 0) return
    setBusy(true); setError(null)
    try { setResult(await api.scenario(user.id, adjustments)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const reset = () => { setChanges({}); setIncome(0); setOneOffs([]); setResult(null) }
  const compare = useMemo(() => {
    if (!result) return []
    const base = new Map(d.time_travel.monthly.map((m) => [m.month, m.end_balance_p50]))
    return result.scenario_monthly.map((m) => ({ month: m.month, baseline: base.get(m.month), scenario: m.end_balance_p50 }))
  }, [result, d.time_travel.monthly])
  const inAMonth = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

  return (
    <div className="stack">
      <div className="section-title"><h2>What if…?</h2></div>
      {d.time_travel.smart_moves.length > 0 && (
        <Card>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}><Sparkles size={18} color="var(--primary)" /><h3>Smart moves for you</h3></div>
          <div className="stack" style={{ gap: 10 }}>
            {d.time_travel.smart_moves.map((m) => (
              <div key={m.category} className="row" style={{ alignItems: 'flex-start' }}>
                <CategoryIcon category={m.category} boxed />
                <div style={{ flex: 1 }}>
                  <div className="row between"><strong>{m.title}</strong><span className="badge green">{signed0(m.balance_gain_6m)}</span></div>
                  <div className="small muted">{m.message}</div>
                </div>
                <button className="btn secondary" style={{ padding: '6px 12px' }}
                  onClick={() => setChanges((c) => ({ ...c, [m.category]: m.change_pct }))}>Try</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="row" style={{ gap: 8 }}><Wand2 size={18} color="var(--primary)" /><h3>Build your own future</h3></div>
        <div className="stack" style={{ gap: 14, marginTop: 12 }}>
          {cats.map((c) => {
            const v = changes[c.category] ?? 0
            return (
              <label key={c.category} className="field">
                <span className="row between" style={{ color: 'var(--text)' }}>
                  <span className="row" style={{ gap: 8 }}><CategoryIcon category={c.category} size={16} />{c.category}</span>
                  <span className={`num ${v < 0 ? 'pos' : v > 0 ? 'neg' : 'muted'}`}>{v > 0 ? '+' : ''}{v}% · {money0(c.avg_monthly * (1 + v / 100))}/mo</span>
                </span>
                <input type="range" min={-60} max={60} step={5} value={v}
                  onChange={(e) => setChanges((cur) => ({ ...cur, [c.category]: Number(e.target.value) }))} />
              </label>
            )
          })}
          <label className="field">
            <span className="row between" style={{ color: 'var(--text)' }}><span>Income change</span><span className={`num ${income > 0 ? 'pos' : income < 0 ? 'neg' : 'muted'}`}>{income > 0 ? '+' : ''}{income}%</span></span>
            <input type="range" min={-50} max={30} step={5} value={income} onChange={(e) => setIncome(Number(e.target.value))} />
          </label>

          <div>
            <div className="row between"><span className="small" style={{ fontWeight: 600 }}>One-off costs</span>
              <button className="btn ghost" style={{ padding: 4 }} onClick={() => setOneOffs((o) => [...o, { label: 'Holiday', amount: 500, date: inAMonth }])}><Plus size={16} /> Add</button></div>
            {oneOffs.map((o, i) => (
              <div key={i} className="row" style={{ marginTop: 8 }}>
                <input className="input" value={o.label} aria-label="Label" onChange={(e) => setOneOffs((all) => all.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <input className="input num" type="number" min={0} value={o.amount} aria-label="Amount" style={{ maxWidth: 100 }}
                  onChange={(e) => setOneOffs((all) => all.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                <input className="input" type="date" value={o.date} aria-label="Date" style={{ maxWidth: 150 }}
                  onChange={(e) => setOneOffs((all) => all.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                <button className="icon-btn" aria-label="Remove" onClick={() => setOneOffs((all) => all.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          <div className="row">
            <button className="btn" onClick={run} disabled={busy || adjustments.length === 0}>{busy ? 'Travelling…' : 'See my future'}</button>
            <button className="btn ghost" onClick={reset}><RotateCcw size={16} /> Reset</button>
          </div>
          {error && <div className="small neg">{error}</div>}
        </div>
      </Card>

      {result && (
        <Card>
          <h3>Your new future</h3>
          <div className="grid grid-4" style={{ marginTop: 10, textAlign: 'center' }}>
            {Object.entries(result.difference_at).map(([m, v]) => (
              <div key={m}><div className="tiny muted">{m === '12' ? '1 year' : `${m} mo`}</div><strong className={`num ${v >= 0 ? 'pos' : 'neg'}`}>{signed0(v)}</strong></div>
            ))}
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            Overdraft risk (90 days): {pct(result.baseline.prob_overdraft['90d'] ?? 0)} → <strong>{pct(result.scenario.prob_overdraft['90d'] ?? 0)}</strong>
          </div>
          <div style={{ height: 200, marginTop: 10 }}>
            <ResponsiveContainer>
              <ComposedChart data={compare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compact} width={52} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money0(Number(v))} labelFormatter={(l) => monthLong(String(l))} />
                <Legend />
                <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" />
                <Line dataKey="baseline" name="Current path" stroke="var(--text-muted)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line dataKey="scenario" name="With changes" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  )
}

/** "Future you" number tracker: big balance above the graph that follows the cursor (Invest-style). */
function FutureTracker({ d, fc }: { d: Dashboard; fc: Forecast | null }) {
  const [months, setMonths] = useState(6)
  const [active, setActive] = useState<number | null>(null)
  const today = d.overview.balance

  const data = useMemo(() => {
    if (!fc) return []
    const cutoff = new Date(d.overview.as_of)
    cutoff.setMonth(cutoff.getMonth() + months)
    return fc.daily.filter((p) => new Date(p.date) <= cutoff).map((p) => ({ ...p, band: [p.p10, p.p90] as [number, number] }))
  }, [fc, months, d.overview.as_of])

  const point = data.length ? data[active ?? data.length - 1] : null
  const horizon = HORIZONS.find((h) => h.m === months)!
  const change = point ? point.p50 - today : 0
  const up = change >= 0
  const [pounds, pence] = point ? money(point.p50).replace('£', '').replace('-', '').split('.') : ['–', '']
  const negative = (point?.p50 ?? 0) < 0

  return (
    <Card className="tracker">
      <div className="tracker-label">
        Future you {active == null ? `in ${horizon.long}` : 'on'}
        <span className="tracker-date">{point ? fullDate(point.date) : ''}</span>
      </div>
      <div className="tracker-value num" aria-live="polite">
        {negative && <span className="tracker-minus">-</span>}
        <span className="tracker-currency">£</span>{pounds}<span className="tracker-pence">.{pence}</span>
      </div>
      <div className="tracker-stats">
        <div>
          <div className="tracker-stat-label">Vs today</div>
          <div className={`tracker-stat num ${up ? 'pos' : 'neg'}`}>
            {up ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}{money0(Math.abs(change))}
          </div>
        </div>
        {point && (
          <div>
            <div className="tracker-stat-label">Likely range</div>
            <div className="tracker-stat num">{money0(point.p10)} – {money0(point.p90)}</div>
          </div>
        )}
        {point && point.prob_negative > 0.01 && (
          <div>
            <div className="tracker-stat-label">Chance below £0</div>
            <div className="tracker-stat num neg">{pct(point.prob_negative)}</div>
          </div>
        )}
      </div>

      <div style={{ height: 300, marginTop: 8 }}>
        {!fc ? <div className="center" style={{ minHeight: 300 }}><Spinner /></div> : (
          <ResponsiveContainer>
            <ComposedChart
              data={data}
              margin={{ top: 12, right: 4, left: 4, bottom: 0 }}
              onMouseMove={(st) => setActive(st?.activeTooltipIndex != null ? Number(st.activeTooltipIndex) : null)}
              onMouseLeave={() => setActive(null)}
            >
              <defs>
                <linearGradient id="tracker-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" ticks={monthTicks(data, 'date')} tickFormatter={monthShort} axisLine={false} tickLine={false} />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip content={() => null} cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '3 3' }} isAnimationActive={false} />
              <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" />
              <ReferenceLine y={d.overview.buffer_target} stroke="var(--ill-orange)" strokeDasharray="2 4" />
              <Area dataKey="band" stroke="none" fill="var(--primary)" fillOpacity={0.08} isAnimationActive={false} activeDot={false} />
              <Area dataKey="p50" stroke="var(--primary)" strokeWidth={2.5} fill="url(#tracker-fill)" isAnimationActive={false}
                activeDot={{ r: 6, fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="range-tabs" role="tablist" aria-label="Time range">
        {HORIZONS.map((h) => (
          <button key={h.m} role="tab" aria-selected={months === h.m} className={months === h.m ? 'on' : ''}
            onClick={() => { setMonths(h.m); setActive(null) }}>{h.label}</button>
        ))}
      </div>
      <div className="legend" style={{ justifyContent: 'center', marginTop: 10 }}>
        <span><i style={{ background: 'var(--primary)' }} />Most likely</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />80% of futures</span>
        <span><i style={{ background: 'var(--ill-orange)' }} />Safety buffer {money0(d.overview.buffer_target)}</span>
        <span><i style={{ background: 'var(--danger)' }} />£0</span>
      </div>
    </Card>
  )
}

