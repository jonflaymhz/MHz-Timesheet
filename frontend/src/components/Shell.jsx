import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useLocation, Link, NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import { canApprove, isOverrideAuthority } from '../lib/capabilities.js'
import { initials } from '../lib/week.js'
import { CalendarWeek, Clock, People, Cog } from './Icons.jsx'

// Header with logo, nav and account avatar; on a phone a bottom tab bar
// instead of the header nav (Employee UI Redesign v1.0 §1, §2, §5). Team
// and Admin stay reachable for the people who have them.
export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const desktop = useIsDesktop()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const showTeam = canApprove(user)
  const showAdmin = isOverrideAuthority(user)

  useEffect(() => { setMenuOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // "This week" is the week view, including someone else's week opened from Team.
  const weekActive = location.pathname === '/' && !new URLSearchParams(location.search).get('for')
  const tabs = [
    { to: '/', label: 'This week', icon: CalendarWeek, active: weekActive },
    { to: '/history', label: 'History', icon: Clock, active: location.pathname.startsWith('/history') },
    ...(showTeam ? [{ to: '/team', label: 'Team', icon: People, active: location.pathname.startsWith('/team') || (location.pathname === '/' && !weekActive) }] : []),
    ...(showAdmin ? [{ to: '/admin', label: 'Admin', icon: Cog, active: location.pathname.startsWith('/admin') }] : []),
  ]

  return (
    <div className={desktop ? '' : 'has-tabbar'}>
      <header className="topbar">
        <Link to="/" className="brand"><img src="/mhz_logo.svg" alt="MHz" /><span>Timesheet</span></Link>
        {desktop && (
          <nav className="topnav" aria-label="Main">
            {tabs.map(t => <NavLink key={t.to} to={t.to} className={t.active ? 'active' : ''} end>{t.label}</NavLink>)}
          </nav>
        )}
        <div className="topbar-right" ref={menuRef}>
          {desktop && <span className="topbar-name">{user?.full_name}</span>}
          <button type="button" className="avatar-btn" aria-label="Account" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
            <span className="avatar">{initials(user?.full_name)}</span>
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <div className="menu-head"><strong>{user?.full_name}</strong>{user?.username}</div>
              <button type="button" role="menuitem" onClick={handleLogout}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <Outlet />
      {!desktop && (
        <nav className="tabbar-bottom" aria-label="Main">
          {tabs.map(t => (
            <Link key={t.to} to={t.to} className={t.active ? 'active' : ''} aria-current={t.active ? 'page' : undefined}>
              <t.icon />{t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
