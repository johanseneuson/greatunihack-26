import { CalendarClock, Sparkles, Waves as WavesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, ErrorBar, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CategoryIcon } from '../components/CategoryIcon'
import { FutureTracker, HORIZONS, horizonData, indexAt } from '../components/FutureTracker'
import { Card, PageHead } from '../components/ui'
import { compact, dayMonth, monthLong, monthShort, monthTicks, money0, signed0 } from '../lib/format'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import type { Dashboard, Forecast, ForecastAccuracy, WaveWeek } from '../lib/types'

const color = (w: WaveWeek, highlighted: boolean) => {
  if (highlighted) return w.is_wave ? 'var(--warning)' : 'var(--primary)'
  return w.kind === 'history' ? (w.is_wave ? 'var(--ill-pink)' : 'var(--chart-light)') : (w.is_wave ? 'var(--ill-orange)' : 'var(--primary-soft)')
}

export default function Future({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const w = d.waves
  // Shared between the balance tracker and the waves graph so both always show the same moment in time.
  const [fc, setFc] = useState<Forecast | null>(null)
  const [accuracy, setAccuracy] = useState<ForecastAccuracy | null | undefined>(undefined)
  const [months, setMonths] = useState(6)
  const [hoverDate, setHoverDate] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    api.forecast(user.id, 366, 2).then(setFc).catch(() => setFc(null))
    api.forecastAccuracy(user.id).then(setAccuracy).catch(() => setAccuracy(undefined))
  }, [user, d])

  const balance = useMemo(() => horizonData(fc, d.overview.as_of, 12), [fc, d.overview.as_of])
  const balanceOn = (date: string) => { const i = indexAt(balance, date); return i == null ? null : balance[i] }

  // Past year + forecast weeks up to the selected range. One huge week (e.g. a renovation) would flatten
  // everything else: cap the axis and label the capped bars.
  const { series, cap } = useMemo(() => {
    const end = new Date(d.overview.as_of)
    end.setMonth(end.getMonth() + months)
    const iso = end.toISOString().slice(0, 10)
    const rows = w.series.filter((s) => s.kind === 'history' || s.week_start <= iso)
    const sorted = rows.map((s) => s.outflow).sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0
    const raw = Math.max(p90 * 2.2, ...rows.map((s) => s.baseline * 1.6), ...rows.map((s) => s.p90 ?? 0), 100)
    const step = raw > 2000 ? 500 : raw > 500 ? 100 : 50
    const cap = Math.ceil(raw / step) * step
    return {
      cap,
      series: rows.map((s) => ({
        ...s,
        shown: Math.min(s.outflow, cap),
        capped: s.outflow > cap ? compact(s.outflow) : '',
        range: s.kind === 'forecast' && s.p10 != null && s.p90 != null
          ? [Math.max(0, s.outflow - s.p10), Math.max(0, Math.min(cap, s.p90) - s.outflow)] as [number, number] : undefined,
      })),
    }
  }, [w.series, months, d.overview.as_of])
  const today = series.find((s) => s.kind === 'forecast')?.week_start
  const heavy = w.upcoming_wave_months ?? []
  const outlook = w.monthly_outlook ?? []
  const hoveredWeek = hoverDate ? series.findIndex((s) => s.kind === 'forecast' && s.week_start <= hoverDate && hoverDate <= (s.week_end ?? s.week_start)) : -1
  const horizonLabel = HORIZONS.find((h) => h.m === months)?.long

  return (
    <div className="page">
      <PageHead title="Your future" />
      <FutureTracker d={d} fc={fc} months={months} onMonths={setMonths} hoverDate={hoverDate} onHover={setHoverDate} accuracy={accuracy} />

      <Card className="section">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="ico"><WavesIcon size={18} /></span>
          <div>
            <h3>Costs come in waves. We spot them before they hit.</h3>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Your weekly flexible spending over the past year and the next {horizonLabel}, from the same forecast as your balance above:
              point at a week to see your balance then. Regular bills are left out, so what stands out are the surges: big purchases,
              seasonal peaks and less frequent bills.
            </p>
          </div>
        </div>
        <div style={{ height: 280, marginTop: 16 }}>
          <ResponsiveContainer>
            <ComposedChart
              data={series}
              margin={{ top: 18, right: 8, left: 0, bottom: 0 }}
              onMouseMove={(st) => {
                const s = st?.activeTooltipIndex != null ? series[Number(st.activeTooltipIndex)] : undefined
                setHoverDate(s?.kind === 'forecast' ? s.week_end ?? s.week_start : null)
              }}
              onMouseLeave={() => setHoverDate(null)}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week_start" ticks={monthTicks(series, 'week_start', months > 6 ? 2 : 1)} tickFormatter={monthShort} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} width={52} axisLine={false} tickLine={false} domain={[0, cap]} allowDataOverflow />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                const p = payload?.[0]?.payload as WaveWeek | undefined
                if (!active || !p) return null
                const bal = p.kind === 'forecast' ? balanceOn(p.week_end ?? p.week_start) : null
                return (
                  <div className="chart-tip" style={{ maxWidth: 260 }}>
                    <strong>Week of {dayMonth(p.week_start)}</strong> {p.kind === 'forecast' && <span className="badge purple">forecast</span>}<br />
                    {money0(p.outflow)} flexible spending
                    {p.kind === 'forecast' && p.p10 != null && <span className="muted"> (likely {money0(p.p10)}–{money0(p.p90 ?? 0)})</span>}<br />
                    <span className="muted">Normal: {money0(p.baseline)}</span>
                    {p.is_wave && <><br /><strong style={{ color: 'var(--danger)' }}>Wave</strong></>}
                    {p.payday && <><br /><span className="pos">Payday {dayMonth(p.payday)}</span></>}
                    {p.bills && p.bills.length > 0 && <><br /><span className="muted">Bills: {p.bills.slice(0, 3).map((b) => `${b.name} ${money0(-b.amount)}`).join(', ')}</span></>}
                    {bal && <><br /><strong>Balance by {dayMonth(bal.date)}: {money0(bal.p50)}</strong></>}
                  </div>
                )
              }} />
              {today && <ReferenceLine x={today} stroke="var(--primary)" strokeDasharray="4 4" label={{ value: 'Today', position: 'insideTopLeft', fill: 'var(--primary)', fontSize: 12 }} />}
              <Bar dataKey="shown" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {series.map((s, i) => <Cell key={s.kind + s.week_start} fill={color(s, i === hoveredWeek)} />)}
                <LabelList dataKey="capped" position="insideTop" fill="#fff" fontSize={10} fontWeight={700} />
                <ErrorBar dataKey="range" width={0} stroke="var(--primary)" strokeOpacity={0.3} />
              </Bar>
              <Line dataKey="baseline" type="stepAfter" dot={false} stroke="var(--secondary)" strokeWidth={1.5} strokeDasharray="3 3" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: 'var(--chart-light)' }} />Normal week</span>
          <span><i style={{ background: 'var(--ill-pink)' }} />Past wave</span>
          <span><i style={{ background: 'var(--primary-soft)' }} />Forecast</span>
          <span><i style={{ background: 'var(--ill-orange)' }} />Wave ahead</span>
          <span><i style={{ background: 'var(--primary)', opacity: 0.45, width: 3 }} />Likely range</span>
          <span><i style={{ background: 'var(--secondary)' }} />Your normal level</span>
        </div>
      </Card>

      <div className="grid grid-2 collapse section" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="section-title"><h2>Coming up</h2></div>
          {w.upcoming_waves.length === 0 && heavy.length === 0 && (
            <Card><div className="row"><Sparkles size={18} color="var(--success)" /><span>Calm waters ahead: no spending waves forecast. 🎉</span></div></Card>
          )}
          {w.upcoming_waves.map((u) => (
            <Card key={u.start}>
              <div className="row between"><h3>Week of {dayMonth(u.start)}</h3><span className="badge amber">{signed0(u.excess_over_normal)}</span></div>
              <p className="small muted" style={{ margin: '4px 0' }}>{u.reasons.join(' · ')}</p>
              <div className="small">Expect about <strong>{money0(u.expected_spend)}</strong> out (up to {money0(u.high_estimate)} in a bad week).</div>
            </Card>
          ))}
          {heavy.map((m) => (
            <Card key={m.month}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}><CalendarClock size={18} color="var(--ill-orange)" /><h3>{monthLong(m.month)}</h3></span>
                <span className="badge amber">{signed0(m.excess_over_normal)}</span>
              </div>
              <p className="small muted" style={{ margin: '4px 0' }}>{m.reasons.join(' · ')}</p>
              <div className="small">A heavier month: about {money0(m.expected_variable_spend)} of flexible spending vs a normal {money0(m.normal_variable_spend)}.</div>
            </Card>
          ))}

          {outlook.length > 0 && (
            <Card>
              <h3>Your next 12 months</h3>
              <p className="tiny muted" style={{ marginTop: 2 }}>Expected flexible spending per month</p>
              <div style={{ height: 160 }}>
                <ResponsiveContainer>
                  <ComposedChart data={outlook} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} interval={0} fontSize={11} />
                    <YAxis hide />
                    <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => money0(Number(v))} labelFormatter={(l) => monthLong(String(l))} />
                    <Bar dataKey="expected_variable_spend" name="Expected" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {outlook.map((m) => <Cell key={m.month} fill={m.is_wave ? 'var(--ill-orange)' : 'var(--chart-light)'} />)}
                    </Bar>
                    <Line dataKey="normal_variable_spend" name="Normal" dot={false} stroke="var(--secondary)" strokeDasharray="3 3" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>

        <div className="stack">
          <div className="section-title"><h2>Past waves</h2></div>
          {w.past_waves.length === 0 && <Card><span className="muted">No big surges in your history. Nice and steady.</span></Card>}
          {w.past_waves.slice(0, 6).map((p) => (
            <Card key={p.start}>
              <div className="row between">
                <h3>{dayMonth(p.start)} – {dayMonth(p.end)}</h3>
                <span className="badge red">{signed0(p.excess_over_normal)}</span>
              </div>
              <div className="small muted" style={{ margin: '4px 0 8px' }}>{money0(p.total_spent)} spent over {p.weeks} week{p.weeks > 1 ? 's' : ''}</div>
              <div className="chips">
                {p.drivers.map((x) => (
                  <span key={x.category} className="chip row" style={{ gap: 6 }}><CategoryIcon category={x.category} size={14} />{x.category} {signed0(x.excess)}</span>
                ))}
              </div>
            </Card>
          ))}
          {w.seasonal_peaks.length > 0 && (
            <Card>
              <h3>Your seasonal pattern</h3>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>Months that usually cost you more than average:</p>
              <div className="chips">
                {w.seasonal_peaks.map((s) => <span key={s.month} className="chip">{s.month} +{s.above_average_pct}%</span>)}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
