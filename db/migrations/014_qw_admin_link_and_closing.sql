-- ============================================================
-- Migration 014: User Management v1.6 Phases 5-6.
--
-- §3.6 Inbound user admin from QW (routes/qwAdmin.js): audit actions for
--      users created, closed out and reactivated from QW.
-- §3.2/§5.2 Closing state: a leaver keeps Timesheet access until the grace
--      end, entering only weeks up to their leaving date; a daily job then
--      removes them. closing_grace_end set = Closing.
--
-- ALTER TYPE ... ADD VALUE can't run inside a transaction block, so the
-- enum additions come first, outside BEGIN.
-- Re-runnable. Run manually: psql $DATABASE_URL -f db/migrations/014_qw_admin_link_and_closing.sql
-- ============================================================

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'create_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'close_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reactivate_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reassign_reports';

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS closing_leave_date date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS closing_grace_end date;
COMMENT ON COLUMN users.closing_grace_end IS
  'Set while Closing (User Management scope 3.2): Timesheet access continues to this date, for weeks up to closing_leave_date only; the daily job then removes the user.';

-- A qw_user_id links one Timesheet user to one QW user.
CREATE UNIQUE INDEX IF NOT EXISTS users_qw_user_id_key ON users (qw_user_id) WHERE qw_user_id IS NOT NULL;

COMMIT;
