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
