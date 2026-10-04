// Pull side of the QW integration (Section 2): scheduled hourly, no live
// updates needed. Project list (number, name, status, sold labour codes)
// and project cost codes with their rates — no sell/margin data crosses
// this boundary.

const db = require('../db/pool');

// A QW restart (deploy) answers 502 for a few seconds; without a retry the
// pull logged an error and left projects/rates stale for an hour (Minor
// Fixes Batch 2, item 1). On a 5xx, timeout or connection error, retry after
// 30s, 60s, 120s. A 4xx (e.g. bad secret) won't fix itself, so no retry.
// QW_PULL_RETRY_DELAYS_MS overrides the delays (QA only).
const RETRY_DELAYS_MS = (process.env.QW_PULL_RETRY_DELAYS_MS || '30000,60000,120000')
  .split(',').map(Number).filter(n => n >= 0);
const REQUEST_TIMEOUT_MS = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Returns { data, retries } where retries lists what each failed attempt hit.
async function fetchFromQW(path) {
  const retries = [];
  for (let attempt = 0; ; attempt++) {
    let failure;
    try {
      const res = await fetch(`${process.env.QW_API_BASE_URL}/integrations/timesheet/${path}`, {
        headers: { 'x-sync-secret': process.env.QW_SYNC_SHARED_SECRET },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { data: await res.json(), retries };
      if (res.status < 500) throw Object.assign(new Error(`QW responded ${res.status} for ${path}`), { final: true });
      failure = String(res.status);
    } catch (err) {
      if (err.final) throw err;
      failure = err.name === 'TimeoutError' ? 'timeout' : `connection error (${err.cause?.code || err.message})`;
    }
    if (attempt >= RETRY_DELAYS_MS.length) {
      throw new Error(`QW responded ${failure} for ${path}${retries.length ? ` after ${retries.length} retries (${retries.join(', ')})` : ''}`);
    }
    retries.push(failure);
    console.warn(`QW pull ${path}: ${failure}, retry ${attempt + 1} of ${RETRY_DELAYS_MS.length} in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

const retryNote = retries => (retries.length ? `; succeeded after ${retries.length} ${retries.length === 1 ? 'retry' : 'retries'} (${retries.join(', ')})` : '');

async function logSync(type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO qw_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ('pull', $1, $2, $3, $4, NOW())`,
    [type, status, detail, startedAt]
  );
}

// Working Cost Codes v1.1: project_name is QW's display label ("SY5714 ·
// title · client", §2.12), so every existing place that shows or searches
// project_name picks up the title with no further change. A project QW
// sends as active arrives with Timesheet on (§2.11); an existing row keeps
// its own timesheet_enabled setting.
const ABSENT_CLOSE_REASON = 'No longer sent by QW';

async function pullProjects() {
  const startedAt = new Date();
  try {
    const { data: projects, retries } = await fetchFromQW('projects');
    for (const p of projects) {
      const isOpen = p.status === 'active';
      await db.query(
        `INSERT INTO project_ref (qw_project_number, project_name, project_title, customer_name, estimate_codes,
                                  qw_status, is_open, timesheet_enabled, closed_reason, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, NOW())
         ON CONFLICT (qw_project_number)
         DO UPDATE SET project_name = $2, project_title = $3, customer_name = $4, estimate_codes = $5,
                       qw_status = $6, is_open = $7, closed_reason = $8, last_synced_at = NOW()`,
        [p.project_number, p.project_name, p.title || null, p.customer || null, p.estimate_codes || [],
         p.status, isOpen, isOpen ? null : 'Closed in QW']
      );
    }
    // §2.13: a project QW stops sending (deleted, or renumbered — SY5708 and
    // SY5710 were both earlier numbers of what is now SY5711) is closed
    // after 24h, never deleted, so its history stays. admin_override still
    // wins, so an admin reopen keeps it bookable.
    const closed = await db.query(
      `UPDATE project_ref SET is_open = FALSE, closed_reason = $1
        WHERE is_open AND last_synced_at < NOW() - INTERVAL '24 hours'
        RETURNING qw_project_number`,
      [ABSENT_CLOSE_REASON]
    );
    const closedNote = closed.rows.length ? `; closed as no longer sent: ${closed.rows.map(r => r.qw_project_number).join(', ')}` : '';
    await logSync('projects', 'success', `${projects.length} projects synced${closedNote}${retryNote(retries)}`, startedAt);
  } catch (err) {
    await logSync('projects', 'error', err.message, startedAt);
    throw err;
  }
}

// §2.1/§2.2: QW's hourly labour catalogue is the source of truth for
// project codes. QW sends one row per catalogue item carrying its base code;
// variants (factory/on-site) collapse to one project cost code here, rated
// at the variants' shared rate, or the most common one where they differ
// (EL-DE: GTee Specialist Services is £125 against £52.50), which is logged.
const DEPT_OF_PREFIX = { CL: 'CL', WW: 'WW', EL: 'EL', ELEC: 'EL', IL: 'IL' };

function cleanDescription(d) {
  return (d || '')
    .replace(/\s*\((hourly|per hour)\)\s*$/i, '')
    .replace(/\s+on-site$/i, '')
    .replace(/^On-Site\s+/i, '')
    .trim();
}

function collapseRates(rows) {
  const byCode = new Map();
  for (const r of rows) {
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }
  const codes = [];
  const exceptions = [];
  // QW flags a code missing from its labour_code_category mapping
  // (Financials Labour v1.1 §2); it still books, counted by prefix.
  const unmapped = [...new Set(rows.filter(r => r.mapped === false).map(r => `${r.code}→${r.spend_category || '?'}`))];
  for (const [code, items] of byCode) {
    const counts = new Map();
    for (const i of items) {
      const rate = Number(i.rate);
      counts.set(rate, (counts.get(rate) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const rate = ranked[0][0];
    if (ranked.length > 1) {
      const odd = items.filter(i => Number(i.rate) !== rate).map(i => `${i.part_no} £${Number(i.rate).toFixed(2)}`);
      exceptions.push(`${code} at £${rate.toFixed(2)} (differs: ${odd.join(', ')})`);
    }
    const descs = [...new Set(items.map(i => cleanDescription(i.description)).filter(Boolean))];
    codes.push({
      code,
      rate,
      department: DEPT_OF_PREFIX[code.split('-')[0]] || code.split('-')[0],
      description: descs.length <= 2 ? descs.join(' / ') : `${descs.slice(0, 2).join(' / ')} +${descs.length - 2} more`,
    });
  }
  return { codes, exceptions, unmapped };
}

async function pullRates() {
  const startedAt = new Date();
  try {
    const { data: rows, retries } = await fetchFromQW('rates');
    const { codes, exceptions, unmapped } = collapseRates(rows);
    let upserted = 0;
    const clashes = [];
    for (const c of codes) {
      // Never overwrite a locally maintained non-project code that happens
      // to share a code (the IL-AD clash, §2.4, is why IL-DA exists).
      const result = await db.query(
        `INSERT INTO cost_code (code, description, department, current_rate, code_type, is_active, last_synced_at)
         VALUES ($1, $2, $3, $4, 'project', TRUE, NOW())
         ON CONFLICT (code) DO UPDATE
           SET description = $2, department = $3, current_rate = $4, is_active = TRUE, last_synced_at = NOW()
           WHERE cost_code.code_type = 'project'
         RETURNING id`,
        [c.code, c.description, c.department, c.rate]
      );
      if (result.rows[0]) upserted++; else clashes.push(c.code);
    }
    // A base code no longer in the catalogue stops being offered; history
    // keeps pointing at the row.
    const retired = await db.query(
      `UPDATE cost_code SET is_active = FALSE
        WHERE code_type = 'project' AND is_active AND NOT (code = ANY($1::text[]))
        RETURNING code`,
      [codes.map(c => c.code)]
    );
    let detail = `${upserted} of ${codes.length} QW base codes synced as project cost codes (from ${rows.length} catalogue items)`;
    if (exceptions.length) detail += `; rate exceptions: ${exceptions.join('; ')}`;
    if (unmapped.length) detail += `; unmapped in QW category table (defaulted by prefix): ${unmapped.join(', ')}`;
    if (clashes.length) detail += `; skipped, clashes with a non-project code: ${clashes.join(', ')}`;
    if (retired.rows.length) detail += `; retired: ${retired.rows.map(r => r.code).join(', ')}`;
    detail += retryNote(retries);
    await logSync('cost_codes', clashes.length ? 'partial' : 'success', detail, startedAt);
  } catch (err) {
    await logSync('cost_codes', 'error', err.message, startedAt);
    throw err;
  }
}

async function runHourlySync() {
  await pullProjects().catch(err => console.error('Project pull failed:', err.message));
  await pullRates().catch(err => console.error('Rate pull failed:', err.message));
}

module.exports = { pullProjects, pullRates, runHourlySync, collapseRates };
