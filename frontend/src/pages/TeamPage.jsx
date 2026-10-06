import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { mondayOf } from '../lib/dates.js'

function lastCompletedWeekStart() {
  const m = new Date(mondayOf(new Date()))
  m.setUTCDate(m.getUTCDate() - 7)
  return m.toISOString().slice(0, 10)
}

// Supervisor's Monday-morning routine: who on my team hasn't submitted yet
// for a given week (Section 6), plus a way to enter a full week on behalf
// of someone who can't use the system themselves (proxy entry).
export default function TeamPage() {
  const [weekStart, setWeekStart] = useState(lastCompletedWeekStart())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [awaiting, setAwaiting] = useState([])

  useEffect(() => {
    api.get('/team/awaiting-approval').then(setAwaiting).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get(`/team/outstanding?week_start=${weekStart}`).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [weekStart])

  return (
    <div className="page">
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Your team</h1>

      {/* Working Cost Codes v1.1 §2.9: every submitted week this person is
          the resolved approver for, across weeks and beyond direct reports. */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Waiting for your approval
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        {awaiting.map(w => (
          <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {w.full_name}
                {w.path === 'self' && <span className="tag tag-submitted" style={{ marginLeft: 8 }}>Your timesheet</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                Week {w.week_number} · {Number(w.total_hours)}h{w.path === 'admin' ? ' · no approver in chain, admin fallback' : ''}
                {w.entered_by_me && <span style={{ color: 'var(--amber)', fontWeight: 600 }}> · you entered hours, another approver is needed</span>}
              </div>
            </div>
            <Link to={w.path === 'self' ? `/?week_start=${String(w.week_start_date).slice(0, 10)}` : `/?for=${w.user_id}&week_start=${String(w.week_start_date).slice(0, 10)}`} className="btn btn-ghost btn-sm">Review</Link>
          </div>
        ))}
        {awaiting.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>Nothing waiting.</div>}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Team by week
      </div>

      <input
        type="date" className="input" value={weekStart}
        onChange={e => setWeekStart(mondayOf(e.target.value))}
        style={{ marginBottom: 16 }}
      />

      {loading ? <div style={{ color: 'var(--text3)' }}>Loading…</div> : (
        <div className="card">
          {(data?.all || []).map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600 }}>{p.full_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`tag ${p.status ? `tag-${p.status}` : ''}`} style={!p.status ? { background: 'var(--status-bad-bg)', color: 'var(--status-bad-text)' } : undefined}>
                  {p.status || 'not started'}
                </span>
                <Link to={`/?for=${p.id}&week_start=${weekStart}`} className="btn btn-ghost btn-sm">
                  {p.status === 'submitted' ? 'Review' : 'Open'}
                </Link>
              </div>
            </div>
          ))}
          {(data?.all || []).length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No reports assigned to you.</div>}
        </div>
      )}
    </div>
  )
}
