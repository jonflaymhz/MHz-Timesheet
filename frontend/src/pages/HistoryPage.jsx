import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { fmtRange } from '../lib/dates.js'

// "Previous weeks" — one line each, e.g. "Wk 37, 8–12 Aug, 37 hrs,
// Approved" (Section 6). Tapping a row opens that week's full detail.
export default function HistoryPage() {
  const navigate = useNavigate()
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/weeks/history/mine').then(setWeeks).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/" className="btn btn-ghost btn-sm">← Back</Link>
        <h1 style={{ fontSize: 18 }}>Previous weeks</h1>
      </div>

      {loading ? <div style={{ color: 'var(--text3)' }}>Loading…</div> : (
        <div className="card">
          {weeks.map(w => (
            <div
              key={w.id}
              onClick={() => navigate(`/?week_start=${w.week_start_date}`)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Wk {w.week_number}, {fmtRange(w.week_start_date, w.week_end_date)}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>{Number(w.total_hours)} hrs</div>
              </div>
              <span className={`tag tag-${w.status}`}>{w.status}</span>
            </div>
          ))}
          {weeks.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No previous weeks yet.</div>}
        </div>
      )}
    </div>
  )
}
