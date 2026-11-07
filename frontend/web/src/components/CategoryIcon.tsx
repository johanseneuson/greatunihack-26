import {
  ArrowLeftRight, Baby, Banknote, BookOpen, Car, CircleDashed, Clapperboard, Coffee, CreditCard, Gift, Hammer,
  HeartPulse, House, PiggyBank, Plane, Repeat, ShieldCheck, ShoppingBag, ShoppingBasket, Sparkles, Utensils, Wallet, Zap,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, [LucideIcon, string]> = {
  Income: [Wallet, 'var(--success)'],
  Housing: [House, 'var(--primary)'],
  'Bills & Utilities': [Zap, 'var(--ill-orange)'],
  Groceries: [ShoppingBasket, 'var(--ill-pink)'],
  Transport: [Car, 'var(--ill-blue)'],
  Insurance: [ShieldCheck, 'var(--secondary)'],
  Health: [HeartPulse, 'var(--ill-pink)'],
  Education: [BookOpen, 'var(--badge-blue)'],
  Childcare: [Baby, 'var(--ill-purple)'],
  'Debt repayment': [CreditCard, 'var(--danger)'],
  'Eating out': [Utensils, 'var(--ill-pink)'],
  'Coffee & snacks': [Coffee, 'var(--badge-plum)'],
  Shopping: [ShoppingBag, 'var(--ill-purple)'],
  Entertainment: [Clapperboard, 'var(--ill-orange)'],
  Subscriptions: [Repeat, 'var(--badge-blue)'],
  'Personal care': [Sparkles, 'var(--ill-purple)'],
  Home: [Hammer, 'var(--secondary)'],
  Travel: [Plane, 'var(--ill-blue)'],
  'Gifts & donations': [Gift, 'var(--ill-pink)'],
  Cash: [Banknote, 'var(--success)'],
  Savings: [PiggyBank, 'var(--success)'],
  Transfer: [ArrowLeftRight, 'var(--text-muted)'],
}

export const categoryColor = (category: string) => (ICONS[category] ?? [CircleDashed, 'var(--text-muted)'])[1]

export function CategoryIcon({ category, size = 18, boxed = false }: { category: string; size?: number; boxed?: boolean }) {
  const [Icon, color] = ICONS[category] ?? [CircleDashed, 'var(--text-muted)']
  if (!boxed) return <Icon size={size} color={color} aria-hidden />
  return (
    <span className="ico" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <Icon size={size} aria-hidden />
    </span>
  )
}
