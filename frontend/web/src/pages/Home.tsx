import { BRAND } from '../lib/brand'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, CircleUserRound, MoreHorizontal, Target, Telescope } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { AlertCard } from '../components/AlertCard'
import { CategoryIcon } from '../components/CategoryIcon'
import { Gauge } from '../components/Gauge'
import { Card, Progress } from '../components/ui'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { dayMonth, firstName, greeting, money, money0, signed0 } from '../lib/format'
import type { Account, Dashboard } from '../lib/types'

export default function Home({ d }: { d: Dashboard }) {
  const { user } = useUser()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [view, setView] = useState<'today' | 'future'>('today')

  useEffect(() => {
    if (user) api.accounts(user.id).then(setAccounts).catch(() => setAccounts([]))
  }, [user, d])

  const o = d.overview
  const top = d.warnings.find((w) => w.severity === 'critical' || w.severity === 'warning') ?? d.warnings[0]
  const six = d.time_travel.snapshots.find((s) => s.months_ahead === 6) ?? d.time_travel.snapshots.at(-1)
  const spark = useMemo(() => d.forecast.daily.filter((_, i) => i % 3 === 0), [d])
  const upcoming = d.forecast.upcoming.slice(0, 4)
  const safe = d.budget.safe_to_spend

  return (
    <>
      <section className="hero">
        <div className="page">
          <div className="hero-top">
            <span className="row" style={{ gap: 8, fontWeight: 600 }}>
              <img src="/natwest.svg" alt="NatWest" width={32} height={32} />
              {BRAND}
            </span>
            <button className="icon-btn" aria-label="Profile and data" onClick={() => navigate('/profile')}><CircleUserRound size={26} /></button>
          </div>
          <h1>{greeting()}, {firstName(o.user.name)}</h1>
          <div className="pills">
            <button className={view === 'today' ? 'on' : ''} onClick={() => setView('today')}>Today</button>
            <button className={view === 'future' ? 'on' : ''} onClick={() => setView('future')}>Future you</button>
          </div>
        </div>
      </section>

      <div className="page stack">
        {top && (
          <Link to="/assistant" className="card row between" style={{ color: 'inherit', zIndex: 1 }}>
            <span className="row" style={{ minWidth: 0 }}>
              <span className={`badge ${top.severity === 'critical' ? 'red' : top.severity === 'warning' ? 'amber' : 'green'}`}>
                {top.severity === 'positive' ? '✓' : '!'}
              </span>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top.title}</span>
            </span>
            <ChevronRight size={20} className="chev" />
          </Link>
        )}

        {view === 'today' ? (
          <div className="grid grid-2 collapse">
            <div className="stack">
              <Card className="account">
                <div className="row between">
                  <div>
                    <h3>Total balance</h3>
                    <div className="tiny muted">As of {dayMonth(o.as_of)} · {o.transactions.toLocaleString()} transactions</div>
                  </div>
                  <MoreHorizontal size={18} className="muted" />
                </div>
                <div className="row between" style={{ alignItems: 'flex-end' }}>
                  <img src="/natwest.svg" alt="" width={26} height={26} />
                  <div className="amount num">{money(o.balance)}</div>
                </div>
                <div className="row between small">
                  <span className="muted">Safe to spend today</span>
                  <strong className="num purple">{money(safe.today)}</strong>
                </div>
              </Card>

              {o.balance_source === 'transactions' && accounts.map((a) => (
                <Card key={a.id} className="account">
                  <div className="row between">
                    <div>
                      <h3>{a.name}</h3>
                      <div className="tiny muted">{a.kind === 'credit' ? 'Credit card' : a.kind === 'savings' ? 'Savings' : 'Current'} · {a.provider.replace('sandbox:', 'Sandbox bank ')}</div>
                    </div>
                  </div>
                  <div className="amount num" style={{ fontSize: 20 }}>{money(a.balance)}</div>
                </Card>
              ))}
              {o.balance_source === 'profile' && accounts.length > 0 && (
                <Card className="flush">
                  <div className="list">
                    {accounts.map((a) => (
                      <div key={a.id} className="list-row">
                        <span className="bank-dot" style={{ background: 'var(--secondary)' }}>{a.name[0]}</span>
                        <div className="grow"><div style={{ fontWeight: 600 }}>{a.name}</div><div className="tiny muted">{a.transactions} transactions linked</div></div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card>
                <div className="card-title"><h3>Coming up</h3><Link className="card-link" to="/future">Timeline <ChevronRight size={16} /></Link></div>
                <div className="list">
                  {upcoming.length === 0 && <span className="muted small">No scheduled payments detected yet.</span>}
                  {upcoming.map((e, i) => (
                    <div key={i} className="row between" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                      <span className="row" style={{ minWidth: 0 }}>
                        {e.amount > 0 ? <ArrowDownLeft size={18} color="var(--success)" /> : <ArrowUpRight size={18} color="var(--text-muted)" />}
                        <span style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                          <div className="tiny muted">{dayMonth(e.date)} · {e.kind === 'income' ? 'Income' : e.category}</div>
                        </span>
                      </span>
                      <strong className={`num ${e.amount > 0 ? 'pos' : ''}`}>{e.amount > 0 ? '+' : ''}{money(e.amount)}</strong>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="stack">
              <Card>
                <div style={{ textAlign: 'center' }}>
                  <h3>Your resilience score</h3>
                  <Gauge score={d.resilience.score} label={d.resilience.label} />
                  <p className="small muted" style={{ margin: '0 0 4px' }}>{d.resilience.next_best_step}</p>
                </div>
                <div className="divider" />
                <div className="grid grid-3" style={{ textAlign: 'center' }}>
                  <div><div className="tiny muted">Savings rate</div><strong className="num">{Math.round(d.resilience.savings_rate * 100)}%</strong></div>
                  <div><div className="tiny muted">Safety net</div><strong className="num">{d.resilience.emergency_fund_months} mo</strong></div>
                  <div><div className="tiny muted">Overdraft risk</div><strong className="num">{Math.round((d.forecast.summary.prob_overdraft['90d'] ?? 0) * 100)}%</strong></div>
                </div>
              </Card>

              <GoalsCard d={d} />
            </div>
          </div>
        ) : (
          <FutureTeaser d={d} spark={spark} six={six} />
        )}

        <div className="section">
          <div className="section-title"><h2>For you</h2><Link className="card-link" to="/assistant">All insights <ChevronRight size={16} /></Link></div>
          <div className="grid grid-2 collapse">
            {d.warnings.slice(0, 4).map((w) => <AlertCard key={w.id} w={w} />)}
          </div>
        </div>
      </div>
    </>
  )
}

function GoalsCard({ d }: { d: Dashboard }) {
  const goals = d.time_travel.goals
  return (
    <Card>
      <div className="card-title"><h3>Goals</h3><Link className="card-link" to="/profile">Manage <ChevronRight size={16} /></Link></div>
      {goals.length === 0 && <p className="small muted" style={{ margin: 0 }}>Add a goal and we'll show when future you gets there.</p>}
      <div className="stack" style={{ gap: 12 }}>
        {goals.map((g) => (
          <div key={g.id}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}><Target size={16} color="var(--primary)" /><strong>{g.name}</strong></span>
              <span className="num small">{money0(g.target_amount)}</span>
            </div>
            <div style={{ margin: '6px 0' }}><Progress value={g.saved_amount / g.target_amount} tone={g.on_track === false ? 'amber' : 'purple'} /></div>
            <div className="tiny muted">{g.message}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function FutureTeaser({ d, spark, six }: { d: Dashboard; spark: Dashboard['forecast']['daily']; six?: Dashboard['time_travel']['snapshots'][number] }) {
  return (
    <div className="grid grid-2 collapse">
      <Card>
        <div className="row" style={{ gap: 8 }}><Telescope size={18} color="var(--primary)" /><h3>Future you in 6 months</h3></div>
        {six && (
          <>
            <div className="tile-big num" style={{ marginTop: 10 }}>{money0(six.p50)}</div>
            <div className={`small ${six.change_vs_today >= 0 ? 'pos' : 'neg'}`}>{signed0(six.change_vs_today)} vs today</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Likely range {money0(six.p10)} – {money0(six.p90)}</div>
          </>
        )}
        <div style={{ height: 110, marginTop: 10 }}>
          <ResponsiveContainer>
            <AreaChart data={spark} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area type="monotone" dataKey="p50" stroke="var(--primary)" strokeWidth={2} fill="url(#spark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <Link to="/future" className="btn" style={{ width: '100%', marginTop: 8 }}>Travel to your future</Link>
      </Card>
      <div className="stack">
        {d.time_travel.smart_moves.slice(0, 3).map((m) => (
          <Card key={m.category}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <CategoryIcon category={m.category} boxed />
              <div style={{ flex: 1 }}>
                <div className="row between"><h3>{m.title}</h3><span className="badge green">{signed0(m.balance_gain_6m)}</span></div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>{m.message}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
