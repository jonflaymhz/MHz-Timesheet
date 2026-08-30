import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'

// First-login enrollment for an elevated-tier account with no MFA set up
// yet (admin scope Section 4.2). Reached only via a pending-enrollment
// session created by /auth/login-elevated — see App.jsx's
// RequireMfaEnrollment guard.
export default function MfaEnrollPage() {
  const { refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [enroll, setEnroll] = useState(null) // { otpauth_url, manual_entry_key, qr_code_data_url }
  const [totpCode, setTotpCode] = useState('')
  const [backupCodes, setBackupCodes] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.post('/auth/mfa/enroll/start').then(setEnroll).catch(e => setError(e.message))
  }, [])

  async function confirm(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const result = await api.post('/auth/mfa/enroll/confirm', { totp_code: totpCode })
      setBackupCodes(result.backup_codes)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function finish() {
    await refresh()
    navigate('/')
  }

  async function cancel() {
    await logout()
    navigate('/login')
  }

  if (backupCodes) {
    return (
      <div className="page" style={{ paddingTop: 60, maxWidth: 420 }}>
        <h1 style={{ textAlign: 'center', marginBottom: 6 }}>Save your backup codes</h1>
        <p style={{ textAlign: 'center', color: 'var(--text2)', marginBottom: 20, fontSize: 13 }}>
          Each code works once, if you ever lose access to your authenticator app. Store them somewhere safe —
          they won't be shown again.
        </p>
        <div className="card" style={{ padding: 16, marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: 'monospace', textAlign: 'center' }}>
          {backupCodes.map(c => <div key={c}>{c}</div>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13 }}>
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
          I've saved these somewhere safe
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={!saved} onClick={finish}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingTop: 60, maxWidth: 380 }}>
      <h1 style={{ textAlign: 'center', marginBottom: 6 }}>Set up your authenticator</h1>
      <p style={{ textAlign: 'center', color: 'var(--text2)', marginBottom: 24, fontSize: 13 }}>
        Scan this with an authenticator app (Google Authenticator, 1Password, Authy…)
      </p>
      {error && <div className="banner banner-error">{error}</div>}
      {enroll && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img src={enroll.qr_code_data_url} alt="MFA enrollment QR code" style={{ width: 200, height: 200 }} />
          </div>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Can't scan? Enter this manually:</div>
            <div className="card" style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 14, display: 'inline-block' }}>{enroll.manual_entry_key}</div>
          </div>
          <form onSubmit={confirm}>
            <input
              className="input" inputMode="numeric" maxLength={6} placeholder="6-digit code from the app"
              value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              style={{ marginBottom: 16, textAlign: 'center', fontSize: 20, letterSpacing: 4 }}
              autoFocus
            />
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || totpCode.length !== 6}>
              {loading ? 'Confirming…' : 'Confirm'}
            </button>
          </form>
        </>
      )}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={cancel}>Cancel and sign out</button>
      </div>
    </div>
  )
}
