// Kiosk tile grouping (User Management scope 3.5): columns in this order,
// people alphabetical by short name inside each, empty groups not shown.
// The same six groups are used on the Timesheet kiosk.
export const KIOSK_GROUPS = ['Coachbuild', 'Wiring', 'Engineering', 'CTP', 'Solutions', 'Other']

export function groupForKiosk(people) {
  const byGroup = {}
  for (const p of people) {
    const g = KIOSK_GROUPS.includes(p.kiosk_group) ? p.kiosk_group : 'Other'
    ;(byGroup[g] = byGroup[g] || []).push(p)
  }
  return KIOSK_GROUPS
    .filter(g => byGroup[g]?.length)
    .map(g => ({ group: g, people: byGroup[g].sort((a, b) => (a.short_name || '').localeCompare(b.short_name || '')) }))
}
