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
    // project_name is "SY5714 · title · client" (§2.12); the separate
    // columns keep search working if that label format ever changes.
    where += ` AND (pr.qw_project_number ILIKE $${params.length} OR pr.project_name ILIKE $${params.length}
               OR pr.project_title ILIKE $${params.length} OR pr.customer_name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT pr.id, pr.qw_project_number, pr.project_name FROM project_ref pr WHERE ${where} ORDER BY pr.qw_project_number`,
    params
  );
  res.json(result.rows);
});

// ── GET /api/reference/cost-codes ─────────────────────────────
// Working Cost Codes v1.1 §2.3: ?type=project for project time (QW catalogue
// codes; with ?project_ref_id each carries on_project when it's sold on
// that project's estimate), ?type=non_project for reason time (each carries
// is_default for the person's department admin code, from ?dept_code).
// ?department keeps its old meaning for any older caller.
router.get('/cost-codes', requireAuth, async (req, res) => {
  const params = [];
  let where = 'cc.is_active = TRUE';
  if (req.query.type === 'project' || req.query.type === 'non_project') {
    params.push(req.query.type);
    where += ` AND cc.code_type = $${params.length}`;
  }
  if (req.query.department) {
    params.push(req.query.department);
    where += ` AND cc.department = $${params.length}`;
  }
  params.push(req.query.project_ref_id || null);
  const projParam = params.length;
  params.push(req.query.dept_code || null);
  const deptParam = params.length;
  const result = await db.query(
    `SELECT cc.id, cc.code, cc.description, cc.department, cc.current_rate, cc.code_type,
            COALESCE(cc.code = ANY(pr.estimate_codes), FALSE) AS on_project,
            (cc.code_type = 'non_project' AND cc.department = $${deptParam} AND cc.code ~ '-(AD|DA)$') AS is_default
       FROM cost_code cc
       LEFT JOIN project_ref pr ON pr.id = $${projParam}::uuid
      WHERE ${where}
      ORDER BY cc.code`,
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
// CTP build list (CTP Integration Scope Section 3) — not gated to CTP
// staff here; the frontend only surfaces this group on the entry form for
// a has_ctp_access person, but any account seeing it (e.g. a proxy-entering
// supervisor) should get the same list. is_active is the manual admin
// override; synced_open is the shipped-date window computed by the hourly
// pull (Section 3) — a build must clear both to be selectable.
// Sorted soonest-required-first (usability feedback 2026-09-02, item 5) —
// required_by is NULL for a manually-added build or one CTP hasn't set a
// ship date on, which NULLS LAST pushes to the bottom rather than the top.
router.get('/ctp-builds', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, name, order_ref, customer, sku, qty_open, required_by FROM ctp_build
      WHERE is_active = TRUE AND synced_open = TRUE
      ORDER BY required_by ASC NULLS LAST, order_ref, name`
  );
  res.json(result.rows);
});

// ── GET /api/reference/ctp-categories ─────────────────────────
// CTP's own category list (Section 4) — entirely separate from
// non_project_reason and cost_code, no overlap even where a name looks
// similar (MHz 'Sickness' vs CTP 'Sick').
router.get('/ctp-categories', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, name, kind, requires_comment FROM ctp_category WHERE is_active = TRUE ORDER BY kind, name`
  );
  res.json(result.rows);
});

module.exports = router;
