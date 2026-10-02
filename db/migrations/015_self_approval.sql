-- ============================================================
-- Migration 015: Timesheet Self-Approval v1.0.
--
-- users.can_self_approve: this person may approve their OWN submitted week
-- (for people at the top of a reporting chain, so their weeks don't
-- stall). Separate from can_approve, which is approving other people's
-- weeks; it only takes effect when can_approve is also set. Set from QW
-- Admin > Users > Timesheet panel. Nobody has it until an admin ticks it.
--
-- A self-approved week is one where approved_by = user_id; the approve
-- audit row carries self_approval: true.
-- Re-runnable. Run manually: psql $DATABASE_URL -f db/migrations/015_self_approval.sql
-- ============================================================
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_self_approve BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN users.can_self_approve IS
  'May approve their own submitted timesheet week (Self-Approval v1.0). Only effective with can_approve.';
COMMIT;
