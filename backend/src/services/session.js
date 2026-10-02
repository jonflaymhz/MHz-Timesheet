const crypto = require('crypto');
const db = require('../db/pool');

const STANDARD_TTL_DAYS = parseInt(process.env.SESSION_STANDARD_TTL_DAYS, 10) || 30;
// Admin tier gets a much shorter session, matching "same standard as
// the rest of QW" (Section 3) — re-authenticate more often on the tier that
// can edit locked data.
const ELEVATED_TTL_DAYS = 1;
// Pending MFA enrollment is a narrow window between password-check success
// and enrollment completing — short-lived on purpose.
const PENDING_MFA_TTL_MINUTES = 15;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId, { deviceLabel, isKiosk = false, elevated = false, pendingMfaEnrollment = false } = {}) {
  const token = generateToken();
  let expiresAt;
  if (pendingMfaEnrollment) {
    expiresAt = new Date(Date.now() + PENDING_MFA_TTL_MINUTES * 60 * 1000);
  } else {
    const ttlDays = elevated ? ELEVATED_TTL_DAYS : STANDARD_TTL_DAYS;
    expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }
  await db.query(
    `INSERT INTO user_sessions (user_id, session_token, device_label, is_kiosk, expires_at, pending_mfa_enrollment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, token, deviceLabel || null, isKiosk, expiresAt, pendingMfaEnrollment]
  );
  return { token, expiresAt };
}

async function getSession(token) {
  if (!token) return null;
  const result = await db.query(
    `SELECT s.*, u.id AS u_id, u.full_name, u.username, u.employment_type,
            u.department, u.reports_to, u.is_active, u.has_ctp_access,
            u.can_approve, u.can_self_approve, u.is_payroll_admin, u.is_system_admin,
            u.closing_leave_date, u.closing_grace_end
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.session_token = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
    [token]
  );
  return result.rows[0] || null;
}

async function revokeSession(token) {
  await db.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE session_token = $1`, [token]);
}

async function revokeAllSessionsForUser(userId) {
  await db.query(
    `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

module.exports = { createSession, getSession, revokeSession, revokeAllSessionsForUser };
