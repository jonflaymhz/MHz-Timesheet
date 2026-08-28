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

// Monday of the week containing `date`.
function mondayOf(date) {
  const d = toDateOnly(date);
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

module.exports = { isoWeekNumber, mondayOf, fmtDate, lastCompletedWeekStart, currentWeekStart, weekBounds, isMonday, isQuarterHour };
