const express = require('express');
const db = require('../db/pool');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/team/outstanding ────────────────────────────────
// A supervisor's own reports/freelancers who haven't submitted for a given
// week yet (Section 6's Monday-morning routine).
router.get('/outstanding', requireAuth, requireSupervisor, async (req, res) => {
  const weekStart = req.query.week_start;
  if (!weekStart) return res.status(400).json({ error: 'week_start is required' });
  const result = await db.query(
    `SELECT u.id, u.full_name, tw.status
       FROM users u
       LEFT JOIN timesheet_week tw ON tw.user_id = u.id AND tw.week_start_date = $2
      WHERE u.reports_to = $1 AND u.is_active = TRUE
      ORDER BY u.full_name`,
    [req.user.id, weekStart]
  );
  const outstanding = result.rows.filter(r => !r.status || r.status === 'draft' || r.status === 'rejected');
  res.json({ all: result.rows, outstanding });
});

// A supervisor's reports, for the proxy-entry picker (Section 6).
router.get('/reports', requireAuth, requireSupervisor, async (req, res) => {
  const result = await db.query(
    `SELECT id, full_name FROM users WHERE reports_to = $1 AND is_active = TRUE ORDER BY full_name`,
    [req.user.id]
  );
  res.json(result.rows);
});

module.exports = router;
