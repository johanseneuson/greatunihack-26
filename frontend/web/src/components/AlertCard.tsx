import { AlertTriangle, CheckCircle2, Info, Siren } from 'lucide-react'
import type { Warning } from '../lib/types'

const ICON = { critical: Siren, warning: AlertTriangle, info: Info, positive: CheckCircle2 }

export function AlertCard({ w, compact = false }: { w: Warning; compact?: boolean }) {
  const Icon = ICON[w.severity]
  return (
    <div className={`card alert ${w.severity}`}>
      <span className={`ico ${w.severity}`}><Icon size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <h3>{w.title}</h3>
          {w.probability != null && w.severity !== 'positive' && (
            <span className={`badge ${w.severity === 'critical' ? 'red' : 'amber'}`}>{Math.round(w.probability * 100)}% chance</span>
          )}
        </div>
        <p className="small muted" style={{ margin: '4px 0 0' }}>{w.message}</p>
        {!compact && w.action && <div className="action">{w.action}</div>}
        {!compact && w.upside && <div className="upside">✓ {w.upside}</div>}
      </div>
    </div>
  )
}
