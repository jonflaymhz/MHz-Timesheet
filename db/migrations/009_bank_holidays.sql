-- ============================================================
-- Migration 009: Bank Holiday handling (usability feedback 2026-09-02,
-- item 3). Decision (Jon, 2026-09-03): auto-applied category — the app
-- logs a Bank Holiday entry for staff automatically, the same shape as
-- an ordinary Holiday entry, rather than requiring staff to log it
-- themselves.
--
-- bank_holiday is a plain reference table of England & Wales bank
-- holiday dates, seeded for the rest of 2026 and all of 2027 (dates
-- computed from the standard Easter/nth-weekday/weekend-substitution
-- rules, not fetched from anywhere) so the auto-apply logic below has
-- something to check against. This needs topping up with future years
-- as they're announced/computed — there's no ongoing feed for it.
--
-- Auto-apply itself (backend/src/routes/weeks.js's getOrCreateWeek) has
-- no per-user work-pattern to consult (schema note #6 — still a fixed
-- Mon-Fri assumption for everyone), so every bank holiday date always
-- falls on a contracted day and always gets an entry; a person who
-- actually works a bank holiday can just delete the auto-added entry
-- and log real time instead, same as any other entry.
--
-- A CTP-department person gets the new CTP-side 'Bank Holiday' category
-- instead of the MHz reason — mirroring how CTP already keeps its own
-- 'Sick'/'Holiday' categories distinct from MHz's non_project_reason
-- list (migration 006) rather than sharing rows across the two systems.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/009_bank_holidays.sql
-- ============================================================

BEGIN;

INSERT INTO non_project_reason (name) VALUES ('Bank Holiday');
INSERT INTO ctp_category (name, kind, requires_comment) VALUES ('Bank Holiday', 'non_project', FALSE);

CREATE TABLE bank_holiday (
    holiday_date  DATE PRIMARY KEY,
    name          TEXT NOT NULL
);

INSERT INTO bank_holiday (holiday_date, name) VALUES
    ('2026-01-01', 'New Year''s Day'),
    ('2026-04-03', 'Good Friday'),
    ('2026-04-06', 'Easter Monday'),
    ('2026-05-04', 'Early May bank holiday'),
    ('2026-05-25', 'Spring bank holiday'),
    ('2026-08-31', 'Summer bank holiday'),
    ('2026-12-25', 'Christmas Day'),
    ('2026-12-28', 'Boxing Day (substitute)'),
    ('2027-01-01', 'New Year''s Day'),
    ('2027-03-26', 'Good Friday'),
    ('2027-03-29', 'Easter Monday'),
    ('2027-05-03', 'Early May bank holiday'),
    ('2027-05-31', 'Spring bank holiday'),
    ('2027-08-30', 'Summer bank holiday'),
    ('2027-12-27', 'Christmas Day (substitute)'),
    ('2027-12-28', 'Boxing Day (substitute)');

COMMIT;
