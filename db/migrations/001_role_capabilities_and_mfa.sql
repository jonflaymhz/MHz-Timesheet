-- ============================================================
-- Migration 001: role-split capabilities, MFA enrollment/backup
-- codes, freeze/remove distinction (Batch 1 of admin-management).
-- Run manually: psql $DATABASE_URL -f db/migrations/001_role_capabilities_and_mfa.sql
-- ============================================================

-- ---- Step 1: enum additions (NOT wrapped in a transaction --------
-- ---- ALTER TYPE ... ADD VALUE cannot run inside one alongside ----
-- ---- other DDL; each statement auto-commits individually.     ----
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reset_pin';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reset_password';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reset_mfa';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'mfa_enrolled';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'freeze_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'unfreeze_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'remove_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'restore_user';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'update_user';

-- ---- Step 2: everything else, transactional -------------------
BEGIN;

-- New capability flags replacing user_role reliance. A person may hold
-- any combination (base scope + admin scope Section 2). "Entry" needs no
-- column of its own — implied by pin_hash IS NOT NULL.
ALTER TABLE users
  ADD COLUMN can_approve      BOOLEAN NOT NULL DEFAULT FALSE,  -- was role='supervisor'
  ADD COLUMN is_payroll_admin BOOLEAN NOT NULL DEFAULT FALSE,  -- was role='jonny'
  ADD COLUMN is_system_admin  BOOLEAN NOT NULL DEFAULT FALSE,  -- was role='admin'
  ADD COLUMN removed_at       TIMESTAMPTZ,                     -- NULL = not removed
  ADD COLUMN last_login_at    TIMESTAMPTZ;

-- Backfill the existing accounts from the old enum before it's dropped.
UPDATE users SET can_approve      = TRUE WHERE role = 'supervisor';
UPDATE users SET is_payroll_admin = TRUE WHERE role = 'jonny';
UPDATE users SET is_system_admin  = TRUE WHERE role = 'admin';
-- role IN ('employee','contractor') -> all three flags correctly stay FALSE.

-- Invariant: a removed user is always also frozen (is_active = FALSE) —
-- every existing "WHERE is_active = TRUE" query across the app therefore
-- already excludes removed users too, with no further edits needed there.
ALTER TABLE users ADD CONSTRAINT chk_removed_implies_inactive
  CHECK (removed_at IS NULL OR NOT is_active);

CREATE INDEX idx_users_removed_at ON users(removed_at) WHERE removed_at IS NOT NULL;

-- role column + its enum are fully superseded by the flags above.
ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;

-- MFA backup codes: 8-10 single-use codes shown once at enrollment.
-- Storage/generation only this batch; consuming one at login (as a TOTP
-- fallback) is a separate follow-up — reset-mfa is the recovery path today.
CREATE TABLE user_mfa_backup_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    code_hash   TEXT NOT NULL,        -- bcrypt hash of the single-use code
    used_at     TIMESTAMPTZ,          -- NULL = unused (reserved for later)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_backup_user ON user_mfa_backup_codes(user_id);

-- Pending-MFA-enrollment sessions get a short-TTL, narrowly-scoped session
-- row rather than a whole new table.
ALTER TABLE user_sessions ADD COLUMN pending_mfa_enrollment BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
