-- ============================================================
-- Megahertz Timesheet System — Database Schema v1.2
-- Separate database: mhz_timesheet
-- Reference: MHz_Timesheet_Scope_v1_0.md (Section 13 revision)
-- v1.2 changelog vs v1.1: two-field category model (cost_code +
-- non_project_reason, replacing the single polymorphic category
-- table), users.department, PIN policy fields (6-digit, monthly
-- re-verify, 5-attempt lockout), ISO week numbering confirmed.
-- ============================================================
-- This database is standalone. No foreign keys, views, or
-- cross-database queries into mhz_quoting. The only connection
-- to QW is the two integration jobs described in Section 2 of
-- the scope doc (hourly pull, live push on approval), which
-- write into the qw_sync_* tables below via application code,
-- not database links.
--
-- QW-side prerequisite (Section 13 item 1) is now resolved: QW's
-- ops.project gained a closed lifecycle (closed_at/closed_by/
-- close_reason, status also takes 'closed') in patch
-- v0.99.9_project_lifecycle.sql. project_ref.is_open below mirrors
-- (qw_status = 'active') exactly, per that confirmed answer.
-- ============================================================

CREATE TYPE user_role AS ENUM ('employee', 'contractor', 'supervisor', 'admin', 'jonny');
CREATE TYPE employment_type AS ENUM ('employee', 'contractor');
CREATE TYPE week_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE audit_action AS ENUM ('correct', 'unsubmit', 'approve', 'reject', 'close_project', 'reopen_project', 'unlock_pin');

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       TEXT NOT NULL,
    username        TEXT NOT NULL UNIQUE,
    -- Department drives the default cost code offered for non-project time
    -- (Section 13 item 2): a wiring contractor logging Holiday is defaulted
    -- to IL-AD rather than having to hunt for it. Expected values match
    -- cost_code.department ('CL','EL','IL','WW') — kept as free TEXT rather
    -- than an FK/enum since admin/Jonny/supervisor may have no department.
    department      TEXT,
    pin_hash        TEXT,               -- bcrypt hash of a 6-digit PIN; standard tier login (Section 3)
    -- PIN policy (Section 3, confirmed): 6-digit PIN, session re-verifies
    -- roughly monthly on a trusted device, 5 failed attempts locks the
    -- account pending admin unlock (no auto-expiring cooldown).
    failed_pin_attempts  INTEGER NOT NULL DEFAULT 0,
    pin_locked_at        TIMESTAMPTZ,    -- NULL = not locked; set = locked, needs admin unlock (logged to audit_log)
    pin_last_verified_at TIMESTAMPTZ,    -- app re-prompts for PIN when this is >~30 days old
    -- Admin/Jonny tier is specced as "proper 2FA, same standard as the rest
    -- of QW" (Section 3) — a short numeric PIN plus TOTP doesn't meet that
    -- bar on its own. Elevated roles (admin, jonny) use password_hash as
    -- their primary secret instead of pin_hash, with mfa_enabled forced
    -- true at the application layer. Standard tier (employee/contractor/
    -- supervisor) leaves password_hash NULL and uses pin_hash only.
    password_hash   TEXT,               -- bcrypt hash; admin/jonny tier primary credential
    role            user_role NOT NULL DEFAULT 'employee',
    employment_type employment_type NOT NULL DEFAULT 'employee',
    reports_to      UUID REFERENCES users(id),   -- line manager (Section 3)
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE, -- true for admin/jonny tier only
    mfa_secret      TEXT,               -- TOTP secret, admin/jonny tier only
    is_active       BOOLEAN NOT NULL DEFAULT TRUE, -- deactivate, never delete (Section 3)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_reports_to ON users(reports_to);
CREATE INDEX idx_users_active ON users(is_active);

-- ------------------------------------------------------------
-- Sessions (own auth, entirely separate from QW's user_sessions)
-- ------------------------------------------------------------
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    session_token   TEXT NOT NULL UNIQUE,
    device_label    TEXT,               -- e.g. "Dave's phone", "Factory kiosk"
    is_kiosk        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);

-- ------------------------------------------------------------
-- Project reference (synced hourly from QW — pull side, Section 2)
-- ------------------------------------------------------------
CREATE TABLE project_ref (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qw_project_number  TEXT NOT NULL UNIQUE,   -- e.g. SY5502, MSPQ6444
    project_name        TEXT NOT NULL,
    qw_status           TEXT NOT NULL,          -- status as received from QW ('active'/'pre_kickoff'/'closed')
    is_open              BOOLEAN NOT NULL,       -- derived: (qw_status = 'active')
    admin_override        BOOLEAN,                -- NULL = no override; TRUE = force open; FALSE = force closed (Section 7)
    last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_ref_open ON project_ref(is_open);
CREATE INDEX idx_project_ref_number ON project_ref(qw_project_number);

-- Effective bookable status = admin_override if set, else is_open.
-- Application layer resolves this; kept simple here rather than
-- as a generated column to avoid re-deriving on every sync write.
--
-- Close/Reopen (Section 7) are both logged to audit_log below
-- (entity_type='project_ref', action_type='close_project'/
-- 'reopen_project') — the timesheet app's own Close/Reopen buttons
-- are a local, immediate override ahead of the next hourly pull;
-- the actual source-of-truth action is QW's own
-- PATCH /ops/projects/:id/status (patch v0.99.9), which is what a
-- PM/admin uses to close a project for real. Never automatic.

-- ------------------------------------------------------------
-- Cost codes (synced hourly from QW — pull side, Section 2/13)
-- The 58-code catalogue (Coachbuilding CL-, Engineering EL-,
-- Wiring IL-, Woodwork WW-, cross-department Rework RW-) is the
-- complete and sole cost-code source for this app (Section 11) —
-- QW is only queried for the rate attached to each code, not for
-- its own category structure.
-- ------------------------------------------------------------
CREATE TABLE cost_code (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,   -- e.g. IL-ON, CL-AD, RW-EL
    description     TEXT NOT NULL,
    department      TEXT NOT NULL,          -- 'CL', 'EL', 'IL', 'WW', or 'RW' (cross-department)
    current_rate    NUMERIC(10,2),          -- NULL until matched to a QW rate, or genuinely rateless
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_code_department ON cost_code(department);
CREATE INDEX idx_cost_code_code ON cost_code(code);

-- ------------------------------------------------------------
-- Non-project reasons (Section 9) — purely local to this app, no
-- QW involvement and no rate at all. NOT synced from anywhere.
-- ------------------------------------------------------------
CREATE TABLE non_project_reason (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,   -- e.g. 'Holiday', 'Sickness', 'Admin'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Timesheet week
-- ------------------------------------------------------------
CREATE TABLE timesheet_week (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    week_number     SMALLINT NOT NULL,          -- ISO 8601 week number (confirmed) — Mon-Sun, so this
                                                 -- always agrees with week_start_date's own ISO week
    week_start_date DATE NOT NULL,              -- Monday
    week_end_date   DATE NOT NULL,              -- Sunday
    -- 'rejected' behaves exactly like 'draft' for edit permissions — the
    -- employee can freely edit and resubmit a rejected week, same as a
    -- draft one. It exists as its own status (rather than snapping straight
    -- back to 'draft', per a literal reading of Section 5) purely so the
    -- weekly history view can show "Rejected" as its own line per Section
    -- 6's four-state list, with rejection_reason visible to the owner.
    -- Resubmitting a rejected week transitions it straight to 'submitted',
    -- same path as resubmitting a draft.
    status          week_status NOT NULL DEFAULT 'draft',
    submitted_at    TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    approved_by     UUID REFERENCES users(id),
    rejected_at     TIMESTAMPTZ,
    rejected_by     UUID REFERENCES users(id),
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, week_start_date)
);

CREATE INDEX idx_week_user ON timesheet_week(user_id);
CREATE INDEX idx_week_status ON timesheet_week(status);
CREATE INDEX idx_week_start_date ON timesheet_week(week_start_date);

-- ------------------------------------------------------------
-- Timesheet entry
--
-- Every real entry needs BOTH of (Section 13 item 2, confirmed):
--   1. "Project/reason" — a project (project_ref_id) OR one of the
--      18 non-project reasons (reason_id). Exactly one, never both.
--   2. "Cost code" (cost_code_id) — always required, even for a
--      non-project entry, so time still lands against a department
--      for reporting (e.g. Holiday + IL-AD for a Wiring contractor).
-- A non-work marker names none of the three and logs zero hours.
-- ------------------------------------------------------------
CREATE TABLE timesheet_entry (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_id                 UUID NOT NULL REFERENCES timesheet_week(id) ON DELETE CASCADE,
    entry_date              DATE NOT NULL,
    project_ref_id          UUID REFERENCES project_ref(id),        -- set for project time, else NULL
    reason_id               UUID REFERENCES non_project_reason(id), -- set for non-project time, else NULL
    cost_code_id            UUID REFERENCES cost_code(id),          -- always required except on a marker row
    hours                   NUMERIC(4,2) NOT NULL DEFAULT 0,
    -- An explicit non-work marker (Section 6: "every contracted day has an
    -- entry (or an explicit non-work marker)") is its own row shape: zero
    -- hours, names neither a project, a reason, nor a cost code.
    is_non_work_marker      BOOLEAN NOT NULL DEFAULT FALSE,
    description             TEXT,
    rate_at_entry           NUMERIC(10,2),      -- snapshotted, never recalculated (Section 4); NULL for markers/non-project
    calculated_cost_at_entry NUMERIC(10,2),      -- hours * rate_at_entry, snapshotted; NULL for markers/non-project
    entered_by              UUID NOT NULL REFERENCES users(id), -- defaults to week owner; supervisor if proxy-entered (Section 6)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Exactly one of (project_ref_id, reason_id) for a real entry, cost
    -- code always required; a marker names none of the three.
    CHECK (
        (is_non_work_marker AND project_ref_id IS NULL AND reason_id IS NULL AND cost_code_id IS NULL AND hours = 0)
        OR
        (NOT is_non_work_marker
         AND cost_code_id IS NOT NULL
         AND ((project_ref_id IS NOT NULL AND reason_id IS NULL) OR (project_ref_id IS NULL AND reason_id IS NOT NULL))
         AND hours > 0 AND hours <= 24)
    ),

    -- Hours rounding: application layer enforces 15-minute increments
    -- (0.25 step) before insert; DB check is a coarse backstop only.
    CHECK (hours * 4 = TRUNC(hours * 4))
);

-- Duplicate prevention (Section 4): exact same day + project/reason + cost
-- code blocked. COALESCE handles NULLs — Postgres treats NULL as distinct
-- in a plain UNIQUE constraint, so an expression index is used instead.
-- cost_code_id is NOT NULL for every real entry (enforced by the CHECK
-- above), so it's safe to index directly; only markers have it NULL, and
-- those are covered by the separate one-marker-per-day index below.
CREATE UNIQUE INDEX idx_entry_no_duplicates
    ON timesheet_entry (
        week_id, entry_date, cost_code_id,
        COALESCE(project_ref_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(reason_id, '00000000-0000-0000-0000-000000000000')
    )
    WHERE NOT is_non_work_marker;

-- At most one non-work marker per person per day.
CREATE UNIQUE INDEX idx_entry_one_marker_per_day
    ON timesheet_entry (week_id, entry_date)
    WHERE is_non_work_marker;

CREATE INDEX idx_entry_week ON timesheet_entry(week_id);
CREATE INDEX idx_entry_project ON timesheet_entry(project_ref_id);
CREATE INDEX idx_entry_reason ON timesheet_entry(reason_id);
CREATE INDEX idx_entry_cost_code ON timesheet_entry(cost_code_id);
CREATE INDEX idx_entry_entered_by ON timesheet_entry(entered_by);
CREATE INDEX idx_entry_date ON timesheet_entry(entry_date);

-- ------------------------------------------------------------
-- Audit log — Jonny's Correct/Unsubmit actions, approve/reject,
-- project close/reopen, and PIN unlocks (Section 5, 7, 8)
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type     audit_action NOT NULL,
    entity_type     TEXT NOT NULL,      -- 'timesheet_week', 'timesheet_entry', 'project_ref', or 'user'
    entity_id       UUID NOT NULL,
    performed_by    UUID NOT NULL REFERENCES users(id),
    old_value       JSONB,
    new_value       JSONB,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_performed_by ON audit_log(performed_by);
CREATE INDEX idx_audit_created_at ON audit_log(created_at);

-- ------------------------------------------------------------
-- Integration health (Section 8) — one row per sync/push event
-- ------------------------------------------------------------
CREATE TABLE qw_sync_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_direction  TEXT NOT NULL,      -- 'pull' or 'push'
    sync_type       TEXT NOT NULL,      -- 'projects', 'cost_codes', 'approved_hours'
    status          TEXT NOT NULL,      -- 'success' or 'error'
    detail          TEXT,               -- error message, or summary count on success
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_sync_log_type_status ON qw_sync_log(sync_type, status);
CREATE INDEX idx_sync_log_started ON qw_sync_log(started_at);

-- ============================================================
-- v1.2 changes vs v1.1 (Section 13 revision, both items resolved):
--
-- 1. QW's ops.project closed lifecycle now exists (patch
--    v0.99.9_project_lifecycle.sql) — project_ref.is_open mirrors
--    (qw_status = 'active') exactly, no further ambiguity.
--
-- 2. Category model split into cost_code (58 QW-rated codes,
--    replacing the old single `category` table) and
--    non_project_reason (18 reasons, purely local, no QW sync).
--    timesheet_entry now has project_ref_id + reason_id (exactly
--    one set for a real entry) + cost_code_id (always required).
--    users.department added to drive a sensible cost-code default
--    for non-project entries.
--
-- 3. PIN policy fields added to users: failed_pin_attempts,
--    pin_locked_at (admin-unlock only, no auto cooldown),
--    pin_last_verified_at (drives the ~monthly re-prompt). Kiosk
--    PIN-required-after-tile-selection is enforced at the
--    application layer, same as before — no schema change needed
--    for that part, just noting it's confirmed policy now.
--
-- 4. week_number confirmed as ISO 8601 week numbering.
--
-- Carried over from v1.1, still open:
--
-- 5. No DELETE is modelled anywhere except CASCADE from a deleted
--    week (which itself should never happen in normal operation —
--    weeks are deactivated via user.is_active on the owning user,
--    not deleted). Worth confirming this is the intended behaviour
--    before build.
--
-- 6. "Contracted day" gating (Section 6) needs a per-user work-
--    pattern field (e.g. days-per-week or a weekday bitmap) that
--    doesn't exist on `users` yet — not added here pending a
--    decision on how granular it needs to be (fixed 5-day week
--    assumption vs per-person pattern). Phase 1 build assumes a
--    fixed Mon-Fri contracted week for everyone until this is
--    decided; revisit before onboarding anyone with a different
--    pattern.
--
-- 7. Woodwork's rework code is WL- in Section 9's examples but the
--    department's own main prefix is WW- everywhere else — not
--    "fixed" here, carried through as-given from the scope doc;
--    confirm against the actual Excel before the cost_code seed
--    data is finalised.
-- ============================================================
