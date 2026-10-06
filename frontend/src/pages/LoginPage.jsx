import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getKioskToken } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { useAutofocusOnVisible } from '../hooks/useAutofocusOnVisible.js'
import { groupForKiosk } from '../lib/kioskGroups.js'

// One login page for everyone (Admin Scope Section 3.1) — no separate
// admin/Jonny front door to find. Username is entered first; the account's
// tier (looked up via /auth/login-tier, which never reveals whether a
// username exists — unknown usernames get the same 'standard' answer as
// any real non-elevated account) decides whether a PIN field or a
// password+authenticator pair appears next. Kiosk mode skips the lookup
// entirely — the tile list only ever contains standard-tier accounts.
export default function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  // A browser registered as a kiosk (Admin > Kiosk devices) opens on the tiles.
  const isKioskDevice = !!getKioskToken()
  const [kioskMode, setKioskMode] = useState(isKioskDevice)
  const [kioskUsers, setKioskUsers] = useState([])
  const [kioskError, setKioskError] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedName, setSelectedName] = useState('')

  const [username, setUsername] = useState('')
  const [tier, setTier] = useState(null) // null (not yet looked up) | 'standard' | 'elevated'
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usernameRef = useRef(null)
  const pinRef = useRef(null)
  const passwordRef = useRef(null)

  useEffect(() => {
    if (kioskMode) {
      setKioskError('')
      api.get('/auth/kiosk-users').then(setKioskUsers).catch(e => { setKioskUsers([]); setKioskError(e.message) })
    }
  }, [kioskMode])

  async function continueFromUsername(e) {
    e.preventDefault()
    if (!username) return
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/login-tier', { username })
      setTier(result.tier)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function backToUsername() {
    setTier(null)
    setPin(''); setPassword(''); setTotpCode('')
    setError('')
  }

  async function submitStandard(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/login', {
        ...(kioskMode ? { user_id: selectedUserId } : { username }),
        pin,
        is_kiosk: kioskMode,
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

  const showCredentialStepForFocus = kioskMode ? !!selectedUserId : tier !== null
  useAutofocusOnVisible(usernameRef, !kioskMode && !showCredentialStepForFocus)
  useAutofocusOnVisible(pinRef, showCredentialStepForFocus && (kioskMode || tier === 'standard'))
  useAutofocusOnVisible(passwordRef, !kioskMode && showCredentialStepForFocus && tier === 'elevated')

  async function submitElevated(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/login-elevated', { username, password, totp_code: totpCode })
      await refresh()
      navigate(result.mfa_enrollment_required ? '/mfa-enroll' : '/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (kioskMode && !selectedUserId) {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <h1 style={{ textAlign: 'center', marginBottom: 6 }}>Who's this?</h1>
        <p style={{ textAlign: 'center', color: 'var(--text2)', marginBottom: 24 }}>Tap your name, then enter your PIN</p>
        {kioskError && <div className="banner banner-error" style={{ maxWidth: 480, margin: '0 auto 16px' }}>{kioskError}</div>}
        <div className="kiosk-groups">
          {groupForKiosk(kioskUsers).map(({ group, people }) => (
            <div key={group} className="kiosk-group">
              <div className="kiosk-group-title">{group}</div>
              {people.map(u => (
                <button key={u.id} className="name-tile" onClick={() => { setSelectedUserId(u.id); setSelectedName(u.full_name) }}>
                  <div className="name-tile-avatar">{(u.short_name || u.full_name).charAt(0)}</div>
                  {u.short_name || u.full_name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setKioskMode(false)}>Use my own device instead</button>
        </div>
      </div>
    )
  }

  // Kiosk mode always goes straight to the PIN step — tile selection already
  // identified a standard-tier account.
  const showCredentialStep = kioskMode ? !!selectedUserId : tier !== null

  return (
    <div className="page" style={{ paddingTop: 60, maxWidth: 380 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 30 }}>MHz Timesheets</h1>
      {kioskMode && selectedUserId && (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div className="name-tile-avatar" style={{ margin: '0 auto 10px' }}>{selectedName.charAt(0)}</div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{selectedName}</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSelectedUserId('')}>Not you?</button>
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {!kioskMode && !showCredentialStep && (
        <form onSubmit={continueFromUsername}>
          <input
            ref={usernameRef}
            className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)}
            style={{ marginBottom: 16 }} autoFocus
            autoCapitalize="none" autoCorrect="off" spellCheck="false"
          />
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || !username}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}

      {kioskMode && showCredentialStep && (
        <form onSubmit={submitStandard}>
          <input
            ref={pinRef}
            className="input" type="tel" inputMode="numeric" maxLength={6} placeholder="6-digit PIN"
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            style={{ marginBottom: 16, textAlign: 'center', fontSize: 24, letterSpacing: 6 }}
            autoFocus
          />
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || pin.length !== 6}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {!kioskMode && showCredentialStep && tier === 'standard' && (
        <form onSubmit={submitStandard}>
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
            {username} · <button type="button" className="btn btn-ghost btn-sm" style={{ display: 'inline', padding: 0 }} onClick={backToUsername}>not you?</button>
          </div>
          <input
            ref={pinRef}
            className="input" type="tel" inputMode="numeric" maxLength={6} placeholder="6-digit PIN"
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            style={{ marginBottom: 16, textAlign: 'center', fontSize: 24, letterSpacing: 6 }}
            autoFocus
          />
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || pin.length !== 6}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {!kioskMode && showCredentialStep && tier === 'elevated' && (
        <form onSubmit={submitElevated}>
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 13, color: 'var(--text2)' }}>
            {username} · <button type="button" className="btn btn-ghost btn-sm" style={{ display: 'inline', padding: 0 }} onClick={backToUsername}>not you?</button>
          </div>
          <input ref={passwordRef} className="input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
          <input
            className="input" inputMode="numeric" maxLength={6} placeholder="Authenticator code"
            value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
            style={{ marginBottom: 16, textAlign: 'center', fontSize: 20, letterSpacing: 4 }}
          />
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {!kioskMode && !showCredentialStep && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setKioskMode(true)}>Use shared factory kiosk instead</button>
        </div>
      )}
    </div>
  )
}
