// Format a plain 'YYYY-MM-DD' string for display WITHOUT ever constructing
// a Date object and reading it back in the browser's local timezone — the
// same class of bug fixed on the backend (see db/pool.js): a UK-only app,
// but if anyone ever opens it from a negative-UTC-offset timezone,
// `new Date('2026-08-17').toLocaleDateString()` can silently render as the
// 16th. Parsing the components directly sidesteps that entirely.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function fmtShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function fmtRange(start, end) {
  return `${fmtShort(start)} – ${fmtShort(end)}`
}

export function dayOfMonth(dateStr) {
  return Number(dateStr.split('-')[2])
}

// Zeller-independent weekday name via the UTC-anchored Date constructor —
// safe specifically because we only ever call getUTCDay() on it, never a
// local-timezone getter.
export function weekdayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return WEEKDAYS[d.getUTCDay()]
}

// Today's calendar date in the UK as 'YYYY-MM-DD' (matches the backend's
// londonToday): at 00:30 BST it's still yesterday in UTC.
export function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// Monday ('YYYY-MM-DD') of the week containing `date`: a 'YYYY-MM-DD' string
// as given, or a Date by its UK calendar date (Security Fixes v1.1, C1).
export function mondayOf(date) {
  const ymd = typeof date === 'string' ? date.slice(0, 10) : londonDate(date)
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7)
  return d.toISOString().slice(0, 10)
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// "28 Sep to 4 Oct" (Employee UI Redesign v1.0 §2).
export function fmtRangeWords(start, end) {
  return `${fmtShort(start)} to ${fmtShort(end)}`
}

// A timestamp's UK calendar date as "6 Oct".
export function fmtStampDate(ts) {
  if (!ts) return ''
  return fmtShort(londonDate(new Date(ts)))
}
