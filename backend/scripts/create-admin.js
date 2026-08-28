// One-off bootstrap: creates the first admin/Jonny-tier account.
// Usage: node scripts/create-admin.js <username> <full_name> <role: admin|jonny>
// Prints a generated password and a TOTP enrollment secret + otpauth URL —
// these are shown ONCE, here, and nowhere else. Change the password after
// first login if this was run by anyone other than the account's own owner.

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const db = require('../src/db/pool');

async function main() {
  const [username, fullName, role] = process.argv.slice(2);
  if (!username || !fullName || !['admin', 'jonny'].includes(role)) {
    console.error('Usage: node scripts/create-admin.js <username> <full_name> <admin|jonny>');
    process.exit(1);
  }

  const password = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  const mfaSecret = authenticator.generateSecret();

  const result = await db.query(
    `INSERT INTO users (full_name, username, role, employment_type, password_hash, mfa_enabled, mfa_secret)
     VALUES ($1, $2, $3, 'employee', $4, TRUE, $5)
     RETURNING id`,
    [fullName, username, role, passwordHash, mfaSecret]
  );

  const otpauth = authenticator.keyuri(username, 'MHz Timesheet', mfaSecret);

  console.log('\nAccount created:', result.rows[0].id);
  console.log('Username:  ', username);
  console.log('Password:  ', password, '(shown once — store it now)');
  console.log('TOTP secret:', mfaSecret);
  console.log('Enrollment URL (paste into an authenticator app, or generate a QR from it):');
  console.log(otpauth);
  console.log('\nLog in at POST /api/auth/admin-login with username, password, and the current 6-digit code.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
