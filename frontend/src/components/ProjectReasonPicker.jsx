import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

// Shows 3-4 recently-used projects by default, a search box to narrow the
// full list, non-project reasons as a separate, always-visible group
// (Section 6), and — for CTP staff only — a CTP device/build group
// (Admin Scope Section 7). showCtpBuilds is keyed off the entry's owner
// department, not the logged-in viewer's, so a supervisor proxy-entering
// for a CTP contractor still sees it.
export default function ProjectReasonPicker({ value, onSelect, showCtpBuilds }) {
  const [recent, setRecent] = useState([])
  const [reasons, setReasons] = useState([])
  const [ctpBuilds, setCtpBuilds] = useState([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [allProjects, setAllProjects] = useState([])

  useEffect(() => {
    api.get('/reference/projects?recent=1').then(setRecent).catch(() => {})
    api.get('/reference/non-project-reasons').then(setReasons).catch(() => {})
    if (showCtpBuilds) api.get('/reference/ctp-builds').then(setCtpBuilds).catch(() => {})
  }, [showCtpBuilds])

  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults(null); return }
    const t = setTimeout(() => {
      api.get(`/reference/projects?q=${encodeURIComponent(search.trim())}`).then(setSearchResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  function loadAll() {
    api.get('/reference/projects').then(r => { setAllProjects(r); setShowAll(true) }).catch(() => {})
  }

  const projectList = searchResults ?? (showAll ? allProjects : recent)

  return (
    <div>
      <input
        className="input" placeholder="Search project number or name…"
        value={search} onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {projectList.map(p => (
          <button
            key={p.id}
            className="btn-ghost btn"
            style={{
              justifyContent: 'flex-start', textAlign: 'left',
              borderColor: value?.type === 'project' && value.id === p.id ? 'var(--accent)' : 'var(--border)',
              background: value?.type === 'project' && value.id === p.id ? 'var(--accent-tint)' : '#fff',
            }}
            onClick={() => onSelect({ type: 'project', id: p.id, label: p.project_name })}
          >
            {p.project_name}
          </button>
        ))}
        {!searchResults && !showAll && (
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }} onClick={loadAll}>
            See all open projects
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Not project work
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {reasons.map(r => (
          <button
            key={r.id}
            className="btn btn-sm"
            style={{
              background: value?.type === 'reason' && value.id === r.id ? 'var(--accent)' : 'var(--bg3)',
              color: value?.type === 'reason' && value.id === r.id ? '#fff' : 'var(--text)',
            }}
            onClick={() => onSelect({ type: 'reason', id: r.id, label: r.name })}
          >
            {r.name}
          </button>
        ))}
      </div>

      {showCtpBuilds && ctpBuilds.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 8px' }}>
            CTP build
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ctpBuilds.map(b => (
              <button
                key={b.id}
                className="btn btn-sm"
                style={{
                  background: value?.type === 'ctpBuild' && value.id === b.id ? 'var(--accent)' : 'var(--bg3)',
                  color: value?.type === 'ctpBuild' && value.id === b.id ? '#fff' : 'var(--text)',
                }}
                onClick={() => onSelect({ type: 'ctpBuild', id: b.id, label: b.name })}
              >
                {b.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
