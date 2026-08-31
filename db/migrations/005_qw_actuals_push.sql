-- ============================================================
-- Migration 005: manual "Send to QW" batch push, replacing the old
-- automatic per-approval push (Timesheet -> QW Actual Hours Feedback
-- Design v1.0, sections 3, 4, 6).
-- Run manually: psql $DATABASE_URL -f db/migrations/005_qw_actuals_push.sql
-- ============================================================

-- ---- Step 1: enum addition (NOT wrapped in a transaction, same reason
-- ---- as prior migrations — ALTER TYPE ... ADD VALUE auto-commits). ----
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'send_to_qw';

-- ---- Step 2: everything else, transactional -------------------
BEGIN;

-- Section 6: the identity mapping. Manual-confirm, not auto-matched by
-- name — a name match already nearly broke silently on the Ekaterina ->
-- Katya rename this week. Nullable: a person only needs this once they
-- actually log project time that must cross to QW.
ALTER TABLE users ADD COLUMN qw_user_id INTEGER;

-- Section 4: per-entry sent marker, not per-batch — a partial batch
-- failure must only mark the entries that actually succeeded, and a
-- correction must be able to clear this on just the one entry it touched.
CREATE TABLE qw_send_batch (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiated_by      UUID NOT NULL REFERENCES users(id),
    initiated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    entries_attempted INTEGER NOT NULL,
    entries_succeeded INTEGER NOT NULL,
    entries_failed    INTEGER NOT NULL
);

ALTER TABLE timesheet_entry ADD COLUMN qw_sent_at TIMESTAMPTZ;
ALTER TABLE timesheet_entry ADD COLUMN qw_send_batch_id UUID REFERENCES qw_send_batch(id);

-- Section 6: one-off confirmed mapping for the existing 26 active people,
-- matched by hand against QW's user list on 2026-08-31 (reuses the mapping
-- already confirmed earlier the same day for the 16 accounts created then).
UPDATE users SET qw_user_id = 18 WHERE username = 'andrew';
UPDATE users SET qw_user_id = 17 WHERE username = 'andrewm';
UPDATE users SET qw_user_id = 19 WHERE username = 'bill';
UPDATE users SET qw_user_id = 20 WHERE username = 'colin';
UPDATE users SET qw_user_id = 21 WHERE username = 'damien';
UPDATE users SET qw_user_id = 22 WHERE username = 'dominic';
UPDATE users SET qw_user_id = 6  WHERE username = 'gary';
UPDATE users SET qw_user_id = 24 WHERE username = 'james';
UPDATE users SET qw_user_id = 2  WHERE username = 'jon';
UPDATE users SET qw_user_id = 9  WHERE username = 'jonny';
UPDATE users SET qw_user_id = 23 WHERE username = 'katya';
UPDATE users SET qw_user_id = 12 WHERE username = 'lucas';
UPDATE users SET qw_user_id = 25 WHERE username = 'matthew';
UPDATE users SET qw_user_id = 26 WHERE username = 'michael';
UPDATE users SET qw_user_id = 4  WHERE username = 'mihail';
UPDATE users SET qw_user_id = 8  WHERE username = 'nigel';
UPDATE users SET qw_user_id = 27 WHERE username = 'richard';
UPDATE users SET qw_user_id = 28 WHERE username = 'robert';
UPDATE users SET qw_user_id = 29 WHERE username = 'roberts';
UPDATE users SET qw_user_id = 5  WHERE username = 'simon';
UPDATE users SET qw_user_id = 30 WHERE username = 'stephen';
UPDATE users SET qw_user_id = 7  WHERE username = 'stephenh';
UPDATE users SET qw_user_id = 11 WHERE username = 'stephenn';
UPDATE users SET qw_user_id = 10 WHERE username = 'steven';
UPDATE users SET qw_user_id = 31 WHERE username = 'toby';
UPDATE users SET qw_user_id = 32 WHERE username = 'tony';
-- jon.legacy deliberately left unmapped — removed/inactive duplicate account.

COMMIT;
