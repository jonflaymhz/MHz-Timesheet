import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'

// Standard tier: username + 6-digit PIN (Section 3). Kiosk mode swaps the
// username field for a name-tile grid — tapping a tile only identifies who
// you are, a PIN is still required next (confirmed policy, not a shortcut).
export default function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [kioskMode, setKioskMode] = useState(false)
  const [kioskUsers, setKioskUsers] = useState([])
  const [selectedUsername, setSelectedUsername] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (kioskMode) {
      api.get('/auth/kiosk-users').then(setKioskUsers).catch(() => {})
    }
  }, [kioskMode])

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/login', {
        username: kioskMode ? selectedUsername : username,
        pin,
        is_kiosk: kioskMode,
        device_label: kioskMode ? 'Factory kiosk' : undefined,
      })
      await refresh()
      navigate('/')
    } catch (err) {
      setError(err.message)
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  if (kioskMode && !selectedUsername) {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <h1 style={{ textAlign: 'center', marginBottom: 6 }}>Who's this?</h1>
        <p style={{ textAlign: 'center', color: 'var(--text2)', marginBottom: 24 }}>Tap your name, then enter your PIN</p>
        <div className="tile-grid">
          {kioskUsers.map(u => (
            <button key={u.id} className="name-tile" onClick={() => { setSelectedUsername(u.username); setSelectedName(u.full_name) }}>
              <div className="name-tile-avatar">{u.full_name.charAt(0)}</div>
              {u.full_name}
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setKioskMode(false)}>Use my own device instead</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingTop: 60, maxWidth: 380 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 30 }}>MHz Timesheets</h1>
      {kioskMode && selectedUsername && (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div className="name-tile-avatar" style={{ margin: '0 auto 10px' }}>{selectedName.charAt(0)}</div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{selectedName}</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSelectedUsername('')}>Not you?</button>
        </div>
      )}
      <form onSubmit={submit}>
        {error && <div className="banner banner-error">{error}</div>}
        {!kioskMode && (
          <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
        )}
        <input
          className="input" type="tel" inputMode="numeric" maxLength={6} placeholder="6-digit PIN"
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          style={{ marginBottom: 16, textAlign: 'center', fontSize: 24, letterSpacing: 6 }}
          autoFocus={kioskMode}
        />
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || pin.length !== 6 || (!kioskMode && !username)}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!kioskMode && <button className="btn btn-ghost btn-sm" onClick={() => setKioskMode(true)}>Use shared factory kiosk instead</button>}
        <Link to="/admin-login" style={{ fontSize: 13, color: 'var(--text3)' }}>Admin / Jonny sign-in</Link>
      </div>
    </div>
  )
}
