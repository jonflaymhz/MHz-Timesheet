// Day states, labels and entry helpers shared by the phone and desktop week
// views (Employee UI Redesign v1.0 §2, §5).
import { api } from './api.js'
import { addDays, weekdayName, londonDate } from './dates.js'

export const DEFAULT_STANDARD_DAY = 7.5
export const DAILY_CAP = 14

export function fmtH(h) {
  const n = Math.round(Number(h || 0) * 100) / 100
  return Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, '')
}

export const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Sent back' }

export function weekDates(week) {
  return Array.from({ length: 7 }, (_, i) => addDays(week.week_start_date, i))
}

export function isWeekend(date) {
  const n = weekdayName(date)
  return n === 'Saturday' || n === 'Sunday'
}

export const SHORT_DAY = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }

// Leave-type reasons and CTP categories get the grey absence dot.
const ABSENCE_NAMES = new Set(['Holiday', 'Bank Holiday', 'Sickness', 'Sick', 'Unpaid Leave', 'Paternity Leave', 'Compassionate Leave', 'Hospital Appointment'])

// One identity per line of work: what it's booked to plus its type of work.
export function lineKey(e) {
  if (e.is_non_work_marker) return 'marker'
  return [e.project_ref_id, e.reason_id, e.ctp_build_id, e.ctp_category_id, e.cost_code_id].map(v => v || '-').join('|')
}

export function isAbsence(e) {
  if (e.is_non_work_marker) return true
  if (e.reason_id) return ABSENCE_NAMES.has(e.reason_name)
  if (e.ctp_category_id && !e.ctp_build_id) return ABSENCE_NAMES.has(e.ctp_category_name)
  return false
}

// Navy and orange alternate between the week's distinct lines of work, in
// the order they first appear; absence is grey.
export function dotColours(entries) {
  const map = new Map()
  let n = 0
  for (const e of entries) {
    const k = lineKey(e)
    if (map.has(k)) continue
    map.set(k, isAbsence(e) ? 'var(--dot-abs)' : (n++ % 2 === 0 ? 'var(--dot-a)' : 'var(--dot-b)'))
  }
  return map
}

export function ctpBuildIdentity(b) {
  if (!b) return ''
  return [b.sku || b.name, b.qty_open, b.order_ref || 'manual', b.customer].filter(Boolean).join(', ')
}

export function entryTitle(e) {
  if (e.is_non_work_marker) return e.description ? 'Other' : 'Not contracted to work'
  if (e.project_name) return e.project_name
  if (e.reason_name) return e.reason_name
  if (e.ctp_build_name) return `${e.ctp_build_sku || e.ctp_build_name} / ${e.ctp_build_order_ref}${e.ctp_build_customer ? ' / ' + e.ctp_build_customer : ''}`
  return e.ctp_category_name || 'Entry'
}

export function entrySubtitle(e) {
  if (e.is_non_work_marker) return e.description || 'Not working'
  const parts = []
  if (e.ctp_build_name) parts.push(e.ctp_category_name)
  else if (e.cost_code) parts.push(`${e.cost_code}${e.cost_code_description ? ' · ' + e.cost_code_description : ''}`)
  else parts.push('CTP')
  if (e.description) parts.push(e.description)
  return parts.join(' · ')
}

// State of one day (§2 table). `leaveDate` is a closing leaver's last day;
// later days need nothing.
export function dayState(date, dayEntries, standard, leaveDate) {
  const work = dayEntries.filter(e => !e.is_non_work_marker)
  const marker = dayEntries.find(e => e.is_non_work_marker)
  const total = work.reduce((s, e) => s + Number(e.hours), 0)
  const weekend = isWeekend(date)
  const base = { date, total, marker, work, weekend, count: work.length }
  if (leaveDate && date > leaveDate && work.length === 0) return { ...base, state: 'off', note: 'After your leaving date' }
  if (total >= standard) return { ...base, state: 'complete', note: `${work.length} ${work.length === 1 ? 'entry' : 'entries'}` }
  if (weekend) {
    if (total > 0) return { ...base, state: 'complete', note: `${work.length} ${work.length === 1 ? 'entry' : 'entries'}` }
    return { ...base, state: 'weekend', note: 'Not a working day' }
  }
  if (total > 0) {
    const short = standard - total
    return { ...base, state: 'short', shortBy: short, note: `${fmtH(short)} h short: add time or absence` }
  }
  if (marker) return { ...base, state: 'off', note: marker.description ? `Other: ${marker.description}` : 'Not contracted to work' }
  return { ...base, state: 'missing', note: 'Needs hours or a reason' }
}

export function weekDayStates(week, entries) {
  const standard = Number(week.standard_day_hours) || DEFAULT_STANDARD_DAY
  return weekDates(week).map(d => dayState(d, entries.filter(e => e.entry_date === d), standard, week.owner_leave_date || null))
}

function listWords(names) {
  if (names.length <= 1) return names.join('')
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

// Why Submit is disabled, in one line, or null when it can go (mirrors the
// server's submit checks: every weekday covered, working days done).
export function submitBlocker(week, states) {
  const missing = states.filter(s => s.state === 'missing')
  if (missing.length > 3) return `Fill in ${missing.length} days to submit`
  if (missing.length) return `Fill in ${listWords(missing.map(s => weekdayName(s.date)))} to submit`
  let lastDay = addDays(week.week_start_date, 4)
  if (week.owner_leave_date && week.owner_leave_date < lastDay) lastDay = week.owner_leave_date
  if (lastDay > londonDate()) return `You can submit from ${weekdayName(lastDay)}`
  return null
}

// POST body that recreates an entry as it is.
export function entryBody(e) {
  if (e.is_non_work_marker) return { entry_date: e.entry_date, is_non_work_marker: true, description: e.description || null }
  return {
    entry_date: e.entry_date,
    project_ref_id: e.project_ref_id || null,
    reason_id: e.reason_id || null,
    ctp_build_id: e.ctp_build_id || null,
    ctp_category_id: e.ctp_category_id || null,
    cost_code_id: e.cost_code_id || null,
    hours: Number(e.hours),
    description: e.description || null,
  }
}

// There is no edit endpoint: changing an entry deletes it and adds the new
// one. Deleting first keeps the 14-hour daily cap from counting the old and
// new hours together; if the add fails the old entries are put back.
export async function replaceEntries(weekId, olds, body) {
  for (const o of olds) await api.delete(`/weeks/${weekId}/entries/${o.id}`)
  if (!body) return
  try {
    await api.post(`/weeks/${weekId}/entries`, body)
  } catch (err) {
    for (const o of olds) await api.post(`/weeks/${weekId}/entries`, entryBody(o)).catch(() => {})
    throw err
  }
}

// The person's department admin code for reason time (Working Cost Codes
// v1.1 §2.5), the same pick the server makes for bank holidays.
export function defaultAdminCode(codes) {
  return codes.find(c => c.is_default) || codes.find(c => /-(AD|DA)$/.test(c.code)) || null
}

export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || ''
}
