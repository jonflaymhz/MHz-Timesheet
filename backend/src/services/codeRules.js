// Which cost codes each kind of entry may use (Working Cost Codes v1.1
// §2.3). Project time books to QW catalogue codes, plus rework: RW-* codes
// are locally maintained but allowed on a project (Jon, 29/09/2026) and
// count in their trade's category in QW (RW-IL → Wiring, …). Reason time
// books to non-project codes, rework included.
function allowedOnProject(code) {
  return code.code_type === 'project' || /^RW-/.test(code.code);
}

function allowedOnReason(code) {
  return code.code_type === 'non_project';
}

module.exports = { allowedOnProject, allowedOnReason };
