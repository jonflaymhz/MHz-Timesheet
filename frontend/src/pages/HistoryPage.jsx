import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { fmtRangeWords } from '../lib/dates.js'
import { fmtH, STATUS_LABEL } from '../lib/week.js'
import { ChevronRight } from '../components/Icons.jsx'

// Past weeks, newest first (Employee UI Redesign v1.0 §7). Tapping one
// opens it in its own state: editable when Draft or Sent back, read-only
// when Submitted or Approved.
export default function HistoryPage() {
  const navigate = useNavigate()
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/weeks/history/mine').then(setWeeks).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  return (
    <div className="page">
      <h1 style={{ fontSize: 20, marginBottom: 14 }}>History</h1>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? <div style={{ color: 'var(--muted)' }}>Loading…</div> : (
        <ul style={{ listStyle: 'none' }}>
          {weeks.map(w => (
            <li key={w.id}>
              <button type="button" className={`hist-row${w.status === 'rejected' ? ' sent-back-row' : ''}`}
                onClick={() => navigate(`/?week_start=${w.week_start_date}`)}>
                <span>
                  <span style={{ display: 'block', fontWeight: 600 }}>Week {w.week_number}</span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>{fmtRangeWords(w.week_start_date, w.week_end_date)}</span>
                </span>
                <span className="hours">{fmtH(w.total_hours)} h</span>
                <span className={`chip chip-${w.status}`}>{STATUS_LABEL[w.status] || w.status}</span>
                <ChevronRight style={{ color: 'var(--muted)', flexShrink: 0 }} />
              </button>
            </li>
          ))}
          {weeks.length === 0 && !error && <li style={{ color: 'var(--muted)' }}>No previous weeks yet.</li>}
        </ul>
      )}
    </div>
  )
}
