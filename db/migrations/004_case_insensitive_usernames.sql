-- ============================================================
-- Migration 004: usernames are case-insensitive everywhere.
--
-- Root cause: a mobile keyboard auto-capitalised the first letter of a
-- username ("jon" -> "Jon") on the login screen. The tier lookup did an
-- exact-case match, found no row, and — by design — treated the unknown
-- username the same as any real non-elevated account (so as not to leak
-- which usernames exist), silently showing the PIN step instead of
-- password+MFA for an elevated account.
--
-- Fix: usernames are always stored lowercase from here on (enforced in
-- application code at every INSERT), and every lookup lowercases its
-- input before matching. This migration just normalises what's already
-- stored so the two agree; nothing here should ever produce a UNIQUE
-- violation, since no two accounts were ever created differing only by
-- case (usernames have always been chosen lowercase in practice).
-- Run manually: psql $DATABASE_URL -f db/migrations/004_case_insensitive_usernames.sql
-- ============================================================

UPDATE users SET username = LOWER(TRIM(username)) WHERE username != LOWER(TRIM(username));
