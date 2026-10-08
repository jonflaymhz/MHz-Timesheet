import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import DayCard from '../components/DayCard.jsx'
import AddTimeSheet from '../components/AddTimeSheet.jsx'
import AbsenceSheet from '../components/AbsenceSheet.jsx'
import Sheet from '../components/Sheet.jsx'
import DesktopWeek from '../components/DesktopWeek.jsx'
import ReviewPanel from '../components/ReviewPanel.jsx'
import { WeekSwitch, StatusChip, StatusMessages, lockedFootNote } from '../components/WeekBits.jsx'
import { weekdayName } from '../lib/dates.js'
import { canApprove } from '../lib/capabilities.js'
import { fmtH, weekDayStates, submitBlocker, dotColours, firstName } from '../lib/week.js'

export default function WeekPage() {
  const { user } = useAuth()
  const desktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const forUserId = searchParams.get('for')
  const weekStartParam = searchParams.get('week_start')

  const [week, setWeek] = useState(null)
  const [entries, setEntries] = useState([])
  const [approval, setApproval] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [openDays, setOpenDays] = useState(new Set())
  const [addSheet, setAddSheet] = useState(null)      // { date, entry? }
  const [absenceSheet, setAbsenceSheet] = useState(null) // { date, shortBy }
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)

  const load = useCallback(async ({ quiet } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const path = forUserId
        ? `/weeks/for/${forUserId}${weekStartParam ? `?week_start=${weekStartParam}` : ''}`
        : `/weeks/mine${weekStartParam ? `?week_start=${weekStartParam}` : ''}`
      const data = await api.get(path)
      setWeek(data.week)
      setEntries(data.entries)
      setApproval(data.approval || null)
      if (!quiet) setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [forUserId, weekStartParam])

  useEffect(() => { load() }, [load])
  const refresh = useCallback(() => load({ quiet: true }), [load])

  const editable = !!week && (week.status === 'draft' || week.status === 'rejected')
  const states = useMemo(() => (week ? weekDayStates(week, entries) : []), [week, entries])
  const colours = useMemo(() => dotColours(entries), [entries])

  // Smart default: days needing attention start open, complete days closed.
  // Only when a different week (or status) loads, not after every edit.
  useEffect(() => {
    if (!week) return
    const ed = week.status === 'draft' || week.status === 'rejected'
    setOpenDays(new Set(ed ? weekDayStates(week, entries).filter(s => s.state === 'missing' || s.state === 'short').map(s => s.date) : []))
    setConfirmChecked(false)
  }, [week?.id, week?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  function goToWeek(startDate) {
    const next = new URLSearchParams(searchParams)
    next.set('week_start', startDate)
    setSearchParams(next)
  }

  function toggleDay(date) {
    setOpenDays(prev => {
      const n = new Set(prev)
      if (n.has(date)) n.delete(date); else n.add(date)
      return n
    })
  }

  function jumpToDay(date) {
    setOpenDays(prev => new Set(prev).add(date))
    requestAnimationFrame(() => document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function removeMarker(marker) {
    setError('')
    try {
      await api.delete(`/weeks/${week.id}/entries/${marker.id}`)
      refresh()
    } catch (err) { setError(err.message) }
  }

  async function submit() {
    setSubmitting(true); setError('')
    try {
      await api.post(`/weeks/${week.id}/submit`, { confirmed: true })
      setConfirmOpen(false)
      await load()
      window.scrollTo({ top: 0 })
    } catch (err) {
      const missing = err.body?.missing_dates
      setError(missing ? `Week is incomplete: ${missing.map(d => weekdayName(d)).join(', ')} still need hours or a reason.` : err.message)
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !week) return <div className="page" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error && !week) return <div className="page"><div className="banner banner-error">{error}</div></div>
  if (!week) return null

  const total = entries.reduce((s, e) => s + Number(e.hours), 0)
  const isProxyView = !!forUserId && forUserId !== user?.id
  const approverName = approval?.approver_name || (isProxyView ? 'the approver' : 'your supervisor')
  const blocker = editable ? submitBlocker(week, states) : null
  const resubmit = week.status === 'rejected'
  const confirmText = isProxyView ? `I confirm these hours are accurate for ${week.owner_full_name}.` : 'I confirm these hours are accurate.'
  const goesTo = resubmit ? `Goes back to ${approverName} for approval` : `Goes to ${approverName} for approval`

  // Review (supervisor on a report's week, or self-approval), as before.
  const isSelfReview = !isProxyView && week.status === 'submitted' && approval?.allowed && approval.path === 'self'
  const canReview = (isProxyView && week.status === 'submitted' && canApprove(user) && !!approval) || isSelfReview

  const dayTotalOf = (date) => states.find(s => s.date === date)?.total || 0
  const sheets = (
    <>
      {addSheet && (
        <AddTimeSheet week={week} date={addSheet.date} entry={addSheet.entry} dayTotal={dayTotalOf(addSheet.date)}
          onClose={() => setAddSheet(null)} onSaved={refresh} />
      )}
      {absenceSheet && (
        <AbsenceSheet week={week} date={absenceSheet.date} shortBy={absenceSheet.shortBy} dayTotal={dayTotalOf(absenceSheet.date)}
          onClose={() => setAbsenceSheet(null)} onSaved={refresh} />
      )}
    </>
  )

  const proxyBanner = isProxyView && (
    <div className="banner banner-warn">
      {editable ? `Entering on behalf of ${week.owner_full_name}. This week will show as proxy-entered.` : `${week.owner_full_name}'s week.`}
    </div>
  )
  const review = canReview && <ReviewPanel key={week.id} week={week} approval={approval} isSelfReview={isSelfReview} onDone={load} />

  if (desktop) {
    return (
      <div className="page-wide">
        {proxyBanner}
        <DesktopWeek
          week={week} entries={entries} states={states} colours={colours} total={total} editable={editable}
          onGo={goToWeek} onRefresh={refresh} onAbsence={(date, shortBy) => setAbsenceSheet({ date, shortBy })}
          onRemoveMarker={removeMarker} error={error} setError={setError}
          blocker={blocker} submitting={submitting} onSubmit={submit} resubmit={resubmit}
          confirmText={confirmText} goesTo={goesTo} approverName={approverName}
          review={review}
        />
        {sheets}
      </div>
    )
  }

  return (
    <div className={`page${editable ? ' has-submit-bar' : ''}`}>
      {proxyBanner}
      <WeekSwitch week={week} onGo={goToWeek} />

      <section className="summary" aria-label="Week summary">
        <div className="summary-top">
          <div>
            <div className="summary-label">{isProxyView ? `${firstName(week.owner_full_name)}'s total` : 'Total this week'}</div>
            <div className="summary-total">{fmtH(total)}<small>h</small></div>
          </div>
          <StatusChip status={week.status} />
        </div>
        <div className="strip" role="group" aria-label="Days">
          {states.map(s => (
            <button key={s.date} type="button" onClick={() => jumpToDay(s.date)}
              aria-label={`${weekdayName(s.date)}: ${fmtH(s.total)} hours, ${s.note}`}>
              <span aria-hidden="true">{weekdayName(s.date)[0]}</span>
              <span className={`strip-bar ${s.state === 'complete' || s.state === 'off' ? 'complete' : s.state === 'short' ? 'short' : ''}`} />
            </button>
          ))}
        </div>
      </section>

      <StatusMessages week={week} approverName={approverName} />
      {error && <div className="banner banner-error" role="alert">{error}</div>}

      {states.map(s => (
        <DayCard
          key={s.date} day={s} open={openDays.has(s.date)} onToggle={() => toggleDay(s.date)}
          editable={editable} colours={colours} weekOwnerId={week.user_id}
          onAdd={() => setAddSheet({ date: s.date })}
          onEdit={(entry) => setAddSheet({ date: s.date, entry })}
          onAbsence={(shortBy) => setAbsenceSheet({ date: s.date, shortBy })}
          onRemoveMarker={removeMarker}
        />
      ))}

      {lockedFootNote(week, approverName) && <p className="foot-note">{lockedFootNote(week, approverName)}</p>}
      {review}

      {editable && (
        <div className="submit-bar">
          <div className="submit-bar-inner">
            <button type="button" className="btn btn-primary" disabled={!!blocker || submitting} onClick={() => { setConfirmChecked(false); setConfirmOpen(true) }}>
              {resubmit ? 'Resubmit week' : 'Submit week'}
            </button>
            <div className="submit-bar-note">{blocker || goesTo}</div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <Sheet title={resubmit ? 'Resubmit week' : 'Submit week'} subtitle={`Week ${week.week_number}, ${fmtH(total)} h`} onClose={() => setConfirmOpen(false)}>
          <label className="confirm">
            <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />
            <span>{confirmText}</span>
          </label>
          <button type="button" className="btn btn-primary sheet-save" style={{ marginTop: 4 }} disabled={!confirmChecked || submitting} onClick={submit}>
            {submitting ? 'Submitting…' : resubmit ? 'Resubmit week' : 'Submit week'}
          </button>
          <p className="help" style={{ textAlign: 'center' }}>{goesTo}</p>
        </Sheet>
      )}
      {sheets}
    </div>
  )
}
