const express = require('express');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const wu = require('../services/weekUtils');

const router = express.Router();

// A supervisor (or admin/jonny) may act on a report's week — used for both
// viewing and proxy entry (Section 6). Returns the target week row, or null
// if the requester has no standing to touch it.
async function loadWeekWithAuthority(weekId, requester) {
  const result = await db.query(
    `SELECT tw.*, u.full_name AS owner_full_name FROM timesheet_week tw
       JOIN users u ON u.id = tw.user_id WHERE tw.id = $1`,
    [weekId]
  );
  const week = result.rows[0];
  if (!week) return { week: null, allowed: false, isProxy: false };
  if (week.user_id === requester.id) return { week, allowed: true, isProxy: false };
  if (requester.is_payroll_admin || requester.is_system_admin) return { week, allowed: true, isProxy: true };
  if (requester.can_approve) {
    const ownerResult = await db.query(`SELECT reports_to FROM users WHERE id = $1`, [week.user_id]);
    if (ownerResult.rows[0]?.reports_to === requester.id) return { week, allowed: true, isProxy: true };
  }
  return { week, allowed: false, isProxy: false };
}

async function weekWithEntries(weekId) {
  const [weekResult, entriesResult] = await Promise.all([
    db.query(
      `SELECT tw.*, u.full_name AS owner_full_name, u.department AS owner_department, u.has_ctp_access AS owner_has_ctp_access
         FROM timesheet_week tw
         JOIN users u ON u.id = tw.user_id WHERE tw.id = $1`,
      [weekId]
    ),
    db.query(
      `SELECT te.*, pr.qw_project_number, pr.project_name, npr.name AS reason_name,
              cb.name AS ctp_build_name, cb.order_ref AS ctp_build_order_ref,
              ccat.name AS ctp_category_name, ccat.kind AS ctp_category_kind,
              cc.code AS cost_code, cc.description AS cost_code_description
         FROM timesheet_entry te
         LEFT JOIN project_ref pr ON pr.id = te.project_ref_id
         LEFT JOIN non_project_reason npr ON npr.id = te.reason_id
         LEFT JOIN ctp_build cb ON cb.id = te.ctp_build_id
         LEFT JOIN ctp_category ccat ON ccat.id = te.ctp_category_id
         LEFT JOIN cost_code cc ON cc.id = te.cost_code_id
        WHERE te.week_id = $1
        ORDER BY te.entry_date, te.created_at`,
      [weekId]
    ),
  ]);
  return { week: weekResult.rows[0], entries: entriesResult.rows };
}

async function getOrCreateWeek(userId, start) {
  let week = (await db.query(
    `SELECT * FROM timesheet_week WHERE user_id = $1 AND week_start_date = $2`,
    [userId, start]
  )).rows[0];
  if (!week) {
    const { start: s, end, weekNumber } = wu.weekBounds(start);
    week = (await db.query(
      `INSERT INTO timesheet_week (user_id, week_number, week_start_date, week_end_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, weekNumber, s, end]
    )).rows[0];
  }
  return week;
}

// ── GET /api/weeks/mine ────────────────────────────────────────
// Default view is the most recently COMPLETED week, not today (Section 6).
// ?week_start=YYYY-MM-DD (a Monday) fetches a specific week instead.
router.get('/mine', requireAuth, async (req, res) => {
  const start = req.query.week_start
    ? req.query.week_start
    : wu.fmtDate(wu.lastCompletedWeekStart());
  if (!wu.isMonday(start)) return res.status(400).json({ error: 'week_start must be a Monday' });
  const week = await getOrCreateWeek(req.user.id, start);
  const { entries } = await weekWithEntries(week.id);
  res.json({ week, entries });
});

// ── GET /api/weeks/for/:userId ──────────────────────────────────
// Proxy entry (Section 6): a supervisor entering a full week on behalf of a
// freelancer who can't use the system themselves. Every resulting entry's
// entered_by will be the supervisor, not the week owner — the week is then
// visibly proxy-entered wherever it's shown, per Section 6.
router.get('/for/:userId', requireAuth, async (req, res) => {
  const targetId = req.params.userId;
  if (targetId !== req.user.id) {
    if (!req.user.is_payroll_admin && !req.user.is_system_admin) {
      if (!req.user.can_approve) return res.status(403).json({ error: 'Not authorised' });
      const ownerResult = await db.query(`SELECT reports_to FROM users WHERE id = $1`, [targetId]);
      if (ownerResult.rows[0]?.reports_to !== req.user.id) return res.status(403).json({ error: 'Not authorised' });
    }
  }
  const start = req.query.week_start
    ? req.query.week_start
    : wu.fmtDate(wu.lastCompletedWeekStart());
  if (!wu.isMonday(start)) return res.status(400).json({ error: 'week_start must be a Monday' });
  const week = await getOrCreateWeek(targetId, start);
  const { entries } = await weekWithEntries(week.id);
  res.json({ week, entries, is_proxy: targetId !== req.user.id });
});

router.get('/:id', requireAuth, async (req, res) => {
  const { week, allowed } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to view this week' });
  const full = await weekWithEntries(week.id);
  res.json(full);
});

// ── GET /api/weeks/history/mine ────────────────────────────────
// "Previous weeks" list (Section 6) — one line per week, most recent first.
router.get('/history/mine', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT tw.*, COALESCE(SUM(te.hours), 0) AS total_hours
       FROM timesheet_week tw
       LEFT JOIN timesheet_entry te ON te.week_id = tw.id AND NOT te.is_non_work_marker
      WHERE tw.user_id = $1
      GROUP BY tw.id
      ORDER BY tw.week_start_date DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

function isEditable(week) {
  return week.status === 'draft' || week.status === 'rejected';
}

// ── POST /api/weeks/:id/entries ────────────────────────────────
router.post('/:id/entries', requireAuth, async (req, res) => {
  const { week, allowed, isProxy } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to edit this week' });
  if (!isEditable(week)) return res.status(400).json({ error: 'Week is locked and cannot be edited' });

  const { entry_date, project_ref_id, reason_id, ctp_build_id, ctp_category_id, cost_code_id, hours, description, is_non_work_marker } = req.body;
  if (!entry_date || entry_date < week.week_start_date || entry_date > week.week_end_date) {
    return res.status(400).json({ error: 'entry_date must fall within this week' });
  }
  if (Math.round(Number(hours || 0) * 4) !== Number(hours || 0) * 4) {
    return res.status(400).json({ error: 'Hours must be in 15-minute increments' });
  }

  if (is_non_work_marker) {
    try {
      const result = await db.query(
        `INSERT INTO timesheet_entry (week_id, entry_date, is_non_work_marker, hours, entered_by)
         VALUES ($1, $2, TRUE, 0, $3) RETURNING *`,
        [week.id, entry_date, req.user.id]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A non-work marker already exists for this day' });
      throw err;
    }
  }

  const targets = [project_ref_id, reason_id, ctp_category_id].filter(Boolean);
  if (targets.length === 0) return res.status(400).json({ error: 'One of project_ref_id, reason_id, or ctp_category_id is required' });
  if (targets.length > 1) return res.status(400).json({ error: 'project_ref_id, reason_id, and ctp_category_id are mutually exclusive' });
  // CTP Integration Scope Section 4: a CTP entry has no cost code at all —
  // CTP staff aren't in any of the 58-code catalogue's five departments, so
  // there's no correct one to force a pick from, for either CTP shape.
  if (!ctp_category_id && !cost_code_id) return res.status(400).json({ error: 'cost_code_id is required' });
  if (!hours || hours <= 0) return res.status(400).json({ error: 'hours must be greater than zero' });

  if (project_ref_id) {
    // Visibility (Section 6) is checked against the week OWNER, not
    // whoever's actually typing this in — a proxy-entering supervisor's
    // own access never substitutes for the subcontractor's.
    const projResult = await db.query(
      `SELECT COALESCE(pr.admin_override, pr.is_open) AS open, pr.timesheet_enabled,
              (u.employment_type = 'employee' OR EXISTS (
                 SELECT 1 FROM project_visibility pv WHERE pv.project_ref_id = pr.id AND pv.user_id = u.id
              )) AS visible_to_owner
         FROM project_ref pr, users u
        WHERE pr.id = $1 AND u.id = $2`,
      [project_ref_id, week.user_id]
    );
    const proj = projResult.rows[0];
    if (!proj) return res.status(400).json({ error: 'Unknown project' });
    if (!proj.open) return res.status(400).json({ error: 'This project is closed to new time booking' });
    if (!proj.timesheet_enabled) return res.status(400).json({ error: 'This project is not yet open for timesheet entry' });
    if (!proj.visible_to_owner) return res.status(400).json({ error: 'This project is not available to this person' });
  }
  if (ctp_category_id) {
    const categoryResult = await db.query(`SELECT name, kind, requires_comment FROM ctp_category WHERE id = $1 AND is_active`, [ctp_category_id]);
    if (!categoryResult.rows[0]) return res.status(400).json({ error: 'Unknown or inactive CTP category' });
    const category = categoryResult.rows[0];
    // Section 4: 'Other' is the only category in either system that forces
    // a comment — reuses the existing Notes field, same as reason_id's
    // 'Other' handling below.
    if (category.requires_comment && !description?.trim()) {
      return res.status(400).json({ error: `Notes are required when "${category.name}" is selected` });
    }
    if (category.kind === 'build') {
      if (!ctp_build_id) return res.status(400).json({ error: 'ctp_build_id is required for this category' });
      // synced_open, not just is_active — a build outside its post-ship
      // window (Section 3) shouldn't accept new hours even if an admin
      // hasn't gotten around to hiding it manually.
      const buildResult = await db.query(`SELECT 1 FROM ctp_build WHERE id = $1 AND is_active AND synced_open`, [ctp_build_id]);
      if (!buildResult.rows[0]) return res.status(400).json({ error: 'Unknown, inactive, or closed CTP build' });
    } else if (ctp_build_id) {
      return res.status(400).json({ error: 'ctp_build_id must not be set for a non-project CTP category' });
    }
  }
  if (reason_id) {
    const reasonResult = await db.query(`SELECT name FROM non_project_reason WHERE id = $1 AND is_active`, [reason_id]);
    if (!reasonResult.rows[0]) return res.status(400).json({ error: 'Unknown or inactive reason' });
    // Section 6.4: "Other" reuses the existing Notes field rather than a
    // new one — Notes stays optional for every other reason, as today.
    if (reasonResult.rows[0].name === 'Other' && !description?.trim()) {
      return res.status(400).json({ error: 'Notes are required when "Other" is selected' });
    }
  }

  let rate = null;
  if (cost_code_id) {
    const costResult = await db.query(`SELECT current_rate FROM cost_code WHERE id = $1 AND is_active`, [cost_code_id]);
    if (!costResult.rows[0]) return res.status(400).json({ error: 'Unknown cost code' });
    rate = costResult.rows[0].current_rate;
  }
  // Rate snapshotting (Section 4): calculated only for project time — non-
  // project and CTP time is informational only, never part of cost-vs-
  // budget reporting (Section 9), so it's never costed even if a rate exists.
  const rateAtEntry = project_ref_id ? rate : null;
  const cost = project_ref_id && rate != null ? Number(hours) * Number(rate) : null;

  try {
    const result = await db.query(
      `INSERT INTO timesheet_entry
         (week_id, entry_date, project_ref_id, reason_id, ctp_build_id, ctp_category_id, cost_code_id, hours, description, rate_at_entry, calculated_cost_at_entry, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [week.id, entry_date, project_ref_id || null, reason_id || null, ctp_build_id || null, ctp_category_id || null, cost_code_id || null, hours, description || null, rateAtEntry, cost, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An identical entry already exists for this day' });
    throw err;
  }
});

router.delete('/:id/entries/:entryId', requireAuth, async (req, res) => {
  const { week, allowed } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to edit this week' });
  if (!isEditable(week)) return res.status(400).json({ error: 'Week is locked and cannot be edited' });
  await db.query(`DELETE FROM timesheet_entry WHERE id = $1 AND week_id = $2`, [req.params.entryId, week.id]);
  res.json({ message: 'Deleted' });
});

// ── POST /api/weeks/:id/submit ─────────────────────────────────
// Gated on a complete week (Section 6) — Phase 1 assumes a fixed Mon-Fri
// contracted week for everyone (schema note #6) until per-user work
// patterns are decided.
const CONTRACTED_WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri

router.post('/:id/submit', requireAuth, async (req, res) => {
  const { week, allowed, isProxy } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to submit this week' });
  if (!isEditable(week)) return res.status(400).json({ error: 'Week is already submitted or approved' });
  // Section 10.1: the confirmation is the point, not a formality — enforced
  // server-side so it can't be skipped by calling the API directly.
  if (!req.body?.confirmed) return res.status(400).json({ error: 'Confirmation is required before submitting' });

  const { entries } = await weekWithEntries(week.id);
  const coveredDates = new Set(entries.map(e => e.entry_date));
  const missing = [];
  const start = new Date(week.week_start_date);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // Mon=1..Sun=7
    if (!CONTRACTED_WEEKDAYS.includes(isoDow)) continue;
    const key = d.toISOString().slice(0, 10);
    if (!coveredDates.has(key)) missing.push(key);
  }
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Week is incomplete', missing_dates: missing });
  }

  const result = await db.query(
    `UPDATE timesheet_week SET status = 'submitted', submitted_at = NOW() WHERE id = $1 RETURNING *`,
    [week.id]
  );
  const confirmationText = isProxy
    ? `I confirm these hours are accurate for ${week.owner_full_name}.`
    : 'I confirm these hours are accurate.';
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('submit', 'timesheet_week', $1, $2, $3)`,
    [week.id, req.user.id, JSON.stringify({ confirmed: true, confirmation_text: confirmationText })]
  );
  res.json(result.rows[0]);
});

// ── POST /api/weeks/:id/approve ─────────────────────────────────
// One week at a time, never bulk (Section 5, confirmed) — the frontend
// simply never offers a multi-select here. Supervisor-level; Jonny can
// also apply this directly.
router.post('/:id/approve', requireAuth, async (req, res) => {
  const { week, allowed } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to approve this week' });
  if (!req.user.can_approve && !req.user.is_payroll_admin && !req.user.is_system_admin) {
    return res.status(403).json({ error: 'Requires approval access' });
  }
  if (week.status !== 'submitted') {
    return res.status(400).json({ error: 'Only a submitted week can be approved' });
  }
  // Section 10.2: same server-side enforcement as the submit confirmation.
  if (!req.body?.confirmed) return res.status(400).json({ error: 'Confirmation is required before approving' });
  const result = await db.query(
    `UPDATE timesheet_week SET status = 'approved', approved_at = NOW(), approved_by = $2 WHERE id = $1 RETURNING *`,
    [week.id, req.user.id]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('approve', 'timesheet_week', $1, $2, $3)`,
    [week.id, req.user.id, JSON.stringify({
      status: 'approved', confirmed: true,
      confirmation_text: "I've reviewed and confirm these hours as real.",
    })]
  );
  // No automatic QW push here any more (Actual Hours Feedback Design v1.0
  // §2) — sending is a deliberate, manual "Send to QW" batch action,
  // Admin-Payroll-only (see admin.js's /qw-send/* routes).
  res.json(result.rows[0]);
});

// ── POST /api/weeks/:id/reject ─────────────────────────────────
// Supervisor-level reject of a Submitted week, reason required — same
// mechanism as Jonny's Unsubmit, at the supervisor's level (Section 5).
router.post('/:id/reject', requireAuth, async (req, res) => {
  const { week, allowed } = await loadWeekWithAuthority(req.params.id, req.user);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!allowed) return res.status(403).json({ error: 'Not authorised to reject this week' });
  if (!req.user.can_approve && !req.user.is_payroll_admin && !req.user.is_system_admin) {
    return res.status(403).json({ error: 'Requires approval access' });
  }
  if (week.status !== 'submitted') {
    return res.status(400).json({ error: 'Only a submitted week can be rejected' });
  }
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  const result = await db.query(
    `UPDATE timesheet_week SET status = 'rejected', rejected_at = NOW(), rejected_by = $2, rejection_reason = $3
     WHERE id = $1 RETURNING *`,
    [week.id, req.user.id, reason]
  );
  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, reason)
     VALUES ('reject', 'timesheet_week', $1, $2, $3)`,
    [week.id, req.user.id, reason]
  );
  res.json(result.rows[0]);
});

module.exports = router;
