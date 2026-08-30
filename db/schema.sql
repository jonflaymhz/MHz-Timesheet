-- ============================================================
-- Megahertz Timesheet System — Database Schema v1.4
-- Separate database: mhz_timesheet
-- Reference: MHz_Timesheet_Scope_v1_0.md (Section 13 revision),
-- MHz_Timesheet_Admin_Scope_v1_0.md (admin/management batches 1-2)
-- v1.3 changelog vs v1.2: users.role enum replaced by independent
-- capability flags (can_approve/is_payroll_admin/is_system_admin)
-- so a person can hold more than one; users.removed_at added as a
-- distinct state from is_active (freeze vs remove); users.
-- last_login_at added; user_mfa_backup_codes table added; new
-- audit_action values for reset-pin/reset-password/reset-mfa/
-- freeze/unfreeze/remove/restore/update/mfa-enrolled; user_sessions
-- gained pending_mfa_enrollment for the enrollment-in-progress state.
-- v1.4 changelog vs v1.3 (Admin Scope Batch 2 — Section 6/7):
-- project_ref.timesheet_enabled added (Stage 1 global switch, defaults
-- FALSE for newly-synced projects — the 4 already-live projects were
-- grandfathered to TRUE by migration 002, not by this file); new
-- project_visibility table (Stage 2 per-project list); new
-- ctp_build_type table and timesheet_entry.ctp_build_id (Section 7,
-- aggregate by build/device type, not serial-level); timesheet_entry's
-- CHECK and duplicate-prevention index widened to a three-way
-- project/reason/ctp_build shape, cost_code_id now optional (NULL) for a
-- CTP entry since no CTP department exists in the 58-code catalogue; new
-- audit_action values for enable/disable-project-timesheet and
-- add/remove-project-visibility.
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

CREATE TYPE employment_type AS ENUM ('employee', 'contractor');
CREATE TYPE week_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE audit_action AS ENUM (
    'correct', 'unsubmit', 'approve', 'reject', 'close_project', 'reopen_project', 'unlock_pin',
    'reset_pin', 'reset_password', 'reset_mfa', 'mfa_enrolled',
    'freeze_user', 'unfreeze_user', 'remove_user', 'restore_user', 'update_user',
    'enable_project_timesheet', 'disable_project_timesheet',
    'add_project_visibility', 'remove_project_visibility'
);

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
    -- bar on its own. Admin-tier accounts (is_payroll_admin or
    -- is_system_admin) use password_hash + TOTP; a floor account uses
    -- pin_hash only. As of v1.3 these are no longer mutually exclusive —
    -- a person can hold a PIN (their own timesheet) and admin flags
    -- (management access) at the same time.
    password_hash   TEXT,               -- bcrypt hash; admin-tier primary credential
    -- Capability flags (admin scope v1.0 Section 2) replace the old flat
    -- user_role enum so a person can hold more than one simultaneously.
    -- "Entry" needs no flag of its own — implied by pin_hash IS NOT NULL.
    can_approve      BOOLEAN NOT NULL DEFAULT FALSE, -- Approval: reviews/approves reports' timesheets
    is_payroll_admin BOOLEAN NOT NULL DEFAULT FALSE, -- Admin — Payroll/Finance ("Jonny's role")
    is_system_admin  BOOLEAN NOT NULL DEFAULT FALSE, -- Admin — System (user/project/cost-code management)
    employment_type employment_type NOT NULL DEFAULT 'employee',
    reports_to      UUID REFERENCES users(id),   -- line manager (Section 3)
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE, -- true once TOTP enrollment is confirmed
    mfa_secret      TEXT,               -- TOTP secret; set (unconfirmed) during enrollment, confirmed by mfa_enabled
    is_active       BOOLEAN NOT NULL DEFAULT TRUE, -- freeze/unfreeze toggle (never a hard delete)
    -- Remove is distinct from Freeze (admin scope Section 3.3): a removed
    -- user is always also frozen (see chk_removed_implies_inactive below),
    -- but not every frozen user has been removed. Restoring clears this
    -- while deliberately leaving is_active FALSE — a separate reactivate
    -- step is required to actually let them log in again.
    removed_at      TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_removed_implies_inactive CHECK (removed_at IS NULL OR NOT is_active)
);

CREATE INDEX idx_users_reports_to ON users(reports_to);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_removed_at ON users(removed_at) WHERE removed_at IS NOT NULL;

-- ------------------------------------------------------------
-- MFA backup codes — 8-10 single-use codes shown once at enrollment
-- (admin scope Section 4.2 break-glass). Consuming one at login (as a
-- TOTP fallback) is not yet built; reset-mfa (another admin resets and
-- forces re-enrollment) is the recovery path for now.
-- ------------------------------------------------------------
CREATE TABLE user_mfa_backup_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    code_hash   TEXT NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_backup_user ON user_mfa_backup_codes(user_id);

-- ------------------------------------------------------------
-- Sessions (own auth, entirely separate from QW's user_sessions)
-- ------------------------------------------------------------
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    session_token   TEXT NOT NULL UNIQUE,
    device_label    TEXT,               -- e.g. "Dave's phone", "Factory kiosk"
    is_kiosk        BOOLEAN NOT NULL DEFAULT FALSE,
    -- Set for a short-TTL session created between password-check success
    -- and MFA enrollment completing — restricted to the enrollment routes
    -- only (see middleware/auth.js requireAuth) until confirmed.
    pending_mfa_enrollment BOOLEAN NOT NULL DEFAULT FALSE,
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
    -- Stage 1 global switch (Admin Scope Section 6.1) — independent of
    -- is_open/admin_override above, which track whether QW itself
    -- considers the project live. This tracks whether a System admin has
    -- deliberately opened it for TIME BOOKING; every newly-synced project
    -- starts FALSE (qwPull.js's INSERT never names this column, so it
    -- always takes the DEFAULT — and the ON CONFLICT UPDATE never touches
    -- it either, so re-syncing never resets an admin's choice).
    timesheet_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_ref_open ON project_ref(is_open);
CREATE INDEX idx_project_ref_number ON project_ref(qw_project_number);

-- Effective bookable status = admin_override if set, else is_open, AND
-- timesheet_enabled, AND (Section 6.2) the requesting person is either an
-- employee or explicitly listed in project_visibility. Application layer
-- resolves this; kept simple here rather than as a generated column to
-- avoid re-deriving on every sync write.
--
-- Close/Reopen (Section 7) are both logged to audit_log below
-- (entity_type='project_ref', action_type='close_project'/
-- 'reopen_project') — the timesheet app's own Close/Reopen buttons
-- are a local, immediate override ahead of the next hourly pull;
-- the actual source-of-truth action is QW's own
-- PATCH /ops/projects/:id/status (patch v0.99.9), which is what a
-- PM/admin uses to close a project for real. Never automatic.
--
-- Enable/Disable-for-timesheet (Admin Scope Section 6.1, System admin
-- only) are a separate pair of actions from Close/Reopen above, logged as
-- 'enable_project_timesheet'/'disable_project_timesheet'.

-- ------------------------------------------------------------
-- Project visibility (Admin Scope Section 6.2) — Stage 2 per-project
-- list. A row is the grant; there's no separate is_active flag, removing
-- the row revokes it. Only meaningful for a contractor: an employee is
-- always visible once a project is globally enabled (Section 6.2's stated
-- default), so this table is never consulted for one in practice — an
-- employee row here would just be redundant, not wrong.
-- ------------------------------------------------------------
CREATE TABLE project_visibility (
    project_ref_id  UUID NOT NULL REFERENCES project_ref(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    added_by        UUID NOT NULL REFERENCES users(id),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_ref_id, user_id)
);

CREATE INDEX idx_project_visibility_user ON project_visibility(user_id);

-- ------------------------------------------------------------
-- CTP device/build tracking (Admin Scope Section 7) — lightweight,
-- admin-managed list living entirely in this app: no QW involvement, no
-- SY project number, no rate/costing. Aggregate by build/device type, not
-- serial-level (Section 9 open question) — the stated purpose is cost
-- data to inform CTP pricing, which this granularity already serves;
-- serial-level tracking could be added later as an optional column on
-- timesheet_entry without touching this table.
-- ------------------------------------------------------------
CREATE TABLE ctp_build_type (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
--      18 non-project reasons (reason_id) OR a CTP build (ctp_build_id,
--      Admin Scope Section 7). Exactly one of the three.
--   2. "Cost code" (cost_code_id) — required for project/reason entries
--      so time still lands against a department for reporting (e.g.
--      Holiday + IL-AD for a Wiring contractor); NOT required (and left
--      NULL) for a CTP entry — CTP staff are department='CTP', which
--      isn't one of the 58-code catalogue's five departments, so there is
--      no correct code to force a pick from.
-- A non-work marker names none of the three and logs zero hours.
-- ------------------------------------------------------------
CREATE TABLE timesheet_entry (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_id                 UUID NOT NULL REFERENCES timesheet_week(id) ON DELETE CASCADE,
    entry_date              DATE NOT NULL,
    project_ref_id          UUID REFERENCES project_ref(id),        -- set for project time, else NULL
    reason_id               UUID REFERENCES non_project_reason(id), -- set for non-project time, else NULL
    ctp_build_id            UUID REFERENCES ctp_build_type(id),     -- set for CTP build time, else NULL (Section 7)
    cost_code_id            UUID REFERENCES cost_code(id),          -- required for project/reason entries; NULL for a CTP entry or a marker row
    hours                   NUMERIC(4,2) NOT NULL DEFAULT 0,
    -- An explicit non-work marker (Section 6: "every contracted day has an
    -- entry (or an explicit non-work marker)") is its own row shape: zero
    -- hours, names neither a project, a reason, a CTP build, nor a cost code.
    is_non_work_marker      BOOLEAN NOT NULL DEFAULT FALSE,
    description             TEXT,
    rate_at_entry           NUMERIC(10,2),      -- snapshotted, never recalculated (Section 4); NULL for markers/non-project/CTP
    calculated_cost_at_entry NUMERIC(10,2),      -- hours * rate_at_entry, snapshotted; NULL for markers/non-project/CTP
    entered_by              UUID NOT NULL REFERENCES users(id), -- defaults to week owner; supervisor if proxy-entered (Section 6)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Exactly one of (project_ref_id, reason_id, ctp_build_id) for a real
    -- entry; cost code required for the first two, NULL for a CTP entry;
    -- a marker names none of the four.
    CHECK (
        (is_non_work_marker AND project_ref_id IS NULL AND reason_id IS NULL AND cost_code_id IS NULL AND ctp_build_id IS NULL AND hours = 0)
        OR
        (NOT is_non_work_marker
         AND hours > 0 AND hours <= 24
         AND (
           (project_ref_id IS NOT NULL AND reason_id IS NULL AND ctp_build_id IS NULL AND cost_code_id IS NOT NULL)
           OR (project_ref_id IS NULL AND reason_id IS NOT NULL AND ctp_build_id IS NULL AND cost_code_id IS NOT NULL)
           OR (project_ref_id IS NULL AND reason_id IS NULL AND ctp_build_id IS NOT NULL AND cost_code_id IS NULL)
         ))
    ),

    -- Hours rounding: application layer enforces 15-minute increments
    -- (0.25 step) before insert; DB check is a coarse backstop only.
    CHECK (hours * 4 = TRUNC(hours * 4))
);

-- Duplicate prevention (Section 4): exact same day + project/reason/CTP-build
-- + cost code blocked. COALESCE handles NULLs — Postgres treats NULL as
-- distinct in a plain UNIQUE constraint, so an expression index is used
-- instead. cost_code_id can legitimately be NULL for a real (non-marker)
-- CTP entry as of Section 7, so it needs the same NULL-safe sentinel as
-- project_ref_id/reason_id/ctp_build_id — a bare NULL=NULL comparison
-- would let two identical CTP entries for the same day through uncaught.
CREATE UNIQUE INDEX idx_entry_no_duplicates
    ON timesheet_entry (
        week_id, entry_date,
        COALESCE(cost_code_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(project_ref_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(reason_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(ctp_build_id, '00000000-0000-0000-0000-000000000000')
    )
    WHERE NOT is_non_work_marker;

-- At most one non-work marker per person per day.
CREATE UNIQUE INDEX idx_entry_one_marker_per_day
    ON timesheet_entry (week_id, entry_date)
    WHERE is_non_work_marker;

CREATE INDEX idx_entry_week ON timesheet_entry(week_id);
CREATE INDEX idx_entry_project ON timesheet_entry(project_ref_id);
CREATE INDEX idx_entry_reason ON timesheet_entry(reason_id);
CREATE INDEX idx_entry_ctp_build ON timesheet_entry(ctp_build_id);
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

-- ============================================================
-- v1.3 changes vs v1.2 (Admin & Management Scope v1.0, Batch 1 —
-- role-split migration, admin Users page, MFA self-enrollment):
--
-- 1. user_role enum and users.role column removed outright. A flat
--    single-value role couldn't represent a person holding more than
--    one functional capability at once (e.g. Payroll admin without
--    System admin). Replaced with independent boolean flags:
--    can_approve (was 'supervisor'), is_payroll_admin (was 'jonny'),
--    is_system_admin (was 'admin'). "Entry" needs no flag — implied
--    by pin_hash IS NOT NULL.
--
-- 2. users.removed_at added, distinct from is_active: Freeze reuses
--    is_active (reversible, temporary), Remove is the new removed_at
--    (soft-delete only, per admin scope 3.3 — no hard delete of a
--    user with submitted timesheet history). A removed user is always
--    also frozen (chk_removed_implies_inactive), so every existing
--    "WHERE is_active = TRUE" query already excludes removed users.
--
-- 3. users.last_login_at added, feeding the admin Users list.
--
-- 4. PIN and password/MFA are no longer mutually exclusive (v1.2's
--    comment assumed elevated roles used password *instead of* PIN) —
--    a System admin who also logs their own timesheet now needs both.
--
-- 5. user_mfa_backup_codes added: one-time backup codes generated at
--    enrollment (confirmed break-glass approach, admin scope Section
--    4.2/8). Consuming one at login is not yet built.
--
-- 6. user_sessions.pending_mfa_enrollment added: a short-TTL session
--    state between password-check success and MFA enrollment
--    completing, restricted to the enrollment routes only.
--
-- 7. audit_action gained: reset_pin, reset_password, reset_mfa,
--    mfa_enrolled, freeze_user, unfreeze_user, remove_user,
--    restore_user, update_user.
-- ============================================================
