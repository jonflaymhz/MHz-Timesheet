const express = require('express');
const db = require('../db/pool');
const { requireAuth, requireApprovalAuthority } = require('../middleware/auth');
const { approveesOf, resolveApprover } = require('../services/approval');

// Who shows on a supervisor's Team tab (Working Cost Codes v1.1 §2.9):
// their direct reports, plus anyone further down whose week they are the
// resolved approver for because the chain in between has no approver.
async function teamIds(userId) {
  const direct = (await db.query(`SELECT id FROM users WHERE reports_to = $1`, [userId])).rows.map(r => r.id);
  return [...new Set([...direct, ...(await approveesOf(userId))])];
}

const router = express.Router();

// ── GET /api/team/outstanding ────────────────────────────────
// A supervisor's own reports/freelancers who haven't submitted for a given
// week yet (Section 6's Monday-morning routine).
router.get('/outstanding', requireAuth, requireApprovalAuthority, async (req, res) => {
  const weekStart = req.query.week_start;
  if (!weekStart) return res.status(400).json({ error: 'week_start is required' });
  const approvees = await approveesOf(req.user.id);
  const result = await db.query(
    `SELECT u.id, u.full_name, tw.status, (u.id = ANY($3::uuid[])) AS i_approve
       FROM users u
       LEFT JOIN timesheet_week tw ON tw.user_id = u.id AND tw.week_start_date = $2
      WHERE u.id = ANY($1::uuid[]) AND u.is_active = TRUE AND u.pin_hash IS NOT NULL
      ORDER BY u.full_name`,
    [await teamIds(req.user.id), weekStart, approvees]
  );
  const outstanding = result.rows.filter(r => !r.status || r.status === 'draft' || r.status === 'rejected');
  res.json({ all: result.rows, outstanding });
});

// A supervisor's reports, for the proxy-entry picker (Section 6). Same
// pin_hash filter as /outstanding — proxy entry is for people who need a
// timesheet but can't submit it themselves, not for admin-only reports.
router.get('/reports', requireAuth, requireApprovalAuthority, async (req, res) => {
  const result = await db.query(
    `SELECT id, full_name FROM users WHERE id = ANY($1::uuid[]) AND is_active = TRUE AND pin_hash IS NOT NULL ORDER BY full_name`,
    [await teamIds(req.user.id)]
  );
  res.json(result.rows);
});

// ── GET /api/team/awaiting-approval ──────────────────────────
// Every submitted week, any week number, that this person is the resolved
// approver for. Admins also get the weeks whose chain has no approver at
// all (their fallback, §2.9). Weeks the viewer entered hours on are
// flagged, since they can't approve those (§2.10). Someone with
// can_self_approve also gets their own submitted weeks, path 'self'.
router.get('/awaiting-approval', requireAuth, requireApprovalAuthority, async (req, res) => {
  const isAdmin = req.user.is_payroll_admin || req.user.is_system_admin;
  const approvees = await approveesOf(req.user.id);
  const result = await db.query(
    `SELECT tw.id, tw.user_id, tw.week_start_date, tw.week_number, tw.submitted_at, u.full_name,
            COALESCE((SELECT SUM(hours) FROM timesheet_entry te WHERE te.week_id = tw.id AND NOT te.is_non_work_marker), 0) AS total_hours,
            EXISTS (SELECT 1 FROM timesheet_entry te WHERE te.week_id = tw.id AND te.entered_by = $1) AS entered_by_me
       FROM timesheet_week tw
       JOIN users u ON u.id = tw.user_id
      WHERE tw.status = 'submitted' AND (tw.user_id <> $1 OR $2)
      ORDER BY tw.week_start_date DESC, u.full_name`,
    [req.user.id, !!req.user.can_self_approve]
  );
  const rows = [];
  for (const r of result.rows) {
    if (r.user_id === req.user.id) { rows.push({ ...r, path: 'self', entered_by_me: false }); continue; }
    if (approvees.includes(r.user_id)) { rows.push({ ...r, path: 'approver' }); continue; }
    if (isAdmin && !(await resolveApprover(r.user_id))) rows.push({ ...r, path: 'admin' });
  }
  res.json(rows);
});

module.exports = router;
