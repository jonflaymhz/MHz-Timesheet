const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const db = require('../db/pool');
const { verifyPin, isValidPin } = require('../services/pin');
const { createSession, revokeSession } = require('../services/session');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, expires: expiresAt });
}

// ── GET /api/auth/kiosk-users ─────────────────────────────────
// Name-tile list for the shared factory terminal (Section 3). Tapping a
// tile only identifies who's about to log in — it never authenticates by
// itself. A PIN is always required next (confirmed policy).
router.get('/kiosk-users', async (req, res) => {
  const result = await db.query(
    `SELECT id, full_name FROM users
      WHERE is_active = TRUE AND pin_hash IS NOT NULL AND pin_locked_at IS NULL
      ORDER BY full_name`
  );
  res.json(result.rows);
});

// ── POST /api/auth/login ──────────────────────────────────────
// Standard tier: username + 6-digit PIN. Works identically whether it's a
// personal device or (with is_kiosk) the shared terminal after a tile tap —
// the PIN check is exactly the same either way.
router.post('/login', async (req, res) => {
  const { username, pin, device_label, is_kiosk } = req.body;
  if (!username || !isValidPin(pin)) {
    return res.status(400).json({ error: 'Username and a 6-digit PIN are required' });
  }
  const userResult = await db.query(
    `SELECT * FROM users WHERE username = $1 AND is_active = TRUE`,
    [username]
  );
  const user = userResult.rows[0];
  if (!user || !user.pin_hash) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
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
    deviceLabel: device_label || null,
    isKiosk: !!is_kiosk,
  });
  setSessionCookie(res, token, expiresAt);
  res.json({ id: user.id, full_name: user.full_name, role: user.role });
});

// ── POST /api/auth/admin-login ────────────────────────────────
// Admin/Jonny tier: username + password + TOTP. Matches "the same standard
// as the rest of QW" (Section 3) — this tier can edit locked data.
router.post('/admin-login', async (req, res) => {
  const { username, password, totp_code } = req.body;
  if (!username || !password || !totp_code) {
    return res.status(400).json({ error: 'Username, password, and authenticator code are all required' });
  }
  const userResult = await db.query(
    `SELECT * FROM users WHERE username = $1 AND is_active = TRUE AND role IN ('admin', 'jonny')`,
    [username]
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
    return res.status(403).json({ error: 'Two-factor authentication is not set up for this account' });
  }
  const totpOk = authenticator.check(totp_code, user.mfa_secret);
  if (!totpOk) {
    return res.status(401).json({ error: 'Invalid authenticator code' });
  }
  const { token, expiresAt } = await createSession(user.id, { deviceLabel: req.body.device_label, elevated: true });
  setSessionCookie(res, token, expiresAt);
  res.json({ id: user.id, full_name: user.full_name, role: user.role });
});

router.post('/logout', requireAuth, async (req, res) => {
  await revokeSession(req.sessionToken);
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
  res.json({ message: 'Logged out' });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json(req.user);
});

module.exports = router;
