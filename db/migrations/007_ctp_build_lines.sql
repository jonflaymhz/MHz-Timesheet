-- ============================================================
-- Migration 007: group CTP builds into build LINES (one row per
-- order+product, with a quantity), matching how CTP's own Whiteboard
-- groups the same data — not one row per physical unit/serial.
--
-- Live report from Jon (2026-09-02, after the CTP-only picker fix
-- shipped): "I don't want a separate line for each unit. I need a
-- separate line ... for each type of unit under a SO. So 3 x DBBox3 /
-- SO1234 / SCMS." Zero timesheet_entry rows reference ctp_build_id as
-- of this migration (checked live) — safe to wipe and re-sync at the
-- new granularity rather than migrate existing rows.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/007_ctp_build_lines.sql
-- ============================================================

BEGIN;

ALTER TABLE ctp_build ADD COLUMN qty_open INTEGER NOT NULL DEFAULT 1;
COMMENT ON COLUMN ctp_build.qty_open IS 'Count of still-open physical units in this order+product group (services/ctpPull.js). 1 for a manually-added build.';
COMMENT ON COLUMN ctp_build.ctp_ref IS 'Group key "<orderRef>::<product>" for a synced line (matches CTP Whiteboard grouping), not a single CTP builds.buildId — null for a manually-added build.';

-- Wipe and let the next hourly pull (or a restart) repopulate at the new
-- group granularity — see caveat above on why this is safe right now.
DELETE FROM ctp_build;

COMMIT;
