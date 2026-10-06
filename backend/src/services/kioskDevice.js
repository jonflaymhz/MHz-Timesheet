// Kiosk device tokens (Security Fixes & Bugs v1.1, A3). The kiosk tile list
// and PIN login only answer a browser registered by a System admin; the
// browser sends its token as X-Kiosk-Device and only a SHA-256 of it is
// stored (kiosk_devices.token_hash).
const crypto = require('crypto');
const db = require('../db/pool');

const HEADER = 'x-kiosk-device';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Returns the device row, or null if the header is missing, unknown or revoked.
async function findDevice(req) {
  const token = req.get(HEADER);
  if (!token || token.length > 200) return null;
  const { rows } = await db.query(
    `UPDATE kiosk_devices SET last_seen_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id, label`, [hashToken(token)]);
  return rows[0] || null;
}

async function requireKioskDevice(req, res, next) {
  const device = await findDevice(req);
  if (!device) {
    return res.status(401).json({
      error: 'This device is not registered for PIN sign-in. Ask an admin to register it, or sign in with a password account.',
      kiosk_device_required: true,
    });
  }
  req.kioskDevice = device;
  next();
}

module.exports = { hashToken, newToken, findDevice, requireKioskDevice };
