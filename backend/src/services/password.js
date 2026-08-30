const crypto = require('crypto');

// Avoid visually ambiguous characters (l/1/I, O/0) so the printed password
// is actually easy to type back correctly. Shared by the admin
// create/reset-password routes and the one-off create-admin/reset-password
// CLI scripts.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(len = 14) {
  return Array.from(crypto.randomFillSync(new Uint8Array(len)))
    .map(b => ALPHABET[b % ALPHABET.length])
    .join('');
}

module.exports = { generatePassword };
