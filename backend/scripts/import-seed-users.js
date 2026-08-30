// One-off: imports the real 26-person export from the reporting hierarchy
// tool (admin scope Section 1). Matches existing accounts by full_name
// (case-insensitive) and updates them rather than creating duplicates —
// critical for Jon Flay, whose 'jon' account already has real capability
// flags, a password, and MFA set up; this script never touches those for
// an existing match, only department/reports_to.
//
// Usage: node scripts/import-seed-users.js
// Prints a report and also writes one to /tmp — new floor accounts get an
// auto-generated PIN, new admin-tier accounts get an auto-generated
// password (MFA enrollment happens on their first sign-in, same as the
// admin Users page). Shown once each; treat the report file as sensitive
// and delete it once credentials have been handed out.

require('dotenv').config();
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../src/db/pool');
const { hashPin, generatePin } = require('../src/services/pin');
const { generatePassword } = require('../src/services/password');

const PEOPLE = [
  { name: 'Jon Flay', role: 'MD', reportsTo: null, jonnyLevelAdmin: true, doesTimesheets: false },
  { name: 'Stephen Burgess', role: 'CTO', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Tony Kirby-Cook', role: 'Wir Sup', reportsTo: "Bill O'Flynn", jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Richard Benderz', role: 'Support', reportsTo: 'Stephen Burgess', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Stephen Hope', role: 'PM', reportsTo: 'Nigel Smith', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: "Bill O'Flynn", role: 'Prod Mgr', reportsTo: 'Nigel Smith', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: "Andrew O'Reilly", role: 'Coach Sup', reportsTo: "Bill O'Flynn", jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Robert McCarthy', role: 'Wiring', reportsTo: 'Tony Kirby-Cook', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'James Wilson', role: 'CTP', reportsTo: 'Ekaterina Ereshchenko', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Robert Stopford', role: 'Sales', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: false },
  { name: 'Jonny Bushell', role: 'Finance', reportsTo: 'Jon Flay', jonnyLevelAdmin: true, doesTimesheets: false },
  { name: 'Simon Walder', role: 'Sr Eng', reportsTo: 'Nigel Smith', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Ekaterina Ereshchenko', role: 'CTP', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Stephen Norris', role: 'Procurement', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: false },
  { name: 'Nigel Smith', role: 'Ops Mgr', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Michael Collingridge', role: 'Coach', reportsTo: "Andrew O'Reilly", jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Matthew Martin', role: 'Engineer', reportsTo: 'Nigel Smith', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Toby Charles', role: 'Coach', reportsTo: "Andrew O'Reilly", jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Gary Allwood', role: 'Sales', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: false },
  { name: 'Damien Harman', role: 'CTP', reportsTo: 'Ekaterina Ereshchenko', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Steven Edge', role: 'Stores', reportsTo: 'Stephen Norris', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Dominic Flay', role: 'CTP', reportsTo: 'Ekaterina Ereshchenko', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Andrew Morphitis', role: 'Support', reportsTo: 'Stephen Burgess', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Lucas Bunting-Dos Santos', role: 'Solutions', reportsTo: 'Mihail Jolicic', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Colin Wong', role: '', reportsTo: 'Mihail Jolicic', jonnyLevelAdmin: false, doesTimesheets: true },
  { name: 'Mihail Jolicic', role: '', reportsTo: 'Jon Flay', jonnyLevelAdmin: false, doesTimesheets: true },
];

// Confirmed with Jon: jonnyLevelAdmin splits per-person, not a blanket
// mapping. Jon Flay already exists (matched below, flags untouched).
// Jonny Bushell gets BOTH Payroll/Finance and System admin (confirmed).
const ADMIN_ASSIGNMENTS = {
  'Jonny Bushell': { is_payroll_admin: true, is_system_admin: true },
};

async function usernameFor(name, taken) {
  const firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!taken.has(firstName)) return firstName;
  const surnameInitial = (name.split(' ').slice(-1)[0].match(/[a-z]/i) || [''])[0].toLowerCase();
  const withInitial = firstName + surnameInitial;
  if (!taken.has(withInitial)) return withInitial;
  let n = 2;
  while (taken.has(withInitial + n)) n++;
  return withInitial + n;
}

async function main() {
  const existingUsernames = new Set(
    (await db.query(`SELECT username FROM users`)).rows.map(r => r.username)
  );

  const report = [];
  const idByName = {};

  // Pass 1: upsert every person by full_name — no reports_to yet, since
  // some managers appear later in the list than their reports.
  for (const p of PEOPLE) {
    // ORDER BY is_active DESC: if a name matches more than one row (e.g. a
    // stale/frozen duplicate from earlier testing), prefer the live account
    // — matching the wrong one would silently wire other people's
    // reports_to to a dead account instead of the real one.
    const existing = (await db.query(
      `SELECT id FROM users WHERE lower(full_name) = lower($1) ORDER BY is_active DESC LIMIT 1`,
      [p.name]
    )).rows[0];
    const department = p.role || null;

    if (existing) {
      await db.query(`UPDATE users SET department = $2, updated_at = NOW() WHERE id = $1`, [existing.id, department]);
      idByName[p.name] = existing.id;
      report.push({ name: p.name, action: 'matched-existing' });
      continue;
    }

    const admin = ADMIN_ASSIGNMENTS[p.name] || (p.jonnyLevelAdmin ? { is_payroll_admin: true, is_system_admin: false } : { is_payroll_admin: false, is_system_admin: false });
    const username = await usernameFor(p.name, existingUsernames);
    existingUsernames.add(username);

    let pinHash = null, initialPin = null;
    if (p.doesTimesheets) {
      initialPin = generatePin();
      pinHash = await hashPin(initialPin);
    }
    let passwordHash = null, initialPassword = null;
    if (admin.is_payroll_admin || admin.is_system_admin) {
      initialPassword = generatePassword();
      passwordHash = await bcrypt.hash(initialPassword, 10);
    }

    const row = (await db.query(
      `INSERT INTO users (full_name, username, department, pin_hash, password_hash, is_payroll_admin, is_system_admin)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [p.name, username, department, pinHash, passwordHash, admin.is_payroll_admin, admin.is_system_admin]
    )).rows[0];

    idByName[p.name] = row.id;
    report.push({ name: p.name, action: 'created', username, initial_pin: initialPin, initial_password: initialPassword });
  }

  // Pass 2: now that everyone has an id, wire up reports_to.
  for (const p of PEOPLE) {
    const managerId = p.reportsTo ? idByName[p.reportsTo] : null;
    if (p.reportsTo && !managerId) {
      report.push({ name: p.name, action: 'WARNING: manager not found', manager: p.reportsTo });
      continue;
    }
    await db.query(`UPDATE users SET reports_to = $2 WHERE id = $1`, [idByName[p.name], managerId]);
  }

  console.log(`\nImported ${PEOPLE.length} people (${report.filter(r => r.action === 'created').length} created, ${report.filter(r => r.action === 'matched-existing').length} matched existing).\n`);

  const outPath = `/tmp/mhz-timesheet-seed-import-${Date.now()}.txt`;
  const lines = ['MHz Timesheet — seed import credentials (shown once, delete this file once distributed)', ''];
  for (const r of report) {
    if (r.action === 'created' && (r.initial_pin || r.initial_password)) {
      lines.push(`${r.name} (${r.username}): ${r.initial_pin ? `PIN ${r.initial_pin}` : ''}${r.initial_password ? `password ${r.initial_password}` : ''}`);
    }
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n');

  console.log('Full report:');
  for (const r of report) console.log(' ', JSON.stringify(r));
  console.log(`\nCredentials file written to: ${outPath}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
