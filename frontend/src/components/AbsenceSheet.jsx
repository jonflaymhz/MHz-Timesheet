import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Sheet from './Sheet.jsx'
import { weekdayName, fmtShort } from '../lib/dates.js'
import { fmtH, DAILY_CAP, defaultAdminCode } from '../lib/week.js'

// Each choice maps to an existing category (Employee UI Redesign v1.0 §4):
// MHz staff use the non-project reasons, CTP-only staff CTP's own
// categories. The two zero-hour choices are the existing non-work marker,
// "Other" with its note. A choice with no matching category is not offered.
const CHOICES = [
  { key: 'holiday', label: 'Holiday', short: 'holiday', mhz: 'Holiday', ctp: 'Holiday' },
  { key: 'sick', label: 'Sick', short: 'sick', mhz: 'Sickness', ctp: 'Sick' },
  { key: 'unpaid', label: 'Unpaid leave', short: 'unpaid leave', mhz: 'Unpaid Leave', ctp: null },
  { key: 'bank', label: 'Bank holiday', short: 'bank holiday', mhz: 'Bank Holiday', ctp: 'Bank Holiday' },
  { key: 'notcontracted', label: 'Not contracted to work today', short: 'not contracted', marker: true },
  { key: 'other', label: 'Other', short: 'other', marker: true, note: true },
]

export default function AbsenceSheet({ week, date, dayTotal, shortBy, onClose, onSaved }) {
  const ctpOnly = week.owner_department === 'CTP' && !!week.owner_has_ctp_access
  const standard = Number(week.standard_day_hours) || 7.5
  const fromShort = shortBy > 0
  const [reasons, setReasons] = useState(null)
  const [ctpCategories, setCtpCategories] = useState(null)
  const [codes, setCodes] = useState([])
  const [choice, setChoice] = useState(null)
  const maxHours = Math.min(standard, DAILY_CAP - dayTotal)
  const defaultHours = Math.min(fromShort ? shortBy : standard, maxHours)
  const minHours = Math.min(0.5, defaultHours)
  const [hours, setHours] = useState(defaultHours)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (ctpOnly) {
      api.get('/reference/ctp-categories').then(setCtpCategories).catch(e => setError(e.message))
    } else {
      api.get('/reference/non-project-reasons').then(setReasons).catch(e => setError(e.message))
      api.get(`/reference/cost-codes?type=non_project${week.owner_dept_code ? `&dept_code=${week.owner_dept_code}` : ''}`)
        .then(setCodes).catch(() => {})
    }
  }, [ctpOnly, week.owner_dept_code])

  function target(c) {
    if (c.marker) return { marker: true }
    if (ctpOnly) {
      const cat = c.ctp && (ctpCategories || []).find(x => x.kind === 'non_project' && x.name === c.ctp)
      return cat ? { ctp_category_id: cat.id } : null
    }
    const r = (reasons || []).find(x => x.name === c.mhz)
    return r ? { reason_id: r.id } : null
  }

  const loaded = ctpOnly ? !!ctpCategories : !!reasons
  // A zero-hour day makes no sense on a day that already has hours.
  const choices = CHOICES.filter(c => !(fromShort && c.marker)).filter(c => !loaded || target(c))
  const picked = CHOICES.find(c => c.key === choice)

  function step(dir) {
    setHours(h => Math.max(minHours, Math.min(maxHours, Math.round((h + dir * 0.5) * 4) / 4)))
  }

  async function save() {
    const t = picked && target(picked)
    if (!t) return
    setSaving(true); setError('')
    try {
      let body
      if (t.marker) {
        body = { entry_date: date, is_non_work_marker: true, description: picked.note ? note.trim() : null }
      } else if (t.ctp_category_id) {
        body = { entry_date: date, ctp_category_id: t.ctp_category_id, hours }
      } else {
        const code = defaultAdminCode(codes)
        if (!code) throw new Error('No admin type of work is set up for your department. Ask the office.')
        body = { entry_date: date, reason_id: t.reason_id, cost_code_id: code.id, hours }
      }
      await api.post(`/weeks/${week.id}/entries`, body)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const noteMissing = picked?.note && !note.trim()
  const saveHours = picked?.marker ? 0 : hours

  return (
    <Sheet title={fromShort ? 'Absence' : 'Not working'} subtitle={`${weekdayName(date)} ${fmtShort(date)}`} onClose={onClose}>
      {error && <div className="banner banner-error" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}

      <div className="field-label" id="absence-reason">Reason</div>
      <div className="reason-list" role="radiogroup" aria-labelledby="absence-reason">
        {choices.map(c => (
          <button key={c.key} type="button" role="radio" aria-checked={choice === c.key}
            className="pick" onClick={() => { setChoice(c.key); setError('') }}>
            <span className="pick-text">{c.label}</span>
            {c.marker && <span className="mono" style={{ color: 'var(--muted)', fontSize: 14 }}>0 h</span>}
          </button>
        ))}
        {!loaded && !error && <div className="help">Loading…</div>}
      </div>

      {picked && !picked.marker && (
        <>
          <div className="field-label" id="absence-hours">Hours</div>
          <div className="hours-box" role="group" aria-labelledby="absence-hours">
            <button type="button" className="step-btn" aria-label="Half an hour less" disabled={hours <= minHours} onClick={() => step(-1)}>−</button>
            <div className="hours-read" aria-live="polite">{fmtH(hours)}<small>h</small></div>
            <button type="button" className="step-btn" aria-label="Half an hour more" disabled={hours >= maxHours} onClick={() => step(1)}>+</button>
          </div>
          <div className="pills" style={{ justifyContent: 'center' }}>
            <button type="button" className="pill" aria-pressed={hours === standard} disabled={standard > maxHours} onClick={() => setHours(standard)}>Full day</button>
            <button type="button" className="pill" aria-pressed={hours === standard / 2} disabled={standard / 2 > maxHours} onClick={() => setHours(Math.round(standard / 2 * 4) / 4)}>Half day</button>
          </div>
          <p className="help" style={{ textAlign: 'center' }}>Part day? Lower the hours and book the rest as work.</p>
        </>
      )}

      {picked?.note && (
        <>
          <label className="field-label" htmlFor="absence-note">Note (required)</label>
          <textarea id="absence-note" className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Why you weren't working" />
        </>
      )}

      <button type="button" className="btn btn-primary sheet-save" onClick={save} disabled={!picked || saving || noteMissing}>
        {saving ? 'Saving…' : picked ? `Book ${picked.short} (${fmtH(saveHours)} h)` : 'Choose a reason'}
      </button>
    </Sheet>
  )
}
