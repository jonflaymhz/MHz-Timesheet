-- ============================================================
-- Migration 006: real CTP integration, replacing the placeholder
-- ctp_build_type scaffolding from migration 002 (MHz_Timesheet_CTP_
-- Integration_Scope_v1.0, decided 2026-09-02).
--
-- Context: ctp_build_type has zero rows and timesheet_entry has zero
-- entries against ctp_build_id as of this migration — the app is still
-- pre-launch (sample data only), so this is a clean redesign, not a
-- live-data migration. Confirmed with Jon before writing this.
--
-- What changes vs migration 002's design:
--   - Visibility moves from "department = 'CTP'" (exclusive) to a new
--     additive has_ctp_access flag, so a person can eventually see both
--     MHz projects and CTP builds — department keeps its other job
--     (defaulting the cost-code field) but no longer gates CTP at all.
--   - ctp_build_type is extended in place (renamed ctp_build) into a
--     real per-build table, populated by an hourly pull from the actual
--     CTP app (app.ctpsystems.co.uk) rather than typed in by an admin.
--   - A genuinely new ctp_category list (PaP/Mill/Build/Test/Ship plus
--     seven non-productive reasons) — nothing like this existed before.
--   - Push to CTP (raw hours, no cost) for build-linked entries only,
--     mirroring exactly how project time (not reason time) is the only
--     thing that ever crosses to QW.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/006_ctp_integration.sql
-- ============================================================

-- ---- Step 1: enum additions (NOT wrapped in a transaction, same reason
-- ---- as prior migrations — ALTER TYPE ... ADD VALUE auto-commits). ----
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'send_ctp_hours';

-- ---- Step 2: everything else, transactional -------------------
BEGIN;

-- ------------------------------------------------------------
-- Visibility: has_ctp_access replaces department='CTP' as the gate.
-- Backfilled TRUE for the four people already using department='CTP'
-- for this purpose; department is left untouched on their rows (it's
-- inert for cost-code defaulting since no cost_code has department
-- 'CTP', and changing it is out of scope for this migration).
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN has_ctp_access BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET has_ctp_access = TRUE WHERE department = 'CTP';

-- ------------------------------------------------------------
-- Builds: extend the existing (empty) admin-typed list into a real
-- per-build table synced hourly from CTP's own app. is_active stays as
-- a manual admin override/kill-switch, independent of synced_open
-- (which the pull recomputes every run from ctp_ref/shipped_at) — an
-- admin can still hand-hide a build even if the sync thinks it's open.
-- ------------------------------------------------------------
ALTER TABLE ctp_build_type RENAME TO ctp_build;

-- name was UNIQUE under the old admin-typed-list design, where each row was
-- a distinct type. It no longer can be: many real builds legitimately share
-- a product name (e.g. five 'PSU For dBbox2' units on one order), each with
-- its own ctp_ref, which is the real uniqueness key now.
ALTER TABLE ctp_build DROP CONSTRAINT ctp_build_type_name_key;

ALTER TABLE ctp_build ADD COLUMN ctp_ref         TEXT UNIQUE;  -- CTP's own buildId, e.g. 'SO-1068-4'
ALTER TABLE ctp_build ADD COLUMN order_ref       TEXT;         -- CTP's SO-Number, e.g. 'SO-1068'
ALTER TABLE ctp_build ADD COLUMN customer        TEXT;
ALTER TABLE ctp_build ADD COLUMN sku             TEXT;
ALTER TABLE ctp_build ADD COLUMN stage           TEXT;
ALTER TABLE ctp_build ADD COLUMN despatch_status TEXT;
ALTER TABLE ctp_build ADD COLUMN shipped_at      DATE;
ALTER TABLE ctp_build ADD COLUMN synced_open     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ctp_build ADD COLUMN last_synced_at  TIMESTAMPTZ;

COMMENT ON COLUMN ctp_build.name IS 'Product name — CTP''s builds.product';
COMMENT ON COLUMN ctp_build.is_active IS 'Manual admin override, independent of synced_open';

CREATE INDEX idx_ctp_build_ref ON ctp_build(ctp_ref);
CREATE INDEX idx_ctp_build_order_ref ON ctp_build(order_ref);

-- ------------------------------------------------------------
-- CTP categories (MHz_Timesheet_CTP_Integration_Scope_v1.0 Section 4):
-- own list, no overlap with non_project_reason or cost_code even where
-- a name looks similar (MHz 'Sickness' vs CTP 'Sick'). 'kind' decides
-- whether a category pairs with a build (PaP/Mill/Build/Test/Ship) or
-- stands alone the way a non_project_reason does (everything else).
-- ------------------------------------------------------------
CREATE TABLE ctp_category (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL UNIQUE,
    kind              TEXT NOT NULL CHECK (kind IN ('build', 'non_project')),
    requires_comment  BOOLEAN NOT NULL DEFAULT FALSE,  -- 'Other' only, per Section 4
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ctp_category (name, kind, requires_comment) VALUES
    ('PaP', 'build', FALSE),
    ('Mill', 'build', FALSE),
    ('Build', 'build', FALSE),
    ('Test', 'build', FALSE),
    ('Ship', 'build', FALSE),
    ('Personal', 'non_project', FALSE),
    ('Cleaning', 'non_project', FALSE),
    ('Prepping', 'non_project', FALSE),
    ('Maintenance', 'non_project', FALSE),
    ('Other', 'non_project', TRUE),
    ('Holiday', 'non_project', FALSE),
    ('Sick', 'non_project', FALSE);

-- ------------------------------------------------------------
-- timesheet_entry: add ctp_category_id, widen the mutual-exclusivity
-- CHECK to four shapes (MHz project / MHz reason / CTP build / CTP
-- non-project), and widen the duplicate-prevention index to match.
-- A CTP entry never carries cost_code_id (Section 4) in either shape.
-- ------------------------------------------------------------
ALTER TABLE timesheet_entry ADD COLUMN ctp_category_id UUID REFERENCES ctp_category(id);
CREATE INDEX idx_entry_ctp_category ON timesheet_entry(ctp_category_id);

ALTER TABLE timesheet_entry DROP CONSTRAINT timesheet_entry_check;
ALTER TABLE timesheet_entry ADD CONSTRAINT timesheet_entry_check CHECK (
    (is_non_work_marker AND project_ref_id IS NULL AND reason_id IS NULL AND ctp_build_id IS NULL
     AND ctp_category_id IS NULL AND cost_code_id IS NULL AND hours = 0)
    OR
    (NOT is_non_work_marker
     AND hours > 0 AND hours <= 24
     AND (
       (project_ref_id IS NOT NULL AND reason_id IS NULL AND ctp_build_id IS NULL AND ctp_category_id IS NULL AND cost_code_id IS NOT NULL)
       OR (project_ref_id IS NULL AND reason_id IS NOT NULL AND ctp_build_id IS NULL AND ctp_category_id IS NULL AND cost_code_id IS NOT NULL)
       OR (project_ref_id IS NULL AND reason_id IS NULL AND ctp_build_id IS NOT NULL AND ctp_category_id IS NOT NULL AND cost_code_id IS NULL)
       OR (project_ref_id IS NULL AND reason_id IS NULL AND ctp_build_id IS NULL AND ctp_category_id IS NOT NULL AND cost_code_id IS NULL)
     ))
);

DROP INDEX idx_entry_no_duplicates;
CREATE UNIQUE INDEX idx_entry_no_duplicates
    ON timesheet_entry (
        week_id, entry_date,
        COALESCE(cost_code_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(project_ref_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(reason_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(ctp_build_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(ctp_category_id, '00000000-0000-0000-0000-000000000000')
    )
    WHERE NOT is_non_work_marker;

-- ------------------------------------------------------------
-- CTP push: mirrors qw_sent_at/qw_send_batch_id and qw_send_batch
-- exactly. Only build-linked CTP entries are ever eligible (Section 2 —
-- the push contract is person/build/category/week/hours; non-project
-- CTP time, like MHz non-project reason time, never leaves this app).
-- ------------------------------------------------------------
CREATE TABLE ctp_send_batch (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiated_by      UUID NOT NULL REFERENCES users(id),
    initiated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    entries_attempted INTEGER NOT NULL,
    entries_succeeded INTEGER NOT NULL,
    entries_failed    INTEGER NOT NULL
);

ALTER TABLE timesheet_entry ADD COLUMN ctp_sent_at TIMESTAMPTZ;
ALTER TABLE timesheet_entry ADD COLUMN ctp_send_batch_id UUID REFERENCES ctp_send_batch(id);

-- ------------------------------------------------------------
-- CTP sync log — mirrors qw_sync_log's exact shape for the same reason
-- a shared table wasn't used for qw_send_batch either: keeping each
-- integration's log self-contained rather than adding a system
-- discriminator column nobody else needs yet.
-- ------------------------------------------------------------
CREATE TABLE ctp_sync_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_direction  TEXT NOT NULL,      -- 'pull' or 'push'
    sync_type       TEXT NOT NULL,      -- 'builds' or 'approved_hours'
    status          TEXT NOT NULL,      -- 'success' or 'error'
    detail          TEXT,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_ctp_sync_log_type_status ON ctp_sync_log(sync_type, status);
CREATE INDEX idx_ctp_sync_log_started ON ctp_sync_log(started_at);

COMMIT;
