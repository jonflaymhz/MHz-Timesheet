const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const db = require('../db/pool');
const { verifyPin, isValidPin } = require('../services/pin');
const { createSession, revokeSession, revokeAllSessionsForUser } = require('../services/session');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');
const { requireKioskDevice } = require('../services/kioskDevice');
const { standardDayFor } = require('../services/workPattern');

const router = express.Router();

// Secure is decided per-request from whether the connection is actually
// HTTPS, not from NODE_ENV — this app is temporarily served over plain
// HTTP (no cert yet; see deployment notes), and a Secure cookie is
// silently dropped by the browser over HTTP, which would make login look
// like it succeeds while no session actually persists. Once a real
// certificate is in place this becomes correct automatically, no env var
// to remember to flip.
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' };

function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: req.secure, expires: expiresAt });
}

// One login page for everyone (Admin Scope Section 3.1) — the account's
// capabilities decide the credential tier, not a URL the user has to find.
// Approval and either Admin role all sit in the elevated tier (Section 3.1
// widens this beyond just the two admin flags): username + password +
// TOTP, same as the rest of QW. Floor accounts stay on username + PIN.
function isElevatedTier(user) {
  return !!(user.can_approve || user.is_payroll_admin || user.is_system_admin);
}

// ── POST /api/auth/login-tier ─────────────────────────────────
// Lets the single login page ask "PIN or password+MFA?" before rendering
// the right fields, without exposing whether a username exists — an
// unknown username gets the same 'standard' answer as any real
// non-elevated account.
router.post('/login-tier', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ tier: 'standard' });
  const result = await db.query(
    `SELECT can_approve, is_payroll_admin, is_system_admin FROM users WHERE username = $1 AND is_active = TRUE`,
    [username.trim().toLowerCase()]
  );
  const user = result.rows[0];
  res.json({ tier: user && isElevatedTier(user) ? 'elevated' : 'standard' });
});

// ── POST /api/auth/login ──────────────────────────────────────
// Standard tier: username + 6-digit PIN. Only from a registered device
// (Security Fixes v1.1 A3), so nobody elsewhere can guess PINs and lock
// people out. The kiosk name-tile sign-in that sent user_id is gone
// (Employee UI Redesign v1.0 §8); user_id is still accepted so an old
// cached page doesn't break.
router.post('/login', requireKioskDevice, async (req, res) => {
  const { username, user_id, pin, is_kiosk } = req.body;
  if ((!username && !user_id) || !isValidPin(pin)) {
    return res.status(400).json({ error: 'Username and a 6-digit PIN are required' });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (user_id && !UUID_RE.test(String(user_id))) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }
  const userResult = user_id
    ? await db.query(`SELECT * FROM users WHERE id = $1 AND is_active = TRUE`, [user_id])
    : await db.query(`SELECT * FROM users WHERE username = $1 AND is_active = TRUE`, [String(username).trim().toLowerCase()]);
  const user = userResult.rows[0];
  if (!user || !user.pin_hash) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }
  // Defense in depth: the login page won't offer a PIN field for an
  // elevated-tier account, but a person can hold both a pin_hash (their own
  // timesheet, set before being promoted) and elevated capabilities at
  // once — the PIN must never become a live credential for that account.
  if (isElevatedTier(user)) {
    return res.status(401).json({ error: 'This account requires password + authenticator sign-in', tier: 'elevated' });
  }
  if (user.pin_locked_at) {
    return res.status(423).json({ error: 'Account locked after too many failed attempts. Ask an admin to unlock it.' });
  }
  const result = await verifyPin(user, pin);
  if (!result.ok) {
    if (result.locked) {
      return res.status(423).json({ error: 'Account locked after too many failed attempts. Ask an admin to unlock it.' });
    }
    return res.status(401).json({ error: 'Invalid username or PIN', attempts_remaining: result.attemptsRemaining });
  }
  const { token, expiresAt } = await createSession(user.id, {
    deviceLabel: req.kioskDevice.label,
    isKiosk: !!is_kiosk,
  });
  await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  setSessionCookie(req, res, token, expiresAt);
  res.json({ id: user.id, full_name: user.full_name });
});

// ── POST /api/auth/login-elevated ─────────────────────────────
// Elevated tier (Approval and/or either Admin role, Section 3.1): username
// + password + TOTP. Matches "the same standard as the rest of QW". An
// account that hasn't completed MFA enrollment yet (mfa_enabled false)
// gets a short-lived pending session instead of a real one — it can only
// reach the /mfa/enroll/* routes below until enrollment is confirmed.
router.post('/login-elevated', async (req, res) => {
  const { username, password, totp_code } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const userResult = await db.query(
    `SELECT * FROM users WHERE username = $1 AND is_active = TRUE AND (can_approve OR is_payroll_admin OR is_system_admin)`,
    [username.trim().toLowerCase()]
  );
  const user = userResult.rows[0];
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.mfa_enabled || !user.mfa_secret) {
    const { token, expiresAt } = await createSession(user.id, {
      deviceLabel: req.body.device_label,
      pendingMfaEnrollment: true,
    });
    setSessionCookie(req, res, token, expiresAt);
    return res.json({ id: user.id, full_name: user.full_name, mfa_enrollment_required: true });
  }

  if (!totp_code) {
    return res.status(400).json({ error: 'Authenticator code is required' });
  }
  const totpOk = authenticator.check(totp_code, user.mfa_secret);
  if (!totpOk) {
    return res.status(401).json({ error: 'Invalid authenticator code' });
  }
  const { token, expiresAt } = await createSession(user.id, { deviceLabel: req.body.device_label, elevated: true });
  await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  setSessionCookie(req, res, token, expiresAt);
  res.json({ id: user.id, full_name: user.full_name });
});

// ── POST /api/auth/mfa/enroll/start ───────────────────────────
// Only reachable with a pending-enrollment session (requireAuth 403s any
// other route while pending). Generates a TOTP secret and returns a QR
// code plus the manual-entry fallback (admin scope Section 4.2). Reuses
// an already-pending secret rather than regenerating on a page refresh,
// so a QR the user already scanned doesn't silently go stale.
router.post('/mfa/enroll/start', requireAuth, async (req, res) => {
  if (!req.pendingMfaEnrollment) {
    return res.status(400).json({ error: 'MFA is already enrolled for this account' });
  }
  const current = await db.query(`SELECT mfa_secret FROM users WHERE id = $1`, [req.user.id]);
  let secret = current.rows[0]?.mfa_secret;
  if (!secret) {
    secret = authenticator.generateSecret();
    await db.query(`UPDATE users SET mfa_secret = $2 WHERE id = $1`, [req.user.id, secret]);
  }
  const otpauthUrl = authenticator.keyuri(req.user.username, 'MHz Timesheet', secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  res.json({ otpauth_url: otpauthUrl, manual_entry_key: secret, qr_code_data_url: qrCodeDataUrl });
});

// ── POST /api/auth/mfa/enroll/confirm ─────────────────────────
// Verifies the first real code, activates MFA, generates one-time backup
// codes (admin scope Section 4.2/8 — confirmed break-glass approach), and
// upgrades the pending session into a real one in the same request so
// there's no gap where the account is usable without MFA complete.
router.post('/mfa/enroll/confirm', requireAuth, async (req, res) => {
  if (!req.pendingMfaEnrollment) {
    return res.status(400).json({ error: 'MFA is already enrolled for this account' });
  }
  const { totp_code } = req.body;
  const current = await db.query(`SELECT mfa_secret FROM users WHERE id = $1`, [req.user.id]);
  const secret = current.rows[0]?.mfa_secret;
  if (!secret || !totp_code || !authenticator.check(totp_code, secret)) {
    return res.status(401).json({ error: 'Invalid authenticator code' });
  }

  const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const backupCodes = Array.from({ length: 10 }, () => {
    const raw = Array.from(crypto.randomFillSync(new Uint8Array(8)))
      .map(b => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length])
      .join('');
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });

  // Everything below is one all-or-nothing unit — a partial failure here
  // must never leave mfa_enabled=true without matching backup codes, or a
  // pending session that never got upgraded.
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE users SET mfa_enabled = TRUE, last_login_at = NOW() WHERE id = $1`, [req.user.id]);
    for (const code of backupCodes) {
      const codeHash = await bcrypt.hash(code, 10);
      await client.query(
        `INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)`,
        [req.user.id, codeHash]
      );
    }
    await client.query(
      `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by) VALUES ('mfa_enrolled', 'user', $1, $1)`,
      [req.user.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await revokeSession(req.sessionToken);
  const { token, expiresAt } = await createSession(req.user.id, { elevated: true });
  setSessionCookie(req, res, token, expiresAt);

  res.json({ backup_codes: backupCodes });
});

router.post('/logout', requireAuth, async (req, res) => {
  await revokeSession(req.sessionToken);
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
  res.json({ message: 'Logged out' });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ ...req.user, standard_day_hours: standardDayFor(req.user), mfa_enrollment_required: req.pendingMfaEnrollment });
});

module.exports = router;
