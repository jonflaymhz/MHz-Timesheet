const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { requireAuth, requireSystemAdmin, requireOverrideAuthority } = require('../middleware/auth');
const { hashPin, generatePin } = require('../services/pin');
const { generatePassword } = require('../services/password');
const { revokeAllSessionsForUser } = require('../services/session');

const router = express.Router();

function userStatus(row) {
  if (row.removed_at) return 'removed';
  if (!row.is_active) return 'frozen';
  return 'active';
}

// ── User management (admin scope Section 3) — System admin only ───
router.get('/users', requireAuth, requireSystemAdmin, async (req, res) => {
  const params = [];
  const clauses = [];
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    clauses.push(`(u.full_name ILIKE $${params.length} OR u.username ILIKE $${params.length})`);
  }
  if (req.query.status === 'active') clauses.push(`u.is_active = TRUE AND u.removed_at IS NULL`);
  if (req.query.status === 'frozen') clauses.push(`u.is_active = FALSE AND u.removed_at IS NULL`);
  if (req.query.status === 'removed') clauses.push(`u.removed_at IS NOT NULL`);
  if (req.query.capability === 'approval') clauses.push(`u.can_approve = TRUE`);
  if (req.query.capability === 'payroll_admin') clauses.push(`u.is_payroll_admin = TRUE`);
  if (req.query.capability === 'system_admin') clauses.push(`u.is_system_admin = TRUE`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT u.id, u.full_name, u.username, u.department, u.employment_type,
            u.reports_to, r.full_name AS reports_to_name,
            u.can_approve, u.is_payroll_admin, u.is_system_admin,
            u.is_active, u.removed_at, u.pin_locked_at, u.mfa_enabled, u.last_login_at,
            (u.pin_hash IS NOT NULL) AS does_timesheets
       FROM users u
       LEFT JOIN users r ON r.id = u.reports_to
       ${where}
      ORDER BY u.full_name`,
    params
  );
  res.json(result.rows.map(r => ({ ...r, status: userStatus(r) })));
});

// Auto-generates the initial PIN/password rather than letting the admin
// type one (admin scope Section 3.2) — either or both may apply, since a
// person can be an Entry account and an admin at the same time.
router.post('/users', requireAuth, requireSystemAdmin, async (req, res) => {
  const { full_name, username, department, employment_type, reports_to, does_timesheets, can_approve, is_payroll_admin, is_system_admin } = req.body;
  if (!full_name || !username) {
    return res.status(400).json({ error: 'full_name and username are required' });
  }
  const isAdminTier = !!is_payroll_admin || !!is_system_admin;

  let pinHash = null;
  let initialPin = null;
  if (does_timesheets) {
    initialPin = generatePin();
    pinHash = await hashPin(initialPin);
  }
  let passwordHash = null;
  let initialPassword = null;
  if (isAdminTier) {
    initialPassword = generatePassword();
    passwordHash = await bcrypt.hash(initialPassword, 10);
  }

  try {
    const result = await db.query(
      `INSERT INTO users (full_name, username, department, employment_type, reports_to, pin_hash, password_hash, can_approve, is_payroll_admin, is_system_admin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, full_name, username`,
      [full_name, username, department || null, employment_type || 'employee', reports_to || null,
        pinHash, passwordHash, !!can_approve, !!is_payroll_admin, !!is_system_admin]
    );
    res.status(201).json({ ...result.rows[0], initial_pin: initialPin, initial_password: initialPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already in use' });
    throw err;
  }
});

router.patch('/users/:id', requireAuth, requireSystemAdmin, async (req, res) => {
  const { department, employment_type, reports_to, can_approve, is_payroll_admin, is_system_admin } = req.body;
  const before = (await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: 'User not found' });

  const nextIsAdminTier = (is_payroll_admin ?? before.is_payroll_admin) || (is_system_admin ?? before.is_system_admin);
  let passwordHash = before.password_hash;
  let initialPassword = null;
  // Bootstrapping: the first time either admin flag flips true on a row
  // with no password yet, generate one the same way creation does.
  if (nextIsAdminTier && !before.password_hash) {
    initialPassword = generatePassword();
    passwordHash = await bcrypt.hash(initialPassword, 10);
  }

  const result = await db.query(
    `UPDATE users SET department = COALESCE($2, department),
            employment_type = COALESCE($3, employment_type),
            reports_to = $4,
            can_approve = COALESCE($5, can_approve),
            is_payroll_admin = COALESCE($6, is_payroll_admin),
            is_system_admin = COALESCE($7, is_system_admin),
            password_hash = $8,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, department, employment_type, reports_to, can_approve, is_payroll_admin, is_system_admin`,
    [req.params.id, department, employment_type, reports_to || null, can_approve, is_payroll_admin, is_system_admin, passwordHash]
  );

  const changed = {};
  for (const key of ['department', 'employment_type', 'reports_to', 'can_approve', 'is_payroll_admin', 'is_system_admin']) {
    if (result.rows[0][key] !== before[key]) changed[key] = { old: before[key], new: result.rows[0][key] };
  }
  if (Object.keys(changed).length > 0) {
    await db.query(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, new_value)
       VALUES ('update_user', 'user', $1, $2, $3, $4)`,
      [req.params.id, req.user.id,
        JSON.stringify(Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.old]))),
        JSON.stringify(Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.new])))]
    );
  }

  res.json({ ...result.rows[0], initial_password: initialPassword });
});

// Freeze/unfreeze (Section 3.3) reuse the existing is_active toggle —
// reversible, temporary. Distinct from Remove below.
router.patch('/users/:id/deactivate', requireAuth, requireSystemAdmin, async (req, res) => {
  const existing = (await db.query(`SELECT removed_at FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.removed_at) return res.status(400).json({ error: 'User has been removed — restore before freezing/unfreezing' });
  await db.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [req.params.id]);
  await revokeAllSessionsForUser(req.params.id);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('freeze_user', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Frozen' });
});

router.patch('/users/:id/reactivate', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(`UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('unfreeze_user', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Unfrozen' });
});

// Remove (Section 3.3) — soft-delete only, distinct from Freeze: preserves
// audit trail, always leaves the account also frozen (DB constraint).
router.post('/users/:id/remove', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE users SET removed_at = NOW(), is_active = FALSE WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  await revokeAllSessionsForUser(req.params.id);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('remove_user', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Removed' });
});

// Restore deliberately leaves the account frozen — a separate Unfreeze is
// required to actually let them log in again (undoing "left the company"
// and "actually letting them back in" aren't the same click).
router.post('/users/:id/restore', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE users SET removed_at = NULL WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('restore_user', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Restored (still frozen — unfreeze to allow login)' });
});

// PIN unlock (Section 3: 5 failed attempts locks the account, admin unlock
// only, no auto-expiring cooldown) — logged like every other override.
router.post('/users/:id/unlock-pin', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE users SET failed_pin_attempts = 0, pin_locked_at = NULL WHERE id = $1 RETURNING id, full_name`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('unlock_pin', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `PIN unlocked for ${result.rows[0].full_name}` });
});

// Force PIN reset (admin scope Section 3.4) — invalidates existing
// sessions; never stores the plaintext PIN in the audit log.
router.post('/users/:id/reset-pin', requireAuth, requireSystemAdmin, async (req, res) => {
  const existing = (await db.query(`SELECT pin_hash, full_name FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.pin_hash === null) return res.status(400).json({ error: 'This account does not use a PIN' });
  const newPin = generatePin();
  const pinHash = await hashPin(newPin);
  await db.query(
    `UPDATE users SET pin_hash = $2, failed_pin_attempts = 0, pin_locked_at = NULL, pin_last_verified_at = NULL WHERE id = $1`,
    [req.params.id, pinHash]
  );
  await revokeAllSessionsForUser(req.params.id);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('reset_pin', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `PIN reset for ${existing.full_name}`, new_pin: newPin });
});

// Force password reset (admin scope Section 3.4) — deliberately leaves
// mfa_enabled/mfa_secret untouched; a lost authenticator needs the
// separate reset-mfa action below, not just a password reset.
router.post('/users/:id/reset-password', requireAuth, requireSystemAdmin, async (req, res) => {
  const existing = (await db.query(`SELECT password_hash, full_name FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.password_hash === null) return res.status(400).json({ error: 'This account does not use a password' });
  const newPassword = generatePassword();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.params.id, passwordHash]);
  await revokeAllSessionsForUser(req.params.id);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('reset_password', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `Password reset for ${existing.full_name}`, new_password: newPassword });
});

// Reset MFA (admin scope Section 4.2: "MFA cannot be disabled by the user,
// only reset by another admin") — clears the secret and backup codes so
// the next admin-login naturally re-enters the enrollment flow.
router.post('/users/:id/reset-mfa', requireAuth, requireSystemAdmin, async (req, res) => {
  const existing = (await db.query(`SELECT is_payroll_admin, is_system_admin, full_name FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (!existing.is_payroll_admin && !existing.is_system_admin) {
    return res.status(400).json({ error: 'This account is not admin-tier' });
  }
  await db.query(`UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1`, [req.params.id]);
  await db.query(`DELETE FROM user_mfa_backup_codes WHERE user_id = $1`, [req.params.id]);
  await revokeAllSessionsForUser(req.params.id);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('reset_mfa', 'user', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `MFA reset for ${existing.full_name} — they'll be walked through enrollment again next sign-in` });
});

// ── Project availability (Section 7) ────────────────────────────
router.get('/projects', requireAuth, requireSystemAdmin, async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.status === 'open') where = 'COALESCE(admin_override, is_open)';
  if (req.query.status === 'closed') where = 'NOT COALESCE(admin_override, is_open)';
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where += ` AND (qw_project_number ILIKE $${params.length} OR project_name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT id, qw_project_number, project_name, qw_status, is_open, admin_override, last_synced_at,
            COALESCE(admin_override, is_open) AS effective_open
       FROM project_ref WHERE ${where} ORDER BY qw_project_number`,
    params
  );
  res.json(result.rows);
});

// Immediate local override ahead of the next hourly pull (Section 7) — the
// actual source-of-truth close/reopen happens in QW itself; this just
// fast-forwards the effect here so nobody has to wait up to an hour.
router.post('/projects/:id/close', requireAuth, requireOverrideAuthority, async (req, res) => {
  const result = await db.query(
    `UPDATE project_ref SET admin_override = FALSE WHERE id = $1 RETURNING id, qw_project_number`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('close_project', 'project_ref', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `${result.rows[0].qw_project_number} closed locally` });
});

router.post('/projects/:id/reopen', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE project_ref SET admin_override = TRUE WHERE id = $1 RETURNING id, qw_project_number`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('reopen_project', 'project_ref', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `${result.rows[0].qw_project_number} reopened` });
});

// ── Cost codes (Section 8) ──────────────────────────────────────
// Rates don't need to come from QW (confirmed) — admin sets/maintains them
// directly here instead of relying on the rate_code sync match.
router.get('/cost-codes', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(`SELECT * FROM cost_code ORDER BY department, code`);
  res.json(result.rows);
});

router.patch('/cost-codes/:id', requireAuth, requireSystemAdmin, async (req, res) => {
  const { current_rate, is_active } = req.body;
  const result = await db.query(
    `UPDATE cost_code SET current_rate = COALESCE($2, current_rate), is_active = COALESCE($3, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, current_rate, is_active]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Cost code not found' });
  res.json(result.rows[0]);
});

// ── Override tools: Correct / Unsubmit (Section 5, admin-tier only) ──
router.get('/weeks/search', requireAuth, requireOverrideAuthority, async (req, res) => {
  const params = [];
  let where = "tw.status = 'approved'";
  if (req.query.person) {
    params.push(`%${req.query.person}%`);
    where += ` AND u.full_name ILIKE $${params.length}`;
  }
  if (req.query.week_start) {
    params.push(req.query.week_start);
    where += ` AND tw.week_start_date = $${params.length}`;
  }
  const result = await db.query(
    `SELECT tw.*, u.full_name FROM timesheet_week tw JOIN users u ON u.id = tw.user_id
      WHERE ${where} ORDER BY tw.week_start_date DESC`,
    params
  );
  res.json(result.rows);
});

router.post('/entries/:id/correct', requireAuth, requireOverrideAuthority, async (req, res) => {
  const { project_ref_id, reason_id, cost_code_id, reason: auditReason } = req.body;
  if (!auditReason) return res.status(400).json({ error: 'A reason is required for a Correct action' });
  const existing = (await db.query(`SELECT * FROM timesheet_entry WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Entry not found' });

  // Correct changes project or category only — hours are untouched (§5).
  const result = await db.query(
    `UPDATE timesheet_entry
        SET project_ref_id = $2, reason_id = $3, cost_code_id = $4, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [req.params.id, project_ref_id || null, reason_id || null, cost_code_id || existing.cost_code_id]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, new_value, reason)
     VALUES ('correct', 'timesheet_entry', $1, $2, $3, $4, $5)`,
    [req.params.id, req.user.id,
      JSON.stringify({ project_ref_id: existing.project_ref_id, reason_id: existing.reason_id, cost_code_id: existing.cost_code_id }),
      JSON.stringify({ project_ref_id: result.rows[0].project_ref_id, reason_id: result.rows[0].reason_id, cost_code_id: result.rows[0].cost_code_id }),
      auditReason]
  );
  res.json(result.rows[0]);
});

router.post('/weeks/:id/unsubmit', requireAuth, requireOverrideAuthority, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'A reason is required for an Unsubmit action' });
  const week = (await db.query(`SELECT * FROM timesheet_week WHERE id = $1`, [req.params.id])).rows[0];
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!['submitted', 'approved'].includes(week.status)) {
    return res.status(400).json({ error: 'Only a submitted or approved week can be unsubmitted' });
  }
  const result = await db.query(
    `UPDATE timesheet_week
        SET status = 'draft', submitted_at = NULL, approved_at = NULL, approved_by = NULL
      WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, reason)
     VALUES ('unsubmit', 'timesheet_week', $1, $2, $3, $4)`,
    [req.params.id, req.user.id, JSON.stringify({ status: week.status }), reason]
  );
  res.json(result.rows[0]);
});

// Admin-tier can also apply Approve directly (Section 5) — from draft,
// rejected, or submitted, skipping supervisor review if needed. Not from an
// already-approved week: that's not "approving" anything, it would just
// silently re-trigger a push with no real state change.
router.post('/weeks/:id/approve', requireAuth, requireOverrideAuthority, async (req, res) => {
  const week = (await db.query(`SELECT * FROM timesheet_week WHERE id = $1`, [req.params.id])).rows[0];
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (week.status === 'approved') return res.status(400).json({ error: 'Week is already approved' });
  const result = await db.query(
    `UPDATE timesheet_week SET status = 'approved', approved_at = NOW(), approved_by = $2 WHERE id = $1 RETURNING *`,
    [req.params.id, req.user.id]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('approve', 'timesheet_week', $1, $2)`,
    [req.params.id, req.user.id]
  );
  const { pushApprovedWeek } = require('../services/qwPush');
  pushApprovedWeek(req.params.id).catch(err => console.error(`QW push failed for week ${req.params.id}:`, err.message));
  res.json(result.rows[0]);
});

// ── Audit log (Section 8) — admin-tier only ────────────────────
router.get('/audit-log', requireAuth, requireOverrideAuthority, async (req, res) => {
  const result = await db.query(
    `SELECT a.*, u.full_name AS performed_by_name FROM audit_log a
       JOIN users u ON u.id = a.performed_by
      ORDER BY a.created_at DESC LIMIT 500`
  );
  res.json(result.rows);
});

// ── Outstanding timesheets (Section 8) — company-wide ───────────
router.get('/outstanding', requireAuth, requireOverrideAuthority, async (req, res) => {
  const weekStart = req.query.week_start;
  if (!weekStart) return res.status(400).json({ error: 'week_start is required' });
  const result = await db.query(
    `SELECT u.id, u.full_name, u.department, tw.status
       FROM users u
       LEFT JOIN timesheet_week tw ON tw.user_id = u.id AND tw.week_start_date = $1
      WHERE u.is_active = TRUE AND u.pin_hash IS NOT NULL
      ORDER BY u.full_name`,
    [weekStart]
  );
  const outstanding = result.rows.filter(r => !r.status || r.status === 'draft' || r.status === 'rejected');
  res.json({ all: result.rows, outstanding });
});

// ── Integration health (Section 8) ──────────────────────────────
router.get('/integration-health', requireAuth, requireOverrideAuthority, async (req, res) => {
  const result = await db.query(
    `SELECT DISTINCT ON (sync_direction, sync_type) sync_direction, sync_type, status, detail, started_at, completed_at
       FROM qw_sync_log
      ORDER BY sync_direction, sync_type, started_at DESC`
  );
  res.json(result.rows);
});

module.exports = router;
