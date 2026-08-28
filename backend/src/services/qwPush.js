// Push side of the QW integration (Section 2): live at the moment of
// approval, authenticated as a service credential, not any user session.

const db = require('../db/pool');

async function pushApprovedWeek(weekId) {
  const startedAt = new Date();
  const entriesResult = await db.query(
    `SELECT te.id, te.entry_date, te.hours, te.rate_at_entry, te.calculated_cost_at_entry,
            pr.qw_project_number, cc.code AS cost_code, u.full_name AS person_name
       FROM timesheet_entry te
       JOIN timesheet_week tw ON tw.id = te.week_id
       JOIN users u ON u.id = tw.user_id
       LEFT JOIN project_ref pr ON pr.id = te.project_ref_id
       LEFT JOIN cost_code cc ON cc.id = te.cost_code_id
      WHERE te.week_id = $1 AND NOT te.is_non_work_marker`,
    [weekId]
  );

  const entries = entriesResult.rows.map(r => ({
    project_number: r.qw_project_number || null,
    cost_code: r.cost_code,
    person_name: r.person_name,
    entry_date: r.entry_date,
    hours: Number(r.hours),
    rate_gbp: r.rate_at_entry != null ? Number(r.rate_at_entry) : null,
    cost_gbp: r.calculated_cost_at_entry != null ? Number(r.calculated_cost_at_entry) : null,
    timesheet_entry_id: r.id,
  }));

  if (entries.length === 0) {
    await logSync('push', 'approved_hours', 'success', 'Nothing to push (week has only non-work markers)', startedAt);
    return;
  }

  try {
    const res = await fetch(`${process.env.QW_API_BASE_URL}/integrations/timesheet/approved-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': process.env.QW_SYNC_SHARED_SECRET },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QW responded ${res.status}: ${body}`);
    }
    const body = await res.json();
    await logSync('push', 'approved_hours', 'success', `${body.inserted} inserted, ${body.duplicates} already present`, startedAt);
  } catch (err) {
    await logSync('push', 'approved_hours', 'error', err.message, startedAt);
    throw err;
  }
}

async function logSync(direction, type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO qw_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [direction, type, status, detail, startedAt]
  );
}

module.exports = { pushApprovedWeek };
