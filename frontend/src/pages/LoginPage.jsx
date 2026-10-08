import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { useAutofocusOnVisible } from '../hooks/useAutofocusOnVisible.js'
import { Backspace } from '../components/Icons.jsx'
import { firstName } from '../lib/week.js'

// Remembers who last signed in with a PIN on this phone, so next time it
// opens on "Welcome back" and the keypad. Only a username and first name.
const LAST_USER_KEY = 'mhz_ts_last_user'
function readLastUser() {
  try { const v = JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null'); return v?.username ? v : null } catch { return null }
}
function writeLastUser(v) {
  try { if (v) localStorage.setItem(LAST_USER_KEY, JSON.stringify(v)); else localStorage.removeItem(LAST_USER_KEY) } catch { /* private mode */ }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

// One sign-in page for everyone (Admin Scope §3.1). PIN accounts get the
// keypad (Employee UI Redesign v1.0 §7); Approval/Admin accounts keep
// password + authenticator. The kiosk name-tile sign-in is gone (§8).
export default function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const remembered = useRef(readLastUser()).current
  const [lastUser, setLastUser] = useState(remembered)
  const [step, setStep] = useState(remembered ? 'pin' : 'username') // 'username' | 'pin' | 'elevated'
  const [username, setUsername] = useState(remembered?.username || '')
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usernameRef = useRef(null)
  const passwordRef = useRef(null)

  useAutofocusOnVisible(usernameRef, step === 'username')
  useAutofocusOnVisible(passwordRef, step === 'elevated')

  async function continueFromUsername(e) {
    e.preventDefault()
    if (!username.trim()) return
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/login-tier', { username })
      setStep(result.tier === 'elevated' ? 'elevated' : 'pin')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function signInAsSomeoneElse() {
    writeLastUser(null)
    setLastUser(null)
    setUsername(''); setPin(''); setPassword(''); setTotpCode('')
    setError('')
    setStep('username')
  }

  async function submitPin(code) {
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/login', { username, pin: code })
      writeLastUser({ username: username.trim().toLowerCase(), first_name: firstName(result.full_name) })
      await refresh()
      navigate('/')
    } catch (err) {
      if (err.body?.tier === 'elevated') { setStep('elevated'); setError('') }
      else {
        const left = err.body?.attempts_remaining
        setError(left ? `${err.message}. ${left} ${left === 1 ? 'try' : 'tries'} left.` : err.message)
      }
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  const press = useCallback((k) => {
    if (loading) return
    if (k === 'del') { setPin(pin.slice(0, -1)); return }
    if (pin.length >= 6) return
    const next = pin + k
    setPin(next)
    if (next.length === 6) submitPin(next)
  }, [loading, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Typing on a keyboard works too.
  useEffect(() => {
    if (step !== 'pin') return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); press('del') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, press])

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

  const logo = <div className="signin-logo"><img src="/mhz_logo.svg" alt="MHz" /><span>Timesheet</span></div>

  if (step === 'pin') {
    const greet = lastUser?.username === username.trim().toLowerCase() && lastUser.first_name
    return (
      <main className="signin">
        {logo}
        <h1>{greet ? `Welcome back, ${greet}` : 'Welcome'}</h1>
        <p className="signin-sub">{greet ? 'Enter your 6-digit PIN' : `Enter the 6-digit PIN for ${username.trim()}`}</p>
        <div className="pin-dots" role="img" aria-label={`${pin.length} of 6 digits entered`}>
          {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        <div aria-live="assertive" style={{ minHeight: 44, textAlign: 'center' }}>
          {loading ? <span style={{ color: 'var(--muted)' }}>Signing in…</span> : error && <div className="banner banner-error" style={{ margin: '6px 0 0' }}>{error}</div>}
        </div>
        <div className="keypad">
          {KEYS.map((k, i) => k === ''
            ? <span key={i} className="blank" aria-hidden="true" />
            : k === 'del'
              ? <button key={i} type="button" aria-label="Delete" onClick={() => press('del')} disabled={loading || !pin.length}><Backspace /></button>
              : <button key={i} type="button" onClick={() => press(k)} disabled={loading}>{k}</button>
          )}
        </div>
        <div className="signin-links">
          <button type="button" className="btn-link" onClick={signInAsSomeoneElse}>Not you? Sign in as someone else</button>
          <span>Forgotten PIN? Ask the office</span>
        </div>
      </main>
    )
  }

  return (
    <main className="signin">
      {logo}
      <h1>Sign in</h1>
      {error && <div className="banner banner-error" role="alert" style={{ marginTop: 18 }}>{error}</div>}

      {step === 'username' && (
        <form onSubmit={continueFromUsername} style={{ marginTop: 20 }}>
          <label className="field-label" htmlFor="username" style={{ marginTop: 0 }}>Username</label>
          <input
            id="username" ref={usernameRef} className="input" value={username} onChange={e => setUsername(e.target.value)}
            autoFocus autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="username"
          />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={loading || !username.trim()}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
          <div className="signin-links"><span>Forgotten your username? Ask the office</span></div>
        </form>
      )}

      {step === 'elevated' && (
        <form onSubmit={submitElevated} style={{ marginTop: 20 }}>
          <p className="signin-sub" style={{ marginBottom: 10 }}>{username.trim()}</p>
          <label className="field-label" htmlFor="password" style={{ marginTop: 0 }}>Password</label>
          <input id="password" ref={passwordRef} className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          <label className="field-label" htmlFor="totp">Authenticator code</label>
          <input
            id="totp" className="input mono" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
            value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
            style={{ textAlign: 'center', fontSize: 20, letterSpacing: 4 }}
          />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="signin-links">
            <button type="button" className="btn-link" onClick={signInAsSomeoneElse}>Not you? Sign in as someone else</button>
          </div>
        </form>
      )}
    </main>
  )
}
