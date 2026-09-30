-- ============================================================
-- Migration 013: User Management v1.6 Phase 3 -- short name and kiosk group.
--
-- §3.1 users.short_name: kiosk tiles and other tight spaces. First name
--      alone where unique, first name + surname initial where not.
-- §3.5 users.kiosk_group: kiosk column (Coachbuild / Wiring / Engineering /
--      CTP / Solutions / Other). Same value as QW; its own field, not
--      derived from department.
-- Backfilled from the scope 4.1 master list via qw_user_id. Anyone without
-- a mapping (jon.legacy) gets their first name and 'Other'.
-- Until the single cross-app user action (Phase 5), these are set here and
-- in QW Admin > Users; Timesheet user creation defaults them.
--
-- Re-runnable. Run manually: psql $DATABASE_URL -f db/migrations/013_short_name_kiosk_group.sql
-- ============================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS short_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kiosk_group text;

UPDATE users u SET short_name = v.s, kiosk_group = v.g
  FROM (VALUES
    (2,  'Jon',      'Other'),
    (4,  'Mihail',   'Solutions'),
    (5,  'Simon',    'Engineering'),
    (6,  'Gary',     'Other'),
    (7,  'Steve H',  'Engineering'),
    (8,  'Nigel',    'Engineering'),
    (9,  'Jonny',    'Other'),
    (10, 'Steve E',  'Other'),
    (11, 'Steve N',  'Other'),
    (12, 'Lucas',    'Solutions'),
    (17, 'Andy M',   'Engineering'),
    (18, 'Andy O',   'Coachbuild'),
    (19, 'Bill',     'Coachbuild'),
    (20, 'Colin',    'Solutions'),
    (21, 'Damien',   'CTP'),
    (22, 'Dominic',  'CTP'),
    (23, 'Katya',    'CTP'),
    (24, 'James',    'CTP'),
    (25, 'Matthew',  'Engineering'),
    (26, 'Michael',  'Coachbuild'),
    (27, 'Richard',  'Engineering'),
    (28, 'Robert M', 'Wiring'),
    (29, 'Robert S', 'Other'),
    (30, 'Steve B',  'Engineering'),
    (31, 'Toby',     'Coachbuild'),
    (32, 'Tony',     'Wiring')
  ) AS v(qw_user_id, s, g)
 WHERE u.qw_user_id = v.qw_user_id AND u.short_name IS NULL;

UPDATE users SET short_name = COALESCE(short_name, split_part(full_name, ' ', 1)),
                 kiosk_group = COALESCE(kiosk_group, 'Other')
 WHERE short_name IS NULL OR kiosk_group IS NULL;

-- Any insert that doesn't give a short name (admin create, scripts) gets the
-- first name, so the NOT NULL never blocks user creation.
CREATE OR REPLACE FUNCTION users_default_short_name() RETURNS trigger AS $$
BEGIN
  IF NEW.short_name IS NULL OR btrim(NEW.short_name) = '' THEN
    NEW.short_name := split_part(btrim(NEW.full_name), ' ', 1);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_default_short_name ON users;
CREATE TRIGGER trg_users_default_short_name BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_default_short_name();

ALTER TABLE users ALTER COLUMN short_name SET NOT NULL;
ALTER TABLE users ALTER COLUMN kiosk_group SET NOT NULL;
ALTER TABLE users ALTER COLUMN kiosk_group SET DEFAULT 'Other';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kiosk_group_check;
ALTER TABLE users ADD CONSTRAINT users_kiosk_group_check
  CHECK (kiosk_group IN ('Coachbuild','Wiring','Engineering','CTP','Solutions','Other'));

COMMIT;
