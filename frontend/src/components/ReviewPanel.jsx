import { useState } from 'react'
import { api } from '../lib/api.js'

// Approve / send back a submitted week (supervisor review, or Self-Approval
// v1.0). Behaviour unchanged by the employee redesign, restyled only.
export default function ReviewPanel({ week, approval, isSelfReview, onDone }) {
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocked = !approval.allowed

  async function approve() {
    setBusy(true); setError('')
    try {
      await api.post(`/weeks/${week.id}/approve`, { confirmed: true })
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function reject() {
    if (!rejectReason.trim()) return
    setBusy(true); setError('')
    try {
      await api.post(`/weeks/${week.id}/reject`, { reason: rejectReason.trim() })
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <section className="card" style={{ padding: 16, marginTop: 16 }} aria-label="Review this week">
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Review</h2>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {blocked && <div className="banner banner-warn">{approval.reason}</div>}
      {isSelfReview && (
        <div className="banner banner-info">
          This is your own timesheet. You're allowed to approve it yourself; it's recorded as a self-approval and Payroll can see it.
        </div>
      )}
      {approval.allowed && approval.path === 'admin' && (
        <p className="help" style={{ marginBottom: 8 }}>
          Approving as admin{approval.approver_name ? ` (normally ${approval.approver_name})` : ''}. The audit log records it as an admin approval.
        </p>
      )}
      {!showReject ? (
        <>
          {!blocked && (
            <label className="confirm" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={confirmApprove} onChange={e => setConfirmApprove(e.target.checked)} />
              <span>I've reviewed and confirm these hours as real.</span>
            </label>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={() => setShowReject(true)} disabled={busy || blocked}>Send back</button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={approve} disabled={busy || blocked || !confirmApprove}>Approve week</button>
          </div>
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="reject-reason" style={{ marginTop: 4 }}>Why are you sending it back?</label>
          <textarea id="reject-reason" className="input" value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowReject(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={reject} disabled={busy || !rejectReason.trim()}>Send back</button>
          </div>
        </>
      )}
    </section>
  )
}
