const express = require('express');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Effective bookable status = admin_override if set, else is_open
// (schema note, Section 7).
const EFFECTIVE_OPEN_SQL = `COALESCE(admin_override, is_open)`;

// ── GET /api/reference/projects ───────────────────────────────
// Only open projects are selectable for new time booking (Section 7).
// ?recent=1 returns this user's 3-4 most recently used projects instead of
// the full list, for the picker's default view (Section 6).
router.get('/projects', requireAuth, async (req, res) => {
  if (req.query.recent === '1') {
    const result = await db.query(
      `SELECT DISTINCT ON (pr.id) pr.id, pr.qw_project_number, pr.project_name, MAX(te.created_at) OVER (PARTITION BY pr.id) AS last_used
         FROM timesheet_entry te
         JOIN timesheet_week tw ON tw.id = te.week_id
         JOIN project_ref pr ON pr.id = te.project_ref_id
        WHERE tw.user_id = $1 AND ${EFFECTIVE_OPEN_SQL}
        ORDER BY pr.id, last_used DESC`,
      [req.user.id]
    );
    const recent = result.rows.sort((a, b) => new Date(b.last_used) - new Date(a.last_used)).slice(0, 4);
    return res.json(recent);
  }
  const q = (req.query.q || '').trim();
  const params = [];
  let where = EFFECTIVE_OPEN_SQL;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (qw_project_number ILIKE $${params.length} OR project_name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT id, qw_project_number, project_name FROM project_ref WHERE ${where} ORDER BY qw_project_number`,
    params
  );
  res.json(result.rows);
});

// ── GET /api/reference/cost-codes ─────────────────────────────
// ?department=IL restricts to one department's codes (used for the
// non-project "-AD" default, Section 13 item 2).
router.get('/cost-codes', requireAuth, async (req, res) => {
  const params = [];
  let where = 'is_active = TRUE';
  if (req.query.department) {
    params.push(req.query.department);
    where += ` AND department = $${params.length}`;
  }
  const result = await db.query(
    `SELECT id, code, description, department, current_rate FROM cost_code WHERE ${where} ORDER BY code`,
    params
  );
  res.json(result.rows);
});

router.get('/non-project-reasons', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, name FROM non_project_reason WHERE is_active = TRUE ORDER BY name`
  );
  res.json(result.rows);
});

module.exports = router;
