// Inbound user admin from QW (User Management scope 3.6). QW Admin > Users is
// the one place people are added, edited, closed out and reactivated; QW
// writes each change here, identifying the person by qw_user_id.
//
// Auth: x-qw-admin-secret must equal QW_ADMIN_SHARED_SECRET -- a separate
// secret from the QW_SYNC_SHARED_SECRET used for the hourly pull/push, so a
// leaked sync secret can't be used to change users.
//
// PUT always carries the full record (shared fields, plus the Timesheet panel
// when QW has it), never a partial one: Timesheet's own PATCH clears fields
// that are left out, and so would this if it accepted partial bodies.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { hashPin, generatePin } = require('../services/pin');
const { generatePassword } = require('../services/password');
const { revokeAllSessionsForUser } = require('../services/session');

const router = express.Router();

const KIOSK_GROUPS = ['Coachbuild', 'Wiring', 'Engineering', 'CTP', 'Solutions', 'Other'];
const DEPT_CODES = ['CL', 'WW', 'EL', 'IL', 'PM'];
const USERNAME_RE = /^[a-z0-9][a-z0-9.\-]*$/;
const STATUSES = ['active', 'frozen', 'closing', 'removed'];

function requireQwAdminSecret(req, res, next) {
  const expected = process.env.QW_ADMIN_SHARED_SECRET || '';
  const provided = req.headers['x-qw-admin-secret'] || '';
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}
router.use(requireQwAdminSecret);

const USER_SELECT = `
  SELECT u.id, u.qw_user_id, u.username, u.full_name, u.short_name, u.kiosk_group,
         u.department, u.dept_code, u.employment_type, u.reports_to, r.qw_user_id AS reports_to_qw_user_id,
         r.full_name AS reports_to_name,
         (u.pin_hash IS NOT NULL) AS does_timesheets, u.can_approve, u.is_payroll_admin, u.is_system_admin,
         u.has_ctp_access, u.is_active, u.removed_at, u.closing_leave_date, u.closing_grace_end,
         u.mfa_enabled, u.last_login_at
    FROM users u LEFT JOIN users r ON r.id = u.reports_to`;

function statusOf(u) {
  if (u.removed_at) return 'removed';
  if (u.closing_grace_end) return 'closing';
  if (!u.is_active) return 'frozen';
  return 'active';
}
const shape = u => ({ ...u, status: statusOf(u) });

// Audit rows need a Timesheet user as performed_by: the acting QW admin's
// Timesheet account, else any system admin (the row's reason says "via QW").
async function actorId(client, actorQwUserId) {
  if (actorQwUserId) {
    const r = await client.query(`SELECT id FROM users WHERE qw_user_id = $1`, [actorQwUserId]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const r = await client.query(`SELECT id FROM users WHERE is_system_admin ORDER BY created_at LIMIT 1`);
  return r.rows[0]?.id || null;
}

async function audit(client, action, entityId, performedBy, oldValue, newValue, reason) {
  if (!performedBy) return;
  await client.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, new_value, reason)
     VALUES ($1, 'user', $2, $3, $4, $5, $6)`,
    [action, entityId, performedBy, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null,
      reason || 'via QW Admin > Users']
  );
}

// GET /users -- every Timesheet user (QW shows the Timesheet panel and the
// Inactive sheet from this).
router.get('/users', async (req, res) => {
  const r = await db.query(`${USER_SELECT} ORDER BY u.full_name`);
  res.json(r.rows.map(shape));
});

router.get('/users/:qwUserId', async (req, res) => {
  const r = await db.query(`${USER_SELECT} WHERE u.qw_user_id = $1`, [parseInt(req.params.qwUserId, 10)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'No Timesheet user for this QW user', not_linked: true });
  res.json(shape(r.rows[0]));
});

// GET /users/:qwUserId/close-out-info -- what a close-out needs to deal with:
// active direct reports, and their submitted weeks waiting on approval.
router.get('/users/:qwUserId/close-out-info', async (req, res) => {
  const u = (await db.query(`SELECT id FROM users WHERE qw_user_id = $1`, [parseInt(req.params.qwUserId, 10)])).rows[0];
  if (!u) return res.status(404).json({ error: 'No Timesheet user for this QW user', not_linked: true });
  const reports = (await db.query(
    `SELECT r.id, r.full_name, r.qw_user_id FROM users r WHERE r.reports_to = $1 AND r.removed_at IS NULL ORDER BY r.full_name`, [u.id])).rows;
  const awaiting = (await db.query(
    `SELECT COUNT(*)::int AS n FROM timesheet_week w JOIN users r ON r.id = w.user_id
      WHERE r.reports_to = $1 AND w.status = 'submitted'`, [u.id])).rows[0].n;
  const ownDraft = (await db.query(
    `SELECT COUNT(*)::int AS n FROM timesheet_week WHERE user_id = $1 AND status IN ('draft', 'rejected')`, [u.id])).rows[0].n;
  res.json({ direct_reports: reports, weeks_awaiting_approval: awaiting, own_unsubmitted_weeks: ownDraft });
});

// PUT /users/:qwUserId -- create or update. Body:
//   { actor_qw_user_id, username, full_name, short_name, kiosk_group,
//     status?: 'active'|'frozen'|'closing'|'removed', closing?: { leave_date, grace_end },
//     timesheet?: { department, dept_code, employment_type, reports_to_qw_user_id,
//                   does_timesheets, can_approve, is_payroll_admin, is_system_admin, has_ctp_access },
//     reassign_reports_to_qw_user_id?  -- close-out: move direct reports
//     reset_credentials?: true         -- reactivate: new PIN/password, MFA re-enrolment }
// With no Timesheet user yet, `timesheet` is required (that's a joiner);
// without it the call is a no-op reported as not_linked (e.g. QW-only users).
router.put('/users/:qwUserId', async (req, res) => {
  const qwUserId = parseInt(req.params.qwUserId, 10);
  const b = req.body || {};
  const username = (b.username || '').trim().toLowerCase();
  const fullName = (b.full_name || '').trim();
  const shortName = (b.short_name || '').trim();
  if (!qwUserId || !username || !fullName || !shortName) return res.status(400).json({ error: 'username, full_name and short_name are required' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!KIOSK_GROUPS.includes(b.kiosk_group)) return res.status(400).json({ error: 'Invalid kiosk group' });
  if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  const t = b.timesheet;
  if (t) {
    for (const k of ['does_timesheets', 'can_approve', 'is_payroll_admin', 'is_system_admin', 'has_ctp_access']) {
      if (typeof t[k] !== 'boolean') return res.status(400).json({ error: `timesheet.${k} must be true or false (full record required)` });
    }
    if (t.dept_code && !DEPT_CODES.includes(t.dept_code)) return res.status(400).json({ error: 'Invalid dept_code' });
    if (t.employment_type && !['employee', 'contractor'].includes(t.employment_type)) return res.status(400).json({ error: 'Invalid employment_type' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const before = (await client.query(`SELECT * FROM users WHERE qw_user_id = $1 FOR UPDATE`, [qwUserId])).rows[0];
    if (!before && !t) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No Timesheet user for this QW user', not_linked: true });
    }
    const performedBy = await actorId(client, b.actor_qw_user_id);

    let reportsTo = before ? before.reports_to : null;
    if (t) {
      reportsTo = null;
      if (t.reports_to_qw_user_id) {
        const m = (await client.query(`SELECT id, is_active, removed_at FROM users WHERE qw_user_id = $1`, [t.reports_to_qw_user_id])).rows[0];
        if (!m) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Line manager has no Timesheet account' }); }
        if (before && m.id === before.id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A user cannot report to themselves' }); }
        // Only a changed manager must be active (an existing one may have left).
        if ((!before || m.id !== before.reports_to) && (!m.is_active || m.removed_at)) {
          await client.query('ROLLBACK'); return res.status(400).json({ error: 'Line manager must be an active user' });
        }
        reportsTo = m.id;
      }
    }

    const elevated = t ? (t.can_approve || t.is_payroll_admin || t.is_system_admin)
      : (before.can_approve || before.is_payroll_admin || before.is_system_admin);
    let pinHash = before ? before.pin_hash : null, initialPin = null;
    let passwordHash = before ? before.password_hash : null, initialPassword = null;
    if (t) {
      if (t.does_timesheets && !pinHash) { initialPin = generatePin(); pinHash = await hashPin(initialPin); }
      if (!t.does_timesheets) pinHash = null;
    }
    // Only a joiner/edit (the Timesheet panel) issues credentials; a status
    // change such as close-out never does.
    if (t && elevated && !passwordHash) { initialPassword = generatePassword(); passwordHash = await bcrypt.hash(initialPassword, 10); }

    let row;
    if (!before) {
      row = (await client.query(
        `INSERT INTO users (qw_user_id, username, full_name, short_name, kiosk_group, department, dept_code, employment_type,
                            reports_to, pin_hash, password_hash, can_approve, is_payroll_admin, is_system_admin, has_ctp_access)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [qwUserId, username, fullName, shortName, b.kiosk_group, t.department || null, t.dept_code || null, t.employment_type || 'employee',
          reportsTo, pinHash, passwordHash, t.can_approve, t.is_payroll_admin, t.is_system_admin, t.has_ctp_access]
      )).rows[0];
      await audit(client, 'create_user', row.id, performedBy, null, { username, full_name: fullName });
    } else {
      row = (await client.query(
        `UPDATE users SET username = $2, full_name = $3, short_name = $4, kiosk_group = $5,
                department = $6, dept_code = $7, employment_type = $8, reports_to = $9,
                pin_hash = $10, password_hash = $11, can_approve = $12, is_payroll_admin = $13,
                is_system_admin = $14, has_ctp_access = $15, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [before.id, username, fullName, shortName, b.kiosk_group,
          t ? (t.department || null) : before.department, t ? (t.dept_code || null) : before.dept_code,
          t ? (t.employment_type || 'employee') : before.employment_type, reportsTo, pinHash, passwordHash,
          t ? t.can_approve : before.can_approve, t ? t.is_payroll_admin : before.is_payroll_admin,
          t ? t.is_system_admin : before.is_system_admin, t ? t.has_ctp_access : before.has_ctp_access]
      )).rows[0];
      const keys = ['username', 'full_name', 'short_name', 'kiosk_group', 'department', 'dept_code', 'employment_type', 'reports_to',
        'can_approve', 'is_payroll_admin', 'is_system_admin', 'has_ctp_access'];
      const changed = keys.filter(k => String(before[k]) !== String(row[k]));
      if ((before.pin_hash === null) !== (row.pin_hash === null)) changed.push('does_timesheets');
      if (changed.length) {
        await audit(client, 'update_user', row.id, performedBy,
          Object.fromEntries(changed.map(k => [k, k === 'does_timesheets' ? before.pin_hash !== null : before[k]])),
          Object.fromEntries(changed.map(k => [k, k === 'does_timesheets' ? row.pin_hash !== null : row[k]])));
      }
      // A promotion to the password+MFA tier ends any PIN session straight away.
      const wasElevated = before.can_approve || before.is_payroll_admin || before.is_system_admin;
      if (elevated && !wasElevated) await revokeAllSessionsForUser(row.id);
    }

    // Status
    if (b.status !== undefined) {
      const prev = statusOf(row);
      if (b.status !== prev) {
        if (b.status === 'active') {
          row = (await client.query(`UPDATE users SET is_active = TRUE, removed_at = NULL, closing_leave_date = NULL, closing_grace_end = NULL WHERE id = $1 RETURNING *`, [row.id])).rows[0];
          await audit(client, prev === 'frozen' ? 'unfreeze_user' : 'restore_user', row.id, performedBy, { status: prev }, { status: 'active' });
        } else if (b.status === 'frozen') {
          row = (await client.query(`UPDATE users SET is_active = FALSE, closing_leave_date = NULL, closing_grace_end = NULL WHERE id = $1 RETURNING *`, [row.id])).rows[0];
          await revokeAllSessionsForUser(row.id);
          await audit(client, 'freeze_user', row.id, performedBy, { status: prev }, { status: 'frozen' });
        } else if (b.status === 'closing') {
          const c = b.closing || {};
          if (!c.leave_date || !c.grace_end) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'closing.leave_date and closing.grace_end are required' }); }
          row = (await client.query(`UPDATE users SET is_active = TRUE, removed_at = NULL, closing_leave_date = $2, closing_grace_end = $3 WHERE id = $1 RETURNING *`, [row.id, c.leave_date, c.grace_end])).rows[0];
          await audit(client, 'close_user', row.id, performedBy, { status: prev }, { status: 'closing', leave_date: c.leave_date, grace_end: c.grace_end });
        } else if (b.status === 'removed') {
          row = (await client.query(`UPDATE users SET is_active = FALSE, removed_at = NOW(), closing_grace_end = NULL WHERE id = $1 RETURNING *`, [row.id])).rows[0];
          await revokeAllSessionsForUser(row.id);
          await audit(client, 'remove_user', row.id, performedBy, { status: prev }, { status: 'removed' });
        }
      }
    }

    // Close-out: move this person's direct reports to a new line manager, so
    // their weeks awaiting approval go to that person (scope 5.1).
    let reassigned = [];
    if (b.reassign_reports_to_qw_user_id) {
      const to = (await client.query(`SELECT id, is_active, removed_at, closing_grace_end FROM users WHERE qw_user_id = $1`, [b.reassign_reports_to_qw_user_id])).rows[0];
      if (!to || to.id === row.id || !to.is_active || to.removed_at || to.closing_grace_end) {
        await client.query('ROLLBACK'); return res.status(400).json({ error: 'New line manager must be an active Timesheet user' });
      }
      reassigned = (await client.query(`UPDATE users SET reports_to = $2, updated_at = NOW() WHERE reports_to = $1 AND id <> $2 RETURNING id, full_name`, [row.id, to.id])).rows;
      if (reassigned.length) await audit(client, 'reassign_reports', row.id, performedBy, { reports_to: row.id }, { reports_to: to.id, users: reassigned.map(r => r.full_name) });
    }

    // Reactivate (scope 5.3): fresh credentials and MFA enrolment.
    if (b.reset_credentials) {
      if (row.pin_hash) { initialPin = generatePin(); }
      const isElevated = row.can_approve || row.is_payroll_admin || row.is_system_admin;
      if (isElevated) { initialPassword = generatePassword(); }
      row = (await client.query(
        `UPDATE users SET pin_hash = $2, password_hash = $3, mfa_enabled = FALSE, mfa_secret = NULL,
                failed_pin_attempts = 0, pin_locked_at = NULL WHERE id = $1 RETURNING *`,
        [row.id, initialPin ? await hashPin(initialPin) : row.pin_hash, initialPassword ? await bcrypt.hash(initialPassword, 10) : row.password_hash]
      )).rows[0];
      await client.query(`DELETE FROM user_mfa_backup_codes WHERE user_id = $1`, [row.id]);
      await revokeAllSessionsForUser(row.id);
      await audit(client, 'reactivate_user', row.id, performedBy, null, { credentials_reset: true });
    }

    await client.query('COMMIT');
    const out = (await db.query(`${USER_SELECT} WHERE u.id = $1`, [row.id])).rows[0];
    res.status(before ? 200 : 201).json({ ...shape(out), created: !before, initial_pin: initialPin, initial_password: initialPassword,
      reassigned: reassigned.map(r => r.full_name) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Username already in use in Timesheet' });
    throw err;
  } finally {
    client.release();
  }
});

// POST /users/:qwUserId/reset-mfa { actor_qw_user_id } -- MFA Recovery v1.0:
// QW Admin > Users resets Timesheet MFA through the link, same effects as
// Timesheet's own Admin reset: secret and backup codes cleared, sessions
// revoked, enrolment forced at next sign-in, audit row. QW checks the actor
// is an admin; this refuses a self-reset as a second line.
router.post('/users/:qwUserId/reset-mfa', async (req, res) => {
  const actorQw = req.body?.actor_qw_user_id ? Number(req.body.actor_qw_user_id) : null;
  if (actorQw && actorQw === Number(req.params.qwUserId)) {
    return res.status(403).json({ error: 'An admin cannot reset their own MFA. Ask another admin.' });
  }
  const row = (await db.query(`SELECT id, full_name, mfa_enabled, mfa_secret FROM users WHERE qw_user_id = $1`, [req.params.qwUserId])).rows[0];
  if (!row) return res.status(404).json({ error: 'No Timesheet user for this QW user', not_linked: true });
  if (!row.mfa_enabled && !row.mfa_secret) return res.json({ status: 'nothing_to_reset', full_name: row.full_name });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1`, [row.id]);
    await client.query(`DELETE FROM user_mfa_backup_codes WHERE user_id = $1`, [row.id]);
    await client.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [row.id]);
    await audit(client, 'reset_mfa', row.id, await actorId(client, actorQw), { mfa_enabled: row.mfa_enabled }, { mfa_enabled: false });
    await client.query('COMMIT');
    res.json({ status: 'reset', full_name: row.full_name });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
