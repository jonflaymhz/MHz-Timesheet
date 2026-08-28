import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import Shell from './components/Shell.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import WeekPage from './pages/WeekPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import TeamPage from './pages/TeamPage.jsx'
import AdminPage from './pages/AdminPage.jsx'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page" style={{ color: 'var(--text3)' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin-login" element={<AdminLoginPage />} />
        <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<WeekPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="team" element={<RequireRole roles={['supervisor', 'admin', 'jonny']}><TeamPage /></RequireRole>} />
          <Route path="admin" element={<RequireRole roles={['admin', 'jonny']}><AdminPage /></RequireRole>} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
