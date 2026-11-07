import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Area, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { fullDate, money, money0, monthShort, monthTicks, pct } from '../lib/format'
import type { Dashboard, Forecast } from '../lib/types'
import { Card, Spinner } from './ui'

const HORIZONS = [{ m: 1, label: '1M', long: '1 month' }, { m: 3, label: '3M', long: '3 months' },
  { m: 6, label: '6M', long: '6 months' }, { m: 12, label: '1Y', long: '1 year' }]

/** "Future you" number tracker: big balance above the graph that follows the cursor (Invest-style). */
export function FutureTracker({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const [fc, setFc] = useState<Forecast | null>(null)
  useEffect(() => {
    if (user) api.forecast(user.id, 366, 2).then(setFc).catch(() => setFc(null))
  }, [user, d])
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
