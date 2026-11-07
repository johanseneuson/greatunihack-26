import { Building2, Check, ChevronRight, FileUp, Moon, Plus, Sun, Target, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Card, PageHead, Sheet } from '../components/ui'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { fullDate, initials, money0 } from '../lib/format'
import type { Connector, Goal, ImportResult, User } from '../lib/types'

const CHALLENGES = [
  ['irregular_income', 'Irregular income'], ['debt', 'Paying off debt'], ['first_job', 'First job'],
  ['saving_for_deposit', 'Saving for a deposit'], ['new_baby', 'New baby'], ['irregular_spending', 'Spending is unpredictable'],
  ['home_renovation', 'Doing up my home'], ['student', 'Studying'],
] as const

type Theme = 'system' | 'light' | 'dark'
const applyTheme = (t: Theme) => {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem('fb.theme', t) } catch { /* ignore */ }
}

export default function Profile() {
  const { users, user, setUserId, refresh, reloadUsers } = useUser()
  const [sheet, setSheet] = useState<null | 'upload' | 'bank' | 'new'>(null)
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem('fb.theme') as Theme) || 'system' } catch { return 'system' } })

  return (
    <div className="page">
      <PageHead title="Profile & data" />
      <div className="grid grid-2 collapse" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card className="flush">
            <div className="list">
              <div className="list-row"><strong>Who's using Finance Buddy?</strong></div>
              {users.map((u) => (
                <button key={u.id} className="list-row" onClick={() => setUserId(u.id)}>
                  <span className="avatar">{initials(u.name)}</span>
                  <span className="grow"><div style={{ fontWeight: 600 }}>{u.name}</div><div className="tiny muted">{u.income_type} · {u.housing ?? 'housing not set'}</div></span>
                  {user?.id === u.id && <Check size={18} color="var(--primary)" />}
                </button>
              ))}
              <button className="list-row" onClick={() => setSheet('new')}>
                <span className="ico"><UserPlus size={18} /></span><span className="grow">Add a new person</span><ChevronRight size={18} className="chev" />
              </button>
            </div>
          </Card>

          <Card className="flush">
            <div className="list">
              <div className="list-row"><strong>Add your financial data</strong></div>
              <button className="list-row" onClick={() => setSheet('bank')}>
                <span className="ico"><Building2 size={18} /></span>
                <span className="grow"><div>Link a bank account</div><div className="tiny muted">Sandbox bank (demo data from Kaggle)</div></span>
                <ChevronRight size={18} className="chev" />
              </button>
              <button className="list-row" onClick={() => setSheet('upload')}>
                <span className="ico"><FileUp size={18} /></span>
                <span className="grow"><div>Upload a statement</div><div className="tiny muted">CSV from Monzo, Starling, Revolut, NatWest or any bank</div></span>
                <ChevronRight size={18} className="chev" />
              </button>
              {user && (
                <button className="list-row" onClick={async () => {
                  if (!confirm(`Delete all transactions and accounts for ${user.name}?`)) return
                  await api.clearData(user.id); await refresh()
                }}>
                  <span className="ico" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Trash2 size={18} /></span>
                  <span className="grow">Clear all transactions</span>
                </button>
              )}
            </div>
          </Card>

          {user && <Goals user={user} onChange={refresh} />}

          <Card>
            <h3>Appearance</h3>
            <div className="chips" style={{ marginTop: 10 }}>
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button key={t} className={`chip ${theme === t ? 'on' : ''}`} onClick={() => { setTheme(t); applyTheme(t) }}>
                  {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : null} {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {user && <Circumstances key={user.id} user={user} onSaved={refresh} />}
      </div>

      {sheet === 'upload' && user && <UploadSheet userId={user.id} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'bank' && user && <BankSheet userId={user.id} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'new' && (
        <NewUserSheet onClose={() => setSheet(null)} onCreated={async (u) => { await reloadUsers(); setUserId(u.id); setSheet('bank') }} />
      )}
    </div>
  )
}

function Circumstances({ user, onSaved }: { user: User; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<User>(user)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof User>(k: K, v: User[K]) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }
  const num = (v: string) => (v === '' ? null : Number(v))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { id, email, ...body } = form
    void email
    await api.updateUser(id, body)
    await onSaved()
    setSaving(false); setSaved(true)
  }

  return (
    <Card>
      <form className="stack" onSubmit={save}>
        <div>
          <h2>Your circumstances</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Everything here personalises your budget, safety buffer and warnings.</p>
        </div>
        <div className="grid grid-2">
          <label className="field">Name<input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
          <label className="field">Income type
            <select className="input" value={form.income_type} onChange={(e) => set('income_type', e.target.value as User['income_type'])}>
              <option value="salary">Regular salary</option><option value="irregular">Irregular / freelance</option>
              <option value="student">Student</option><option value="benefits">Benefits</option><option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="field">Monthly income (if not in your data)
            <input className="input" type="number" min={0} value={form.declared_monthly_income ?? ''} onChange={(e) => set('declared_monthly_income', num(e.target.value))} placeholder="e.g. 2400" />
          </label>
          <label className="field">Payday (day of month)
            <input className="input" type="number" min={1} max={31} value={form.income_day ?? ''} onChange={(e) => set('income_day', num(e.target.value))} placeholder="e.g. 25" />
          </label>
          <label className="field">Housing
            <select className="input" value={form.housing ?? ''} onChange={(e) => set('housing', (e.target.value || null) as User['housing'])}>
              <option value="">Prefer not to say</option><option value="rent">Renting</option><option value="mortgage">Mortgage</option>
              <option value="family">Living with family</option><option value="other">Other</option>
            </select>
          </label>
          <label className="field">People in household
            <input className="input" type="number" min={1} value={form.household_size} onChange={(e) => set('household_size', Number(e.target.value) || 1)} />
          </label>
          <label className="field">Dependents
            <input className="input" type="number" min={0} value={form.dependents} onChange={(e) => set('dependents', Number(e.target.value) || 0)} />
          </label>
          <label className="field">Current balance (optional)
            <input className="input" type="number" value={form.current_balance ?? ''} onChange={(e) => set('current_balance', num(e.target.value))} placeholder="From your data" />
          </label>
          <label className="field">Never go below (safety buffer)
            <input className="input" type="number" min={0} value={form.savings_buffer_target ?? ''} onChange={(e) => set('savings_buffer_target', num(e.target.value))} placeholder="We'll suggest one" />
          </label>
        </div>
        <div className="field">What's going on in your life?
          <div className="chips">
            {CHALLENGES.map(([k, label]) => {
              const on = form.challenges.includes(k)
              return <button type="button" key={k} className={`chip ${on ? 'on' : ''}`}
                onClick={() => set('challenges', on ? form.challenges.filter((c) => c !== k) : [...form.challenges, k])}>{label}</button>
            })}
          </div>
        </div>
        <label className="field">Anything else your coach should know?
          <textarea className="input" rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} maxLength={2000} />
        </label>
        <div className="row">
          <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save & update my future'}</button>
          {saved && <span className="small pos row" style={{ gap: 4 }}><Check size={16} /> Updated</span>}
        </div>
      </form>
    </Card>
  )
}

function Goals({ user, onChange }: { user: User; onChange: () => Promise<void> }) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const load = () => api.goals(user.id).then(setGoals)
  useEffect(() => { load() }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: FormEvent) => {
    e.preventDefault()
    await api.addGoal(user.id, { name, target_amount: Number(amount), target_date: date || null, saved_amount: 0 })
    setName(''); setAmount(''); setDate('')
    await load(); await onChange()
  }
  return (
    <Card>
      <h3>Goals</h3>
      <div className="stack" style={{ gap: 8, margin: '10px 0' }}>
        {goals.map((g) => (
          <div key={g.id} className="row between small">
            <span className="row" style={{ gap: 8 }}><Target size={16} color="var(--primary)" />{g.name} · {money0(g.target_amount)}{g.target_date ? ` by ${fullDate(g.target_date)}` : ''}</span>
            <button className="icon-btn" aria-label={`Delete ${g.name}`} onClick={async () => { await api.deleteGoal(user.id, g.id); await load(); await onChange() }}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <form className="row wrap" onSubmit={add}>
        <input className="input" style={{ flex: '2 1 140px' }} placeholder="New goal, e.g. Car" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input num" style={{ flex: '1 1 90px' }} type="number" min={1} placeholder="£" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <input className="input" style={{ flex: '1 1 140px' }} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Target date" />
        <button className="btn" aria-label="Add goal"><Plus size={16} /></button>
      </form>
    </Card>
  )
}

function ResultNote({ r }: { r: ImportResult }) {
  return (
    <div className="card" style={{ background: 'var(--success-soft)', border: 'none' }}>
      <strong className="pos">Imported {r.imported.toLocaleString()} transactions</strong>
      <div className="small">{r.duplicates_skipped > 0 && `${r.duplicates_skipped} duplicates skipped · `}{r.accounts.join(', ')}{r.date_from && ` · ${fullDate(r.date_from)} – ${fullDate(r.date_to!)}`}</div>
      {r.notes?.map((n) => <div key={n} className="tiny muted">{n}</div>)}
    </div>
  )
}

function UploadSheet({ userId, onClose, onDone }: { userId: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [account, setAccount] = useState('Main account')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    setBusy(true); setError(null)
    try { setResult(await api.upload(userId, file, account)); await onDone() } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Upload a statement" onClose={onClose}>
      <form className="stack" style={{ padding: 16 }} onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>Export a CSV from your banking app. We recognise dates, amounts, money in/out and categories automatically, and skip duplicates.</p>
        <label className="field">CSV file<input className="input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></label>
        <label className="field">Account name (if the file doesn't say)<input className="input" value={account} onChange={(e) => setAccount(e.target.value)} /></label>
        <button className="btn" disabled={!file || busy}>{busy ? 'Importing…' : 'Upload'}</button>
        {error && <div className="small neg">{error}</div>}
        {result && <ResultNote r={result} />}
      </form>
    </Sheet>
  )
}

function BankSheet({ userId, onClose, onDone }: { userId: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api.connectors().then(setConnectors).catch((e) => setError(e.message)) }, [])
  const link = async (id: string) => {
    setBusy(id); setError(null)
    try { setResult(await api.linkBank(userId, id)); await onDone() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <Sheet title="Link a bank" onClose={onClose}>
      <div className="list">
        {connectors.map((c) => (
          <button key={c.id} className="list-row" onClick={() => link(c.id)} disabled={!!busy}>
            <span className="ico"><Building2 size={18} /></span>
            <span className="grow"><div style={{ fontWeight: 600 }}>{c.name}</div><div className="tiny muted">{c.description}</div></span>
            {busy === c.id ? <span className="spinner" style={{ width: 20, height: 20 }} /> : <ChevronRight size={18} className="chev" />}
          </button>
        ))}
      </div>
      <div style={{ padding: 16 }}>
        {error && <div className="small neg">{error}</div>}
        {result && <ResultNote r={result} />}
        <p className="tiny muted">Real Open Banking providers plug into the same connector interface on the backend.</p>
      </div>
    </Sheet>
  )
}

function NewUserSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (u: User) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { onCreated(await api.createUser({ name })) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Add a person" onClose={onClose}>
      <form className="stack" style={{ padding: 16 }} onSubmit={submit}>
        <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></label>
        <button className="btn" disabled={busy}>Create &amp; add data</button>
      </form>
    </Sheet>
  )
}
