// Approval routing (Working Cost Codes, Rates, Approvals v1.1 §2.9/§2.10).
//
// The approver for a week is the owner's reports_to if that person has
// Approval and is active; otherwise the first active Approval-holder
// further up the reports_to chain. System and Payroll admins can approve
// any week as a fallback, recorded as an admin approval. Nobody approves a
// week they entered hours on (their own week, or a week they proxy-entered).
const db = require('../db/pool');

const SELF_ENTERED_NOTE = 'You entered hours on this week, another approver is needed';

async function loadUsers() {
  const result = await db.query(
    `SELECT id, full_name, reports_to, can_approve, is_active, removed_at, is_payroll_admin, is_system_admin FROM users`
  );
  return new Map(result.rows.map(u => [u.id, u]));
}

function isLiveApprover(u) {
  return !!u && u.can_approve && u.is_active && !u.removed_at;
}

// Walks up from the owner's manager; null when the chain has no active
// Approval-holder (then only the admin fallback can approve).
function resolveFrom(users, ownerId) {
  const seen = new Set([ownerId]);
  let next = users.get(ownerId)?.reports_to;
  while (next && !seen.has(next)) {
    seen.add(next);
    const u = users.get(next);
    if (!u) return null;
    if (isLiveApprover(u)) return u;
    next = u.reports_to;
  }
  return null;
}

async function resolveApprover(ownerId) {
  return resolveFrom(await loadUsers(), ownerId);
}

// Everyone whose weeks `approverId` is the resolved approver for.
async function approveesOf(approverId) {
  const users = await loadUsers();
  return [...users.values()].filter(u => u.id !== approverId && resolveFrom(users, u.id)?.id === approverId).map(u => u.id);
}

// Whether `requester` may approve (or reject) `week` right now. `path` is
// 'approver' or 'admin'; `reason` explains a refusal in words the UI shows.
async function approvalDecision(week, requester) {
  const approver = await resolveApprover(week.user_id);
  const base = { approver_id: approver?.id || null, approver_name: approver?.full_name || null };
  if (week.user_id === requester.id) {
    return { ...base, allowed: false, reason: "You can't approve your own week" };
  }
  const entered = await db.query(
    `SELECT 1 FROM timesheet_entry WHERE week_id = $1 AND entered_by = $2 LIMIT 1`,
    [week.id, requester.id]
  );
  if (entered.rows[0]) return { ...base, allowed: false, reason: SELF_ENTERED_NOTE };
  if (approver && approver.id === requester.id) return { ...base, allowed: true, path: 'approver' };
  if (requester.is_payroll_admin || requester.is_system_admin) return { ...base, allowed: true, path: 'admin' };
  return {
    ...base, allowed: false,
    reason: approver ? `${approver.full_name} approves this week` : 'Only an admin can approve this week (no approver in the reporting chain)',
  };
}

// Viewing and proxy entry: the owner, an admin, the owner's direct manager
// with Approval (as before), or the resolved approver further up.
async function canActFor(requester, ownerId) {
  if (ownerId === requester.id) return true;
  if (requester.is_payroll_admin || requester.is_system_admin) return true;
  if (!requester.can_approve) return false;
  const users = await loadUsers();
  if (users.get(ownerId)?.reports_to === requester.id) return true;
  return resolveFrom(users, ownerId)?.id === requester.id;
}

// §2.7: project time is costed at the cost code's current_rate when the
// week is approved, not when the hours were typed in.
async function snapshotRatesAtApproval(weekId) {
  await db.query(
    `UPDATE timesheet_entry te
        SET rate_at_entry = cc.current_rate,
            calculated_cost_at_entry = CASE WHEN cc.current_rate IS NULL THEN NULL ELSE te.hours * cc.current_rate END
       FROM cost_code cc
      WHERE te.week_id = $1 AND te.project_ref_id IS NOT NULL AND cc.id = te.cost_code_id`,
    [weekId]
  );
}

module.exports = { resolveApprover, approveesOf, approvalDecision, canActFor, snapshotRatesAtApproval, SELF_ENTERED_NOTE };
