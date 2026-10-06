-- ============================================================
-- Migration 016: kiosk device tokens (Security Fixes & Bugs v1.1, A3).
--
-- GET /api/auth/kiosk-users and PIN login (POST /api/auth/login) now need a
-- registered, unrevoked device. A System admin registers a browser from
-- Admin > Kiosk devices: the server makes a random token, keeps only its
-- SHA-256 here, and the browser keeps the token in localStorage and sends
-- it as X-Kiosk-Device. Revoking sets revoked_at; the row is kept.
-- Re-runnable. Run manually: psql $DATABASE_URL -f db/migrations/016_kiosk_devices.sql
-- ============================================================
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'register_kiosk_device';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'revoke_kiosk_device';

BEGIN;
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
COMMENT ON TABLE kiosk_devices IS
  'Browsers allowed to show kiosk tiles and use PIN login (Security Fixes v1.1 A3). Token is stored hashed only.';
COMMIT;
