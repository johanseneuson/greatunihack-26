const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })

/** £1,760.50 */
export const money = (n: number) => gbp.format(n)
/** £1,761 */
export const money0 = (n: number) => gbp0.format(n)
/** +£120 / -£45 */
export const signed0 = (n: number) => `${n >= 0 ? '+' : '-'}${gbp0.format(Math.abs(n))}`
/** £1.2k for chart axes */
export const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `${n < 0 ? '-' : ''}£${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `${n < 0 ? '-' : ''}£${Math.abs(Math.round(n))}`
export const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`

const d = (iso: string) => new Date(iso.length === 7 ? `${iso}-01T00:00:00` : `${iso}T00:00:00`)
/** 18 Nov */
export const dayMonth = (iso: string) => d(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
/** 18 Nov 2026 */
export const fullDate = (iso: string) => d(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
/** Nov / November 2026 */
export const monthShort = (iso: string) => d(iso).toLocaleDateString('en-GB', { month: 'short' })
export const monthLong = (iso: string) => d(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export const greeting = (date = new Date()) => {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
export const firstName = (name: string) => name.split(' ')[0]
export const initials = (name: string) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

/** One tick per month: the first data point of each calendar month (avoids "Nov Nov Dec Dec" axes). */
export function monthTicks<T>(data: T[], key: keyof T, every = 1): string[] {
  const out: string[] = []
  let last = ''
  data.forEach((p) => {
    const v = String(p[key])
    const ym = v.slice(0, 7)
    if (ym !== last) { last = ym; out.push(v) }
  })
  return out.filter((_, i) => i % every === 0)
}
