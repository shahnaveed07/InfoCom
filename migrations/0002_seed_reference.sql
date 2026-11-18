-- IGS — InfoCom Global Services · Production Foundation Seed for Cloudflare D1
-- Safe & idempotent in all environments (contains zero personal accounts or demo data)

INSERT INTO roles (id, code, name, description, is_system)
VALUES
  ('role-admin', 'admin', 'Academy Administrator', 'Full institutional, admissions, financial, and audit governance access.', 1),
  ('role-instructor', 'instructor', 'Faculty Instructor', 'Academic delivery, curriculum tracking, grading, attendance, and schedules.', 1),
  ('role-student', 'student', 'Enrolled Student', 'Personal dashboard, grades, attendance alerts, schedules, and documents.', 1)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;

INSERT INTO academies (id, code, name, legal_name, email, phone, website, address, logo_data_url, timezone, currency)
VALUES (
  'acad-infocom',
  'INFOCOM-MAIN',
  'IGS — InfoCom Global Services',
  'InfoCom Global Services — Computer Institute',
  '',
  '',
  '',
  'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
  '',
  'Asia/Kolkata',
  'INR'
)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  legal_name = excluded.legal_name,
  address = excluded.address,
  timezone = excluded.timezone,
  currency = excluded.currency;

INSERT INTO academy_settings (id, academy_id, key, value, value_type)
VALUES
  ('set-academy-student-id-prefix', 'acad-infocom', 'academy.student_id_prefix', 'IGS', 'string'),
  ('set-academy-invoice-prefix', 'acad-infocom', 'academy.invoice_prefix', 'INV-2026', 'string'),
  ('set-academy-invoice-next-seq', 'acad-infocom', 'academy.invoice_next_seq', '1001', 'number'),
  ('set-academy-fee-due-days', 'acad-infocom', 'academy.fee_due_days', '14', 'number'),
  ('set-academy-late-fee-pct', 'acad-infocom', 'academy.late_fee_pct', '5', 'number'),
  ('set-grading-passing-score', 'acad-infocom', 'grading.passing_score', '60', 'number'),
  ('set-grading-distinction-score', 'acad-infocom', 'grading.distinction_score', '90', 'number'),
  ('set-attendance-min-rate-pct', 'acad-infocom', 'attendance.min_rate_pct', '75', 'number'),
  ('set-attendance-late-weight-pct', 'acad-infocom', 'attendance.late_weight_pct', '75', 'number'),
  ('set-certificate-code-prefix', 'acad-infocom', 'certificate.code_prefix', 'IGS-CERT-2026', 'string'),
  ('set-certificate-min-completion-pct', 'acad-infocom', 'certificate.min_completion_pct', '100', 'number'),
  ('set-certificate-min-weighted-score', 'acad-infocom', 'certificate.min_weighted_score', '60', 'number'),
  ('set-certificate-min-attendance-pct', 'acad-infocom', 'certificate.min_attendance_pct', '75', 'number'),
  ('set-session-reminder-window-hours', 'acad-infocom', 'session.reminder_window_hours', '24', 'number'),
  ('set-admission-portal-activation-policy', 'acad-infocom', 'admission.portal_activation_policy', 'on_approval', 'string')
ON CONFLICT(academy_id, key) DO NOTHING;

INSERT INTO departments (id, academy_id, code, name, status)
VALUES ('dept-admin', 'acad-infocom', 'ADMIN', 'Academy Administration', 'active')
ON CONFLICT(code) DO UPDATE SET name = excluded.name;

INSERT INTO certificate_templates (
  id, code, name, title_format, signatory_name, signatory_title,
  min_completion_pct, min_score, min_attendance_pct, is_active
)
VALUES (
  'tmpl-default-2026',
  'CERT-DEFAULT-2026',
  'IGS — InfoCom Global Services Completion Template',
  'Verified Certificate of Completion',
  'Academy Director',
  'IGS — InfoCom Global Services',
  100,
  60,
  75,
  1
)
ON CONFLICT(code) DO UPDATE SET
  is_active = 1,
  name = excluded.name;
