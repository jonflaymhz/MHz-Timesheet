import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { WeekSwitch, StatusChip, StatusMessages, lockedFootNote } from './WeekBits.jsx'
import AddTimeSheet from './AddTimeSheet.jsx'
import { Close, Plus } from './Icons.jsx'
import { weekdayName, dayOfMonth, londonDate } from '../lib/dates.js'
import { fmtH, lineKey, entryTitle, entryBody, replaceEntries, SHORT_DAY, DAILY_CAP } from '../lib/week.js'

function lineSub(e) {
  if (e.ctp_build_id) return e.ctp_category_name
  if (e.cost_code) return `${e.cost_code}${e.cost_code_description ? ' · ' + e.cost_code_description : ''}`
  return 'CTP'
}

// One typed cell. Commits on blur or Enter; Escape puts the value back.
function Cell({ value, label, weekend, onCommit }) {
  const shown = value ? fmtH(value) : ''
  const [text, setText] = useState(shown)
  useEffect(() => { setText(shown) }, [shown])
  function commit() {
    if (text.trim() === shown) return
    onCommit(text.trim(), () => setText(shown))
  }
  return (
    <input
      className={`cell-input${weekend ? ' weekend' : ''}`} inputMode="decimal" aria-label={label}
      value={text} onChange={e => setText(e.target.value.replace(/[^0-9.:]/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setText(shown); e.currentTarget.blur() }
      }}
    />
  )
}

// "7.5", "7:30" or "" → hours, or null if not a valid amount.
function parseHours(t) {
  if (t === '') return 0
  let h
  if (t.includes(':')) {
    const [a, b = '0'] = t.split(':')
    h = Number(a || 0) + Number(b || 0) / 60
  } else h = Number(t)
  if (!Number.isFinite(h) || h < 0) return null
  return h
}

function completeness(states) {
  const lines = []
  let run = []
  const flush = () => {
    if (!run.length) return
    const label = run.length === 1 ? weekdayName(run[0].date) : `${SHORT_DAY[weekdayName(run[0].date)]} to ${SHORT_DAY[weekdayName(run[run.length - 1].date)]}`
    lines.push({ cls: 'ok', text: `${label}: Complete` })
    run = []
  }
  for (const s of states) {
    if (s.weekend && s.total === 0) continue
    if (s.state === 'complete') { run.push(s); continue }
    flush()
    if (s.state === 'missing') lines.push({ cls: 'missing', text: `${weekdayName(s.date)}: Needs hours or a reason` })
    else if (s.state === 'short') lines.push({ cls: 'short', text: `${weekdayName(s.date)}: ${fmtH(s.shortBy)} h short` })
    else if (s.state === 'off') lines.push({ cls: '', text: `${weekdayName(s.date)}: ${s.note}` })
  }
  flush()
  return lines
}

// Desktop My week (Employee UI Redesign v1.0 §5): a grid with one row per
// project/reason and type of work, hours typed straight into the cells.
export default function DesktopWeek({
  week, entries, states, colours, total, editable, onGo, onRefresh, onAbsence, onRemoveMarker,
  error, setError, blocker, submitting, onSubmit, resubmit, confirmText, goesTo, approverName, review,
}) {
  const [pending, setPending] = useState([]) // lines added with no hours yet
  const [addLine, setAddLine] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const today = londonDate()
  useEffect(() => { setPending([]); setConfirmed(false) }, [week.id])

  const rows = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (e.is_non_work_marker) continue
      const k = lineKey(e)
      if (!map.has(k)) map.set(k, { key: k, sample: e, entries: [] })
      map.get(k).entries.push(e)
    }
    const real = [...map.values()]
    const extra = pending.filter(p => !map.has(p.key))
    return [...real, ...extra]
  }, [entries, pending])

  async function commitCell(row, date, text, revert) {
    const h = parseHours(text)
    if (h === null || h > DAILY_CAP || Math.round(h * 4) !== h * 4) {
      setError('Hours go in 15-minute steps, e.g. 7.5 or 7:30, up to 14 a day.')
      revert(); return
    }
    const olds = row.entries.filter(e => e.entry_date === date)
    const current = olds.reduce((s, e) => s + Number(e.hours), 0)
    if (h === current) { revert(); return }
    const t = row.sample
    const body = h > 0 ? {
      ...entryBody(t), entry_date: date, hours: h,
      description: olds.find(o => o.description)?.description || null,
    } : null
    setBusy(true); setError('')
    try {
      await replaceEntries(week.id, olds, body)
    } catch (err) {
      setError(err.message)
      revert()
    } finally {
      setBusy(false)
      onRefresh()
    }
  }

  async function removeRow(row) {
    if (!row.entries.length) { setPending(p => p.filter(x => x.key !== row.key)); return }
    if (!window.confirm(`Remove ${entryTitle(row.sample)} and its ${fmtH(row.entries.reduce((s, e) => s + Number(e.hours), 0))} h from this week?`)) return
    setBusy(true); setError('')
    try {
      for (const e of row.entries) await api.delete(`/weeks/${week.id}/entries/${e.id}`)
    } catch (err) { setError(err.message) } finally { setBusy(false); onRefresh() }
  }

  const comp = completeness(states)
  const foot = lockedFootNote(week, approverName)

  return (
    <>
      <WeekSwitch week={week} onGo={onGo}><StatusChip status={week.status} /></WeekSwitch>
      <div className="desk">
        <div>
          <StatusMessages week={week} approverName={approverName} />
          {error && <div className="banner banner-error" role="alert">{error}</div>}
          <div className="grid-wrap">
            <table className="grid" aria-busy={busy}>
              <thead>
                <tr>
                  <th className="line-cell" scope="col">Project and type of work</th>
                  {states.map(s => (
                    <th key={s.date} scope="col" className={s.date === today ? 'today' : ''}>
                      {SHORT_DAY[weekdayName(s.date)]}<span className="d">{dayOfMonth(s.date)}</span>
                    </th>
                  ))}
                  <th scope="col">Total</th>
                  {editable && <th scope="col"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const rowTotal = row.entries.reduce((s, e) => s + Number(e.hours), 0)
                  const title = entryTitle(row.sample)
                  return (
                    <tr key={row.key}>
                      <td className="line-cell">
                        <div className="line-name"><span className="dot" style={{ background: colours.get(row.key) || 'var(--dot-a)' }} /><span title={title}>{title}</span></div>
                        <div className="line-sub" title={lineSub(row.sample)}>{lineSub(row.sample)}</div>
                      </td>
                      {states.map(s => {
                        const v = row.entries.filter(e => e.entry_date === s.date).reduce((a, e) => a + Number(e.hours), 0)
                        return (
                          <td key={s.date}>
                            {editable
                              ? <Cell value={v} weekend={s.weekend} label={`${title}, ${weekdayName(s.date)}`}
                                  onCommit={(t, revert) => commitCell(row, s.date, t, revert)} />
                              : <span className="cell-ro">{v ? fmtH(v) : ''}</span>}
                          </td>
                        )
                      })}
                      <td className="row-total">{fmtH(rowTotal)}</td>
                      {editable && (
                        <td><button type="button" className="icon-btn" aria-label={`Remove line ${title}`} onClick={() => removeRow(row)} disabled={busy}><Close width={18} height={18} /></button></td>
                      )}
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={editable ? 10 : 9} style={{ padding: 18, color: 'var(--muted)' }}>{editable ? 'No time yet. Add a line to start.' : 'Nothing booked this week.'}</td></tr>
                )}
                {editable && (
                  <tr>
                    <td className="line-cell" colSpan={10}>
                      <button type="button" className="add-line" onClick={() => setAddLine(true)}><Plus width={18} height={18} />Add a line</button>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="line-cell">Day total</td>
                  {states.map(s => (
                    <td key={s.date} className={s.state === 'short' ? 'short' : s.state === 'missing' ? 'missing' : ''}
                      title={s.state === 'short' ? `${fmtH(s.shortBy)} h short` : undefined}>
                      {fmtH(s.total)}
                      {s.state === 'short' && <span className="short-note">{fmtH(s.shortBy)} h short</span>}
                    </td>
                  ))}
                  <td>{fmtH(total)}</td>
                  {editable && <td />}
                </tr>
                <tr className="under">
                  <td className="line-cell" />
                  {states.map(s => (
                    <td key={s.date}>
                      {s.marker && (
                        <span className="marker-chip">
                          {s.marker.description ? 'Other' : 'Not contracted'}
                          {editable && <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => onRemoveMarker(s.marker)} aria-label={`Remove not working from ${weekdayName(s.date)}`}>Remove</button>}
                        </span>
                      )}
                      {editable && s.state === 'missing' && (
                        <button type="button" className="under-btn" onClick={() => onAbsence(s.date, 0)} aria-label={`${weekdayName(s.date)}: not working`}>Not working</button>
                      )}
                      {editable && s.state === 'short' && (
                        <button type="button" className="under-btn" onClick={() => onAbsence(s.date, s.shortBy)} aria-label={`${weekdayName(s.date)}: absence`}>Absence</button>
                      )}
                    </td>
                  ))}
                  <td />
                  {editable && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <aside className="panel" aria-label="Week status">
          <div className="summary-label" style={{ color: 'var(--muted)' }}>Week total</div>
          <div className="panel-total">{fmtH(total)}<small style={{ fontSize: 16, color: 'var(--muted)', marginLeft: 4 }}>h</small></div>
          <h3>Days</h3>
          {comp.map((l, i) => (
            <div key={i} className={`comp-line ${l.cls}`}>
              <span className="dot" style={{ background: l.cls === 'ok' ? 'var(--ok)' : l.cls === 'short' ? 'var(--warn-bar)' : l.cls === 'missing' ? 'var(--bad)' : 'var(--dot-abs)' }} />
              <span>{l.text}</span>
            </div>
          ))}
          {editable ? (
            <>
              <label className="confirm">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                <span>{confirmText}</span>
              </label>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={!!blocker || !confirmed || submitting || busy} onClick={onSubmit}>
                {submitting ? 'Submitting…' : resubmit ? 'Resubmit week' : 'Submit week'}
              </button>
              <p className="help" style={{ textAlign: 'center' }}>{blocker || goesTo}</p>
            </>
          ) : foot && <p className="help" style={{ marginTop: 16 }}>{foot}</p>}
          {review}
        </aside>
      </div>

      {addLine && (
        <AddTimeSheet week={week} lineOnly dayTotal={0}
          onClose={() => setAddLine(false)}
          onPickLine={(sample) => {
            const key = lineKey(sample)
            setPending(p => p.some(x => x.key === key) ? p : [...p, { key, sample, entries: [] }])
          }}
          onSaved={() => {}} />
      )}
    </>
  )
}
