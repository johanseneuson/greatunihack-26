import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`card ${className}`} onClick={onClick} role={onClick ? 'button' : undefined}>{children}</div>
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Progress({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'pink' | 'green' | 'amber' | 'purple' }) {
  return <div className={`bar ${tone}`}><span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'purple' }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value num ${tone ?? ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />
}

export function Loading({ label = 'Crunching your numbers…' }: { label?: string }) {
  return (
    <div className="center">
      <div className="stack" style={{ alignItems: 'center' }}>
        <Spinner />
        <span className="muted small">{label}</span>
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="center">
      <div className="card stack" style={{ maxWidth: 440, alignItems: 'center' }}>
        <h2>Something's not connected</h2>
        <p className="muted" style={{ margin: 0 }}>{message}</p>
        <code className="small muted">cd backend &amp;&amp; uvicorn app.main:app --reload</code>
        {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Rendered on <body> so it is never styled by whatever opened it (for example the dark call screen).
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function PageHead({ title, right, left }: { title: string; right?: ReactNode; left?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ width: 40 }} className="mobile-only">{left}</div>
      <h1 className="title">{title}</h1>
      <div style={{ minWidth: 40, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  )
}
