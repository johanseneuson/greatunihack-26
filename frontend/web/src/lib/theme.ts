// Shared design tokens (same values as src/styles/tokens.css) - for charts on web and for the Expo app later.
export const palette = {
  primary: '#5e10b1',
  primaryStrong: '#3c1053',
  secondary: '#3c7b8a',
  illBlue: '#5b8ae6',
  illPurple: '#8e4fc0',
  illOrange: '#f5a83a',
  illPink: '#ec737f',
  badgePink: '#f9dcdc',
  badgePlum: '#8a3c7c',
  badgeBlue: '#3a5cc4',
  success: '#1f8a4c',
  danger: '#c8313d',
  bg: '#f2f1f7',
  surface: '#ffffff',
  text: '#1d1a22',
  textMuted: '#6b6573',
} as const

// Chart colours read CSS variables so they follow light/dark mode on web.
export const chart = {
  primary: 'var(--primary)',
  light: 'var(--chart-light)',
  strong: 'var(--chart-strong)',
  pink: 'var(--ill-pink)',
  orange: 'var(--ill-orange)',
  purple: 'var(--ill-purple)',
  teal: 'var(--secondary)',
  danger: 'var(--danger)',
  success: 'var(--success)',
  muted: 'var(--text-muted)',
  border: 'var(--border)',
}

export const resilienceColor = (score: number) =>
  score >= 80 ? 'var(--success)' : score >= 60 ? '#7fb24a' : score >= 40 ? 'var(--ill-orange)' : 'var(--danger)'
