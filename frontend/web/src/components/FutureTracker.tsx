import { ArrowDownRight, ArrowUpRight, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Area, ComposedChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fullDate, money, money0, monthShort, monthTicks, pct } from '../lib/format'
import type { Dashboard, Forecast, ForecastAccuracy } from '../lib/types'
import { Card, Spinner } from './ui'

export const HORIZONS = [{ m: 1, label: '1M', long: '1 month' }, { m: 3, label: '3M', long: '3 months' },
  { m: 6, label: '6M', long: '6 months' }, { m: 12, label: '1Y', long: '1 year' }]

/** Forecast points up to `months` ahead, with the 80% band as a [low, high] pair for the shaded area. */
export function horizonData(fc: Forecast | null, asOf: string, months: number) {
  if (!fc) return []
  const cutoff = new Date(asOf)
  cutoff.setMonth(cutoff.getMonth() + months)
  return fc.daily.filter((p) => new Date(p.date) <= cutoff).map((p) => ({ ...p, band: [p.p10, p.p90] as [number, number] }))
}

/** Index of the last forecast point on or before `date` (forecast points are every 2 days). */
export function indexAt(data: { date: string }[], date: string | null) {
  if (!date || !data.length) return null
  let i = data.findIndex((p) => p.date > date)
  if (i === -1) i = data.length
  return Math.max(0, i - 1)
}

interface Props {
  d: Dashboard
  fc: Forecast | null
  months: number
  onMonths: (m: number) => void
  /** Date being looked at - set by hovering this graph or the waves graph below it. */
  hoverDate: string | null
  onHover: (date: string | null) => void
  accuracy?: ForecastAccuracy | null
}

/** "Future you" number tracker: big balance above the graph that follows the cursor (Invest-style). */
export function FutureTracker({ d, fc, months, onMonths, hoverDate, onHover, accuracy }: Props) {
  const today = d.overview.balance
  const data = useMemo(() => horizonData(fc, d.overview.as_of, months), [fc, months, d.overview.as_of])
  const active = indexAt(data, hoverDate)

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
              onMouseMove={(st) => {
                const i = st?.activeTooltipIndex != null ? Number(st.activeTooltipIndex) : null
                onHover(i != null && data[i] ? data[i].date : null)
              }}
              onMouseLeave={() => onHover(null)}
            >
              <defs>
                <linearGradient id="tracker-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" ticks={monthTicks(data, 'date')} tickFormatter={monthShort} axisLine={false} tickLine={false} />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
              <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" />
              <ReferenceLine y={d.overview.buffer_target} stroke="var(--ill-orange)" strokeDasharray="2 4" />
              <Area dataKey="band" stroke="none" fill="var(--primary)" fillOpacity={0.08} isAnimationActive={false} activeDot={false} />
              <Area dataKey="p50" stroke="var(--primary)" strokeWidth={2.5} fill="url(#tracker-fill)" isAnimationActive={false} activeDot={false} />
              {/* Drawn from shared state, so hovering the waves graph moves this marker too */}
              {active != null && point && <ReferenceLine x={point.date} stroke="var(--primary)" strokeDasharray="3 3" />}
              {active != null && point && (
                <ReferenceDot x={point.date} y={point.p50} r={6} fill="var(--primary)" stroke="var(--surface)" strokeWidth={3} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="range-tabs" role="tablist" aria-label="Time range">
        {HORIZONS.map((h) => (
          <button key={h.m} role="tab" aria-selected={months === h.m} className={months === h.m ? 'on' : ''}
            onClick={() => { onMonths(h.m); onHover(null) }}>{h.label}</button>
        ))}
      </div>
      <div className="legend" style={{ justifyContent: 'center', marginTop: 10 }}>
        <span><i style={{ background: 'var(--primary)' }} />Most likely</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />80% of futures</span>
        <span><i style={{ background: 'var(--ill-orange)' }} />Safety buffer {money0(d.overview.buffer_target)}</span>
        <span><i style={{ background: 'var(--danger)' }} />£0</span>
      </div>
      <AccuracyNote accuracy={accuracy} />
    </Card>
  )
}

function AccuracyNote({ accuracy }: { accuracy?: ForecastAccuracy | null }) {
  if (accuracy === undefined) return null
  return (
    <div className="accuracy-note">
      <ShieldCheck size={16} />
      {accuracy ? (
        <span>
          <strong>Tested on your last {accuracy.weeks} weeks:</strong> we hid them, forecast them, then compared. Weekly spending was
          off by {money0(accuracy.mae_weekly)} on average
          {accuracy.improvement_vs_naive_pct != null && accuracy.improvement_vs_naive_pct > 0 &&
            <>, {Math.round(accuracy.improvement_vs_naive_pct)}% closer than just using your average week</>}
          , and the shaded range caught {pct(accuracy.coverage_80)} of real weeks.
        </span>
      ) : (
        <span>Once you have about 7 months of history we'll test this forecast against your real spending and show how accurate it is.</span>
      )}
    </div>
  )
}
