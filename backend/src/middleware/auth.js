const { getSession } = require('../services/session');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'mhz_ts_session';

// Routes reachable with only a pending-MFA-enrollment session (created
// between password-check success and enrollment completing) — everything
// else 403s until enrollment is confirmed, so a half-enrolled account can
// never reach real app data.
const MFA_ENROLLMENT_ALLOWED_PREFIXES = ['/api/auth/mfa/enroll'];
const MFA_ENROLLMENT_ALLOWED_EXACT = ['/api/auth/me', '/api/auth/logout'];

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = await getSession(token);
  if (!session || !session.is_active) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (session.pending_mfa_enrollment) {
    const allowed = MFA_ENROLLMENT_ALLOWED_PREFIXES.some(p => req.originalUrl.startsWith(p))
      || MFA_ENROLLMENT_ALLOWED_EXACT.includes(req.originalUrl);
    if (!allowed) {
      return res.status(403).json({ error: 'Complete MFA enrollment before continuing', mfa_enrollment_required: true });
    }
  }
  req.user = {
    id: session.u_id,
    full_name: session.full_name,
    username: session.username,
    employment_type: session.employment_type,
    department: session.department,
    has_ctp_access: session.has_ctp_access,
    reports_to: session.reports_to,
    can_approve: session.can_approve,
    is_payroll_admin: session.is_payroll_admin,
    is_system_admin: session.is_system_admin,
  };
  req.sessionToken = token;
  req.pendingMfaEnrollment = !!session.pending_mfa_enrollment;
  next();
}

// Payroll and System admin both get full override authority (base scope
// Section 5) — System admin additionally manages accounts/projects (admin
// scope Section 3), but for the override actions themselves the two are
// equivalent, matching the old admin+jonny behaviour.
function requireOverrideAuthority(req, res, next) {
  if (!req.user?.is_payroll_admin && !req.user?.is_system_admin) {
    return res.status(403).json({ error: 'Requires admin access' });
  }
  next();
}

function requireSystemAdmin(req, res, next) {
  if (!req.user?.is_system_admin) {
    return res.status(403).json({ error: 'Requires system admin access' });
  }
  next();
}

function requireApprovalAuthority(req, res, next) {
  if (!req.user?.can_approve && !req.user?.is_payroll_admin && !req.user?.is_system_admin) {
    return res.status(403).json({ error: 'Requires approval access' });
  }
  next();
}

// "Send to QW" is bound to the Payroll/Finance role specifically (Actual
// Hours Feedback Design v1.0 §3/§9) — Jonny and Jon today, but by role,
// not by name. Deliberately narrower than requireOverrideAuthority: System
// admin alone does not get this.
function requirePayrollAdmin(req, res, next) {
  if (!req.user?.is_payroll_admin) {
    return res.status(403).json({ error: 'Requires payroll admin access' });
  }
  next();
}

module.exports = { requireAuth, requireOverrideAuthority, requireSystemAdmin, requireApprovalAuthority, requirePayrollAdmin, COOKIE_NAME };
