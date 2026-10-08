import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'
import Sheet from './Sheet.jsx'
import { weekdayName, fmtShort, londonDate } from '../lib/dates.js'
import { fmtH, DAILY_CAP, ctpBuildIdentity, replaceEntries } from '../lib/week.js'

const DEPT_LABELS = { CL: 'Coachbuild', WW: 'Woodwork', EL: 'Engineering', IL: 'Wiring', PM: 'Project Management', RW: 'Rework' }
// Only planned leave can be booked ahead (Working Cost Codes v1.1 §2.6).
const LEAVE_REASONS = ['Holiday', 'Bank Holiday', 'Unpaid Leave', 'Paternity Leave', 'Compassionate Leave', 'Hospital Appointment']
const QUICK = [0.5, 1, 2, 4, 7.5, 8]
const DOTS = ['var(--dot-a)', 'var(--dot-b)']

function selectionFromEntry(e) {
  if (!e) return null
  if (e.project_ref_id) return { type: 'project', id: e.project_ref_id, label: e.project_name }
  if (e.reason_id) return { type: 'reason', id: e.reason_id, label: e.reason_name }
  if (e.ctp_build_id) return { type: 'ctpBuild', buildId: e.ctp_build_id, categoryId: e.ctp_category_id, label: e.ctp_build_name }
  if (e.ctp_category_id) return { type: 'ctpCategory', categoryId: e.ctp_category_id, label: e.ctp_category_name }
  return null
}

function modeOf(sel) {
  if (!sel) return null
  return sel.type === 'project' ? 'project' : sel.type === 'reason' ? 'reason' : 'ctp'
}

// Add time (Employee UI Redesign v1.0 §3), one pass: Project / Not project /
// CTP, then type of work, hours and notes. Opened on an existing entry it is
// pre-filled and offers Delete. Same fields and rules as the old entry form.
// lineOnly (desktop "Add a line", §5) picks the work and type of work only;
// hours then go straight into the grid.
export default function AddTimeSheet({ week, date, dayTotal, entry, lineOnly, onPickLine, onClose, onSaved }) {
  const department = week.owner_department
  const deptCode = week.owner_dept_code
  const hasCtpAccess = !!week.owner_has_ctp_access
  // "CTP-only staff see CTP builds only" (CTP Integration Scope §5).
  const ctpOnly = department === 'CTP' && hasCtpAccess
  const standard = Number(week.standard_day_hours) || 7.5

  const initialSel = selectionFromEntry(entry)
  const [mode, setMode] = useState(modeOf(initialSel) || (ctpOnly ? 'ctp' : 'project'))
  const [selection, setSelection] = useState(initialSel)
  const [costCodes, setCostCodes] = useState([])
  const [costCodeId, setCostCodeId] = useState(entry?.cost_code_id || '')
  const otherHours = Math.max(0, dayTotal - (entry ? Number(entry.hours) : 0))
  const maxHours = Math.max(0.25, DAILY_CAP - otherHours)
  const [hours, setHours] = useState(() => {
    if (entry) return Number(entry.hours)
    const short = Math.round((standard - dayTotal) * 4) / 4
    return short > 0 ? Math.min(short, maxHours) : Math.min(1, maxHours)
  })
  const [description, setDescription] = useState(entry?.description || '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  // Reference lists
  const [recent, setRecent] = useState([])
  const [reasons, setReasons] = useState([])
  const [ctpBuilds, setCtpBuilds] = useState([])
  const [ctpCategories, setCtpCategories] = useState([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [allProjects, setAllProjects] = useState(null)

  useEffect(() => {
    if (!ctpOnly) {
      api.get('/reference/projects?recent=1').then(setRecent).catch(() => {})
      api.get('/reference/non-project-reasons').then(setReasons).catch(() => {})
    }
    if (hasCtpAccess) {
      api.get('/reference/ctp-builds').then(setCtpBuilds).catch(() => {})
      api.get('/reference/ctp-categories').then(setCtpCategories).catch(() => {})
    }
  }, [ctpOnly, hasCtpAccess])

  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults(null); return }
    const t = setTimeout(() => {
      api.get(`/reference/projects?q=${encodeURIComponent(search.trim())}`).then(setSearchResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  // Type of work list follows the selection. The first load on an existing
  // entry keeps that entry's own type of work.
  const keepCode = useRef(!!entry)
  const isCtp = selection?.type === 'ctpBuild' || selection?.type === 'ctpCategory'
  useEffect(() => {
    const keep = keepCode.current
    keepCode.current = false
    if (selection?.type === 'reason') {
      api.get(`/reference/cost-codes?type=non_project${deptCode ? `&dept_code=${deptCode}` : ''}`)
        .then(codes => {
          setCostCodes(codes)
          if (!keep) setCostCodeId(codes.find(c => c.is_default)?.id || '')
        })
        .catch(() => {})
    } else if (selection?.type === 'project') {
      if (!keep) setCostCodeId('')
      api.get(`/reference/cost-codes?type=project&project_ref_id=${selection.id}`).then(setCostCodes).catch(() => {})
    } else {
      setCostCodes([]); if (!keep) setCostCodeId('')
    }
  }, [selection?.type, selection?.id, deptCode])

  function switchMode(m) {
    if (m === mode) return
    setMode(m)
    if (modeOf(selection) !== m) { setSelection(null); setCostCodeId('') }
    setError('')
  }

  const buildCategories = ctpCategories.filter(c => c.kind === 'build')
  const nonBuildCategories = ctpCategories.filter(c => c.kind === 'non_project')
  const selectedBuildId = selection?.type === 'ctpBuild' ? selection.buildId : null
  const selectedCategory = ctpCategories.find(c => c.id === selection?.categoryId)
  const requiresComment = (selection?.type === 'reason' && selection.label === 'Other') || (isCtp && !!selectedCategory?.requires_comment)
  const isFuture = !lineOnly && date > londonDate()
  const selName = selection?.type === 'reason' ? selection.label : selection?.type === 'ctpCategory' ? selectedCategory?.name || selection.label : ''
  const futureBlocked = isFuture && selection && !LEAVE_REASONS.includes(selName)

  const onProject = costCodes.filter(c => c.on_project)
  const byDept = new Map()
  for (const c of costCodes) {
    if (selection?.type === 'project' && c.on_project) continue
    const key = selection?.type === 'project' ? c.department : 'all'
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key).push(c)
  }

  let projectList = searchResults ?? allProjects ?? recent
  if (selection?.type === 'project' && !searchResults && !projectList.some(p => p.id === selection.id)) {
    projectList = [{ id: selection.id, project_name: selection.label }, ...projectList]
  }

  function stepHours(dir) {
    setHours(h => Math.max(0.25, Math.min(maxHours, Math.round((h + dir * 0.25) * 4) / 4)))
  }

  function pickLine() {
    if (!selection) { setError('Pick what this line is for'); return }
    if (selection.type === 'ctpBuild' && !selection.categoryId) { setError('Pick what you did on this build'); return }
    if (!isCtp && !costCodeId) { setError('Pick a type of work'); return }
    const code = costCodes.find(c => c.id === costCodeId)
    const build = ctpBuilds.find(b => b.id === selectedBuildId)
    onPickLine({
      project_ref_id: selection.type === 'project' ? selection.id : null,
      reason_id: selection.type === 'reason' ? selection.id : null,
      ctp_build_id: selection.type === 'ctpBuild' ? selection.buildId : null,
      ctp_category_id: isCtp ? selection.categoryId : null,
      cost_code_id: isCtp ? null : costCodeId,
      project_name: selection.type === 'project' ? selection.label : null,
      reason_name: selection.type === 'reason' ? selection.label : null,
      ctp_build_name: build?.name || null, ctp_build_sku: build?.sku || null,
      ctp_build_order_ref: build?.order_ref || 'manual', ctp_build_customer: build?.customer || null,
      ctp_category_name: selectedCategory?.name || null,
      cost_code: code?.code || null, cost_code_description: code?.description || null,
    })
    onClose()
  }

  async function save() {
    if (!selection) { setError(mode === 'project' ? 'Pick a project' : mode === 'reason' ? 'Pick a reason' : 'Pick a CTP build or category'); return }
    if (selection.type === 'ctpBuild' && !selection.categoryId) { setError('Pick what you did on this build'); return }
    if (futureBlocked) { setError("Can't book work in the future"); return }
    if (!isCtp && !costCodeId) { setError('Pick a type of work'); return }
    if (requiresComment && !description.trim()) { setError('Notes are required for "Other"'); return }
    setSaving(true); setError('')
    const body = {
      entry_date: date,
      project_ref_id: selection.type === 'project' ? selection.id : null,
      reason_id: selection.type === 'reason' ? selection.id : null,
      ctp_build_id: selection.type === 'ctpBuild' ? selection.buildId : null,
      ctp_category_id: isCtp ? selection.categoryId : null,
      cost_code_id: isCtp ? null : costCodeId,
      hours,
      description: description.trim() || null,
    }
    try {
      if (entry) await replaceEntries(week.id, [entry], body)
      else await api.post(`/weeks/${week.id}/entries`, body)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      if (entry) onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setSaving(true); setError('')
    try {
      await api.delete(`/weeks/${week.id}/entries/${entry.id}`)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const modes = ctpOnly ? [] : [['project', 'Project'], ['reason', 'Not project'], ...(hasCtpAccess ? [['ctp', 'CTP']] : [])]

  return (
    <Sheet title={lineOnly ? 'Add a line' : entry ? 'Edit time' : 'Add time'}
      subtitle={lineOnly ? `Week ${week.week_number}` : `${weekdayName(date)} ${fmtShort(date)}`} onClose={onClose}>
      {modes.length > 1 && (
        <div className="seg" role="group" aria-label="What was this time for">
          {modes.map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}>{label}</button>
          ))}
        </div>
      )}

      {error && <div className="banner banner-error" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
      {isFuture && (
        <div className="banner banner-warn" style={{ marginTop: 14, marginBottom: 0 }}>
          This day is still to come: only leave (Holiday, Bank Holiday, Unpaid, Paternity, Compassionate Leave, Hospital Appointment) can be booked ahead.
        </div>
      )}

      {mode === 'project' && (
        <>
          <label className="field-label" htmlFor="proj-search">Project</label>
          <input
            id="proj-search" className="input" type="search" placeholder="Search number or name"
            value={search} onChange={e => setSearch(e.target.value)} autoComplete="off"
          />
          {!searchResults && !allProjects && recent.length > 0 && (
            <div className="help" style={{ marginBottom: 6 }}>Your recent projects</div>
          )}
          <div className="pick-list" style={{ marginTop: 8 }}>
            {projectList.map((p, i) => (
              <button
                key={p.id} type="button" className="pick"
                aria-pressed={selection?.type === 'project' && selection.id === p.id}
                onClick={() => { setSelection({ type: 'project', id: p.id, label: p.project_name }); setError('') }}
              >
                <span className="dot" style={{ background: DOTS[i % 2] }} />
                <span className="pick-text">{p.project_name}</span>
              </button>
            ))}
            {searchResults && searchResults.length === 0 && <div className="help">No open projects match "{search.trim()}".</div>}
            {!searchResults && !allProjects && (
              <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }}
                onClick={() => api.get('/reference/projects').then(setAllProjects).catch(() => {})}>
                See all open projects
              </button>
            )}
          </div>
        </>
      )}

      {mode === 'reason' && (
        <>
          <div className="field-label" id="reason-label">Reason</div>
          <div className="pills" role="group" aria-labelledby="reason-label">
            {reasons.map(r => (
              <button key={r.id} type="button" className="pill"
                aria-pressed={selection?.type === 'reason' && selection.id === r.id}
                onClick={() => { setSelection({ type: 'reason', id: r.id, label: r.name }); setError('') }}>
                {r.name}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'ctp' && (
        <>
          {ctpBuilds.length > 0 && (
            <>
              <div className="field-label">CTP build</div>
              <div className="pick-list">
                {ctpBuilds.map(b => (
                  <button key={b.id} type="button" className="pick" aria-pressed={selectedBuildId === b.id}
                    onClick={() => {
                      // Keep an already-picked build category when switching build.
                      const cat = selection?.type === 'ctpBuild' ? selection.categoryId : null
                      setSelection({ type: 'ctpBuild', buildId: b.id, categoryId: cat, label: ctpBuildIdentity(b) }); setError('')
                    }}>
                    <span className="pick-text">{ctpBuildIdentity(b)}</span>
                  </button>
                ))}
              </div>
              {selectedBuildId && (
                <>
                  <div className="field-label" id="ctp-what">What on this build?</div>
                  <div className="pills" role="group" aria-labelledby="ctp-what">
                    {buildCategories.map(c => (
                      <button key={c.id} type="button" className="pill" aria-pressed={selection.categoryId === c.id}
                        onClick={() => setSelection({ ...selection, categoryId: c.id })}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {nonBuildCategories.length > 0 && (
            <>
              <div className="field-label" id="ctp-other">CTP, not build work</div>
              <div className="pills" role="group" aria-labelledby="ctp-other">
                {nonBuildCategories.map(c => (
                  <button key={c.id} type="button" className="pill"
                    aria-pressed={selection?.type === 'ctpCategory' && selection.categoryId === c.id}
                    onClick={() => { setSelection({ type: 'ctpCategory', categoryId: c.id, label: c.name }); setError('') }}>
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {selection && !isCtp && (
        <>
          <label className="field-label" htmlFor="type-of-work">Type of work</label>
          <select id="type-of-work" className="input" value={costCodeId} onChange={e => setCostCodeId(e.target.value)}>
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

      {lineOnly ? (
        <button type="button" className="btn btn-primary sheet-save" onClick={pickLine}
          disabled={!selection || (selection.type === 'ctpBuild' && !selection.categoryId)}>
          Add line
        </button>
      ) : (
        <>
        <div className="field-label" id="hours-label">Hours</div>
        <div className="hours-box" role="group" aria-labelledby="hours-label">
          <button type="button" className="step-btn" aria-label="15 minutes less" disabled={hours <= 0.25} onClick={() => stepHours(-1)}>−</button>
          <div className="hours-read" aria-live="polite">{fmtH(hours)}<small>h</small></div>
          <button type="button" className="step-btn" aria-label="15 minutes more" disabled={hours >= maxHours} onClick={() => stepHours(1)}>+</button>
        </div>
        <div className="pills" style={{ justifyContent: 'center' }}>
          {QUICK.map(q => (
            <button key={q} type="button" className="pill mono" aria-pressed={hours === q} disabled={q > maxHours}
              aria-label={`${q} hours`} onClick={() => setHours(q)}>
              {fmtH(q)}
            </button>
          ))}
        </div>
        {maxHours < DAILY_CAP && <div className="help" style={{ textAlign: 'center' }}>Up to {fmtH(maxHours)} h more on this day ({DAILY_CAP} h daily limit).</div>}

        <label className="field-label" htmlFor="entry-notes">Notes{requiresComment ? ' (required)' : ', optional'}</label>
        <textarea id="entry-notes" className="input" value={description} onChange={e => setDescription(e.target.value)} />

        <button type="button" className="btn btn-primary sheet-save" onClick={save}
          disabled={saving || !selection || (selection.type === 'ctpBuild' && !selection.categoryId)}>
          {saving ? 'Saving…' : `Save ${fmtH(hours)} h to ${weekdayName(date)}`}
        </button>
        {entry && (
          <button type="button" className="btn btn-danger sheet-delete" onClick={remove} disabled={saving}>
            {confirmDelete ? 'Tap again to delete' : 'Delete'}
          </button>
        )}
        </>
      )}
    </Sheet>
  )
}
