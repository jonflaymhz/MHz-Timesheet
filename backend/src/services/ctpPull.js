// Pull side of the CTP integration (MHz_Timesheet_CTP_Integration_Scope_v1.0
// Section 2): scheduled hourly, mirrors qwPull.js. Unlike QW, CTP's endpoint
// is gated by its own HTTP Basic credential rather than a shared-secret
// header — CTP's app auths everything that way, including its human users,
// so this integration gets its own login rather than reusing theirs.
//
// synced_open is recomputed on every pull from ctp_ref/shipped_at, not set
// once and left — CTP's own /api/timesheet/builds endpoint already returns a
// generous 30-day post-ship window (see that endpoint's comment on
// ctp-systems-test/server.js); the exact 1-week selectability rule is this
// app's business rule to own, per Section 3, so it's applied here rather
// than trusted from CTP's response shape.

const db = require('../db/pool');

const SHIP_WINDOW_DAYS = 7;

function ctpAuthHeader() {
  const token = Buffer.from(`${process.env.CTP_SYNC_USER}:${process.env.CTP_SYNC_PASS}`).toString('base64');
  return `Basic ${token}`;
}

async function fetchFromCtp(path) {
  const res = await fetch(`${process.env.CTP_API_BASE_URL}${path}`, {
    headers: { Authorization: ctpAuthHeader() },
  });
  if (!res.ok) throw new Error(`CTP responded ${res.status} for ${path}`);
  return res.json();
}

async function logSync(type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO ctp_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ('pull', $1, $2, $3, $4, NOW())`,
    [type, status, detail, startedAt]
  );
}

function isOpen(b) {
  if (!b.shippedDate) return true;
  const shipped = new Date(b.shippedDate);
  const ageDays = (Date.now() - shipped.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= SHIP_WINDOW_DAYS;
}

async function pullBuilds() {
  const startedAt = new Date();
  try {
    const { builds } = await fetchFromCtp('/api/timesheet/builds');
    for (const b of builds) {
      await db.query(
        `INSERT INTO ctp_build (name, ctp_ref, order_ref, customer, sku, stage, despatch_status, shipped_at, synced_open, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (ctp_ref)
         DO UPDATE SET name = $1, order_ref = $3, customer = $4, sku = $5, stage = $6,
                        despatch_status = $7, shipped_at = $8, synced_open = $9, last_synced_at = NOW()`,
        [b.product, b.buildId, b.orderRef, b.customer, b.sku, b.stage, b.despatchStatus, b.shippedDate || null, isOpen(b)]
      );
    }
    await logSync('builds', 'success', `${builds.length} builds synced`, startedAt);
  } catch (err) {
    await logSync('builds', 'error', err.message, startedAt);
    throw err;
  }
}

async function runHourlySync() {
  await pullBuilds().catch(err => console.error('CTP build pull failed:', err.message));
}

module.exports = { pullBuilds, runHourlySync };
