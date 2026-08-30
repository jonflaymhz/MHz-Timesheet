import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import Shell from './components/Shell.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import MfaEnrollPage from './pages/MfaEnrollPage.jsx'
import WeekPage from './pages/WeekPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import TeamPage from './pages/TeamPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import { canApprove, isOverrideAuthority } from './lib/capabilities.js'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page" style={{ color: 'var(--text3)' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mfa_enrollment_required) return <Navigate to="/mfa-enroll" replace />
  return children
}

function RequireMfaEnrollment({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page" style={{ color: 'var(--text3)' }}>Loading…</div>
  if (!user) return <Navigate to="/admin-login" replace />
  if (!user.mfa_enrollment_required) return <Navigate to="/" replace />
  return children
}

function RequireCapability({ check, children }) {
  const { user } = useAuth()
  if (!check(user)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin-login" element={<AdminLoginPage />} />
        <Route path="/mfa-enroll" element={<RequireMfaEnrollment><MfaEnrollPage /></RequireMfaEnrollment>} />
        <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<WeekPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="team" element={<RequireCapability check={canApprove}><TeamPage /></RequireCapability>} />
          <Route path="admin" element={<RequireCapability check={isOverrideAuthority}><AdminPage /></RequireCapability>} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
