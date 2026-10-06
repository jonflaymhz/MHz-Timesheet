// Week is always Monday-Sunday (Section 4); week_number is ISO 8601
// (confirmed, Section 13).

function toDateOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoWeekNumber(date) {
  const d = toDateOnly(date);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = toDateOnly(new Date(Date.UTC(d.getUTCFullYear(), 0, 4)));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 86400000));
}

// Monday of the week containing `date`, by the UK calendar date: at 00:30
// BST on a Monday it's still Sunday in UTC, which used to give the previous
// week (Security Fixes & Bugs v1.1, C1). Returns a UTC-midnight Date.
function mondayOf(date) {
  const d = new Date(londonToday(date) + 'T00:00:00Z');
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum);
  return d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// Most recent COMPLETED week (Section 6 default view) — last week, not the
// in-progress current one.
function lastCompletedWeekStart(today = new Date()) {
  const thisMonday = mondayOf(today);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  return thisMonday;
}

function currentWeekStart(today = new Date()) {
  return mondayOf(today);
}

function weekBounds(weekStartDate) {
  const start = toDateOnly(new Date(weekStartDate));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: fmtDate(start), end: fmtDate(end), weekNumber: isoWeekNumber(start) };
}

function isMonday(dateStr) {
  const d = new Date(dateStr);
  return d.getUTCDay() === 1;
}

// 15-minute rounding (Section 4).
function isQuarterHour(hours) {
  return Math.round(hours * 4) === hours * 4;
}

// Today's calendar date in the UK, as 'YYYY-MM-DD' — the future-date rule
// (Working Cost Codes v1.1 §2.6) must not flip at midnight UTC during BST.
function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

module.exports = { londonToday, isoWeekNumber, mondayOf, fmtDate, lastCompletedWeekStart, currentWeekStart, weekBounds, isMonday, isQuarterHour };
