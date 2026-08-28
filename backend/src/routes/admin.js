const express = require('express');
const db = require('../db/pool');
const { requireAuth, requireAdmin, requireOverrideAuthority } = require('../middleware/auth');
const { hashPin, isValidPin } = require('../services/pin');

const router = express.Router();

// ── User management (Section 8) — admin only ────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.full_name, u.username, u.department, u.role, u.employment_type,
            u.reports_to, u.is_active, u.pin_locked_at, r.full_name AS reports_to_name
       FROM users u
       LEFT JOIN users r ON r.id = u.reports_to
      ORDER BY u.full_name`
  );
  res.json(result.rows);
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { full_name, username, department, role, employment_type, reports_to, pin } = req.body;
  if (!full_name || !username || !role) {
    return res.status(400).json({ error: 'full_name, username, and role are required' });
  }
  let pinHash = null;
  if (role !== 'admin' && role !== 'jonny') {
    if (!isValidPin(pin)) return res.status(400).json({ error: 'A 6-digit PIN is required for this role' });
    pinHash = await hashPin(pin);
  }
  try {
    const result = await db.query(
      `INSERT INTO users (full_name, username, department, role, employment_type, reports_to, pin_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, full_name, username, role`,
      [full_name, username, department || null, role, employment_type || 'employee', reports_to || null, pinHash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already in use' });
    throw err;
  }
});

// Deactivate, never delete (Section 3) — historical entries stay intact.
router.patch('/users/:id/deactivate', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.query(`UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Deactivated' });
});

router.patch('/users/:id/reactivate', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.query(`UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Reactivated' });
});

router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { department, role, employment_type, reports_to } = req.body;
  const result = await db.query(
    `UPDATE users SET department = COALESCE($2, department), role = COALESCE($3, role),
            employment_type = COALESCE($4, employment_type), reports_to = $5, updated_at = NOW()
      WHERE id = $1 RETURNING id, full_name, department, role, employment_type, reports_to`,
    [req.params.id, department, role, employment_type, reports_to || null]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

// PIN unlock (Section 3: 5 failed attempts locks the account, admin unlock
// only, no auto-expiring cooldown) — logged like every other override.
router.post('/users/:id/unlock-pin', requireAuth, requireAdmin, async (req, res) => {
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

// ── Project availability (Section 7) ────────────────────────────
router.get('/projects', requireAuth, requireAdmin, async (req, res) => {
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

router.post('/projects/:id/reopen', requireAuth, requireAdmin, async (req, res) => {
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
router.get('/cost-codes', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.query(`SELECT * FROM cost_code ORDER BY department, code`);
  res.json(result.rows);
});

router.patch('/cost-codes/:id', requireAuth, requireAdmin, async (req, res) => {
  const { current_rate, is_active } = req.body;
  const result = await db.query(
    `UPDATE cost_code SET current_rate = COALESCE($2, current_rate), is_active = COALESCE($3, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, current_rate, is_active]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Cost code not found' });
  res.json(result.rows[0]);
});

// ── Override tools: Correct / Unsubmit (Section 5, Jonny/admin only) ──
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

// Jonny can also apply Approve directly (Section 5) — from draft, rejected,
// or submitted, skipping supervisor review if needed. Not from an already-
// approved week: that's not "approving" anything, it would just silently
// re-trigger a push with no real state change.
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

// ── Audit log (Section 8) — admin/Jonny only ────────────────────
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
      WHERE u.is_active = TRUE AND u.role IN ('employee', 'contractor')
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
