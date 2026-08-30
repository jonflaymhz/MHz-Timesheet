import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'
import DayCard from '../components/DayCard.jsx'
import { fmtRange, dayOfMonth, weekdayName } from '../lib/dates.js'
import { canApprove } from '../lib/capabilities.js'

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function WeekPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const forUserId = searchParams.get('for')
  const weekStartParam = searchParams.get('week_start')

  const [week, setWeek] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(null)
    try {
      const path = forUserId
        ? `/weeks/for/${forUserId}${weekStartParam ? `?week_start=${weekStartParam}` : ''}`
        : `/weeks/mine${weekStartParam ? `?week_start=${weekStartParam}` : ''}`
      const data = await api.get(path)
      setWeek(data.week)
      setEntries(data.entries)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [forUserId, weekStartParam])

  useEffect(() => { load() }, [load])

  function goToWeek(startDate) {
    const next = new URLSearchParams(searchParams)
    next.set('week_start', startDate)
    setSearchParams(next)
  }

  async function submit() {
    setSubmitting(true); setError(''); setMissing(null)
    try {
      await api.post(`/weeks/${week.id}/submit`)
      load()
    } catch (err) {
      if (err.body?.missing_dates) setMissing(err.body.missing_dates)
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function approve() {
    setReviewing(true); setError('')
    try {
      await api.post(`/weeks/${week.id}/approve`)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setReviewing(false)
    }
  }

  async function reject() {
    if (!rejectReason.trim()) return
    setReviewing(true); setError('')
    try {
      await api.post(`/weeks/${week.id}/reject`, { reason: rejectReason.trim() })
      setShowReject(false); setRejectReason('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setReviewing(false)
    }
  }

  if (loading) return <div className="page" style={{ color: 'var(--text3)' }}>Loading…</div>
  if (error && !week) return <div className="page"><div className="banner banner-error">{error}</div></div>
  if (!week) return null

  const editable = week.status === 'draft' || week.status === 'rejected'
  const weekTotal = entries.reduce((s, e) => s + Number(e.hours), 0)
  const isProxyView = forUserId && forUserId !== user?.id
  const canReview = isProxyView && week.status === 'submitted' && canApprove(user)

  return (
    <div className="page">
      {isProxyView && (
        <div className="banner banner-warn">Entering on behalf of a teammate — this week will show as proxy-entered.</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => goToWeek(addDays(week.week_start_date, -7))}>← Prev</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Week {week.week_number}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>{fmtRange(week.week_start_date, week.week_end_date)}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => goToWeek(addDays(week.week_start_date, 7))}>Next →</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span className={`tag tag-${week.status}`}>{week.status}</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{weekTotal} hrs total</span>
      </div>

      {week.status === 'rejected' && week.rejection_reason && (
        <div className="banner banner-warn">Sent back: {week.rejection_reason}</div>
      )}
      {error && <div className="banner banner-error">{error}{missing && <div style={{ marginTop: 6 }}>Missing: {missing.join(', ')}</div>}</div>}

      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(week.week_start_date, i)
        return (
          <DayCard
            key={date}
            date={date}
            label={`${weekdayName(date)} ${dayOfMonth(date)}`}
            entries={entries.filter(e => e.entry_date === date)}
            weekId={week.id}
            department={user?.department}
            editable={editable}
            weekOwnerId={week.user_id}
            onRefresh={load}
          />
        )
      })}

      {editable && (
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit week for approval'}
        </button>
      )}

      {canReview && !showReject && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => setShowReject(true)} disabled={reviewing}>Reject</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={approve} disabled={reviewing}>Approve week</button>
        </div>
      )}
      {canReview && showReject && (
        <div className="card" style={{ padding: 16, marginTop: 8 }}>
          <textarea className="input" placeholder="Reason for sending this back…" value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ marginBottom: 10, minHeight: 60 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowReject(false)}>Cancel</button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={reject} disabled={reviewing || !rejectReason.trim()}>Send back</button>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Link to="/history" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>Previous weeks →</Link>
      </div>
    </div>
  )
}
