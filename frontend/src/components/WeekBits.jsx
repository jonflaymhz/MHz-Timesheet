import { ChevronLeft, ChevronRight, Lock } from './Icons.jsx'
import { addDays, fmtRangeWords, fmtStampDate } from '../lib/dates.js'
import { STATUS_LABEL } from '../lib/week.js'

export function WeekSwitch({ week, onGo, children }) {
  return (
    <div className="week-switch">
      <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => onGo(addDays(week.week_start_date, -7))}><ChevronLeft /></button>
      <div className="week-switch-title">
        <strong>Week {week.week_number}</strong>
        <span>{fmtRangeWords(week.week_start_date, week.week_end_date)}</span>
      </div>
      {children}
      <button type="button" className="icon-btn" aria-label="Next week" onClick={() => onGo(addDays(week.week_start_date, 7))}><ChevronRight /></button>
    </div>
  )
}

export function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status] || status}</span>
}

// Sent back / Submitted / Approved messages (Employee UI Redesign v1.0 §7).
export function StatusMessages({ week, approverName }) {
  if (week.status === 'rejected') {
    return (
      <div className="sent-back" role="status">
        <strong>{week.rejected_by_name || 'Your supervisor'}</strong> sent this back{week.rejected_at ? ` on ${fmtStampDate(week.rejected_at)}` : ''}
        {week.rejection_reason && <q>{week.rejection_reason}</q>}
      </div>
    )
  }
  if (week.status === 'submitted') {
    return <div className="lock-line"><Lock />Waiting for {approverName} to approve</div>
  }
  if (week.status === 'approved') {
    return (
      <div className="lock-line"><Lock />
        Approved{week.approved_by_name ? ` by ${week.approved_by_name}` : ''}{week.approved_at ? ` on ${fmtStampDate(week.approved_at)}` : ''}. Locked.
      </div>
    )
  }
  return null
}

export function lockedFootNote(week, approverName) {
  if (week.status === 'submitted') return `Can't be changed while waiting. If it's wrong, ask ${approverName} to send it back.`
  if (week.status === 'approved') return 'Something wrong? Ask the office to correct it.'
  return null
}
