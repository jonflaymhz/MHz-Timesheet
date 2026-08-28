const { getSession } = require('../services/session');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'mhz_ts_session';

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = await getSession(token);
  if (!session || !session.is_active) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = {
    id: session.u_id,
    full_name: session.full_name,
    username: session.username,
    role: session.role,
    employment_type: session.employment_type,
    department: session.department,
    reports_to: session.reports_to,
  };
  req.sessionToken = token;
  next();
}

// Jonny and admin both get full override authority (Section 5) — admin
// additionally manages accounts (Section 3), but for the override actions
// themselves the two roles are equivalent.
function requireOverrideAuthority(req, res, next) {
  if (!['admin', 'jonny'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Requires admin or Jonny-tier access' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Requires admin access' });
  }
  next();
}

function requireSupervisor(req, res, next) {
  if (!['supervisor', 'admin', 'jonny'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Requires supervisor access' });
  }
  next();
}

module.exports = { requireAuth, requireOverrideAuthority, requireAdmin, requireSupervisor, COOKIE_NAME };
