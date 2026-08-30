const express = require('express');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Effective bookable status (Admin Scope Section 6): admin_override if set
// else is_open, AND the Stage 1 global switch (timesheet_enabled), AND
// (Stage 2) the requesting person is either an employee — visible by
// default once a project is globally on — or explicitly listed in
// project_visibility. An external/contract account not on the list
// should never see the project exists at all, not just be blocked from
// booking to it, so this same filter is used everywhere a project list is
// returned, not just at submission time.
const EFFECTIVE_BOOKABLE_SQL = `
  COALESCE(pr.admin_override, pr.is_open) AND pr.timesheet_enabled
  AND ($VISIBILITY_PARAM = 'employee' OR EXISTS (
    SELECT 1 FROM project_visibility pv WHERE pv.project_ref_id = pr.id AND pv.user_id = $USER_PARAM
  ))
`;

function bookableClause(params, userId, employmentType) {
  params.push(employmentType);
  const empParam = params.length;
  params.push(userId);
  const userParam = params.length;
  return EFFECTIVE_BOOKABLE_SQL.replace('$VISIBILITY_PARAM', `$${empParam}`).replace('$USER_PARAM', `$${userParam}`);
}

// ── GET /api/reference/projects ───────────────────────────────
// Only open, globally-enabled, and visible-to-this-person projects are
// selectable for new time booking (Section 6). ?recent=1 returns this
// user's 3-4 most recently used projects instead of the full list, for
// the picker's default view (base scope Section 6).
router.get('/projects', requireAuth, async (req, res) => {
  if (req.query.recent === '1') {
    const params = [req.user.id];
    const bookable = bookableClause(params, req.user.id, req.user.employment_type);
    const result = await db.query(
      `SELECT DISTINCT ON (pr.id) pr.id, pr.qw_project_number, pr.project_name, MAX(te.created_at) OVER (PARTITION BY pr.id) AS last_used
         FROM timesheet_entry te
         JOIN timesheet_week tw ON tw.id = te.week_id
         JOIN project_ref pr ON pr.id = te.project_ref_id
        WHERE tw.user_id = $1 AND ${bookable}
        ORDER BY pr.id, last_used DESC`,
      params
    );
    const recent = result.rows.sort((a, b) => new Date(b.last_used) - new Date(a.last_used)).slice(0, 4);
    return res.json(recent);
  }
  const q = (req.query.q || '').trim();
  const params = [];
  let where = bookableClause(params, req.user.id, req.user.employment_type);
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (pr.qw_project_number ILIKE $${params.length} OR pr.project_name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT pr.id, pr.qw_project_number, pr.project_name FROM project_ref pr WHERE ${where} ORDER BY pr.qw_project_number`,
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

// ── GET /api/reference/ctp-builds ─────────────────────────────
// CTP device/build list (Section 7) — not gated to CTP staff here; the
// frontend only surfaces this group on the entry form for a CTP-department
// person, but any account seeing it (e.g. a proxy-entering supervisor)
// should get the same list.
router.get('/ctp-builds', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, name FROM ctp_build_type WHERE is_active = TRUE ORDER BY name`
  );
  res.json(result.rows);
});

module.exports = router;
