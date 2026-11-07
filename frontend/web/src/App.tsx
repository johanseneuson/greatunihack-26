import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ErrorState, Loading } from './components/ui'
import { UserProvider, useUser } from './context/UserContext'
import type { Dashboard } from './lib/types'

// Pages are code-split so the first screen loads fast (charts are heavy).
const Home = lazy(() => import('./pages/Home'))
const Spending = lazy(() => import('./pages/Spending'))
const Waves = lazy(() => import('./pages/Waves'))
const Future = lazy(() => import('./pages/Future'))
const Coach = lazy(() => import('./pages/Coach'))
const Profile = lazy(() => import('./pages/Profile'))

/** Renders a page once the dashboard is loaded; handles loading, errors and users with no data yet. */
function WithData({ page: Page }: { page: ComponentType<{ d: Dashboard }> }) {
  const { dashboard, loading, error, refresh, user, users } = useUser()
  if (error) return <ErrorState message={error} onRetry={refresh} />
  if (!users.length && !loading) return <ErrorState message="No users yet - create one in Profile & data." />
  if (!dashboard || (loading && dashboard.overview.user.id !== user?.id)) return <Loading />
  if (dashboard.empty) {
    return (
      <div className="center">
        <div className="card stack" style={{ maxWidth: 420, alignItems: 'center' }}>
          <h2>Let's see your future</h2>
          <p className="muted" style={{ margin: 0 }}>Link a bank or upload a statement and we'll forecast your next 12 months.</p>
          <Link className="btn" to="/profile">Add my data</Link>
        </div>
      </div>
    )
  }
  return <Suspense fallback={<Loading />}><Page d={dashboard} /></Suspense>
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<WithData page={Home} />} />
            <Route path="spending" element={<WithData page={Spending} />} />
            <Route path="waves" element={<WithData page={Waves} />} />
            <Route path="future" element={<WithData page={Future} />} />
            <Route path="coach" element={<WithData page={Coach} />} />
            <Route path="profile" element={<Suspense fallback={<Loading />}><Profile /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </UserProvider>
    </BrowserRouter>
  )
}
