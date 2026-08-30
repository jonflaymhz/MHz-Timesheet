// Centralizes the capability checks that used to be 4 separate copies of a
// hardcoded role-array (App.jsx, Shell.jsx, AdminPage.jsx, WeekPage.jsx).
export const canApprove = (user) => !!(user?.can_approve || user?.is_payroll_admin || user?.is_system_admin)
export const isOverrideAuthority = (user) => !!(user?.is_payroll_admin || user?.is_system_admin)
export const isSystemAdmin = (user) => !!user?.is_system_admin
export const isPayrollAdmin = (user) => !!user?.is_payroll_admin
export const userStatus = (u) => (u.removed_at ? 'removed' : (u.is_active ? 'active' : 'frozen'))
