import { CalendarClock, Sparkles, Waves as WavesIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CategoryIcon } from '../components/CategoryIcon'
import { FutureTracker } from '../components/FutureTracker'
import { Card, PageHead } from '../components/ui'
import { compact, dayMonth, monthLong, monthShort, monthTicks, money0, signed0 } from '../lib/format'
import type { Dashboard, WaveWeek } from '../lib/types'

const color = (w: WaveWeek) =>
  w.kind === 'history' ? (w.is_wave ? 'var(--ill-pink)' : 'var(--chart-light)') : (w.is_wave ? 'var(--ill-orange)' : 'var(--primary-soft)')

export default function Future({ d }: { d: Dashboard }) {
  const w = d.waves
  // One huge week (e.g. a renovation) would flatten everything else: cap the axis and label the capped bars.
  const { series, cap } = useMemo(() => {
    const sorted = w.series.map((s) => s.outflow).sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0
    const raw = Math.max(p90 * 2.2, ...w.series.map((s) => s.baseline * 1.6), 100)
    const step = raw > 2000 ? 500 : raw > 500 ? 100 : 50
    const cap = Math.ceil(raw / step) * step
    return {
      cap,
      series: w.series.map((s) => ({ ...s, shown: Math.min(s.outflow, cap), capped: s.outflow > cap ? compact(s.outflow) : '' })),
    }
  }, [w.series])
  const today = series.find((s) => s.kind === 'forecast')?.week_start
  const heavy = w.upcoming_wave_months ?? []
  const outlook = w.monthly_outlook ?? []

  return (
    <div className="page">
      <PageHead title="Your future" />
      <FutureTracker d={d} />

      <Card className="section">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="ico"><WavesIcon size={18} /></span>
          <div>
            <h3>Costs come in waves. We spot them before they hit.</h3>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Your weekly flexible spending over the past year and the next 6 months. Regular bills are left out, so what stands out
              are the surges: big purchases, seasonal peaks and less frequent bills.
            </p>
          </div>
        </div>
        <div style={{ height: 260, marginTop: 16 }}>
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week_start" ticks={monthTicks(series, 'week_start', 2)} tickFormatter={monthShort} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} width={52} axisLine={false} tickLine={false} domain={[0, cap]} allowDataOverflow />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                const p = payload?.[0]?.payload as WaveWeek | undefined
                if (!active || !p) return null
                return (
                  <div className="chart-tip">
                    <strong>Week of {dayMonth(p.week_start)}</strong> {p.kind === 'forecast' && <span className="badge purple">forecast</span>}<br />
                    {money0(p.outflow)} flexible spending<br />
                    <span className="muted">Normal: {money0(p.baseline)}</span>
                    {p.is_wave && <><br /><strong style={{ color: 'var(--danger)' }}>Wave</strong></>}
                  </div>
                )
              }} />
              {today && <ReferenceLine x={today} stroke="var(--primary)" strokeDasharray="4 4" label={{ value: 'Today', position: 'insideTopLeft', fill: 'var(--primary)', fontSize: 12 }} />}
              <Bar dataKey="shown" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {series.map((s) => <Cell key={s.kind + s.week_start} fill={color(s)} />)}
                <LabelList dataKey="capped" position="insideTop" fill="#fff" fontSize={10} fontWeight={700} />
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
