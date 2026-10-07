const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { requireAuth, requireSystemAdmin, requireOverrideAuthority, requirePayrollAdmin } = require('../middleware/auth');
const { hashPin, generatePin } = require('../services/pin');
const { generatePassword } = require('../services/password');
const { revokeAllSessionsForUser } = require('../services/session');
const { getEligibleEntries, sendBatch } = require('../services/qwPush');
const { getEligibleEntries: getEligibleCtpEntries, sendBatch: sendCtpBatch } = require('../services/ctpPush');
const { approvalDecision, snapshotRatesAtApproval } = require('../services/approval');
const { allowedOnProject, allowedOnReason } = require('../services/codeRules');
const { leaversWithUnsubmitted } = require('../services/closingJob');

// Catalogue department codes a person can be mapped to (Working Cost Codes
// v1.1 §2.5) — picks their default non-project admin code.
const DEPT_CODES = ['CL', 'WW', 'EL', 'IL', 'PM'];
function cleanDeptCode(v) {
  if (v === undefined) return undefined;
  const c = (v || '').toString().trim().toUpperCase();
  return c === '' ? null : (DEPT_CODES.includes(c) ? c : undefined);
}

const router = express.Router();

function userStatus(row) {
  if (row.removed_at) return 'removed';
  if (row.closing_grace_end) return 'closing';
  if (!row.is_active) return 'frozen';
  return 'active';
}

// ── Kiosk devices (Security Fixes & Bugs v1.1, A3) — System admin only ───
// Registering returns the token once; only its hash is kept. The browser that
// asked stores it and becomes a kiosk (tile list + PIN login).
const { hashToken, newToken } = require('../services/kioskDevice');

router.get('/kiosk-devices', requireAuth, requireSystemAdmin, async (req, res) => {
  const mine = req.get('x-kiosk-device');
  const { rows } = await db.query(
    `SELECT d.id, d.label, d.created_at, d.last_seen_at, d.revoked_at, u.full_name AS created_by_name,
            (d.token_hash = $1) AS is_this_device
       FROM kiosk_devices d LEFT JOIN users u ON u.id = d.created_by
      ORDER BY d.revoked_at IS NOT NULL, d.created_at DESC`, [mine ? hashToken(mine) : '']);
  res.json(rows);
});

router.post('/kiosk-devices', requireAuth, requireSystemAdmin, async (req, res) => {
  const label = (req.body.label || '').toString().trim().slice(0, 80);
  if (!label) return res.status(400).json({ error: 'Give the device a name, e.g. "Workshop kiosk"' });
  const token = newToken();
  const { rows } = await db.query(
    `INSERT INTO kiosk_devices (label, token_hash, created_by) VALUES ($1, $2, $3) RETURNING id, label, created_at`,
    [label, hashToken(token), req.user.id]);
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('register_kiosk_device', 'kiosk_device', $1, $2, $3)`,
    [rows[0].id, req.user.id, JSON.stringify({ label })]);
  res.json({ ...rows[0], token });
});

router.post('/kiosk-devices/:id/revoke', requireAuth, requireSystemAdmin, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Device not found' });
  const { rows } = await db.query(
    `UPDATE kiosk_devices SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id, label`,
    [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Device not found or already revoked' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value)
     VALUES ('revoke_kiosk_device', 'kiosk_device', $1, $2, $3)`,
    [rows[0].id, req.user.id, JSON.stringify({ label: rows[0].label })]);
  res.json({ ok: true });
});

// ── User management (admin scope Section 3) — System admin only ───
router.get('/users', requireAuth, requireSystemAdmin, async (req, res) => {
  const params = [];
  const clauses = [];
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    clauses.push(`(u.full_name ILIKE $${params.length} OR u.username ILIKE $${params.length})`);
  }
  if (req.query.status === 'active') clauses.push(`u.is_active = TRUE AND u.removed_at IS NULL AND u.closing_grace_end IS NULL`);
  if (req.query.status === 'closing') clauses.push(`u.closing_grace_end IS NOT NULL AND u.removed_at IS NULL`);
  if (req.query.status === 'frozen') clauses.push(`u.is_active = FALSE AND u.removed_at IS NULL`);
  if (req.query.status === 'removed') clauses.push(`u.removed_at IS NOT NULL`);
  // Removed (inactive) users are left out unless asked for (scope 3.3):
  // ?status=removed, or ?include_inactive=1 for everyone.
  if (!req.query.status && req.query.include_inactive !== '1') clauses.push(`u.removed_at IS NULL`);
  if (req.query.capability === 'approval') clauses.push(`u.can_approve = TRUE`);
  if (req.query.capability === 'payroll_admin') clauses.push(`u.is_payroll_admin = TRUE`);
  if (req.query.capability === 'system_admin') clauses.push(`u.is_system_admin = TRUE`);
  if (req.query.employment_type) {
    params.push(req.query.employment_type);
    clauses.push(`u.employment_type = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT u.id, u.qw_user_id, u.full_name, u.short_name, u.kiosk_group, u.username, u.department, u.dept_code, u.employment_type,
            u.reports_to, r.full_name AS reports_to_name,
            u.can_approve, u.can_self_approve, u.is_payroll_admin, u.is_system_admin, u.has_ctp_access,
            u.is_active, u.removed_at, u.closing_leave_date, u.closing_grace_end, u.pin_locked_at, u.mfa_enabled, u.last_login_at,
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
// person can be an Entry account and elevated-tier at the same time.
// A line manager must be a live user (not frozen or removed) and not the
// person themselves. Returns an error message, or null if the value is OK.
async function checkReportsTo(reportsTo, selfId = null) {
  if (!reportsTo) return null;
  if (selfId && reportsTo === selfId) return 'A user cannot report to themselves';
  const r = await db.query(`SELECT is_active, removed_at, closing_grace_end FROM users WHERE id = $1`, [reportsTo]);
  if (!r.rows[0]) return 'Line manager not found';
  if (!r.rows[0].is_active || r.rows[0].removed_at || r.rows[0].closing_grace_end) return 'Line manager must be an active user';
  return null;
}

router.post('/users', requireAuth, requireSystemAdmin, async (req, res) => {
  const { full_name, username, department, employment_type, reports_to, does_timesheets, can_approve, is_payroll_admin, is_system_admin, has_ctp_access } = req.body;
  const deptCode = cleanDeptCode(req.body.dept_code);
  if (req.body.dept_code && deptCode === undefined) return res.status(400).json({ error: `dept_code must be one of ${DEPT_CODES.join(', ')}` });
  if (!full_name || !username) {
    return res.status(400).json({ error: 'full_name and username are required' });
  }
  const reportsToError = await checkReportsTo(reports_to);
  if (reportsToError) return res.status(400).json({ error: reportsToError });
  // Elevated tier (Section 3.1): Approval and either Admin role all require
  // password + MFA, not just the two admin flags.
  const isElevatedTier = !!can_approve || !!is_payroll_admin || !!is_system_admin;

  let pinHash = null;
  let initialPin = null;
  if (does_timesheets) {
    initialPin = generatePin();
    pinHash = await hashPin(initialPin);
  }
  let passwordHash = null;
  let initialPassword = null;
  if (isElevatedTier) {
    initialPassword = generatePassword();
    passwordHash = await bcrypt.hash(initialPassword, 10);
  }

  try {
    const result = await db.query(
      `INSERT INTO users (full_name, username, department, employment_type, reports_to, pin_hash, password_hash, can_approve, is_payroll_admin, is_system_admin, has_ctp_access, dept_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, full_name, username`,
      [full_name, username.trim().toLowerCase(), department || null, employment_type || 'employee', reports_to || null,
        pinHash, passwordHash, !!can_approve, !!is_payroll_admin, !!is_system_admin, !!has_ctp_access, deptCode || null]
    );
    res.status(201).json({ ...result.rows[0], initial_pin: initialPin, initial_password: initialPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already in use' });
    throw err;
  }
});

router.patch('/users/:id', requireAuth, requireSystemAdmin, async (req, res) => {
  const { department, employment_type, reports_to, can_approve, is_payroll_admin, is_system_admin, has_ctp_access } = req.body;
  const deptCode = cleanDeptCode(req.body.dept_code);
  if (req.body.dept_code && deptCode === undefined) return res.status(400).json({ error: `dept_code must be one of ${DEPT_CODES.join(', ')}` });
  const before = (await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!before) return res.status(404).json({ error: 'User not found' });
  // Omitting reports_to keeps the current line manager (only an explicit
  // null/'' clears it). Only a changed value is validated, so editing someone
  // whose existing manager has since left doesn't fail.
  const nextReportsTo = reports_to === undefined ? before.reports_to : (reports_to || null);
  if (nextReportsTo !== before.reports_to) {
    const reportsToError = await checkReportsTo(nextReportsTo, before.id);
    if (reportsToError) return res.status(400).json({ error: reportsToError });
  }

  // Elevated tier (Section 3.1): Approval and either Admin role all require
  // password + MFA, not just the two admin flags.
  const nextIsElevatedTier = (can_approve ?? before.can_approve) || (is_payroll_admin ?? before.is_payroll_admin) || (is_system_admin ?? before.is_system_admin);
  let passwordHash = before.password_hash;
  let initialPassword = null;
  // Bootstrapping: the first time the account becomes elevated-tier on a
  // row with no password yet, generate one the same way creation does.
  if (nextIsElevatedTier && !before.password_hash) {
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
            has_ctp_access = COALESCE($9, has_ctp_access),
            password_hash = $8,
            dept_code = CASE WHEN $10 THEN $11 ELSE dept_code END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, department, dept_code, employment_type, reports_to, can_approve, is_payroll_admin, is_system_admin, has_ctp_access`,
    [req.params.id, department, employment_type, nextReportsTo, can_approve, is_payroll_admin, is_system_admin, passwordHash, has_ctp_access,
      deptCode !== undefined, deptCode ?? null]
  );

  const changed = {};
  for (const key of ['department', 'dept_code', 'employment_type', 'reports_to', 'can_approve', 'is_payroll_admin', 'is_system_admin', 'has_ctp_access']) {
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
  const existing = (await db.query(`SELECT password_hash, full_name, can_approve, is_payroll_admin, is_system_admin FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  // Elevated-tier accounts (approval/admin) sign in with a password; one made
  // an approver by a data change may not have one yet, so this issues it.
  const elevated = existing.can_approve || existing.is_payroll_admin || existing.is_system_admin;
  if (existing.password_hash === null && !elevated) return res.status(400).json({ error: 'This account does not use a password' });
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
// the next elevated-tier login naturally re-enters the enrollment flow.
router.post('/users/:id/reset-mfa', requireAuth, requireSystemAdmin, async (req, res) => {
  // MFA Recovery v1.0 §4: another admin must do it.
  if (String(req.params.id) === String(req.user.id)) return res.status(403).json({ error: 'You cannot reset your own MFA. Ask another admin.' });
  const existing = (await db.query(`SELECT can_approve, is_payroll_admin, is_system_admin, full_name FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (!existing.can_approve && !existing.is_payroll_admin && !existing.is_system_admin) {
    return res.status(400).json({ error: 'This account is not elevated-tier' });
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
    where += ` AND (qw_project_number ILIKE $${params.length} OR project_name ILIKE $${params.length}
               OR project_title ILIKE $${params.length} OR customer_name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT id, qw_project_number, project_name, project_title, customer_name, qw_status, is_open, admin_override, timesheet_enabled, last_synced_at, closed_reason,
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

// Stage 1 global switch (Admin Scope Section 6.1) — distinct from Close/
// Reopen above, which track whether QW itself considers the project live.
// This is the deliberate "make it bookable in the timesheet at all" step,
// System admin only per the doc's heading.
router.post('/projects/:id/enable-timesheet', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE project_ref SET timesheet_enabled = TRUE WHERE id = $1 RETURNING id, qw_project_number`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('enable_project_timesheet', 'project_ref', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `${result.rows[0].qw_project_number} opened for timesheet entry` });
});

router.post('/projects/:id/disable-timesheet', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `UPDATE project_ref SET timesheet_enabled = FALSE WHERE id = $1 RETURNING id, qw_project_number`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by)
     VALUES ('disable_project_timesheet', 'project_ref', $1, $2)`,
    [req.params.id, req.user.id]
  );
  res.json({ message: `${result.rows[0].qw_project_number} hidden from new timesheet entries — existing logged time is unaffected` });
});

// Stage 2 per-project visibility list (Admin Scope Section 6.2) — only
// meaningful for a contractor account; an employee is visible by default
// once a project is globally enabled, so adding one here is a harmless
// no-op rather than an error.
router.get('/projects/:id/visibility', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.full_name, u.username, pv.added_at
       FROM project_visibility pv JOIN users u ON u.id = pv.user_id
      WHERE pv.project_ref_id = $1
      ORDER BY u.full_name`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.post('/projects/:id/visibility', requireAuth, requireSystemAdmin, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const project = (await db.query(`SELECT qw_project_number FROM project_ref WHERE id = $1`, [req.params.id])).rows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    await db.query(
      `INSERT INTO project_visibility (project_ref_id, user_id, added_by) VALUES ($1, $2, $3)`,
      [req.params.id, user_id, req.user.id]
    );
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already on this project\'s visibility list' });
    throw err;
  }
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('add_project_visibility', 'project_ref', $1, $2, $3)`,
    [req.params.id, req.user.id, JSON.stringify({ user_id })]
  );
  res.status(201).json({ message: `Added to ${project.qw_project_number}'s visibility list` });
});

router.delete('/projects/:id/visibility/:userId', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `DELETE FROM project_visibility WHERE project_ref_id = $1 AND user_id = $2 RETURNING user_id`,
    [req.params.id, req.params.userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Not on this project\'s visibility list' });
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value)
     VALUES ('remove_project_visibility', 'project_ref', $1, $2, $3)`,
    [req.params.id, req.user.id, JSON.stringify({ user_id: req.params.userId })]
  );
  res.json({ message: 'Removed from visibility list' });
});

// ── Cost codes (Section 8) ──────────────────────────────────────
// Rates don't need to come from QW (confirmed) — admin sets/maintains them
// directly here instead of relying on the rate_code sync match.
router.get('/cost-codes', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(`SELECT * FROM cost_code ORDER BY code_type DESC, department, code`);
  res.json(result.rows);
});

router.patch('/cost-codes/:id', requireAuth, requireSystemAdmin, async (req, res) => {
  const { current_rate, is_active } = req.body;
  // Project codes and their rates come from the QW catalogue every hour
  // (Working Cost Codes v1.1 §2.1); a local edit would just be overwritten.
  const existing = (await db.query(`SELECT code_type FROM cost_code WHERE id = $1`, [req.params.id])).rows[0];
  if (existing?.code_type === 'project' && current_rate !== undefined) {
    return res.status(400).json({ error: 'Project code rates come from the Genlock labour catalogue; change them there' });
  }
  const result = await db.query(
    `UPDATE cost_code SET current_rate = COALESCE($2, current_rate), is_active = COALESCE($3, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, current_rate, is_active]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Cost code not found' });
  res.json(result.rows[0]);
});

// ── CTP builds (CTP Integration Scope Section 3) ────────────────────
// Populated primarily by the hourly pull from app.ctpsystems.co.uk
// (services/ctpPull.js) — is_active is a manual admin override/kill-switch
// on top of that, independent of synced_open (which the pull recomputes
// every run). A manual POST still exists as a fallback for a build that
// genuinely has no CTP-app counterpart yet (ctp_ref left null).
router.get('/ctp-builds', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(`SELECT * FROM ctp_build ORDER BY last_synced_at DESC NULLS LAST, name`);
  res.json(result.rows);
});

router.post('/ctp-builds', requireAuth, requireSystemAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.query(`INSERT INTO ctp_build (name) VALUES ($1) RETURNING *`, [name]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A build with this name already exists' });
    throw err;
  }
});

router.patch('/ctp-builds/:id', requireAuth, requireSystemAdmin, async (req, res) => {
  const { name, is_active } = req.body;
  const result = await db.query(
    `UPDATE ctp_build SET name = COALESCE($2, name), is_active = COALESCE($3, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, name, is_active]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Build not found' });
  res.json(result.rows[0]);
});

// CTP sync status (mirrors GET /admin/qw-sync-log below).
router.get('/ctp-sync-log', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `SELECT DISTINCT ON (sync_direction, sync_type) sync_direction, sync_type, status, detail, started_at, completed_at
       FROM ctp_sync_log
      ORDER BY sync_direction, sync_type, started_at DESC`
  );
  res.json(result.rows);
});

// Hours by build (Section 6/8) — feeds back into CTP pricing eventually via
// CTP's own reporting; this is just a rough in-app view while that doesn't
// exist yet. Not date-filtered this batch; a to-date total is enough to see
// which builds are cheap or expensive to make, which is the stated purpose.
router.get('/reports/ctp-hours', requireAuth, requireSystemAdmin, async (req, res) => {
  const result = await db.query(
    `SELECT cb.id, cb.name, cb.sku, cb.order_ref, cb.is_active, COALESCE(SUM(te.hours), 0) AS total_hours,
            COUNT(DISTINCT te.week_id) AS weeks_logged
       FROM ctp_build cb
       LEFT JOIN timesheet_entry te ON te.ctp_build_id = cb.id AND NOT te.is_non_work_marker
      GROUP BY cb.id, cb.name, cb.sku, cb.order_ref, cb.is_active
      ORDER BY total_hours DESC, cb.name`
  );
  res.json(result.rows);
});

// ── Override tools: Correct / Unsubmit (Section 5, admin-tier only) ──
router.get('/weeks/search', requireAuth, requireOverrideAuthority, async (req, res) => {
  const params = [];
  let where = "tw.status = 'approved'";
  // Self-Approval v1.0 §5: Payroll can pick out self-approved weeks.
  if (req.query.self_approved === '1') where += ' AND tw.approved_by = tw.user_id';
  if (req.query.person) {
    params.push(`%${req.query.person}%`);
    where += ` AND u.full_name ILIKE $${params.length}`;
  }
  if (req.query.week_start) {
    params.push(req.query.week_start);
    where += ` AND tw.week_start_date = $${params.length}`;
  }
  const result = await db.query(
    `SELECT tw.*, u.full_name, (tw.approved_by = tw.user_id) AS self_approved FROM timesheet_week tw JOIN users u ON u.id = tw.user_id
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
  // Same code-type rule as entry (Working Cost Codes v1.1 §2.3), and a
  // corrected project entry is re-costed at the new code's current rate.
  const nextCode = (await db.query(`SELECT code, code_type, current_rate FROM cost_code WHERE id = $1`, [cost_code_id || existing.cost_code_id])).rows[0];
  if (nextCode && !(project_ref_id ? allowedOnProject : allowedOnReason)(nextCode)) {
    return res.status(400).json({ error: project_ref_id ? 'Project time needs a project cost code' : 'Non-project time needs a non-project cost code' });
  }
  const rate = project_ref_id && nextCode ? nextCode.current_rate : null;

  // Correct changes project or category only — hours are untouched (§5).
  // Clearing qw_sent_at/qw_send_batch_id here (Actual Hours Feedback Design
  // v1.0 §4) is what makes a corrected entry naturally reappear in the next
  // "Send to QW" batch, rather than needing a special case — if it was
  // never sent, these are already NULL and this is a no-op.
  const result = await db.query(
    `UPDATE timesheet_entry
        SET project_ref_id = $2, reason_id = $3, cost_code_id = $4, updated_at = NOW(),
            rate_at_entry = $5, calculated_cost_at_entry = CASE WHEN $5::numeric IS NULL THEN NULL ELSE hours * $5::numeric END,
            qw_sent_at = NULL, qw_send_batch_id = NULL
      WHERE id = $1 RETURNING *`,
    [req.params.id, project_ref_id || null, reason_id || null, cost_code_id || existing.cost_code_id, rate]
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
// already-approved week: that's not "approving" anything, it would just be
// a no-op state change.
router.post('/weeks/:id/approve', requireAuth, requireOverrideAuthority, async (req, res) => {
  const week = (await db.query(`SELECT * FROM timesheet_week WHERE id = $1`, [req.params.id])).rows[0];
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (week.status === 'approved') return res.status(400).json({ error: 'Week is already approved' });
  // §2.10 holds for the override too: an admin who entered hours on the
  // week (or owns it) needs the other admin.
  const decision = await approvalDecision(week, req.user);
  if (!decision.allowed) return res.status(403).json({ error: decision.reason });
  // Section 10.2 applies here too — same confirmation as a supervisor's Approve.
  if (!req.body?.confirmed) return res.status(400).json({ error: 'Confirmation is required before approving' });
  await snapshotRatesAtApproval(week.id);
  const result = await db.query(
    `UPDATE timesheet_week SET status = 'approved', approved_at = NOW(), approved_by = $2 WHERE id = $1 RETURNING *`,
    [req.params.id, req.user.id]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('approve', 'timesheet_week', $1, $2, $3)`,
    [req.params.id, req.user.id, JSON.stringify({
      confirmed: true, confirmation_text: "I've reviewed and confirm these hours as real.",
      approval_path: 'admin_override', admin_approval: true, from_status: week.status, resolved_approver: decision.approver_name,
      ...(decision.path === 'self' ? { self_approval: true } : {}),
    })]
  );
  // No automatic QW push here any more (Actual Hours Feedback Design v1.0
  // §2) — see the /qw-send/* routes below.
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
  // Leavers with weeks up to their leaving date still unsubmitted (scope 5.2):
  // flagged here for Payroll Admin, never deleted.
  const leavers = await leaversWithUnsubmitted();
  res.json({ all: result.rows, outstanding, leavers });
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

// ── "Send approved hours" (Actual Hours Feedback Design v1.0 §3, unified
// per CTP Integration Scope §8 — one button routing each entry to QW or
// CTP by type, not two separate screens). Payroll admin only, not System
// admin — a deliberate role split from every other override route in this
// file. Both destinations are previewed/committed together so Jonny sees
// one full picture of what's about to go out. ────────────────────────
router.get('/send-hours/preview', requireAuth, requirePayrollAdmin, async (req, res) => {
  const [qwEntries, ctpEntries] = await Promise.all([getEligibleEntries(), getEligibleCtpEntries()]);

  const byProject = new Map();
  for (const e of qwEntries) {
    const key = e.qw_project_number || '(no project number)';
    if (!byProject.has(key)) {
      byProject.set(key, { qw_project_number: e.qw_project_number, project_name: e.project_name, hours: 0, entry_count: 0 });
    }
    const p = byProject.get(key);
    p.hours += Number(e.hours);
    p.entry_count += 1;
  }

  const byBuild = new Map();
  for (const e of ctpEntries) {
    const key = e.ctp_build_ref || '(no build ref)';
    if (!byBuild.has(key)) {
      byBuild.set(key, { ctp_build_ref: e.ctp_build_ref, build_name: e.build_name, build_sku: e.build_sku, order_ref: e.order_ref, hours: 0, entry_count: 0 });
    }
    const b = byBuild.get(key);
    b.hours += Number(e.hours);
    b.entry_count += 1;
  }

  res.json({
    qw: {
      total_hours: qwEntries.reduce((s, e) => s + Number(e.hours), 0),
      total_entries: qwEntries.length,
      unmapped_people: [...new Set(qwEntries.filter(e => !e.qw_user_id).map(e => e.person_name))],
      by_project: [...byProject.values()].sort((a, b) => (a.qw_project_number || '').localeCompare(b.qw_project_number || '')),
    },
    ctp: {
      total_hours: ctpEntries.reduce((s, e) => s + Number(e.hours), 0),
      total_entries: ctpEntries.length,
      by_build: [...byBuild.values()].sort((a, b) => (a.order_ref || '').localeCompare(b.order_ref || '')),
    },
  });
});

router.post('/send-hours/commit', requireAuth, requirePayrollAdmin, async (req, res) => {
  // Re-fetched fresh, not passed in from the preview — the batch that
  // actually sends must always be exactly "whatever's eligible right now"
  // (§3), so a commit can never send something the reviewer didn't just
  // see, and never misses something approved in the meantime either.
  const [qwEntries, ctpEntries] = await Promise.all([getEligibleEntries(), getEligibleCtpEntries()]);
  if (qwEntries.length === 0 && ctpEntries.length === 0) {
    return res.status(400).json({ error: 'Nothing eligible to send' });
  }
  const [qwResult, ctpResult] = await Promise.all([
    qwEntries.length > 0 ? sendBatch(qwEntries, req.user.id) : Promise.resolve(null),
    ctpEntries.length > 0 ? sendCtpBatch(ctpEntries, req.user.id) : Promise.resolve(null),
  ]);
  res.json({ qw: qwResult, ctp: ctpResult });
});

module.exports = router;
