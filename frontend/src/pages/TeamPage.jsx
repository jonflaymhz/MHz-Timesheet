import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

function mondayOf(date) {
  const d = new Date(date)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}
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

  useEffect(() => {
    setLoading(true)
    api.get(`/team/outstanding?week_start=${weekStart}`).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [weekStart])

  return (
    <div className="page">
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Your team</h1>

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
