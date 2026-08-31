// One-off bootstrap: creates the very first System admin account, needed
// because there's no admin yet to use the in-app "+ New user" flow. Once
// that first account exists, use the admin Users page for everyone else —
// it generates the password and walks the new admin through MFA enrollment
// automatically (POST /api/auth/admin-login -> /mfa-enroll).
// Usage: node scripts/create-admin.js <username> <full_name> <payroll|system|both>

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { generatePassword } = require('../src/services/password');
const db = require('../src/db/pool');

async function main() {
  const [username, fullName, tier] = process.argv.slice(2);
  if (!username || !fullName || !['payroll', 'system', 'both'].includes(tier)) {
    console.error('Usage: node scripts/create-admin.js <username> <full_name> <payroll|system|both>');
    process.exit(1);
  }

  const isPayrollAdmin = tier === 'payroll' || tier === 'both';
  const isSystemAdmin = tier === 'system' || tier === 'both';

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.query(
    `INSERT INTO users (full_name, username, employment_type, password_hash, is_payroll_admin, is_system_admin, mfa_enabled, mfa_secret)
     VALUES ($1, $2, 'employee', $3, $4, $5, FALSE, NULL)
     RETURNING id`,
    [fullName, username.trim().toLowerCase(), passwordHash, isPayrollAdmin, isSystemAdmin]
  );

  console.log('\nAccount created:', result.rows[0].id);
  console.log('Username:  ', username);
  console.log('Password:  ', password, '(shown once — store it now)');
  console.log('\nLog in at /admin-login — since MFA isn\'t set up yet, you\'ll be walked');
  console.log('through enrollment (QR code + backup codes) automatically.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
