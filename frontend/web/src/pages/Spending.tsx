import { Settings2, TrendingUp, Waves as WavesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { CategoryIcon } from '../components/CategoryIcon'
import { Card, PageHead, Progress, Segmented } from '../components/ui'
import { useUser } from '../context/UserContext'
import Payments from './Payments'
import { api } from '../lib/api'
import { dayMonth, monthLong, monthShort, money, money0, pct } from '../lib/format'
import type { Dashboard, Transaction } from '../lib/types'

type Tab = 'newsfeed' | 'categories' | 'budgets' | 'payments'

export default function Spending({ d }: { d: Dashboard }) {
  const [tab, setTab] = useState<Tab>('newsfeed')
  return (
    <div className="page">
      <PageHead title="Spending" right={<Link to="/profile" className="icon-btn" aria-label="Settings"><Settings2 size={20} /></Link>} />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[{ value: 'newsfeed', label: 'Newsfeed' }, { value: 'categories', label: 'Categories' }, { value: 'budgets', label: 'Budgets' }, { value: 'payments', label: 'Payments' }]}
      />
      {tab === 'newsfeed' && <Newsfeed d={d} />}
      {tab === 'categories' && <Categories d={d} />}
      {tab === 'budgets' && <Budgets d={d} />}
      {tab === 'payments' && <Payments />}
    </div>
  )
}

function Newsfeed({ d }: { d: Dashboard }) {
  const months = d.history.monthly.filter((m) => !m.partial)
  const last = months.at(-1)
  const wave = d.waves.past_waves[0]
  const near = d.budget.categories.find((c) => c.group === 'discretionary' && c.status !== 'on_track')
  const top = d.history.categories_90d[0]
  const subs = d.budget.subscriptions
  const creep = d.warnings.filter((w) => w.kind === 'category_creep')
  const nextBill = d.forecast.upcoming.find((e) => e.kind === 'bill')
  const income = d.forecast.upcoming.find((e) => e.kind === 'income')
  // Income declared in the profile isn't in the transactions - use it for the summary.
  const declared = d.overview.income_source === 'declared'
  const lastIncome = last ? (declared ? d.overview.monthly_income : last.income) : 0
  const lastNet = last ? lastIncome - last.spending : 0

  return (
    <div className="tiles">
      {wave && (
        <Card>
          <h3>Spending wave</h3>
          <div className="tile-art" style={{ background: 'var(--badge-pink)' }}><WavesIcon size={34} color="var(--ill-pink)" /></div>
          <p className="small" style={{ textAlign: 'center', margin: 0 }}>
            {dayMonth(wave.start)} – {dayMonth(wave.end)} you spent <strong>{money0(wave.excess_over_normal)}</strong> more than usual
            {wave.drivers.length > 0 && <>, mostly on {wave.drivers.map((x) => x.category).join(', ')}</>}.
          </p>
          <Link to="/future" className="card-link" style={{ marginTop: 10 }}>See waves ›</Link>
        </Card>
      )}

      {near && (
        <Card>
          <h3>{near.category}</h3>
          <div style={{ display: 'grid', placeItems: 'center', margin: '10px 0' }}><BudgetRing spent={near.spent_this_month} limit={near.suggested_limit} category={near.category} /></div>
          <div style={{ textAlign: 'center' }}>
            <div className="tile-big num" style={{ fontSize: 24 }}>{money0(Math.max(0, near.remaining))}</div>
            <div className="small muted">left of {money0(near.suggested_limit)}</div>
          </div>
          <div className="action small" style={{ marginTop: 10, padding: 8, borderRadius: 8, background: 'var(--surface-2)', textAlign: 'center' }}>
            {near.status === 'over' ? "You've gone over this month's budget" : "You're getting close to budget"}
          </div>
        </Card>
      )}

      {last && (
        <Card>
          <h3 style={{ textAlign: 'center' }}>Last month's summary</h3>
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <div className="tile-big num">{money0(last.spending)}</div>
            <div className="small muted">spent in {monthLong(last.month)}</div>
            <div className="divider" />
            <div className="row between small"><span className="muted">Income{declared ? ' (from profile)' : ''}</span><strong className="num">{money0(lastIncome)}</strong></div>
            <div className="row between small"><span className="muted">Essentials</span><strong className="num">{money0(last.essential)}</strong></div>
            <div className="row between small"><span className="muted">Net</span><strong className={`num ${lastNet >= 0 ? 'pos' : 'neg'}`}>{money0(lastNet)}</strong></div>
          </div>
        </Card>
      )}

      {top && (
        <Card>
          <h3 style={{ textAlign: 'center' }}>Top spending category (90 days)</h3>
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <div className="tile-big num">{money0(top.amount)}</div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}><CategoryIcon category={top.category} /> {top.category}</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{pct(top.share)} of your spending · {top.transactions} transactions</div>
          </div>
        </Card>
      )}

      {creep.map((w) => (
        <Card key={w.id}>
          <div className="row" style={{ gap: 8 }}><TrendingUp size={18} color="var(--ill-orange)" /><h3>{w.title}</h3></div>
          <p className="small muted">{w.message}</p>
          {w.upside && <div className="small pos">{w.upside}</div>}
        </Card>
      ))}

      {(nextBill || income) && (
        <Card>
          <h3>Next up</h3>
          {income && <div className="row between small" style={{ marginTop: 8 }}><span>Payday · {dayMonth(income.date)}</span><strong className="num pos">+{money0(income.amount)}</strong></div>}
          {nextBill && <div className="row between small" style={{ marginTop: 8 }}><span>{nextBill.name} · {dayMonth(nextBill.date)}</span><strong className="num">{money0(nextBill.amount)}</strong></div>}
        </Card>
      )}

      {subs.items.length > 0 && (
        <Card>
          <h3>Subscriptions</h3>
          <div className="tile-big num" style={{ marginTop: 8 }}>{money0(subs.monthly_total)}<span className="small muted"> /month</span></div>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            {subs.items.map((s) => (
              <div key={s.id} className="row between small"><span>{s.name}</span><span className="num muted">{money(s.amount)} · {dayMonth(s.next_date)}</span></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function BudgetRing({ spent, limit, category }: { spent: number; limit: number; category: string }) {
  const r = 30, c = 2 * Math.PI * r
  const p = Math.min(1, limit ? spent / limit : 0)
  return (
    <svg width={80} height={80} viewBox="0 0 80 80" aria-hidden>
      <circle cx={40} cy={40} r={r} fill="var(--badge-pink)" stroke="var(--border)" strokeWidth={6} />
      <circle cx={40} cy={40} r={r} fill="none" stroke="var(--ill-pink)" strokeWidth={6} strokeDasharray={`${c * p} ${c}`}
        strokeLinecap="round" transform="rotate(-90 40 40)" />
      <foreignObject x={26} y={26} width={28} height={28}><div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><CategoryIcon category={category} size={20} /></div></foreignObject>
    </svg>
  )
}

function Categories({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const months = d.history.monthly
  const [selected, setSelected] = useState(months.filter((m) => !m.partial).at(-1)?.month ?? months.at(-1)?.month)
  const [txns, setTxns] = useState<Transaction[] | null>(null)

  useEffect(() => {
    if (!user || !selected) return
    const [y, m] = selected.split('-').map(Number)
    const end = new Date(y, m, 0).getDate()
    setTxns(null)
    api.transactions(user.id, { date_from: `${selected}-01`, date_to: `${selected}-${end}`, include_transfers: false, limit: 1000 })
      .then(setTxns).catch(() => setTxns([]))
  }, [user, selected])

  const byCat = useMemo(() => {
    if (!txns) return []
    const m = new Map<string, { amount: number; n: number }>()
    for (const t of txns) {
      if (t.category === 'Income') continue
      const cur = m.get(t.category) ?? { amount: 0, n: 0 }
      cur.amount -= t.amount
      cur.n += 1
      m.set(t.category, cur)
    }
    return [...m.entries()].filter(([, v]) => v.amount > 0).sort((a, b) => b[1].amount - a[1].amount)
  }, [txns])
  const sel = months.find((m) => m.month === selected)
  const max = byCat[0]?.[1].amount ?? 1

  return (
    <div className="stack">
      <Card>
        <h2 style={{ textAlign: 'center', fontWeight: 500 }}>
          <span className="purple">{sel ? monthLong(sel.month) : ''}:</span> {sel ? money(sel.spending) : ''}
        </h2>
        <div style={{ height: 200, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={months} margin={{ top: 8, left: 0, right: 0, bottom: 0 }}>
              <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => active && payload?.[0] ? (
                <div className="chart-tip"><strong>{monthLong(String(payload[0].payload.month))}</strong><br />{money0(Number(payload[0].value))} spent</div>
              ) : null} />
              <Bar dataKey="spending" radius={[4, 4, 0, 0]} onClick={(_, i) => setSelected(months[i].month)} style={{ cursor: 'pointer' }}>
                {months.map((m) => <Cell key={m.month} fill={m.month === selected ? 'var(--chart-strong)' : 'var(--chart-light)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="tiny muted" style={{ textAlign: 'center' }}>Tap a month to see where the money went</div>
      </Card>

      <Card className="flush">
        <div className="list">
          {!txns && <div className="list-row"><div className="skeleton" style={{ height: 40, width: '100%' }} /></div>}
          {txns && byCat.length === 0 && <div className="list-row muted">No spending recorded this month.</div>}
          {byCat.map(([cat, v]) => (
            <div key={cat} className="list-row" style={{ alignItems: 'flex-start' }}>
              <CategoryIcon category={cat} boxed />
              <div className="grow">
                <div className="row between"><strong>{cat}</strong><span className="num purple" style={{ fontWeight: 600 }}>{money(v.amount)}</span></div>
                <div className="tiny muted" style={{ margin: '2px 0 8px' }}>{v.n} transaction{v.n === 1 ? '' : 's'}</div>
                <Progress value={v.amount / max} tone="pink" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Budgets({ d }: { d: Dashboard }) {
  const b = d.budget
  const s = b.safe_to_spend
  const splitRow = (label: string, now: number | null, next: number | null, tone: 'blue' | 'pink' | 'green') => (
    <div>
      <div className="row between small"><span>{label}</span><span className="num muted">{now != null ? pct(now) : '–'} → <strong style={{ color: 'var(--text)' }}>{next != null ? pct(next) : '–'}</strong></span></div>
      <div style={{ marginTop: 6 }}><Progress value={next ?? 0} tone={tone} /></div>
    </div>
  )
  return (
    <div className="grid grid-2 collapse" style={{ alignItems: 'start' }}>
      <div className="stack">
        <Card>
          <h2>Monthly budgets</h2>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Built from your last 6 months and your circumstances: {b.why}. We'll let you know before you get close.
          </p>
        </Card>
        <Card className="flush">
          <div className="list">
            {b.categories.map((c) => {
              const ratio = c.suggested_limit ? c.spent_this_month / c.suggested_limit : 0
              return (
                <div key={c.category} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <CategoryIcon category={c.category} boxed />
                  <div className="grow">
                    <div className="row between">
                      <strong>{c.category}</strong>
                      <span className="small purple" style={{ fontWeight: 600 }}>Budget: {money(c.suggested_limit)}</span>
                    </div>
                    {c.change < 0 && <div className="tiny pos">Suggested {money0(-c.change)} less than your average {money0(c.avg_monthly)}</div>}
                    <div style={{ margin: '8px 0 4px' }}><Progress value={ratio} tone={c.status === 'over' ? 'pink' : c.status === 'watch' ? 'amber' : 'green'} /></div>
                    <div className="row between tiny muted"><span>Spent: {money(c.spent_this_month)}</span><span>Left: {money(c.remaining)}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="stack">
        <Card>
          <div className="small muted">Safe to spend today</div>
          <div className="tile-big num purple">{money(s.today)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Payday is {dayMonth(s.next_payday)} ({s.days_to_payday} days). We've kept {money0(s.bills_before_payday)} for bills before then
            and your {money0(s.buffer_kept)} safety buffer.
          </div>
          <div className="divider" />
          <div className="row between small"><span className="muted">Flexible budget left this month</span><strong className="num">{money0(s.flexible_budget_left_this_month)}</strong></div>
        </Card>
        <Card>
          <h3>Your money split</h3>
          <p className="tiny muted" style={{ marginTop: 4 }}>Now → with the suggested budget</p>
          <div className="stack" style={{ gap: 12 }}>
            {splitRow('Needs', b.totals.split_now.needs, b.totals.split_suggested.needs, 'blue')}
            {splitRow('Wants', b.totals.split_now.wants, b.totals.split_suggested.wants, 'pink')}
            {splitRow('Savings', b.totals.split_now.savings, b.totals.split_suggested.savings, 'green')}
          </div>
          <div className="divider" />
          <div className="row between small"><span className="muted">Monthly income ({b.income_source})</span><strong className="num">{money0(b.monthly_income)}</strong></div>
          <div className="row between small"><span className="muted">Suggested saving</span><strong className="num pos">{money0(b.totals.savings_suggested)}/mo</strong></div>
        </Card>
      </div>
    </div>
  )
}
