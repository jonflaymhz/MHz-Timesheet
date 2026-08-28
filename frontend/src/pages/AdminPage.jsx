import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'projects', label: 'Projects' },
  { key: 'costcodes', label: 'Cost codes' },
  { key: 'overrides', label: 'Overrides' },
  { key: 'audit', label: 'Audit log' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'health', label: 'Integration' },
]

export default function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('users')
  const isAdmin = user?.role === 'admin'
  const visibleTabs = TABS.filter(t => isAdmin || !['users'].includes(t.key))

  return (
    <div>
      <div className="tabbar" style={{ top: 49 }}>
        {visibleTabs.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="page-wide">
        {tab === 'users' && isAdmin && <UsersTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'costcodes' && isAdmin && <CostCodesTab />}
        {tab === 'overrides' && <OverridesTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'outstanding' && <OutstandingTab />}
        {tab === 'health' && <HealthTab />}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  function load() { api.get('/admin/users').then(setUsers).catch(e => setError(e.message)) }
  useEffect(load, [])

  async function unlock(id) {
    await api.post(`/admin/users/${id}/unlock-pin`).catch(e => setError(e.message))
    load()
  }
  async function toggleActive(u) {
    await api.patch(`/admin/users/${u.id}/${u.is_active ? 'deactivate' : 'reactivate'}`).catch(e => setError(e.message))
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Users</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New user</button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="card">
        {users.map(u => (
          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', opacity: u.is_active ? 1 : 0.5 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{u.full_name} <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}>({u.role}{u.department ? `, ${u.department}` : ''})</span></div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Reports to: {u.reports_to_name || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {u.pin_locked_at && <button className="btn btn-danger btn-sm" onClick={() => unlock(u.id)}>Unlock PIN</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
            </div>
          </div>
        ))}
      </div>
      {showNew && <NewUserModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} users={users} />}
    </div>
  )
}

function NewUserModal({ onClose, onCreated, users }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [department, setDepartment] = useState('')
  const [role, setRole] = useState('employee')
  const [employmentType, setEmploymentType] = useState('employee')
  const [reportsTo, setReportsTo] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true); setError('')
    try {
      await api.post('/admin/users', {
        full_name: fullName, username, department: department || null, role,
        employment_type: employmentType, reports_to: reportsTo || null, pin,
      })
      onCreated()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>New user</h2>
        {error && <div className="banner banner-error">{error}</div>}
        <input className="input" placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} style={{ marginBottom: 10 }} />
        <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ marginBottom: 10 }} />
        <select className="input" value={department} onChange={e => setDepartment(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">No department</option>
          {['CL', 'EL', 'IL', 'WW', 'PM'].map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={role} onChange={e => setRole(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="employee">Employee</option>
          <option value="contractor">Contractor</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
          <option value="jonny">Jonny (processor)</option>
        </select>
        {role !== 'admin' && role !== 'jonny' && (
          <select className="input" value={employmentType} onChange={e => setEmploymentType(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="employee">Employee</option>
            <option value="contractor">Contractor</option>
          </select>
        )}
        <select className="input" value={reportsTo} onChange={e => setReportsTo(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">No line manager</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        {role !== 'admin' && role !== 'jonny' && (
          <input className="input" inputMode="numeric" maxLength={6} placeholder="6-digit PIN" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} style={{ marginBottom: 14 }} />
        )}
        {(role === 'admin' || role === 'jonny') && (
          <div className="banner banner-warn">This tier logs in with a password + authenticator app instead — set that up via the create-admin script, not here.</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving || (role !== 'admin' && role !== 'jonny' && pin.length !== 6)}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Projects (availability) ─────────────────────────────────────
function ProjectsTab() {
  const [projects, setProjects] = useState([])
  const [q, setQ] = useState('')

  function load() { api.get(`/admin/projects${q ? `?q=${q}` : ''}`).then(setProjects).catch(() => {}) }
  useEffect(load, [q])

  async function close(id) { await api.post(`/admin/projects/${id}/close`); load() }
  async function reopen(id) { await api.post(`/admin/projects/${id}/reopen`); load() }

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Project availability</h2>
      <input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 14, maxWidth: 320 }} />
      <div className="card">
        {projects.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.project_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>QW status: {p.qw_status} · synced {new Date(p.last_synced_at).toLocaleString('en-GB')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="tag" style={{ background: p.effective_open ? 'var(--status-good-bg)' : 'var(--status-bad-bg)', color: p.effective_open ? 'var(--status-good-text)' : 'var(--status-bad-text)' }}>
                {p.effective_open ? 'Open' : 'Closed'}
              </span>
              {p.effective_open
                ? <button className="btn btn-danger btn-sm" onClick={() => close(p.id)}>Close</button>
                : <button className="btn btn-ghost btn-sm" onClick={() => reopen(p.id)}>Reopen</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Cost codes ────────────────────────────────────────────────
function CostCodesTab() {
  const [codes, setCodes] = useState([])
  function load() { api.get('/admin/cost-codes').then(setCodes).catch(() => {}) }
  useEffect(load, [])

  async function setRate(id, rate) {
    await api.patch(`/admin/cost-codes/${id}`, { current_rate: rate === '' ? null : Number(rate) })
    load()
  }

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Cost codes</h2>
      <div className="card">
        {codes.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.code} <span style={{ fontWeight: 400, color: 'var(--text3)' }}>— {c.description}</span></div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Department: {c.department}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>£</span>
              <input
                className="input" style={{ width: 90 }} defaultValue={c.current_rate ?? ''}
                onBlur={e => setRate(c.id, e.target.value)}
                placeholder="rate/hr"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Override tools: Correct / Unsubmit (Section 5) ──────────────
function OverridesTab() {
  const [person, setPerson] = useState('')
  const [weeks, setWeeks] = useState([])
  const [expanded, setExpanded] = useState(null) // week id whose entries are shown
  const [weekDetail, setWeekDetail] = useState(null)
  const [mode, setMode] = useState(null) // 'unsubmit' | null, per week
  const [unsubmitReason, setUnsubmitReason] = useState('')
  const [error, setError] = useState('')

  function search() {
    api.get(`/admin/weeks/search${person ? `?person=${encodeURIComponent(person)}` : ''}`).then(setWeeks).catch(e => setError(e.message))
  }
  useEffect(search, [])

  async function expand(weekId) {
    if (expanded === weekId) { setExpanded(null); setWeekDetail(null); return }
    setExpanded(weekId); setMode(null)
    const detail = await api.get(`/weeks/${weekId}`).catch(e => { setError(e.message); return null })
    setWeekDetail(detail)
  }

  async function refreshDetail(weekId) {
    const detail = await api.get(`/weeks/${weekId}`).catch(e => { setError(e.message); return null })
    setWeekDetail(detail)
  }

  async function unsubmit(weekId) {
    if (!unsubmitReason.trim()) { setError('A reason is required'); return }
    try {
      await api.post(`/admin/weeks/${weekId}/unsubmit`, { reason: unsubmitReason.trim() })
      setExpanded(null); setUnsubmitReason(''); setMode(null)
      search()
    } catch (err) { setError(err.message) }
  }

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Find an approved week</h2>
      {error && <div className="banner banner-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="input" placeholder="Search by person…" value={person} onChange={e => setPerson(e.target.value)} />
        <button className="btn btn-ghost" onClick={search}>Search</button>
      </div>
      <div className="card">
        {weeks.map(w => (
          <div key={w.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{w.full_name} — Wk {w.week_number}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{w.week_start_date} to {w.week_end_date}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => expand(w.id)}>{expanded === w.id ? 'Close' : 'View entries'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { expand(w.id); setMode('unsubmit') }}>Unsubmit</button>
              </div>
            </div>

            {expanded === w.id && mode === 'unsubmit' && (
              <div style={{ marginTop: 10 }}>
                <textarea className="input" placeholder="Reason for sending this week back to draft…" value={unsubmitReason} onChange={e => setUnsubmitReason(e.target.value)} style={{ marginBottom: 8, minHeight: 50 }} />
                <button className="btn btn-danger btn-sm" onClick={() => unsubmit(w.id)}>Confirm unsubmit</button>
              </div>
            )}

            {expanded === w.id && mode !== 'unsubmit' && weekDetail && (
              <div style={{ marginTop: 10 }}>
                {weekDetail.entries.filter(e => !e.is_non_work_marker).map(e => (
                  <CorrectableEntry key={e.id} entry={e} onCorrected={() => refreshDetail(w.id)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {weeks.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No approved weeks match.</div>}
      </div>
    </div>
  )
}

function CorrectableEntry({ entry, onCorrected }) {
  const [editing, setEditing] = useState(false)
  const [selection, setSelection] = useState(
    entry.project_ref_id ? { type: 'project', id: entry.project_ref_id } : { type: 'reason', id: entry.reason_id }
  )
  const [costCodeId, setCostCodeId] = useState(entry.cost_code_id)
  const [costCodes, setCostCodes] = useState([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (editing) api.get('/reference/cost-codes').then(setCostCodes).catch(() => {}) }, [editing])

  async function save() {
    if (!reason.trim()) { setError('A reason is required'); return }
    setSaving(true); setError('')
    try {
      await api.post(`/admin/entries/${entry.id}/correct`, {
        project_ref_id: selection.type === 'project' ? selection.id : null,
        reason_id: selection.type === 'reason' ? selection.id : null,
        cost_code_id: costCodeId,
        reason: reason.trim(),
      })
      setEditing(false)
      onCorrected()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13 }}>
          {entry.entry_date} — {entry.qw_project_number || entry.reason_name} · {entry.cost_code} · {entry.hours} hrs
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e => !e)}>{editing ? 'Cancel' : 'Correct'}</button>
      </div>
      {editing && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="banner banner-error">{error}</div>}
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
            Change the cost code — the doc's example case ("wrong cost code picked"). Moving an entry to a
            different project entirely isn't wired up here yet; hours are never touched by Correct either way.
          </div>
          <select className="input" value={costCodeId} onChange={e => setCostCodeId(e.target.value)} style={{ marginBottom: 8 }}>
            {costCodes.map(c => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
          </select>
          <input className="input" placeholder="Reason for this correction…" value={reason} onChange={e => setReason(e.target.value)} style={{ marginBottom: 8 }} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>Save correction</button>
        </div>
      )}
    </div>
  )
}

// ── Audit log ─────────────────────────────────────────────────
function AuditTab() {
  const [log, setLog] = useState([])
  useEffect(() => { api.get('/admin/audit-log').then(setLog).catch(() => {}) }, [])
  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Audit log</h2>
      <div className="card">
        {log.map(a => (
          <div key={a.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <div><strong>{a.action_type}</strong> on {a.entity_type} by {a.performed_by_name} — {new Date(a.created_at).toLocaleString('en-GB')}</div>
            {a.reason && <div style={{ color: 'var(--text2)' }}>Reason: {a.reason}</div>}
          </div>
        ))}
        {log.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No override actions logged yet.</div>}
      </div>
    </div>
  )
}

// ── Outstanding (company-wide) ──────────────────────────────────
function OutstandingTab() {
  const [weekStart, setWeekStart] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!weekStart) return
    api.get(`/admin/outstanding?week_start=${weekStart}`).then(setData).catch(() => {})
  }, [weekStart])

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Outstanding timesheets</h2>
      <input type="date" className="input" style={{ marginBottom: 14, maxWidth: 220 }} onChange={e => setWeekStart(e.target.value)} />
      {data && (
        <div className="card">
          {data.outstanding.map(p => (
            <div key={p.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600 }}>{p.full_name}</span>
              <span style={{ color: 'var(--text3)' }}>{p.status || 'not started'}</span>
            </div>
          ))}
          {data.outstanding.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>Everyone's submitted for this week.</div>}
        </div>
      )}
    </div>
  )
}

// ── Integration health ────────────────────────────────────────
function HealthTab() {
  const [rows, setRows] = useState([])
  useEffect(() => { api.get('/admin/integration-health').then(setRows).catch(() => {}) }, [])
  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Integration health</h2>
      <div className="card">
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.sync_direction} — {r.sync_type.replace('_', ' ')}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{r.detail} · {new Date(r.started_at).toLocaleString('en-GB')}</div>
            </div>
            <span className="tag" style={{ background: r.status === 'success' ? 'var(--status-good-bg)' : 'var(--status-bad-bg)', color: r.status === 'success' ? 'var(--status-good-text)' : 'var(--status-bad-text)' }}>
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
