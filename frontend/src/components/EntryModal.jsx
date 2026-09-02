import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import ProjectReasonPicker from './ProjectReasonPicker.jsx'
import HourPicker from './HourPicker.jsx'
import { fmtShort, weekdayName } from '../lib/dates.js'

// Add (or replace) an entry for one day. Cost code defaults to the user's
// own department's admin code once a non-project reason is picked (Section
// 13 item 2) — a wiring contractor logging Holiday shouldn't have to hunt
// for IL-AD by hand.
export default function EntryModal({ weekId, date, department, hasCtpAccess, onClose, onSaved }) {
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

  useEffect(() => {
    if (selection?.type === 'reason') {
      api.get(`/reference/cost-codes${department ? `?department=${department}` : ''}`)
        .then(codes => {
          setCostCodes(codes)
          const deptDefault = codes.find(c => c.code === `${department}-AD`)
          setCostCodeId(deptDefault?.id || codes[0]?.id || '')
        })
        .catch(() => {})
    } else if (selection?.type === 'project') {
      api.get('/reference/cost-codes').then(setCostCodes).catch(() => {})
    } else if (isCtp) {
      // A CTP entry has no cost code at all (Section 4) — CTP staff aren't
      // in any of the catalogue's five departments.
      setCostCodes([]); setCostCodeId('')
    }
  }, [selection, department, isCtp])

  async function save() {
    if (!selection) { setError(ctpOnly ? 'Pick a CTP build or category' : 'Pick a project, a reason, or a CTP build'); return }
    if (isCtpBuildIncomplete) { setError('Pick what you did on this build'); return }
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
                  {costCodes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
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
