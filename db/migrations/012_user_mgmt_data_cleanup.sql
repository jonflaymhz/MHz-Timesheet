-- ============================================================
-- Migration 012: User Management v1.6 Phase 2 -- data clean-up.
--
-- §4.1 Usernames aligned with QW (lowercase, dot where a first name is
--      shared) and Stephen/Steven -> Steve in full_name. The API can't
--      change a username (PATCH ignores it), hence a direct update. Safe:
--      every reference is by users.id (uuid), and the QW link is
--      qw_user_id, not username.
-- §4.4 Approver gaps: Steve Burgess, Mihail and Steve Norris get
--      can_approve (they have direct reports). Mihail's department set to
--      Solutions. This makes them password+MFA tier, so they drop off the
--      kiosk; their passwords are issued at rollout (Admin > Users > Reset
--      password), as none of them has logged in yet.
-- Each changed user gets an update_user audit_log row, performed by jon.
--
-- Re-runnable (keyed on qw_user_id, changes only rows that differ).
-- Run manually: psql $DATABASE_URL -f db/migrations/012_user_mgmt_data_cleanup.sql
-- ============================================================

BEGIN;

CREATE TEMP TABLE um_target ON COMMIT DROP AS
SELECT * FROM (VALUES
  -- qw_user_id, username,   full_name,        can_approve, department
  (17, 'andy.m',   NULL::text,       NULL::boolean, NULL::text),
  (18, 'andy.o',   NULL,             NULL,          NULL),
  (28, 'robert.m', NULL,             NULL,          NULL),
  (29, 'robert.s', NULL,             NULL,          NULL),
  (30, 'steve.b',  'Steve Burgess',  TRUE,          NULL),
  (7,  'steve.h',  'Steve Hope',     NULL,          NULL),
  (11, 'steve.n',  'Steve Norris',   TRUE,          NULL),
  (10, 'steve.e',  'Steve Edge',     NULL,          NULL),
  (4,  NULL,       NULL,             TRUE,          'Solutions')
) AS t(qw_user_id, username, full_name, can_approve, department);

CREATE TEMP TABLE um_before ON COMMIT DROP AS
SELECT u.* FROM users u JOIN um_target t ON t.qw_user_id = u.qw_user_id;

UPDATE users u SET
    username    = COALESCE(t.username, u.username),
    full_name   = COALESCE(t.full_name, u.full_name),
    can_approve = COALESCE(t.can_approve, u.can_approve),
    department  = COALESCE(t.department, u.department),
    updated_at  = NOW()
  FROM um_target t
 WHERE t.qw_user_id = u.qw_user_id
   AND (u.username    IS DISTINCT FROM COALESCE(t.username, u.username)
     OR u.full_name   IS DISTINCT FROM COALESCE(t.full_name, u.full_name)
     OR u.can_approve IS DISTINCT FROM COALESCE(t.can_approve, u.can_approve)
     OR u.department  IS DISTINCT FROM COALESCE(t.department, u.department));

INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, old_value, new_value, reason)
SELECT 'update_user', 'user', a.id, (SELECT id FROM users WHERE username = 'jon'),
       jsonb_strip_nulls(jsonb_build_object(
         'username',    CASE WHEN a.username    IS DISTINCT FROM b.username    THEN to_jsonb(b.username) END,
         'full_name',   CASE WHEN a.full_name   IS DISTINCT FROM b.full_name   THEN to_jsonb(b.full_name) END,
         'can_approve', CASE WHEN a.can_approve IS DISTINCT FROM b.can_approve THEN to_jsonb(b.can_approve) END,
         'department',  CASE WHEN a.department  IS DISTINCT FROM b.department  THEN to_jsonb(b.department) END)),
       jsonb_strip_nulls(jsonb_build_object(
         'username',    CASE WHEN a.username    IS DISTINCT FROM b.username    THEN to_jsonb(a.username) END,
         'full_name',   CASE WHEN a.full_name   IS DISTINCT FROM b.full_name   THEN to_jsonb(a.full_name) END,
         'can_approve', CASE WHEN a.can_approve IS DISTINCT FROM b.can_approve THEN to_jsonb(a.can_approve) END,
         'department',  CASE WHEN a.department  IS DISTINCT FROM b.department  THEN to_jsonb(a.department) END)),
       'User Management v1.6 Phase 2 data clean-up (migration 012)'
  FROM users a JOIN um_before b ON b.id = a.id
 WHERE a.username IS DISTINCT FROM b.username OR a.full_name IS DISTINCT FROM b.full_name
    OR a.can_approve IS DISTINCT FROM b.can_approve OR a.department IS DISTINCT FROM b.department;

COMMIT;
