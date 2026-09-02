import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

// Shows 3-4 recently-used projects by default, a search box to narrow the
// full list, non-project reasons as a separate, always-visible group
// (Section 6), and — for CTP-access staff only — CTP builds plus CTP's own
// category list (MHz_Timesheet_CTP_Integration_Scope_v1.0 Sections 3/4).
// showCtp is keyed off the entry's owner (has_ctp_access), not the logged-in
// viewer's, so a supervisor proxy-entering for a CTP person still sees it.
//
// A CTP entry is one of two shapes: pick a build then a build-linked
// category (PaP/Mill/Build/Test/Ship), or pick a non-project CTP category
// (Personal/Cleaning/.../Holiday/Sick) with no build at all — mirroring how
// project time and reason time are two separate shapes above it.
export default function ProjectReasonPicker({ value, onSelect, showCtp }) {
  const [recent, setRecent] = useState([])
  const [reasons, setReasons] = useState([])
  const [ctpBuilds, setCtpBuilds] = useState([])
  const [ctpCategories, setCtpCategories] = useState([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [allProjects, setAllProjects] = useState([])

  useEffect(() => {
    api.get('/reference/projects?recent=1').then(setRecent).catch(() => {})
    api.get('/reference/non-project-reasons').then(setReasons).catch(() => {})
    if (showCtp) {
      api.get('/reference/ctp-builds').then(setCtpBuilds).catch(() => {})
      api.get('/reference/ctp-categories').then(setCtpCategories).catch(() => {})
    }
  }, [showCtp])

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
  const buildCategories = ctpCategories.filter(c => c.kind === 'build')
  const nonProjectCtpCategories = ctpCategories.filter(c => c.kind === 'non_project')

  const selectedBuildId = value?.type === 'ctpBuild' ? value.buildId : null
  const selectedBuild = ctpBuilds.find(b => b.id === selectedBuildId)

  function pickBuild(b) {
    // Keep the already-picked category if there is one — switching which
    // build the same category applies to is a common correction.
    const categoryId = value?.type === 'ctpBuild' ? value.categoryId : null
    const category = buildCategories.find(c => c.id === categoryId)
    onSelect({
      type: 'ctpBuild', buildId: b.id, categoryId,
      label: category ? `${b.order_ref || b.name} · ${category.name}` : (b.order_ref || b.name),
      requiresComment: !!category?.requires_comment,
    })
  }

  function pickBuildCategory(c) {
    if (!selectedBuildId) return
    onSelect({
      type: 'ctpBuild', buildId: selectedBuildId, categoryId: c.id,
      label: `${selectedBuild?.order_ref || selectedBuild?.name} · ${c.name}`,
      requiresComment: !!c.requires_comment,
    })
  }

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

      {showCtp && ctpBuilds.length > 0 && (
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
                  background: selectedBuildId === b.id ? 'var(--accent)' : 'var(--bg3)',
                  color: selectedBuildId === b.id ? '#fff' : 'var(--text)',
                }}
                onClick={() => pickBuild(b)}
              >
                {b.order_ref || b.name} — {b.name}
              </button>
            ))}
          </div>

          {selectedBuildId && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '12px 0 8px' }}>
                What on this build?
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {buildCategories.map(c => (
                  <button
                    key={c.id}
                    className="btn btn-sm"
                    style={{
                      background: value?.type === 'ctpBuild' && value.categoryId === c.id ? 'var(--accent)' : 'var(--bg3)',
                      color: value?.type === 'ctpBuild' && value.categoryId === c.id ? '#fff' : 'var(--text)',
                    }}
                    onClick={() => pickBuildCategory(c)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showCtp && nonProjectCtpCategories.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 8px' }}>
            CTP — not build work
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {nonProjectCtpCategories.map(c => (
              <button
                key={c.id}
                className="btn btn-sm"
                style={{
                  background: value?.type === 'ctpCategory' && value.categoryId === c.id ? 'var(--accent)' : 'var(--bg3)',
                  color: value?.type === 'ctpCategory' && value.categoryId === c.id ? '#fff' : 'var(--text)',
                }}
                onClick={() => onSelect({ type: 'ctpCategory', categoryId: c.id, label: c.name, requiresComment: !!c.requires_comment })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
