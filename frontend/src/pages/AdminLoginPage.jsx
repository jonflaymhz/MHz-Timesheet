import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'

// Admin/Jonny tier: username + password + TOTP (Section 3) — "same
// standard as the rest of QW", since this tier can edit locked data.
export default function AdminLoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/admin-login', { username, password, totp_code: totpCode })
      await refresh()
      navigate(result.mfa_enrollment_required ? '/mfa-enroll' : '/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ paddingTop: 60, maxWidth: 380 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 6 }}>Admin / Jonny sign-in</h1>
      <p style={{ textAlign: 'center', color: 'var(--text2)', marginBottom: 24, fontSize: 13 }}>Full authentication required for this tier</p>
      <form onSubmit={submit}>
        {error && <div className="banner banner-error">{error}</div>}
        <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
        <input className="input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 12 }} />
        <input
          className="input" inputMode="numeric" maxLength={6} placeholder="Authenticator code"
          value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
          style={{ marginBottom: 16, textAlign: 'center', fontSize: 20, letterSpacing: 4 }}
        />
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Link to="/login" style={{ fontSize: 13, color: 'var(--text3)' }}>← Standard sign-in</Link>
      </div>
    </div>
  )
}
