// Push side of the QW integration — manual "Send to QW" batch (Actual
// Hours Feedback Design v1.0), not a per-approval push any more. Only
// approved, project-time entries (reason_id/ctp_build_id entries are
// excluded by the INNER JOIN to project_ref) that haven't already been
// sent are ever eligible — a correction clears qw_sent_at on just the one
// entry it touched (see admin.js's /entries/:id/correct), which is what
// makes an entry naturally reappear here without any special-casing.
const db = require('../db/pool');

async function getEligibleEntries() {
  const result = await db.query(
    `SELECT te.id, te.entry_date, te.hours, te.rate_at_entry, te.calculated_cost_at_entry,
            pr.qw_project_number, pr.project_name, cc.code AS cost_code,
            u.full_name AS person_name, u.qw_user_id
       FROM timesheet_entry te
       JOIN timesheet_week tw ON tw.id = te.week_id
       JOIN users u ON u.id = tw.user_id
       JOIN project_ref pr ON pr.id = te.project_ref_id
       LEFT JOIN cost_code cc ON cc.id = te.cost_code_id
      WHERE tw.status = 'approved' AND te.qw_sent_at IS NULL
      ORDER BY pr.qw_project_number, te.entry_date`
  );
  return result.rows;
}

// Section 3: the preview and the commit must agree on exactly what "the
// batch" is — both call getEligibleEntries() fresh rather than the caller
// passing ids around, so a commit can never send something the reviewer
// didn't just see (and never misses something approved in between either).
async function sendBatch(entries, initiatedByUserId) {
  const startedAt = new Date();
  const attempted = entries.length;

  const noMapping = entries.filter(e => !e.qw_user_id);
  const sendable = entries.filter(e => e.qw_user_id);

  const payloadEntries = sendable.map(r => ({
    project_number: r.qw_project_number || null,
    cost_code: r.cost_code,
    person_id: r.qw_user_id,
    person_name: r.person_name,
    entry_date: r.entry_date,
    hours: Number(r.hours),
    rate_gbp: r.rate_at_entry != null ? Number(r.rate_at_entry) : null,
    cost_gbp: r.calculated_cost_at_entry != null ? Number(r.calculated_cost_at_entry) : null,
    timesheet_entry_id: r.id,
  }));

  let qwResults = [];
  let requestError = null;
  if (payloadEntries.length > 0) {
    try {
      const res = await fetch(`${process.env.QW_API_BASE_URL}/integrations/timesheet/approved-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-secret': process.env.QW_SYNC_SHARED_SECRET },
        body: JSON.stringify({ entries: payloadEntries }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Genlock responded ${res.status}: ${body}`);
      }
      const body = await res.json();
      qwResults = body.results || [];
    } catch (err) {
      requestError = err.message;
    }
  }

  // A request-level failure (QW unreachable, non-2xx with no per-entry
  // detail) means every sendable entry failed, not just the ones QW
  // never got to look at — treat them all as errors rather than silently
  // leaving their outcome ambiguous.
  const byEntryId = new Map(qwResults.map(r => [r.timesheet_entry_id, r]));
  const succeededIds = [];
  const failures = [];
  let alreadyPresent = 0;

  for (const e of sendable) {
    const r = requestError ? { status: 'error', message: requestError } : byEntryId.get(e.id);
    if (r && (r.status === 'inserted' || r.status === 'duplicate')) {
      succeededIds.push(e.id);
      if (r.status === 'duplicate') alreadyPresent += 1;
    } else {
      failures.push({
        entry_id: e.id, entry_date: e.entry_date, hours: e.hours,
        project: e.qw_project_number, project_name: e.project_name, person: e.person_name,
        reason: r?.message || 'No response from Genlock for this entry',
      });
    }
  }
  for (const e of noMapping) {
    failures.push({
      entry_id: e.id, entry_date: e.entry_date, hours: e.hours,
      project: e.qw_project_number, project_name: e.project_name, person: e.person_name,
      reason: 'No Genlock account mapping for this person',
    });
  }

  const succeeded = succeededIds.length;
  const failed = attempted - succeeded;

  const batchResult = await db.query(
    `INSERT INTO qw_send_batch (initiated_by, entries_attempted, entries_succeeded, entries_failed)
     VALUES ($1,$2,$3,$4) RETURNING id, initiated_at`,
    [initiatedByUserId, attempted, succeeded, failed]
  );
  const batch = batchResult.rows[0];

  if (succeededIds.length > 0) {
    await db.query(
      `UPDATE timesheet_entry SET qw_sent_at = NOW(), qw_send_batch_id = $2 WHERE id = ANY($1::uuid[])`,
      [succeededIds, batch.id]
    );
  }

  await db.query(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, new_value)
     VALUES ('send_to_qw', 'qw_send_batch', $1, $2, $3)`,
    [batch.id, initiatedByUserId, JSON.stringify({ attempted, succeeded, failed })]
  );

  // Integration health only shows the latest detail line, so a failed push
  // carries its first failure reason here — otherwise "24 failed" says
  // nothing about why.
  const inserted = succeeded - alreadyPresent;
  const firstReason = failures[0]?.reason;
  await logSync(
    'push', 'approved_hours',
    failed === 0 ? 'success' : (succeeded === 0 ? 'error' : 'partial'),
    `Batch ${batch.id}: ${inserted} sent, ${alreadyPresent} already present, ${failed} failed of ${attempted} attempted`
      + (firstReason ? ` — first failure: ${firstReason.slice(0, 300)}` : ''),
    startedAt
  );

  return { batch_id: batch.id, initiated_at: batch.initiated_at, attempted, succeeded, inserted, already_present: alreadyPresent, failed, failures };
}

async function logSync(direction, type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO qw_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [direction, type, status, detail, startedAt]
  );
}

module.exports = { getEligibleEntries, sendBatch };
