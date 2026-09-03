-- ============================================================
-- Migration 008: allow a second entry against the same project/reason/
-- CTP-build+category on the same day (usability feedback 2026-09-02,
-- item 1). Reported case: James logs 15 minutes against a project live
-- during the day, then comes back later the same day to add an hour to
-- the SAME project — previously blocked with 409 "An identical entry
-- already exists for this day".
--
-- Decision (Jon, 2026-09-03): allow the duplicate row rather than
-- reopening/adjusting the original entry — simplest fix, no need to
-- locate and merge into an existing row.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/008_allow_duplicate_entries.sql
-- ============================================================

BEGIN;

DROP INDEX idx_entry_no_duplicates;

COMMIT;
