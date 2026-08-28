-- ============================================================
-- Megahertz Timesheet System — Seed data
--
-- Only data explicitly confirmed in MHz_Timesheet_Scope_v1_0.md is
-- seeded here. The 18 non-project reasons (Section 9) are the
-- complete real list. The cost codes are NOT complete — only the
-- 10 codes the scope doc names explicitly are seeded; Section 11
-- says the full catalogue is 58 codes across CL-/EL-/IL-/WW-/RW-,
-- but the actual list only exists in MHz_Timesheet_-_Blank.xlsx,
-- which isn't available on this machine. Importing the real
-- remaining ~48 codes from that file is a pending step, not
-- something to guess/invent here — doing so would risk silently
-- diverging from what Jonny actually uses in Sage.
-- ============================================================

INSERT INTO non_project_reason (name) VALUES
  ('Admin'), ('Compassionate Leave'), ('Downtime'), ('Holiday'),
  ('Hospital Appointment'), ('Maintenance'), ('Meetings'), ('Non-Productive'),
  ('On-call'), ('Paternity Leave'), ('Quotes'), ('Sales'), ('Sickness'),
  ('Support'), ('Tea-break'), ('Training'), ('Unpaid Leave'), ('Warranty')
ON CONFLICT (name) DO NOTHING;

-- Department-admin codes (Section 13 item 2) — the default cost code for a
-- non-project entry, matched to the entering user's own department.
INSERT INTO cost_code (code, description, department) VALUES
  ('CL-AD', 'Coachbuilding — Department Admin', 'CL'),
  ('EL-AD', 'Engineering — Department Admin', 'EL'),
  ('IL-AD', 'Wiring — Department Admin', 'IL'),
  ('WW-AD', 'Woodwork — Department Admin', 'WW')
ON CONFLICT (code) DO NOTHING;

-- Project-specific warranty codes (Section 9) — distinct from the
-- non-project "Warranty" reason above.
INSERT INTO cost_code (code, description, department) VALUES
  ('CL-WA', 'Coachbuilding — Warranty', 'CL'),
  ('EL-WA', 'Engineering — Warranty', 'EL')
ON CONFLICT (code) DO NOTHING;

-- Cross-department rework codes (Section 9) — count against the project's
-- sold hours for cost-vs-budget purposes, not tracked separately.
-- Note: Section 9 gives 'RW-WL' for Woodwork's rework code, even though
-- Woodwork's own main prefix is 'WW-' everywhere else in the doc — carried
-- through as-given; confirm against the actual Excel before this is final.
INSERT INTO cost_code (code, description, department) VALUES
  ('RW-CL', 'Rework — Coachbuilding', 'RW'),
  ('RW-EL', 'Rework — Engineering', 'RW'),
  ('RW-IL', 'Rework — Wiring', 'RW'),
  ('RW-WL', 'Rework — Woodwork', 'RW')
ON CONFLICT (code) DO NOTHING;
