// Push side of the CTP integration (Section 2/6) — mirrors qwPush.js's
// manual-batch shape. Only build-linked CTP entries are ever eligible (the
// INNER JOIN to ctp_build below) — CTP non-project time (Personal, Holiday,
// Sick, etc.) stays local to this app only, exactly the way MHz non-project
// reason time never crosses to QW either. Raw hours only: no rate, no cost
// — CTP does its own costing later, in its own app (Section 6).
const db = require('../db/pool');

function ctpAuthHeader() {
  const token = Buffer.from(`${process.env.CTP_SYNC_USER}:${process.env.CTP_SYNC_PASS}`).toString('base64');
  return `Basic ${token}`;
}

async function getEligibleEntries() {
  const result = await db.query(
    `SELECT te.id, te.entry_date, te.hours,
            cb.ctp_ref AS ctp_build_ref, cb.name AS build_name, cb.sku AS build_sku, cb.order_ref,
            cc.name AS category_name,
            u.full_name AS person_name,
            tw.week_start_date
       FROM timesheet_entry te
       JOIN timesheet_week tw ON tw.id = te.week_id
       JOIN users u ON u.id = tw.user_id
       JOIN ctp_build cb ON cb.id = te.ctp_build_id
       JOIN ctp_category cc ON cc.id = te.ctp_category_id
      WHERE tw.status = 'approved' AND te.ctp_sent_at IS NULL
      ORDER BY cb.order_ref, te.entry_date`
  );
  return result.rows;
}

// Same preview/commit-must-agree discipline as qwPush.sendBatch: the caller
// always re-fetches getEligibleEntries() fresh rather than passing ids in.
async function sendBatch(entries, initiatedByUserId) {
  const startedAt = new Date();
  const attempted = entries.length;

  const payloadEntries = entries.map(r => ({
    external_id: r.id,
    buildId: r.ctp_build_ref,
    person: r.person_name,
    category: r.category_name,
    weekStart: r.week_start_date,
    hours: Number(r.hours),
  }));

  let requestError = null;
  if (payloadEntries.length > 0) {
    try {
      const res = await fetch(`${process.env.CTP_API_BASE_URL}/api/timesheet/hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: ctpAuthHeader() },
        body: JSON.stringify({ entries: payloadEntries }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`CTP responded ${res.status}: ${body}`);
      }
    } catch (err) {
      requestError = err.message;
    }
  }

  // CTP's endpoint doesn't return per-entry results (just aggregate
  // inserted/updated/skipped counts) — a request-level success means every
  // entry in the batch made it, a request-level failure means none did.
  const succeededIds = requestError ? [] : entries.map(e => e.id);
  const failed = requestError ? attempted : 0;
  const succeeded = attempted - failed;

  const batchResult = await db.query(
    `INSERT INTO ctp_send_batch (initiated_by, entries_attempted, entries_succeeded, entries_failed)
     VALUES ($1,$2,$3,$4) RETURNING id, initiated_at`,
    [initiatedByUserId, attempted, succeeded, failed]
  );
  const batch = batchResult.rows[0];

  if (succeededIds.length > 0) {
    await db.query(
      `UPDATE timesheet_entry SET ctp_sent_at = NOW(), ctp_send_batch_id = $2 WHERE id = ANY($1::uuid[])`,
      [succeededIds, batch.id]
    );
  }

  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('send_ctp_hours', 'ctp_send_batch', $1, $2, $3)`,
    [batch.id, initiatedByUserId, JSON.stringify({ attempted, succeeded, failed })]
  );

  await logSync(
    'push', 'approved_hours',
    requestError ? (attempted > 0 ? 'error' : 'success') : 'success',
    requestError || `Batch ${batch.id}: ${succeeded} sent, ${failed} failed of ${attempted} attempted`,
    startedAt
  );

  const failures = requestError
    ? entries.map(e => ({ entry_id: e.id, entry_date: e.entry_date, hours: e.hours, build: e.order_ref, person: e.person_name, reason: requestError }))
    : [];

  return { batch_id: batch.id, initiated_at: batch.initiated_at, attempted, succeeded, failed, failures };
}

async function logSync(direction, type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO ctp_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [direction, type, status, detail, startedAt]
  );
}

module.exports = { getEligibleEntries, sendBatch };
