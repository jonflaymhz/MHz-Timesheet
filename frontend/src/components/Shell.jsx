import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'

export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const showTeamTab = ['supervisor', 'admin', 'jonny'].includes(user?.role)
  const showAdminTab = ['admin', 'jonny'].includes(user?.role)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const isActive = (path) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path))

  return (
    <div>
      <div className="topbar">
        <span className="topbar-brand">MHz Timesheets</span>
        <div className="topbar-user">
          <span>{user?.full_name}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign out</button>
        </div>
      </div>
      {(showTeamTab || showAdminTab) && (
        <div className="tabbar">
          <Link to="/" className={`tab ${isActive('/') && !isActive('/team') && !isActive('/admin') ? 'active' : ''}`}>My week</Link>
          {showTeamTab && <Link to="/team" className={`tab ${isActive('/team') ? 'active' : ''}`}>Team</Link>}
          {showAdminTab && <Link to="/admin" className={`tab ${isActive('/admin') ? 'active' : ''}`}>Admin</Link>}
        </div>
      )}
      <Outlet />
    </div>
  )
}
