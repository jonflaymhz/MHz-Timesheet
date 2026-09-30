// Daily close-out of leavers (User Management scope 5.2). A user closed out
// from QW is "Closing" until closing_grace_end: they can still log in and
// enter/submit weeks up to closing_leave_date. The day after the grace end
// this job removes them (inactive, sessions revoked, hidden everywhere).
// Unsubmitted weeks are not deleted: they show to Payroll Admin on the
// Outstanding tab (leaversWithUnsubmitted below).
const db = require('../db/pool');
const wu = require('./weekUtils');
const { revokeAllSessionsForUser } = require('./session');

async function runClosingJob() {
  const today = wu.londonToday();
  const due = (await db.query(
    `SELECT id, full_name, closing_grace_end FROM users
      WHERE closing_grace_end IS NOT NULL AND closing_grace_end < $1 AND removed_at IS NULL`, [today])).rows;
  if (!due.length) return 0;
  const admin = (await db.query(`SELECT id FROM users WHERE is_system_admin ORDER BY created_at LIMIT 1`)).rows[0];
  for (const u of due) {
    await db.query(
      `UPDATE users SET removed_at = NOW(), is_active = FALSE, closing_grace_end = NULL, updated_at = NOW() WHERE id = $1`, [u.id]);
    await revokeAllSessionsForUser(u.id);
    if (admin) {
      await db.query(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, new_value, reason)
         VALUES ('remove_user', 'user', $1, $2, $3, $4, 'Close-out grace period ended (daily job)')`,
        [u.id, admin.id, JSON.stringify({ status: 'closing', grace_end: u.closing_grace_end }), JSON.stringify({ status: 'removed' })]);
    }
    console.log(`Closing job: removed ${u.full_name} (grace ended ${u.closing_grace_end})`);
  }
  return due.length;
}

// Leavers (closed out, now removed or still closing) with weeks up to their
// leaving date that aren't submitted, for Payroll Admin.
async function leaversWithUnsubmitted() {
  const r = await db.query(
    `SELECT u.id, u.full_name, u.closing_leave_date AS leave_date, u.removed_at, u.closing_grace_end,
            COUNT(w.id)::int AS unsubmitted_weeks, MIN(w.week_start_date) AS first_week
       FROM users u
       JOIN timesheet_week w ON w.user_id = u.id AND w.status IN ('draft', 'rejected') AND w.week_start_date <= u.closing_leave_date
      WHERE u.closing_leave_date IS NOT NULL
      GROUP BY u.id ORDER BY u.full_name`);
  return r.rows;
}

module.exports = { runClosingJob, leaversWithUnsubmitted };
