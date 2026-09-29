import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import ProjectReasonPicker from './ProjectReasonPicker.jsx'
import HourPicker from './HourPicker.jsx'
import { fmtShort, weekdayName } from '../lib/dates.js'

const DEPT_LABELS = { CL: 'Coachbuild', WW: 'Woodwork', EL: 'Engineering', IL: 'Wiring', PM: 'Project Management', RW: 'Rework' }
const LEAVE_REASONS = ['Holiday', 'Bank Holiday', 'Unpaid Leave', 'Paternity Leave', 'Compassionate Leave', 'Hospital Appointment']

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// Add (or replace) an entry for one day. Project time books to QW catalogue
// codes, the project's own estimate codes first; reason time books to the
// local non-project codes, defaulting to the person's department admin code
// (Working Cost Codes v1.1 §2.3/§2.5) — a wiring contractor logging Holiday
// shouldn't have to hunt for IL-DA by hand.
export default function EntryModal({ weekId, date, department, deptCode, hasCtpAccess, onClose, onSaved }) {
  // Section 5: "CTP-only staff see CTP builds only" — a CTP-department
  // person with no dual MHz access never needs the project/reason side of
  // the picker at all, not just CTP added alongside it.
  const ctpOnly = department === 'CTP' && hasCtpAccess
  const [selection, setSelection] = useState(null) // { type: 'project'|'reason'|'ctpBuild'|'ctpCategory', id/buildId+categoryId, label }
  const [costCodes, setCostCodes] = useState([])
  const [costCodeId, setCostCodeId] = useState('')
  const [hours, setHours] = useState(1)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isCtp = selection?.type === 'ctpBuild' || selection?.type === 'ctpCategory'
  const isCtpBuildIncomplete = selection?.type === 'ctpBuild' && !selection.categoryId
  const requiresComment = (selection?.type === 'reason' && selection.label === 'Other') || (isCtp && selection.requiresComment)
  // §2.6: only planned leave can be booked ahead of today.
  const isFuture = date > londonToday()
  const futureBlocked = isFuture && selection && !LEAVE_REASONS.includes(selection.type === 'reason' || selection.type === 'ctpCategory' ? selection.label : '')

  useEffect(() => {
    if (selection?.type === 'reason') {
      api.get(`/reference/cost-codes?type=non_project${deptCode ? `&dept_code=${deptCode}` : ''}`)
        .then(codes => {
          setCostCodes(codes)
          const deptDefault = codes.find(c => c.is_default)
          setCostCodeId(deptDefault?.id || '')
        })
        .catch(() => {})
    } else if (selection?.type === 'project') {
      setCostCodeId('')
      api.get(`/reference/cost-codes?type=project&project_ref_id=${selection.id}`).then(setCostCodes).catch(() => {})
    } else if (isCtp) {
      // A CTP entry has no cost code at all (Section 4) — CTP staff aren't
      // in any of the catalogue's five departments.
      setCostCodes([]); setCostCodeId('')
    }
  }, [selection?.type, selection?.id, deptCode, isCtp])

  const onProject = costCodes.filter(c => c.on_project)
  const byDept = new Map()
  for (const c of costCodes) {
    if (selection?.type === 'project' && c.on_project) continue
    const key = selection?.type === 'project' ? c.department : 'all'
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key).push(c)
  }

  async function save() {
    if (!selection) { setError(ctpOnly ? 'Pick a CTP build or category' : 'Pick a project, a reason, or a CTP build'); return }
    if (isCtpBuildIncomplete) { setError('Pick what you did on this build'); return }
    if (futureBlocked) { setError("Can't book work in the future"); return }
    if (!isCtp && !costCodeId) { setError('Pick a cost code'); return }
    if (requiresComment && !description.trim()) { setError(`Notes are required when "${selection.label.split(' · ').pop()}" is selected`); return }
    setSaving(true); setError('')
    try {
      await api.post(`/weeks/${weekId}/entries`, {
        entry_date: date,
        project_ref_id: selection.type === 'project' ? selection.id : null,
        reason_id: selection.type === 'reason' ? selection.id : null,
        ctp_build_id: selection.type === 'ctpBuild' ? selection.buildId : null,
        ctp_category_id: isCtp ? selection.categoryId : null,
        cost_code_id: isCtp ? null : costCodeId,
        hours,
        description: description.trim() || null,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>Add time — {weekdayName(date)} {fmtShort(date)}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        {isFuture && (
          <div className="banner banner-warn">This day is still to come: only leave (Holiday, Bank Holiday, Unpaid, Paternity, Compassionate Leave, Hospital Appointment) can be booked ahead.</div>
        )}

        <ProjectReasonPicker value={selection} onSelect={setSelection} showCtp={!!hasCtpAccess} ctpOnly={ctpOnly} />

        {selection && (
          <>
            {!isCtp && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 8px' }}>
                  Cost code
                </div>
                <select className="input" value={costCodeId} onChange={e => setCostCodeId(e.target.value)} style={{ marginBottom: 16 }}>
                  <option value="">Select…</option>
                  {selection.type === 'project' ? (
                    <>
                      {onProject.length > 0 && (
                        <optgroup label="On this project">
                          {onProject.map(c => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
                        </optgroup>
                      )}
                      {[...byDept.entries()].map(([dept, codes]) => (
                        <optgroup key={dept} label={DEPT_LABELS[dept] || dept}>
                          {codes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
                        </optgroup>
                      ))}
                    </>
                  ) : costCodes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
                </select>
              </>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, marginTop: isCtp ? 16 : 0 }}>
              Hours
            </div>
            <HourPicker value={hours} onChange={setHours} />

            <textarea
              className="input" placeholder={requiresComment ? 'Notes (required)' : 'Notes (optional)'}
              value={description} onChange={e => setDescription(e.target.value)}
              style={{ marginTop: 16, minHeight: 70, resize: 'vertical' }}
            />
          </>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 20 }} onClick={save} disabled={saving || !selection || isCtpBuildIncomplete}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
