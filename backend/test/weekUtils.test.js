// Week boundaries use the UK calendar date (Security Fixes & Bugs v1.1, C1).
// Run: cd backend && npm test
const test = require('node:test');
const assert = require('node:assert');
const wu = require('../src/services/weekUtils');

const ymd = d => wu.fmtDate(d);

test('00:30 BST on a Monday is that Monday\'s week, not the previous one', () => {
  const t = new Date('2026-10-04T23:30:00Z'); // Mon 5 Oct 2026 00:30 BST
  assert.strictEqual(ymd(wu.mondayOf(t)), '2026-10-05');
  assert.strictEqual(ymd(wu.currentWeekStart(t)), '2026-10-05');
  assert.strictEqual(ymd(wu.lastCompletedWeekStart(t)), '2026-09-28');
});

test('23:30 BST on a Sunday is still that Sunday\'s week', () => {
  const t = new Date('2026-10-04T22:30:00Z'); // Sun 4 Oct 2026 23:30 BST
  assert.strictEqual(ymd(wu.mondayOf(t)), '2026-09-28');
});

test('00:30 GMT on a Monday in winter', () => {
  const t = new Date('2026-11-09T00:30:00Z'); // Mon 9 Nov 2026 00:30 GMT
  assert.strictEqual(ymd(wu.mondayOf(t)), '2026-11-09');
});

test('mid-week and date-only inputs', () => {
  assert.strictEqual(ymd(wu.mondayOf(new Date('2026-10-08T12:00:00Z'))), '2026-10-05');
  assert.strictEqual(ymd(wu.mondayOf(new Date('2026-10-11'))), '2026-10-05'); // Sunday
  assert.strictEqual(ymd(wu.mondayOf(new Date('2026-10-05'))), '2026-10-05');
});

test('frontend mondayOf (lib/dates.js) agrees', async () => {
  const { mondayOf } = await import('../../frontend/src/lib/dates.js');
  assert.strictEqual(mondayOf(new Date('2026-10-04T23:30:00Z')), '2026-10-05');
  assert.strictEqual(mondayOf(new Date('2026-10-04T22:30:00Z')), '2026-09-28');
  assert.strictEqual(mondayOf('2026-10-07'), '2026-10-05'); // date picker value
  assert.strictEqual(mondayOf('2026-10-05'), '2026-10-05');
});
