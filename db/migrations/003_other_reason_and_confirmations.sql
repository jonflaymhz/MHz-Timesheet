-- ============================================================
-- Migration 003: "Other" catch-all non-project category, and
-- submit/approve confirmation logging (Admin Scope Sections 6.4, 10).
-- Run manually: psql $DATABASE_URL -f db/migrations/003_other_reason_and_confirmations.sql
-- ============================================================

-- ---- Step 1: enum addition (NOT wrapped in a transaction, same reason
-- ---- as migrations 001/002 — ALTER TYPE ... ADD VALUE auto-commits). --
-- Submitting a week previously wasn't an audited action at all (only
-- overrides were) — Section 10 asks for the submit confirmation to be
-- logged alongside the existing Correct/Unsubmit/Approve trail.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'submit';

-- ---- Step 2: everything else, transactional -------------------
BEGIN;

-- Section 6.4: reuses the existing Notes field (timesheet_entry.description)
-- rather than a new column — application code (POST /api/weeks/:id/entries)
-- makes Notes mandatory only when this specific reason is selected.
INSERT INTO non_project_reason (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

COMMIT;
