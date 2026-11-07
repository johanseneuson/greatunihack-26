// Resilience dial - modelled on the credit-score gauge in the design kit.
import { resilienceColor } from '../lib/theme'

const START = 135 // degrees, measured clockwise from 12 o'clock is easier: we use standard math below
const SWEEP = 270

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from)
  const b = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}

export function Gauge({ score, label, size = 220 }: { score: number; label: string; size?: number }) {
  const cx = 110, cy = 110, r = 88
  const from = 360 - START // 225deg = bottom-left
  const value = Math.max(0, Math.min(100, score))
  const end = from + (SWEEP * value) / 100
  const tip = polar(cx, cy, r, end)
  const ticks = Array.from({ length: 28 }, (_, i) => from + (SWEEP * i) / 27)
  return (
    <svg viewBox="0 0 220 200" width={size} height={(size * 200) / 220} role="img" aria-label={`Resilience score ${score} out of 100, ${label}`}>
      <defs>
        <linearGradient id="gauge-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#d63b4a" />
          <stop offset="35%" stopColor="#f08a3c" />
          <stop offset="60%" stopColor="#f5c33a" />
          <stop offset="100%" stopColor="#2f9e5b" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const a = polar(cx, cy, r + 14, t)
        const b = polar(cx, cy, r + 18, t)
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" strokeWidth={2} strokeLinecap="round" />
      })}
      <path d={arc(cx, cy, r, from, from + SWEEP)} fill="none" stroke="var(--surface-2)" strokeWidth={16} strokeLinecap="round" />
      <path d={arc(cx, cy, r, from, Math.max(from + 0.5, end))} fill="none" stroke="url(#gauge-grad)" strokeWidth={16} strokeLinecap="round" />
      <circle cx={tip.x} cy={tip.y} r={9} fill="var(--surface)" stroke={resilienceColor(score)} strokeWidth={4} />
      <text x={cx} y={cy + 6} textAnchor="middle" fontSize="52" fontWeight="300" fill="var(--text)">{score}</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fontSize="17" fontWeight="600" fill={resilienceColor(score)}>{label}</text>
      <text x={cx - 62} y={cy + 86} textAnchor="middle" fontSize="11" fill="var(--text-muted)">0</text>
      <text x={cx + 62} y={cy + 86} textAnchor="middle" fontSize="11" fill="var(--text-muted)">100</text>
    </svg>
  )
}
