-- ============================================================
-- Migration 010: CTP build picker — sort by required-by date, item 5 of
-- the usability feedback (2026-09-02). CTP's own `builds.desiredShipDate`
-- is the "required-by" date Jon referred to; it wasn't previously synced
-- because /api/timesheet/builds didn't return it. CTP Systems' endpoint
-- has now been updated (separately) to include it as `requiredBy`.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/010_ctp_build_required_by.sql
-- ============================================================

BEGIN;

ALTER TABLE ctp_build ADD COLUMN required_by DATE;
COMMENT ON COLUMN ctp_build.required_by IS 'Earliest desiredShipDate across the grouped units (services/ctpPull.js) — CTP''s own builds.desiredShipDate, i.e. the sales order''s required-by date.';

COMMIT;
