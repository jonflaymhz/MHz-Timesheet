// One-off: resets an existing admin/Jonny account's password (does not
// touch its TOTP secret). Usage: node scripts/reset-password.js <username>
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/pool');

// Avoid visually ambiguous characters (l/1/I, O/0) so the printed password
// is actually easy to type back correctly.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function genPassword(len = 14) {
  return Array.from(crypto.randomFillSync(new Uint8Array(len)))
    .map(b => ALPHABET[b % ALPHABET.length])
    .join('');
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node scripts/reset-password.js <username>');
    process.exit(1);
  }
  const password = genPassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query(
    `UPDATE users SET password_hash = $2 WHERE username = $1 AND role IN ('admin','jonny') RETURNING id, full_name`,
    [username, passwordHash]
  );
  if (!result.rows[0]) {
    console.error(`No admin/jonny-tier user found with username '${username}'`);
    process.exit(1);
  }
  console.log(`\nPassword reset for ${result.rows[0].full_name} (${username}):`);
  console.log('New password:', password, '(shown once)');
  console.log('TOTP secret is unchanged — keep using the same authenticator entry.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
