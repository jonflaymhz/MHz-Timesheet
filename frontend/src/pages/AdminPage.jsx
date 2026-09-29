import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { isSystemAdmin, isPayrollAdmin } from '../lib/capabilities.js'

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'projects', label: 'Projects' },
  { key: 'costcodes', label: 'Cost codes' },
  { key: 'ctp', label: 'CTP builds' },
  { key: 'overrides', label: 'Overrides' },
  { key: 'audit', label: 'Audit log' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'health', label: 'Integration' },
  { key: 'sendhours', label: 'Send approved hours' },
]

const STATUS_COLORS = {
  active: { bg: 'var(--status-good-bg)', text: 'var(--status-good-text)' },
  frozen: { bg: 'var(--status-warn-bg)', text: 'var(--status-warn-text)' },
  removed: { bg: 'var(--status-bad-bg)', text: 'var(--status-bad-text)' },
}

export default function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('users')
  const isAdmin = isSystemAdmin(user)
  const isPayroll = isPayrollAdmin(user)
  const visibleTabs = TABS.filter(t => {
    if (['users', 'costcodes', 'ctp'].includes(t.key)) return isAdmin
    if (t.key === 'sendhours') return isPayroll
    return true
  })

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
        {tab === 'ctp' && isAdmin && <CtpBuildsTab />}
        {tab === 'overrides' && <OverridesTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'outstanding' && <OutstandingTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'sendhours' && isPayroll && <SendHoursTab />}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────
function capabilityLabels(u) {
  const labels = []
  if (u.can_approve) labels.push('Approval')
  if (u.is_payroll_admin) labels.push('Payroll admin')
  if (u.is_system_admin) labels.push('System admin')
  if (u.has_ctp_access) labels.push('CTP access')
  return labels
}

function UsersTab() {
  const [users, setUsers] = useState([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [capability, setCapability] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState(null)
  const [secret, setSecret] = useState(null) // { title, value } | { title, codes }
  const [error, setError] = useState('')

  function load() {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    if (capability) params.set('capability', capability)
    api.get(`/admin/users${params.toString() ? `?${params}` : ''}`).then(setUsers).catch(e => setError(e.message))
  }
  useEffect(load, [q, status, capability])

  async function unlock(id) {
    await api.post(`/admin/users/${id}/unlock-pin`).catch(e => setError(e.message))
    load()
  }
  async function toggleActive(u) {
    await api.patch(`/admin/users/${u.id}/${u.is_active ? 'deactivate' : 'reactivate'}`).catch(e => setError(e.message))
    load()
  }
  async function remove(u) {
    if (!window.confirm(`Remove ${u.full_name}? This is reversible (Restore), and their timesheet history stays intact.`)) return
    await api.post(`/admin/users/${u.id}/remove`).catch(e => setError(e.message))
    load()
  }
  async function restore(u) {
    await api.post(`/admin/users/${u.id}/restore`).catch(e => setError(e.message))
    load()
  }
  async function resetPin(u) {
    if (!window.confirm(`Reset ${u.full_name}'s PIN? Their current PIN stops working immediately and any active session is signed out.`)) return
    try {
      const r = await api.post(`/admin/users/${u.id}/reset-pin`)
      setSecret({ title: `New PIN for ${u.full_name}`, value: r.new_pin })
    } catch (err) { setError(err.message) }
    load()
  }
  async function resetPassword(u) {
    if (!window.confirm(`Reset ${u.full_name}'s password? Their current password stops working immediately and any active session is signed out. MFA is left untouched.`)) return
    try {
      const r = await api.post(`/admin/users/${u.id}/reset-password`)
      setSecret({ title: `New password for ${u.full_name}`, value: r.new_password })
    } catch (err) { setError(err.message) }
    load()
  }
  async function resetMfa(u) {
    if (!window.confirm(`Reset ${u.full_name}'s MFA? They'll need to re-enrol (new QR code + backup codes) next time they sign in.`)) return
    await api.post(`/admin/users/${u.id}/reset-mfa`).catch(e => setError(e.message))
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Users</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New user</button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="input" placeholder="Search by name or username…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
          <option value="removed">Removed</option>
        </select>
        <select className="input" value={capability} onChange={e => setCapability(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Any capability</option>
          <option value="approval">Approval</option>
          <option value="payroll_admin">Payroll admin</option>
          <option value="system_admin">System admin</option>
        </select>
      </div>
      <div className="card">
        {users.map(u => {
          const sc = STATUS_COLORS[u.status]
          return (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.full_name}
                  <span className="tag" style={{ background: sc.bg, color: sc.text }}>{u.status}</span>
                  {capabilityLabels(u).map(l => (
                    <span key={l} className="tag" style={{ background: 'var(--status-info-bg)', color: 'var(--status-info-text)' }}>{l}</span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {u.username}{u.department ? ` · ${u.department}` : ''}{u.dept_code ? ` (${u.dept_code})` : ''} · Reports to: {u.reports_to_name || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {u.does_timesheets ? 'Has PIN' : 'No timesheet account'}
                  {(u.is_payroll_admin || u.is_system_admin) && ` · MFA ${u.mfa_enabled ? 'enrolled' : 'not enrolled'}`}
                  {' · Last login: '}{u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-GB') : 'never'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 340 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>Edit</button>
                {u.pin_locked_at && <button className="btn btn-danger btn-sm" onClick={() => unlock(u.id)}>Unlock PIN</button>}
                {u.does_timesheets && <button className="btn btn-ghost btn-sm" onClick={() => resetPin(u)}>Reset PIN</button>}
                {(u.is_payroll_admin || u.is_system_admin) && <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(u)}>Reset password</button>}
                {(u.is_payroll_admin || u.is_system_admin) && u.mfa_enabled && <button className="btn btn-ghost btn-sm" onClick={() => resetMfa(u)}>Reset MFA</button>}
                {u.status !== 'removed' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>{u.is_active ? 'Freeze' : 'Unfreeze'}</button>
                )}
                {u.status === 'removed'
                  ? <button className="btn btn-ghost btn-sm" onClick={() => restore(u)}>Restore</button>
                  : <button className="btn btn-danger btn-sm" onClick={() => remove(u)}>Remove</button>}
              </div>
            </div>
          )
        })}
        {users.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No users match.</div>}
      </div>
      {showNew && (
        <NewUserModal
          onClose={() => setShowNew(false)}
          onCreated={(secretResult) => { setShowNew(false); load(); if (secretResult) setSecret(secretResult) }}
          users={users}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(secretResult) => { setEditing(null); load(); if (secretResult) setSecret(secretResult) }}
          users={users}
        />
      )}
      {secret && <SecretRevealModal {...secret} onClose={() => setSecret(null)} />}
    </div>
  )
}

// Shows a one-time generated secret (PIN/password) or a list of backup
// codes — never retrievable again once this closes.
function SecretRevealModal({ title, value, codes, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>{title}</h2>
        <div className="banner banner-warn" style={{ marginBottom: 14 }}>Shown once — make sure it's passed on now, it can't be retrieved again.</div>
        {value && (
          <div className="card" style={{ padding: 16, fontSize: 20, fontFamily: 'monospace', textAlign: 'center', marginBottom: 14 }}>{value}</div>
        )}
        {codes && (
          <div className="card" style={{ padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: 'monospace' }}>
            {codes.map(c => <div key={c}>{c}</div>)}
          </div>
        )}
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

function CapabilityCheckboxes({ doesTimesheets, setDoesTimesheets, canApprove, setCanApprove, isPayrollAdmin, setIsPayrollAdmin, isSystemAdmin, setIsSystemAdmin }) {
  return (
    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={doesTimesheets} onChange={e => setDoesTimesheets(e.target.checked)} />
        Does timesheets (Entry — gets a PIN)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={canApprove} onChange={e => setCanApprove(e.target.checked)} />
        Approval (reviews/approves reports' timesheets)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isPayrollAdmin} onChange={e => setIsPayrollAdmin(e.target.checked)} />
        Admin — Payroll/Finance
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isSystemAdmin} onChange={e => setIsSystemAdmin(e.target.checked)} />
        Admin — System
      </label>
    </div>
  )
}

function NewUserModal({ onClose, onCreated, users }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [department, setDepartment] = useState('')
  const [deptCode, setDeptCode] = useState('')
  const [doesTimesheets, setDoesTimesheets] = useState(true)
  const [employmentType, setEmploymentType] = useState('employee')
  const [reportsTo, setReportsTo] = useState('')
  const [canApprove, setCanApprove] = useState(false)
  const [isPayrollAdmin, setIsPayrollAdmin] = useState(false)
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  const [hasCtpAccess, setHasCtpAccess] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true); setError('')
    try {
      const r = await api.post('/admin/users', {
        full_name: fullName, username, department: department || null, dept_code: deptCode || null,
        employment_type: employmentType, reports_to: reportsTo || null,
        does_timesheets: doesTimesheets, can_approve: canApprove,
        is_payroll_admin: isPayrollAdmin, is_system_admin: isSystemAdmin,
        has_ctp_access: hasCtpAccess,
      })
      if (r.initial_pin) onCreated({ title: `Initial PIN for ${fullName}`, value: r.initial_pin })
      else if (r.initial_password) onCreated({ title: `Initial password for ${fullName}`, value: r.initial_password })
      else onCreated(null)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>New user</h2>
        {error && <div className="banner banner-error">{error}</div>}
        <input className="input" placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} style={{ marginBottom: 10 }} />
        <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ marginBottom: 10 }} />
        <input className="input" placeholder="Department (e.g. Wiring, Coach Sup)" value={department} onChange={e => setDepartment(e.target.value)} style={{ marginBottom: 10 }} />
        <DeptCodeSelect value={deptCode} onChange={setDeptCode} />
        {doesTimesheets && (
          <select className="input" value={employmentType} onChange={e => setEmploymentType(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="employee">Employee</option>
            <option value="contractor">Contractor</option>
          </select>
        )}
        <select className="input" value={reportsTo} onChange={e => setReportsTo(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">No line manager</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <CapabilityCheckboxes
          doesTimesheets={doesTimesheets} setDoesTimesheets={setDoesTimesheets}
          canApprove={canApprove} setCanApprove={setCanApprove}
          isPayrollAdmin={isPayrollAdmin} setIsPayrollAdmin={setIsPayrollAdmin}
          isSystemAdmin={isSystemAdmin} setIsSystemAdmin={setIsSystemAdmin}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 14 }}>
          <input type="checkbox" checked={hasCtpAccess} onChange={e => setHasCtpAccess(e.target.checked)} />
          CTP access — can log time to CTP builds
        </label>
        {(isPayrollAdmin || isSystemAdmin) && (
          <div className="banner banner-warn" style={{ marginBottom: 14 }}>Admin tier — a password will be generated and shown once; they'll be walked through MFA enrolment (QR code + backup codes) on first sign-in.</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving || !fullName || !username}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Working Cost Codes v1.1 §2.5: which catalogue department the person
// books admin time to — picks their default non-project code (IL-DA for
// wiring, CL-AD for coachbuild…). Separate from the free-text department.
function DeptCodeSelect({ value, onChange }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ marginBottom: 10 }}>
      <option value="">Cost-code department: none</option>
      <option value="CL">CL · Coachbuild</option>
      <option value="WW">WW · Woodwork</option>
      <option value="EL">EL · Engineering</option>
      <option value="IL">IL · Wiring</option>
      <option value="PM">PM · Project Management</option>
    </select>
  )
}

function EditUserModal({ user, onClose, onSaved, users }) {
  const [department, setDepartment] = useState(user.department || '')
  const [deptCode, setDeptCode] = useState(user.dept_code || '')
  const [employmentType, setEmploymentType] = useState(user.employment_type || 'employee')
  const [reportsTo, setReportsTo] = useState(user.reports_to || '')
  const [canApprove, setCanApprove] = useState(user.can_approve)
  const [isPayrollAdmin, setIsPayrollAdmin] = useState(user.is_payroll_admin)
  const [isSystemAdmin, setIsSystemAdmin] = useState(user.is_system_admin)
  const [hasCtpAccess, setHasCtpAccess] = useState(user.has_ctp_access)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true); setError('')
    try {
      const r = await api.patch(`/admin/users/${user.id}`, {
        department: department || null, dept_code: deptCode || null, employment_type: employmentType, reports_to: reportsTo || null,
        can_approve: canApprove, is_payroll_admin: isPayrollAdmin, is_system_admin: isSystemAdmin,
        has_ctp_access: hasCtpAccess,
      })
      onSaved(r.initial_password ? { title: `Initial password for ${user.full_name}`, value: r.initial_password } : null)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Edit {user.full_name}</h2>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{user.username}</div>
        {error && <div className="banner banner-error">{error}</div>}
        <input className="input" placeholder="Department (e.g. Wiring, Coach Sup)" value={department} onChange={e => setDepartment(e.target.value)} style={{ marginBottom: 10 }} />
        <DeptCodeSelect value={deptCode} onChange={setDeptCode} />
        <select className="input" value={employmentType} onChange={e => setEmploymentType(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="employee">Employee</option>
          <option value="contractor">Contractor</option>
        </select>
        <select className="input" value={reportsTo} onChange={e => setReportsTo(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">No line manager</option>
          {users.filter(u => u.id !== user.id).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <CapabilityCheckboxes
          doesTimesheets={user.does_timesheets} setDoesTimesheets={() => {}}
          canApprove={canApprove} setCanApprove={setCanApprove}
          isPayrollAdmin={isPayrollAdmin} setIsPayrollAdmin={setIsPayrollAdmin}
          isSystemAdmin={isSystemAdmin} setIsSystemAdmin={setIsSystemAdmin}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 14 }}>
          <input type="checkbox" checked={hasCtpAccess} onChange={e => setHasCtpAccess(e.target.checked)} />
          CTP access — can log time to CTP builds
        </label>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, marginTop: -8 }}>
          Does-timesheets isn't editable here — use Reset PIN to (re)issue one, there's no toggle to remove PIN access this batch.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Projects (availability) ─────────────────────────────────────
// Two independent controls (Admin Scope Section 6): Open/Closed mirrors
// whether QW itself considers the project live; "Timesheet" is the
// separate Stage 1 global switch that must be deliberately turned on
// before anyone can log to it at all, even an already-open project.
function ProjectsTab() {
  const [projects, setProjects] = useState([])
  const [q, setQ] = useState('')
  const [managingVisibility, setManagingVisibility] = useState(null) // project row

  function load() { api.get(`/admin/projects${q ? `?q=${q}` : ''}`).then(setProjects).catch(() => {}) }
  useEffect(load, [q])

  async function close(id) { await api.post(`/admin/projects/${id}/close`); load() }
  async function reopen(id) { await api.post(`/admin/projects/${id}/reopen`); load() }
  async function enableTimesheet(id) { await api.post(`/admin/projects/${id}/enable-timesheet`); load() }
  async function disableTimesheet(id) { await api.post(`/admin/projects/${id}/disable-timesheet`); load() }

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Project availability</h2>
      <input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 14, maxWidth: 320 }} />
      <div className="card">
        {projects.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.project_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                QW status: {p.qw_status} · synced {new Date(p.last_synced_at).toLocaleString('en-GB')}
                {p.closed_reason && !p.effective_open && <span style={{ color: 'var(--status-bad-text)' }}> · {p.closed_reason}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span className="tag" style={{ background: p.effective_open ? 'var(--status-good-bg)' : 'var(--status-bad-bg)', color: p.effective_open ? 'var(--status-good-text)' : 'var(--status-bad-text)' }}>
                {p.effective_open ? 'Open' : 'Closed'}
              </span>
              {p.effective_open
                ? <button className="btn btn-danger btn-sm" onClick={() => close(p.id)}>Close</button>
                : <button className="btn btn-ghost btn-sm" onClick={() => reopen(p.id)}>Reopen</button>}
              <span className="tag" style={{ background: p.timesheet_enabled ? 'var(--status-good-bg)' : 'var(--bg3)', color: p.timesheet_enabled ? 'var(--status-good-text)' : 'var(--text3)' }}>
                {p.timesheet_enabled ? 'Timesheet: on' : 'Timesheet: off'}
              </span>
              {p.timesheet_enabled
                ? <button className="btn btn-danger btn-sm" onClick={() => disableTimesheet(p.id)}>Turn off</button>
                : <button className="btn btn-primary btn-sm" onClick={() => enableTimesheet(p.id)}>Turn on</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setManagingVisibility(p)}>Visibility</button>
            </div>
          </div>
        ))}
        {projects.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No projects match.</div>}
      </div>
      {managingVisibility && (
        <ProjectVisibilityModal project={managingVisibility} onClose={() => setManagingVisibility(null)} />
      )}
    </div>
  )
}

// Per-project visibility list (Section 6.2) — only contractors need
// adding here; an employee is visible by default once a project's
// Timesheet switch is on.
function ProjectVisibilityModal({ project, onClose }) {
  const [granted, setGranted] = useState([])
  const [contractors, setContractors] = useState([])
  const [addId, setAddId] = useState('')
  const [error, setError] = useState('')

  function load() {
    api.get(`/admin/projects/${project.id}/visibility`).then(setGranted).catch(e => setError(e.message))
  }
  useEffect(() => {
    load()
    api.get('/admin/users?employment_type=contractor&status=active').then(setContractors).catch(() => {})
  }, [])

  async function add() {
    if (!addId) return
    try {
      await api.post(`/admin/projects/${project.id}/visibility`, { user_id: addId })
      setAddId(''); load()
    } catch (err) { setError(err.message) }
  }
  async function remove(userId) {
    await api.delete(`/admin/projects/${project.id}/visibility/${userId}`).catch(e => setError(e.message))
    load()
  }

  const addableContractors = contractors.filter(c => !granted.some(g => g.id === c.id))

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Visibility — {project.project_name}</h2>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
          Contractors added here can see and log to this project. Employees always can, once Timesheet is on.
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <select className="input" value={addId} onChange={e => setAddId(e.target.value)}>
            <option value="">Add a contractor…</option>
            {addableContractors.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={!addId}>Add</button>
        </div>
        <div className="card">
          {granted.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <span>{g.full_name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(g.id)}>Remove</button>
            </div>
          ))}
          {granted.length === 0 && <div style={{ padding: 14, color: 'var(--text3)' }}>No contractors added yet.</div>}
        </div>
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// ── CTP builds (CTP Integration Scope Section 3) ────────────────────
// Populated primarily by the hourly pull from app.ctpsystems.co.uk; the
// manual Add below is a fallback for a build with no CTP-app counterpart
// yet. is_active is a manual kill-switch independent of the sync's own
// open/closed (post-ship-window) judgement, shown alongside it.
function CtpBuildsTab() {
  const [builds, setBuilds] = useState([])
  const [report, setReport] = useState([])
  const [syncLog, setSyncLog] = useState([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  function load() {
    api.get('/admin/ctp-builds').then(setBuilds).catch(e => setError(e.message))
    api.get('/admin/reports/ctp-hours').then(setReport).catch(() => {})
    api.get('/admin/ctp-sync-log').then(setSyncLog).catch(() => {})
  }
  useEffect(load, [])

  async function add() {
    if (!newName.trim()) return
    try {
      await api.post('/admin/ctp-builds', { name: newName.trim() })
      setNewName(''); load()
    } catch (err) { setError(err.message) }
  }
  async function toggleActive(b) {
    await api.patch(`/admin/ctp-builds/${b.id}`, { is_active: !b.is_active }).catch(e => setError(e.message))
    load()
  }

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 6 }}>CTP builds</h2>
      {syncLog.map(s => (
        <p key={s.sync_type} style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
          Last {s.sync_type} {s.sync_direction}: {s.status} — {s.detail} ({new Date(s.started_at).toLocaleString('en-GB')})
        </p>
      ))}
      {error && <div className="banner banner-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <input className="input" placeholder="Manually add a build with no CTP-app counterpart…" value={newName} onChange={e => setNewName(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn btn-primary btn-sm" onClick={add} disabled={!newName.trim()}>Add</button>
      </div>
      <div className="card" style={{ marginBottom: 24 }}>
        {builds.map(b => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ opacity: b.is_active ? 1 : 0.5 }}>
              <div style={{ fontWeight: 600 }}>{b.qty_open > 1 ? `${b.qty_open} x ` : ''}{b.sku || b.name}{b.order_ref ? ` / ${b.order_ref}` : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {b.customer || (b.ctp_ref ? '' : 'Manually added')}
                {!b.synced_open && b.ctp_ref && ' · closed (past ship window)'}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(b)}>{b.is_active ? 'Deactivate' : 'Reactivate'}</button>
          </div>
        ))}
        {builds.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No builds yet.</div>}
      </div>

      <h2 style={{ fontSize: 17, marginBottom: 14 }}>Hours by build</h2>
      <div className="card">
        {report.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ opacity: r.is_active ? 1 : 0.5 }}>{r.order_ref ? `${r.order_ref} — ${r.sku || r.name}` : (r.sku || r.name)}{!r.is_active && ' (inactive)'}</span>
            <span style={{ fontWeight: 600 }}>{Number(r.total_hours)} hrs</span>
          </div>
        ))}
        {report.length === 0 && <div style={{ padding: 16, color: 'var(--text3)' }}>No CTP time logged yet.</div>}
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
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {c.code_type === 'project' ? 'Project code, from QW catalogue' : 'Non-project code'} · Department: {c.department}{!c.is_active ? ' · inactive' : ''}
              </div>
            </div>
            {c.code_type === 'project' ? (
              <span style={{ fontWeight: 600 }}>{c.current_rate != null ? `£${Number(c.current_rate).toFixed(2)}/hr` : 'no rate'}</span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>£</span>
                <input
                  className="input" style={{ width: 90 }} defaultValue={c.current_rate ?? ''}
                  onBlur={e => setRate(c.id, e.target.value)}
                  placeholder="rate/hr"
                />
              </div>
            )}
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

// ── Send approved hours (Actual Hours Feedback Design v1.0 §3, unified per
// CTP Integration Scope §8) — one button, routes each entry to QW or CTP by
// type rather than two separate screens. ──────────────────
function SendHoursTab() {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  function loadPreview() {
    // Deliberately leaves `result` alone — a commit reloads the preview
    // straight after, and clearing it here is what used to wipe the
    // outcome before anyone could read it.
    setLoading(true); setError('')
    api.get('/admin/send-hours/preview').then(setPreview).catch(e => setError(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { loadPreview() }, [])

  const totalHours = (preview?.qw.total_hours || 0) + (preview?.ctp.total_hours || 0)
  const totalEntries = (preview?.qw.total_entries || 0) + (preview?.ctp.total_entries || 0)

  async function send() {
    if (!window.confirm(`Send ${totalHours} hours (${preview.qw.total_hours}h to QW, ${preview.ctp.total_hours}h to CTP)?`)) return
    setSending(true); setError('')
    try {
      const r = await api.post('/admin/send-hours/commit')
      setResult(r)
      loadPreview()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text3)' }}>Loading…</div>

  return (
    <div>
      <h2 style={{ fontSize: 17, marginBottom: 6 }}>Send approved hours</h2>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Approved hours not yet sent — project time goes to QW, build-linked CTP time goes to CTP. Non-project time and non-build CTP time never cross — they stay in Timesheet only.
      </p>
      {error && <div className="banner banner-error">{error}</div>}

      {result && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last send result</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>Dismiss</button>
          </div>
          {result.qw && (
            <SendResultBlock
              label="QW"
              counts={[
                `${result.qw.inserted ?? result.qw.succeeded} sent`,
                `${result.qw.already_present ?? 0} already present`,
                `${result.qw.failed} failed`,
              ]}
              attempted={result.qw.attempted}
              failed={result.qw.failed}
              failures={result.qw.failures.map(f => ({ ...f, where: f.project_name || f.project || '(no project)' }))}
            />
          )}
          {result.ctp && (
            <div style={{ marginTop: result.qw ? 14 : 0 }}>
              <SendResultBlock
                label="CTP"
                counts={[`${result.ctp.succeeded} sent`, `${result.ctp.failed} failed`]}
                attempted={result.ctp.attempted}
                failed={result.ctp.failed}
                failures={result.ctp.failures.map(f => ({ ...f, where: f.build || '(no build)' }))}
              />
            </div>
          )}
        </div>
      )}

      {preview && totalEntries === 0 && (
        <div className="card" style={{ padding: 16, color: 'var(--text3)' }}>Nothing to send — everything approved has already gone across.</div>
      )}

      {preview && totalEntries > 0 && (
        <>
          {preview.qw.unmapped_people.length > 0 && (
            <div className="banner banner-warn" style={{ marginBottom: 16 }}>
              No QW account mapping for: {preview.qw.unmapped_people.join(', ')} — their hours will be reported as failed until this is fixed.
            </div>
          )}

          {preview.qw.total_entries > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>To QW — by project</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {preview.qw.by_project.map(p => (
                  <div key={p.qw_project_number} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <span>{p.project_name || p.qw_project_number}</span>
                    <span style={{ fontWeight: 600 }}>{p.hours}h ({p.entry_count})</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', fontWeight: 700 }}>
                  <span>Total</span>
                  <span>{preview.qw.total_hours}h</span>
                </div>
              </div>
            </>
          )}

          {preview.ctp.total_entries > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>To CTP — by build</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {preview.ctp.by_build.map(b => (
                  <div key={b.ctp_build_ref} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <span>{b.order_ref} — {b.build_sku || b.build_name}</span>
                    <span style={{ fontWeight: 600 }}>{b.hours}h ({b.entry_count})</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', fontWeight: 700 }}>
                  <span>Total</span>
                  <span>{preview.ctp.total_hours}h</span>
                </div>
              </div>
            </>
          )}

          <button className="btn btn-primary" onClick={send} disabled={sending}>
            {sending ? 'Sending…' : `Send ${totalHours} hours`}
          </button>
        </>
      )}
    </div>
  )
}

// Failures sharing one reason (typically a request-level error that hit the
// whole batch) collapse into a single heading instead of N identical lines.
function SendResultBlock({ label, counts, attempted, failed, failures }) {
  const groups = new Map()
  for (const f of failures) {
    if (!groups.has(f.reason)) groups.set(f.reason, [])
    groups.get(f.reason).push(f)
  }
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 6, color: failed > 0 ? 'var(--status-bad-text)' : 'var(--status-good-text)' }}>
        {label}: {counts.join(', ')} of {attempted} attempted
      </div>
      {[...groups.entries()].map(([reason, items]) => (
        <div key={reason} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-bad-text)', marginBottom: 4, wordBreak: 'break-word' }}>
            {items.length} {items.length === 1 ? 'entry' : 'entries'}: {reason}
          </div>
          {items.map(f => (
            <div key={f.entry_id} style={{ fontSize: 13, color: 'var(--text2)', padding: '2px 0 2px 12px' }}>
              {f.person} · {String(f.entry_date).slice(0, 10)} · {f.where} · {Number(f.hours)}h
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
