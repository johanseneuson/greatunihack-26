import { useState } from 'react'
import { AlertCard } from '../components/AlertCard'
import { ChatPanel } from '../components/ChatPanel'
import { SupportCard } from '../components/SupportCard'
import { PageHead, Segmented } from '../components/ui'
import type { Dashboard, Severity } from '../lib/types'

type Filter = 'all' | Severity

/** The chat is the page. Early warnings are tucked underneath for anyone who wants them. */
export default function Assistant({ d }: { d: Dashboard }) {
  const [filter, setFilter] = useState<Filter>('all')
  const warnings = d.warnings.filter((w) => filter === 'all' || w.severity === filter)
  return (
    <div className="page narrow">
      <PageHead title="Assistant" />
      <SupportCard />
      <ChatPanel tall />
      <details className="warn-fold">
        <summary>Early warnings &amp; insights ({d.warnings.length})</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <Segmented<Filter> value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'All' }, { value: 'critical', label: 'Urgent' },
            { value: 'warning', label: 'Heads up' }, { value: 'positive', label: 'Wins' },
          ]} />
          {warnings.length === 0 && <div className="muted small">Nothing here right now.</div>}
          {warnings.map((w) => <AlertCard key={w.id} w={w} />)}
        </div>
      </details>
    </div>
  )
}
