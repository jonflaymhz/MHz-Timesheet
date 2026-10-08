// Standard working day (Employee UI Redesign v1.0 §6): drives the short-day
// warning and the absence defaults. One company-wide value for now, from the
// STANDARD_DAY_HOURS config value (there is no app settings table). Per-person
// hours wait on Payroll; when they arrive, read them from `user` here and
// nothing else needs to change.
const DEFAULT_STANDARD_DAY_HOURS = 7.5;

function globalStandardDay() {
  const v = Number(process.env.STANDARD_DAY_HOURS);
  return v > 0 && v <= 14 && Math.round(v * 4) === v * 4 ? v : DEFAULT_STANDARD_DAY_HOURS;
}

// eslint-disable-next-line no-unused-vars
function standardDayFor(user) {
  return globalStandardDay();
}

module.exports = { standardDayFor, DEFAULT_STANDARD_DAY_HOURS };
