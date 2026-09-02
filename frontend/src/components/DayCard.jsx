import { useState } from 'react'
import { api } from '../lib/api.js'
import EntryModal from './EntryModal.jsx'

function fmtHours(h) {
  return Number(h) % 1 === 0 ? String(Number(h)) : Number(h).toFixed(2).replace(/0$/, '')
}

// Whole week always visible, running total per day (Section 6) — this is
// one day of that week.
export default function DayCard({ date, label, entries, weekId, department, hasCtpAccess, editable, weekOwnerId, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false)
  const total = entries.reduce((sum, e) => sum + Number(e.hours), 0)
  const marker = entries.find(e => e.is_non_work_marker)

  async function deleteEntry(id) {
    await api.delete(`/weeks/${weekId}/entries/${id}`)
    onRefresh()
  }

  async function toggleMarker() {
    if (marker) {
      await deleteEntry(marker.id)
    } else {
      await api.post(`/weeks/${weekId}/entries`, { entry_date: date, is_non_work_marker: true })
      onRefresh()
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: entries.length ? 10 : 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{label}</div>
        </div>
        <div style={{ fontWeight: 700, color: total > 0 ? 'var(--accent)' : 'var(--text3)', fontSize: 16 }}>
          {total > 0 ? `${fmtHours(total)} hrs` : marker ? 'No work' : '—'}
        </div>
      </div>

      {entries.filter(e => !e.is_non_work_marker).map(e => (
        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.project_name || e.reason_name || (e.ctp_build_name ? `${e.ctp_build_order_ref || e.ctp_build_name} · ${e.ctp_category_name}` : e.ctp_category_name)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{e.cost_code || 'CTP'}
              {weekOwnerId && e.entered_by !== weekOwnerId && <span style={{ color: 'var(--amber)', fontWeight: 600 }}> · proxy</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontWeight: 600 }}>{fmtHours(e.hours)} hrs</span>
            {editable && <button className="btn btn-ghost btn-sm" onClick={() => deleteEntry(e.id)}>✕</button>}
          </div>
        </div>
      ))}

      {editable && (
        <div style={{ display: 'flex', gap: 8, marginTop: entries.length ? 12 : 0 }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setShowAdd(true)}>+ Add time</button>
          {!entries.some(e => !e.is_non_work_marker) && (
            <button className="btn btn-ghost btn-sm" onClick={toggleMarker}>
              {marker ? 'Undo "no work"' : 'No work today'}
            </button>
          )}
        </div>
      )}

      {showAdd && (
        <EntryModal
          weekId={weekId} date={date} department={department} hasCtpAccess={hasCtpAccess}
          onClose={() => setShowAdd(false)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}
