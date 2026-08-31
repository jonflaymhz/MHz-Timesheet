// One-off: resets an existing admin-tier account's password (does not
// touch its TOTP secret). Usage: node scripts/reset-password.js <username>
// Prefer the admin Users page's "Reset password" action where possible —
// this script exists for when there's no other admin account to do it from.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { generatePassword } = require('../src/services/password');
const db = require('../src/db/pool');

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node scripts/reset-password.js <username>');
    process.exit(1);
  }
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query(
    `UPDATE users SET password_hash = $2 WHERE username = $1 AND (is_payroll_admin OR is_system_admin) RETURNING id, full_name`,
    [username.trim().toLowerCase(), passwordHash]
  );
  if (!result.rows[0]) {
    console.error(`No admin-tier user found with username '${username}'`);
    process.exit(1);
  }
  console.log(`\nPassword reset for ${result.rows[0].full_name} (${username}):`);
  console.log('New password:', password, '(shown once)');
  console.log('TOTP secret is unchanged — keep using the same authenticator entry.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
