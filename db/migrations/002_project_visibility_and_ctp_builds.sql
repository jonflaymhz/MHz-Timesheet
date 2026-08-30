-- ============================================================
-- Migration 002: two-stage project availability + CTP device/build
-- tracking (Batch 2 of admin-management, Admin Scope Section 6/7).
-- Run manually: psql $DATABASE_URL -f db/migrations/002_project_visibility_and_ctp_builds.sql
-- ============================================================

-- ---- Step 1: enum additions (NOT wrapped in a transaction, same reason
-- ---- as migration 001 — ALTER TYPE ... ADD VALUE auto-commits). -------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enable_project_timesheet';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'disable_project_timesheet';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'add_project_visibility';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'remove_project_visibility';

-- ---- Step 2: everything else, transactional -------------------
BEGIN;

-- Stage 1 global switch (Section 6.1): separate from project_ref.is_open/
-- admin_override, which track whether QW itself considers the project
-- live. This tracks whether a System admin has deliberately opened it for
-- TIME BOOKING. New projects arriving via the hourly pull get this column
-- at its DEFAULT (FALSE) since the INSERT in qwPull.js never names it —
-- untouched on the ON CONFLICT UPDATE path too, so re-syncing an existing
-- project never resets an admin's choice either way.
--
-- The four projects already live and in active use as of this migration
-- are grandfathered to TRUE below — defaulting them to FALSE would lock
-- everyone already logging time against them out immediately.
ALTER TABLE project_ref ADD COLUMN timesheet_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE project_ref SET timesheet_enabled = TRUE;

-- Stage 2 per-project visibility list (Section 6.2): who besides
-- "internal staff, automatically" can see and log to a project once it's
-- globally on. Existence of a row is the grant — no separate is_active
-- flag, remove the row to revoke. Only meaningful for a contractor
-- (employment_type) account; an employee is always visible once a
-- project is globally enabled, per Section 6.2's stated default.
CREATE TABLE project_visibility (
    project_ref_id  UUID NOT NULL REFERENCES project_ref(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    added_by        UUID NOT NULL REFERENCES users(id),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_ref_id, user_id)
);

CREATE INDEX idx_project_visibility_user ON project_visibility(user_id);

-- CTP device/build tracking (Section 7): a lightweight, admin-managed
-- list living entirely in this app — no QW involvement, no SY project
-- number, no rate/costing. Aggregate by build/device type, not
-- serial-level (Section 9 open question) — the stated purpose is cost
-- data to inform CTP pricing, which this granularity already serves;
-- serial-level tracking can be added later as an optional column on
-- timesheet_entry without touching this table.
CREATE TABLE ctp_build_type (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- timesheet_entry gains a third mutually-exclusive target alongside
-- project_ref_id/reason_id. Unlike those two, cost_code_id is NOT
-- required for a CTP entry — the 58-code catalogue has no CTP department
-- (CTP staff are all department='CTP', which isn't one of CL/EL/IL/WW/RW),
-- so forcing a cost code would mean picking a deliberately wrong one.
-- CTP time is also never costed (no rate_at_entry/calculated_cost_at_entry)
-- for the same reason non-project time isn't: no QW rate exists for it.
ALTER TABLE timesheet_entry ADD COLUMN ctp_build_id UUID REFERENCES ctp_build_type(id);
CREATE INDEX idx_entry_ctp_build ON timesheet_entry(ctp_build_id);

ALTER TABLE timesheet_entry DROP CONSTRAINT timesheet_entry_check;
ALTER TABLE timesheet_entry ADD CONSTRAINT timesheet_entry_check CHECK (
    (is_non_work_marker AND project_ref_id IS NULL AND reason_id IS NULL AND cost_code_id IS NULL AND ctp_build_id IS NULL AND hours = 0)
    OR
    (NOT is_non_work_marker
     AND hours > 0 AND hours <= 24
     AND (
       (project_ref_id IS NOT NULL AND reason_id IS NULL AND ctp_build_id IS NULL AND cost_code_id IS NOT NULL)
       OR (project_ref_id IS NULL AND reason_id IS NOT NULL AND ctp_build_id IS NULL AND cost_code_id IS NOT NULL)
       OR (project_ref_id IS NULL AND reason_id IS NULL AND ctp_build_id IS NOT NULL AND cost_code_id IS NULL)
     ))
);

-- Duplicate prevention needs to widen to the new three-way shape. cost_code_id
-- can now legitimately be NULL for a real (non-marker) CTP entry, so it needs
-- the same NULL-safe COALESCE sentinel already used for project_ref_id/reason_id
-- — a bare NULL=NULL comparison in a unique index would let two identical CTP
-- entries for the same day through uncaught.
DROP INDEX idx_entry_no_duplicates;
CREATE UNIQUE INDEX idx_entry_no_duplicates
    ON timesheet_entry (
        week_id, entry_date,
        COALESCE(cost_code_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(project_ref_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(reason_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(ctp_build_id, '00000000-0000-0000-0000-000000000000')
    )
    WHERE NOT is_non_work_marker;

COMMIT;
