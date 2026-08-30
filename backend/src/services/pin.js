const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');

const MAX_ATTEMPTS = parseInt(process.env.PIN_MAX_ATTEMPTS, 10) || 5;

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

async function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}

// Auto-generated on account creation / admin-forced reset — the admin
// never types a PIN by hand (admin scope Section 3.2).
function generatePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Verifies a PIN against a locked-out-aware flow (Section 3, confirmed):
// 5 failed attempts locks the account until an admin unlocks it — no
// auto-expiring cooldown. Returns { ok, locked, user } — never throws for
// a bad PIN, only for a genuinely missing/inactive user.
async function verifyPin(user, pin) {
  if (user.pin_locked_at) {
    return { ok: false, locked: true };
  }
  const matches = user.pin_hash ? await bcrypt.compare(pin, user.pin_hash) : false;
  if (matches) {
    await db.query(
      `UPDATE users SET failed_pin_attempts = 0, pin_last_verified_at = NOW() WHERE id = $1`,
      [user.id]
    );
    return { ok: true, locked: false };
  }
  const attempts = user.failed_pin_attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.query(
      `UPDATE users SET failed_pin_attempts = $2, pin_locked_at = NOW() WHERE id = $1`,
      [user.id, attempts]
    );
    return { ok: false, locked: true };
  }
  await db.query(`UPDATE users SET failed_pin_attempts = $2 WHERE id = $1`, [user.id, attempts]);
  return { ok: false, locked: false, attemptsRemaining: MAX_ATTEMPTS - attempts };
}

// Roughly monthly re-verification on an otherwise trusted device session
// (Section 3, confirmed) — the session cookie itself can stay alive longer,
// but the app should re-prompt for the PIN once this goes stale.
function needsPinReverify(user, staleDays = 30) {
  if (!user.pin_last_verified_at) return true;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(user.pin_last_verified_at).getTime() > staleMs;
}

module.exports = { isValidPin, hashPin, verifyPin, needsPinReverify, generatePin, MAX_ATTEMPTS };
