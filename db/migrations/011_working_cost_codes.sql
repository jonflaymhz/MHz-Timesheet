-- ============================================================
-- Migration 011: Timesheet Working Cost Codes, Rates, Approvals v1.1.
--
-- §2.3  cost_code.code_type: 'project' codes are pulled from the QW labour
--       catalogue (one per base code, services/qwPull.js); 'non_project'
--       codes are the original 11, maintained locally.
-- §2.4  IL-AD clash: QW's IL-AD is "Wiring Installation Supervisor"
--       (billable). The local non-project admin code becomes IL-DA; the
--       row keeps its id, so existing entries follow it.
-- §2.5  users.dept_code: the catalogue department (CL/WW/EL/IL/PM) behind
--       the free-text department, for the default admin code. Backfilled
--       from obvious matches only.
-- §2.12 project_ref.project_title / customer_name from the QW pull.
-- §2.3  project_ref.estimate_codes: base codes sold on the project.
-- §2.13 project_ref.closed_reason: why the sync closed a project.
--
-- Run manually: psql $DATABASE_URL -f db/migrations/011_working_cost_codes.sql
-- ============================================================

BEGIN;

ALTER TABLE cost_code ADD COLUMN code_type TEXT NOT NULL DEFAULT 'non_project'
  CHECK (code_type IN ('project', 'non_project'));
COMMENT ON COLUMN cost_code.code_type IS 'project = pulled from the QW labour catalogue (base code, hourly); non_project = locally maintained admin/warranty/rework code.';

UPDATE cost_code SET code = 'IL-DA' WHERE code = 'IL-AD' AND code_type = 'non_project';

ALTER TABLE users ADD COLUMN dept_code TEXT;
COMMENT ON COLUMN users.dept_code IS 'Catalogue department code (CL, WW, EL, IL, PM) behind the free-text department; picks the default non-project admin code.';
UPDATE users SET dept_code = CASE
    WHEN department IN ('Coach', 'Coach Sup') THEN 'CL'
    WHEN department IN ('Wiring', 'Wir Sup') THEN 'IL'
    WHEN department IN ('Engineer', 'Sr Eng') THEN 'EL'
    WHEN department = 'PM' THEN 'PM'
  END
 WHERE dept_code IS NULL;

ALTER TABLE project_ref ADD COLUMN project_title TEXT;
ALTER TABLE project_ref ADD COLUMN customer_name TEXT;
ALTER TABLE project_ref ADD COLUMN estimate_codes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE project_ref ADD COLUMN closed_reason TEXT;
COMMENT ON COLUMN project_ref.closed_reason IS 'Set when the sync closes a project, e.g. "No longer sent by QW" (absent from the pull for 24h).';

COMMIT;
