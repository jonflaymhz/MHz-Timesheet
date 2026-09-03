// Pull side of the CTP integration (MHz_Timesheet_CTP_Integration_Scope_v1.0
// Section 2): scheduled hourly, mirrors qwPull.js. Unlike QW, CTP's endpoint
// is gated by its own HTTP Basic credential rather than a shared-secret
// header — CTP's app auths everything that way, including its human users,
// so this integration gets its own login rather than reusing theirs.
//
// synced_open is recomputed on every pull from ctp_ref/shipped_at, not set
// once and left — CTP's own /api/timesheet/builds endpoint already returns a
// generous 30-day post-ship window (see that endpoint's comment on
// ctp-systems-test/server.js); the exact 1-week selectability rule is this
// app's business rule to own, per Section 3, so it's applied here rather
// than trusted from CTP's response shape.
//
// Grouped into build LINES (one row per order+product, with a qty), not one
// row per physical unit — matching how CTP's own Whiteboard groups the same
// raw per-unit data ("<orderRef>|<product>" in ctp-systems.html's
// renderWhiteboard()) rather than a new convention invented here. A build
// selected on Timesheet is "3 x DBBox3 on SO-1234", not one specific serial.
// ctp_ref stores that composite key, not a single CTP builds.buildId — the
// hours pushed back to CTP therefore carry this group key as buildId too
// (services/ctpPush.js), not a real per-unit id. CTP's own reporting is out
// of scope for this integration (per the CTP Integration Scope doc), so this
// is fine for now but worth knowing before building against it later.

const db = require('../db/pool');

const SHIP_WINDOW_DAYS = 7;

function ctpAuthHeader() {
  const token = Buffer.from(`${process.env.CTP_SYNC_USER}:${process.env.CTP_SYNC_PASS}`).toString('base64');
  return `Basic ${token}`;
}

async function fetchFromCtp(path) {
  const res = await fetch(`${process.env.CTP_API_BASE_URL}${path}`, {
    headers: { Authorization: ctpAuthHeader() },
  });
  if (!res.ok) throw new Error(`CTP responded ${res.status} for ${path}`);
  return res.json();
}

async function logSync(type, status, detail, startedAt) {
  await db.query(
    `INSERT INTO ctp_sync_log (sync_direction, sync_type, status, detail, started_at, completed_at)
     VALUES ('pull', $1, $2, $3, $4, NOW())`,
    [type, status, detail, startedAt]
  );
}

function isOpen(b) {
  if (!b.shippedDate) return true;
  const shipped = new Date(b.shippedDate);
  const ageDays = (Date.now() - shipped.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= SHIP_WINDOW_DAYS;
}

// Grouped by SKU, not product description — "DIO1616MA-XLR (2RU)" is the
// actual unit-type identity; two different SKUs can share a near-identical
// product description, and CTP's own Whiteboard grouping by product alone
// (renderWhiteboard() in ctp-systems.html) would silently merge those. Falls
// back to product only for the rare accessory/fee line with no sku at all.
function groupKey(b) {
  return `${b.orderRef}::${b.sku || b.product}`;
}

async function pullBuilds() {
  const startedAt = new Date();
  try {
    const { builds } = await fetchFromCtp('/api/timesheet/builds');
    const openUnits = builds.filter(isOpen);

    const groups = new Map();
    for (const b of openUnits) {
      const key = groupKey(b);
      let g = groups.get(key);
      if (!g) {
        g = { orderRef: b.orderRef, product: b.product, customer: b.customer, sku: b.sku, qty: 0, latestShipped: null, requiredBy: null };
        groups.set(key, g);
      }
      g.qty++;
      if (b.shippedDate && (!g.latestShipped || b.shippedDate > g.latestShipped)) g.latestShipped = b.shippedDate;
      // Earliest required-by across the group — the soonest-due unit in the
      // order+sku group is the one that should drive the picker's sort.
      if (b.requiredBy && (!g.requiredBy || b.requiredBy < g.requiredBy)) g.requiredBy = b.requiredBy;
    }

    for (const [key, g] of groups) {
      await db.query(
        `INSERT INTO ctp_build (name, ctp_ref, order_ref, customer, sku, shipped_at, qty_open, required_by, synced_open, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW())
         ON CONFLICT (ctp_ref)
         DO UPDATE SET name = $1, order_ref = $3, customer = $4, sku = $5, shipped_at = $6,
                        qty_open = $7, required_by = $8, synced_open = TRUE, last_synced_at = NOW()`,
        [g.product, key, g.orderRef, g.customer, g.sku, g.latestShipped, g.qty, g.requiredBy]
      );
    }

    // Close out any previously-synced line that no longer has any open
    // units (every member now past the ship window) rather than leaving it
    // stale and still selectable.
    const currentKeys = [...groups.keys()];
    await db.query(
      currentKeys.length > 0
        ? `UPDATE ctp_build SET synced_open = FALSE, qty_open = 0 WHERE ctp_ref IS NOT NULL AND NOT (ctp_ref = ANY($1))`
        : `UPDATE ctp_build SET synced_open = FALSE, qty_open = 0 WHERE ctp_ref IS NOT NULL`,
      currentKeys.length > 0 ? [currentKeys] : []
    );

    await logSync('builds', 'success', `${groups.size} build lines synced from ${openUnits.length} open units (${builds.length} total)`, startedAt);
  } catch (err) {
    await logSync('builds', 'error', err.message, startedAt);
    throw err;
  }
}

async function runHourlySync() {
  await pullBuilds().catch(err => console.error('CTP build pull failed:', err.message));
}

module.exports = { pullBuilds, runHourlySync };
