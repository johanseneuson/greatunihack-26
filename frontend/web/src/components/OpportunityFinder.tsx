import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, CircleHelp, ClipboardList, MessageCircleHeart, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApplySheet } from './ApplySheet'
import { useChat } from '../context/ChatContext'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { BOT_NAME } from '../lib/brand'
import type { EligibilityCheck, Opportunities, Opportunity } from '../lib/types'

const VISIBLE = 3

/** Financial Support & Opportunity Finder: Lydia proactively surfaces help the person may be missing. */
export function OpportunityFinder() {
  const { user, version } = useUser()
  const [data, setData] = useState<Opportunities | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (user) api.opportunities(user.id).then(setData).catch(() => setData(null))
  }, [user, version])

  if (!data || data.options.length === 0) return null
  const { summary, options } = data
  const shown = showAll ? options : options.slice(0, VISIBLE)

  return (
    <section className="card opp" aria-labelledby="opp-title">
      <div className="opp-head">
        <Sparkles size={20} className="opp-spark" />
        <h2 id="opp-title">{BOT_NAME} has found possible support</h2>
        <span className="badge purple">{summary.count}</span>
      </div>
      <p className="opp-intro">
        {summary.intro.split('.')[0]}.{' '}
        <span className="muted">These are signposts to check, not decisions - the organisation named decides.</span>
      </p>
      <div className="opp-list">
        {shown.map((o) => <OpportunityItem key={o.id} o={o} />)}
      </div>
      {options.length > VISIBLE && (
        <div className="opp-more">
          <button className="opp-more-btn" onClick={() => setShowAll((s) => !s)}
            aria-label={showAll ? 'Show fewer' : `Show ${options.length - VISIBLE} more`}>
            {showAll ? <ArrowUp size={20} /> : <ArrowDown size={20} />}
          </button>
          {!showAll && <span className="tiny muted">{options.length - VISIBLE} more: {[...new Set(options.slice(VISIBLE).map((o) => o.category_label))].join(', ')}</span>}
        </div>
      )}
    </section>
  )
}

function OpportunityItem({ o }: { o: Opportunity }) {
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const { ask } = useChat()
  const navigate = useNavigate()
  const askLydia = () => {
    navigate('/assistant')
    ask(`Tell me more about ${o.name}. Why might I be eligible and what should I do first?`)
  }
  return (
    <article className="opp-item">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <h3 className="opp-name">{o.name}</h3>
        <span className="badge teal" style={{ flexShrink: 0 }}>{o.category_label}</span>
      </div>
      <p className="opp-why">{o.why}</p>
      {o.value && <div className="opp-value">{o.value}</div>}
      <div className="opp-actions">
        {o.link && (
          <a className="opp-link" href={o.link} target="_blank" rel="noreferrer noopener">
            {o.link_label || 'Check your eligibility'} <ArrowUpRight size={14} />
          </a>
        )}
        {(o.steps.length > 0 || o.draft) && (
          <button className="opp-text-btn" onClick={() => setApplying(true)}><ClipboardList size={14} /> Apply</button>
        )}
        <button className="opp-text-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Eligibility checks <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </button>
        <button className="opp-text-btn" onClick={askLydia}><MessageCircleHeart size={14} /> Ask {BOT_NAME}</button>
      </div>
      {open && (
        <div className="opp-detail">
          <p className="small" style={{ margin: '0 0 8px' }}>{o.what}</p>
          <ul className="opp-checks">
            {o.checks.map((c) => <CheckRow key={c.label} c={c} />)}
          </ul>
          {o.check && <p className="tiny muted" style={{ margin: '8px 0 0' }}>{o.check}</p>}
        </div>
      )}
      {applying && <ApplySheet option={o} onClose={() => setApplying(false)} />}
    </article>
  )
}

function CheckRow({ c }: { c: EligibilityCheck }) {
  const Icon = c.status === 'met' ? Check : c.status === 'not_met' ? X : CircleHelp
  const hint = c.status === 'met' ? 'Looks met from your data' : c.status === 'not_met' ? 'Not met' : 'We can’t tell - please check'
  return (
    <li className={`opp-check ${c.status}`}>
      <Icon size={15} aria-label={hint} />
      <span>
        <strong>{c.label}</strong>
        {c.detail && <span className="muted"> - {c.detail}</span>}
        {c.status === 'unknown' && !c.detail && <span className="muted"> - please check</span>}
      </span>
    </li>
  )
}
