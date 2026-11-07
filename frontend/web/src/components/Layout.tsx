import { ChartNoAxesColumn, House, MessageCircleHeart, Settings, Telescope, Waves } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { initials } from '../lib/format'

export const NAV = [
  { to: '/', label: 'Home', icon: House },
  { to: '/spending', label: 'Spending', icon: ChartNoAxesColumn },
  { to: '/waves', label: 'Waves', icon: Waves },
  { to: '/future', label: 'Future', icon: Telescope },
  { to: '/coach', label: 'Coach', icon: MessageCircleHeart },
]

export function Logo({ size = 34 }: { size?: number }) {
  return <img src="/natwest.svg" alt="NatWest" className="brand-mark" style={{ width: size, height: size }} />
}

export function Layout() {
  const { user } = useUser()
  const navigate = useNavigate()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo /> Finance Buddy</div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <NavLink to="/profile" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
          <Settings size={20} /> Profile &amp; data
        </NavLink>
        <div className="spacer" />
        {user && (
          <button className="user-chip" onClick={() => navigate('/profile')}>
            <span className="avatar">{initials(user.name)}</span>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{user.name}</div>
              <div className="tiny muted">Switch user or add data</div>
            </span>
          </button>
        )}
      </aside>
      <main className="content">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
