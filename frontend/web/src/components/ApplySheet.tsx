import { Check, Copy, ExternalLink, Mail } from 'lucide-react'
import { useState } from 'react'
import type { SupportOption } from '../lib/types'
import { Sheet } from './ui'

/** "Apply" for a support scheme: what to do, the official page, and a message that is ready to send. */
export function ApplySheet({ option, onClose }: { option: SupportOption; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const draft = option.draft
  const subject = /^Subject: (.*)$/m.exec(draft)?.[1] ?? option.name
  const body = draft.replace(/^Subject: .*\n\n/, '')
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }
  return (
    <Sheet title={`Apply: ${option.name}`} onClose={onClose}>
      <div className="stack" style={{ padding: '4px 16px 18px' }}>
        <p className="small muted" style={{ margin: 0 }}>{option.why}</p>
        <ol className="apply-steps">{option.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {draft && (
          <div>
            <div className="tiny muted" style={{ fontWeight: 700, marginBottom: 6 }}>MESSAGE READY TO SEND (add the right names and check it first)</div>
            <textarea className="input" readOnly rows={9} value={draft} aria-label="Drafted message" />
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn secondary" onClick={copy}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}</button>
              <a className="btn secondary" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}><Mail size={16} /> Open in email</a>
            </div>
          </div>
        )}
        <a className="btn" href={option.apply_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={16} /> Open the official page</a>
        {option.check && <p className="tiny muted" style={{ margin: 0 }}>{option.check}</p>}
        <p className="tiny muted" style={{ margin: 0 }}>We never send anything for you. The organisation decides who qualifies.</p>
      </div>
    </Sheet>
  )
}
