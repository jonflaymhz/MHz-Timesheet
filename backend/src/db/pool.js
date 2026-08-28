const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings, not JS Date objects.
// node-postgres otherwise builds a Date at local-midnight and serializes it
// in UTC, which silently shifts every date back a day on a server whose
// TZ has a positive offset (this box runs BST) — entries would show up on
// the wrong day. Every week/entry date in this schema is a plain calendar
// date with no time component, so there's no timezone to lose here.
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
