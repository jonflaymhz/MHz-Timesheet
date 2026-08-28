// Pull side of the QW integration (Section 2): scheduled hourly, no live
// updates needed. Project list (number, name, status only) and rates
// matched by cost code — no cost/sell/margin data crosses this boundary.

const db = require('../db/pool');

async function fetchFromQW(path) {
  const res = await fetch(`${process.env.QW_API_BASE_URL}/integrations/timesheet/${path}`, {
    headers: { 'x-sync-secret': process.env.QW_SYNC_SHARED_SECRET },
  });
  if (!res.ok) throw new Error(`QW responded ${res.status} for ${path}`);
  return res.json();
}

async function logSync(type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO qw_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ('pull', $1, $2, $3, $4, NOW())`,
    [type, status, detail, startedAt]
  );
}

async function pullProjects() {
  const startedAt = new Date();
  try {
    const projects = await fetchFromQW('projects');
    for (const p of projects) {
      const isOpen = p.status === 'active';
      await db.query(
        `INSERT INTO project_ref (qw_project_number, project_name, qw_status, is_open, last_synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (qw_project_number)
         DO UPDATE SET project_name = $2, qw_status = $3, is_open = $4, last_synced_at = NOW()`,
        [p.project_number, p.project_name, p.status, isOpen]
      );
    }
    await logSync('projects', 'success', `${projects.length} projects synced`, startedAt);
  } catch (err) {
    await logSync('projects', 'error', err.message, startedAt);
    throw err;
  }
}

async function pullRates() {
  const startedAt = new Date();
  try {
    const rates = await fetchFromQW('rates');
    let matched = 0;
    for (const r of rates) {
      const result = await db.query(
        `UPDATE cost_code SET current_rate = $2, last_synced_at = NOW() WHERE code = $1 RETURNING id`,
        [r.code, r.rate]
      );
      if (result.rows[0]) matched++;
    }
    await logSync('cost_codes', 'success', `${matched} of ${rates.length} QW-mapped rates matched a local cost code`, startedAt);
  } catch (err) {
    await logSync('cost_codes', 'error', err.message, startedAt);
    throw err;
  }
}

async function runHourlySync() {
  await pullProjects().catch(err => console.error('Project pull failed:', err.message));
  await pullRates().catch(err => console.error('Rate pull failed:', err.message));
}

module.exports = { pullProjects, pullRates, runHourlySync };
