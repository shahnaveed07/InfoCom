-- IGS — InfoCom Global Services · Cloudflare D1 (SQLite) Initial Schema
-- Generated directly from prisma/schema.prisma (45 models, full FK/UNIQUE/INDEX parity)
PRAGMA foreign_keys = ON;

-- ============================================================================
-- IDENTITY & ACCESS CONTROL
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'student',
  status TEXT NOT NULL DEFAULT 'active',
  student_code TEXT UNIQUE,
  staff_code TEXT UNIQUE,
  department TEXT,
  phone TEXT,
  password_hash TEXT,
  password_updated_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS users_role_status_idx ON users(role, status);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by_user_id TEXT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_revoked_idx ON auth_sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_exp_idx ON password_reset_tokens(user_id, expires_at);

-- ============================================================================
-- ACADEMY STRUCTURE & FACILITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS academies (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS academy_settings (
  id TEXT PRIMARY KEY NOT NULL,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(academy_id, key)
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY NOT NULL,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  head_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS departments_academy_idx ON departments(academy_id);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY NOT NULL,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS academic_years_academy_current_idx ON academic_years(academy_id, is_current);

CREATE TABLE IF NOT EXISTS academic_terms (
  id TEXT PRIMARY KEY NOT NULL,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS academic_terms_year_current_idx ON academic_terms(academic_year_id, is_current);

CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY NOT NULL,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  building TEXT NOT NULL DEFAULT 'Main Campus',
  capacity INTEGER NOT NULL DEFAULT 24,
  equipment TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS classrooms_academy_active_idx ON classrooms(academy_id, is_active);

-- ============================================================================
-- PEOPLE PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS student_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL UNIQUE,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  date_of_birth TEXT,
  address TEXT NOT NULL DEFAULT '',
  emergency_contact TEXT NOT NULL DEFAULT '',
  academic_standing TEXT NOT NULL DEFAULT 'Good Standing',
  enrollment_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS instructor_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  staff_code TEXT NOT NULL UNIQUE,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  specialization TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  permissions_configured INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  hire_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS guardians (
  id TEXT PRIMARY KEY NOT NULL,
  student_profile_id TEXT NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS guardians_student_profile_idx ON guardians(student_profile_id);

-- ============================================================================
-- ACADEMICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  track TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Technical Bootcamp',
  description TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  learning_objectives TEXT NOT NULL DEFAULT '[]',
  grading_config TEXT NOT NULL DEFAULT '{}',
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  duration_weeks INTEGER NOT NULL DEFAULT 8,
  tuition_fee TEXT NOT NULL DEFAULT '1200.00',
  passing_score INTEGER NOT NULL DEFAULT 60,
  min_attendance_rate INTEGER NOT NULL DEFAULT 75,
  is_published INTEGER NOT NULL DEFAULT 0,
  show_tuition_publicly INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS courses_instructor_idx ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS courses_department_idx ON courses(department_id);
CREATE INDEX IF NOT EXISTS courses_archived_idx ON courses(is_archived);
CREATE INDEX IF NOT EXISTS courses_published_archived_idx ON courses(is_published, is_archived);

CREATE TABLE IF NOT EXISTS course_modules (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  weight INTEGER NOT NULL,
  lab_hours INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE(course_id, code)
);
CREATE INDEX IF NOT EXISTS course_modules_course_sort_idx ON course_modules(course_id, sort_order);

CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  term_id TEXT REFERENCES academic_terms(id) ON DELETE SET NULL,
  instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 24,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS cohorts_course_status_idx ON cohorts(course_id, status);
CREATE INDEX IF NOT EXISTS cohorts_instructor_idx ON cohorts(instructor_id);

CREATE TABLE IF NOT EXISTS instructor_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  batch_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Lead',
  is_active INTEGER NOT NULL DEFAULT 1,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unassigned_at TEXT,
  UNIQUE(instructor_id, batch_id)
);
CREATE INDEX IF NOT EXISTS instructor_assignments_course_active_idx ON instructor_assignments(course_id, is_active);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  cohort TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_module_ids TEXT NOT NULL DEFAULT '[]',
  tuition_snapshot TEXT,
  batch_name_snapshot TEXT,
  instructor_name_snapshot TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS enrollments_student_status_idx ON enrollments(student_id, status);
CREATE INDEX IF NOT EXISTS enrollments_course_cohort_idx ON enrollments(course_id, cohort_id);

CREATE TABLE IF NOT EXISTS enrollment_histories (
  id TEXT PRIMARY KEY NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  previous_batch_id TEXT,
  new_batch_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  changed_by_user_id TEXT,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS enrollment_histories_enr_changed_idx ON enrollment_histories(enrollment_id, changed_at);

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  cohort TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL,
  instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  instructor_name TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS class_sessions_course_start_idx ON class_sessions(course_id, start_at);
CREATE INDEX IF NOT EXISTS class_sessions_cohort_status_idx ON class_sessions(cohort_id, status);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrollment_id TEXT REFERENCES enrollments(id) ON DELETE SET NULL,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT NOT NULL,
  UNIQUE(session_id, student_id)
);
CREATE INDEX IF NOT EXISTS attendance_records_student_course_idx ON attendance_records(student_id, course_id);
CREATE INDEX IF NOT EXISTS attendance_records_enrollment_idx ON attendance_records(enrollment_id);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES course_modules(id) ON DELETE SET NULL,
  batch_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  assessment_type TEXT NOT NULL DEFAULT 'Module Assessment',
  max_score INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 25,
  due_date TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS assessments_course_module_idx ON assessments(course_id, module_id);

CREATE TABLE IF NOT EXISTS module_grades (
  id TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES course_modules(id) ON DELETE SET NULL,
  enrollment_id TEXT REFERENCES enrollments(id) ON DELETE SET NULL,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 100,
  feedback TEXT NOT NULL DEFAULT '',
  graded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  graded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  graded_by TEXT NOT NULL,
  UNIQUE(student_id, assessment_id)
);
CREATE INDEX IF NOT EXISTS module_grades_student_course_mod_lookup_idx ON module_grades(student_id, course_id, module_id);
CREATE INDEX IF NOT EXISTS module_grades_enrollment_idx ON module_grades(enrollment_id);
CREATE INDEX IF NOT EXISTS module_grades_assessment_idx ON module_grades(assessment_id);

CREATE TABLE IF NOT EXISTS progress_remarks (
  id TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrollment_id TEXT REFERENCES enrollments(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT NOT NULL,
  UNIQUE(student_id, course_id)
);

-- ============================================================================
-- ADMISSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS fee_plans (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  installment_count INTEGER NOT NULL DEFAULT 1,
  currency TEXT NOT NULL DEFAULT 'INR',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admissions (
  id TEXT PRIMARY KEY NOT NULL,
  application_number TEXT UNIQUE,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT,
  gender TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_relationship TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  guardian_email TEXT NOT NULL DEFAULT '',
  previous_qualification TEXT NOT NULL DEFAULT '',
  previous_institution TEXT NOT NULL DEFAULT '',
  graduation_year TEXT NOT NULL DEFAULT '',
  previous_score TEXT NOT NULL DEFAULT '',
  target_course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  target_batch_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  allocated_batch_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  fee_plan_id TEXT REFERENCES fee_plans(id) ON DELETE SET NULL,
  preferred_cohort TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Submitted',
  notes TEXT NOT NULL DEFAULT '',
  applicant_remarks TEXT NOT NULL DEFAULT '',
  review_remarks TEXT NOT NULL DEFAULT '',
  rejection_reason TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  converted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  portal_activated INTEGER NOT NULL DEFAULT 0,
  portal_activated_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  draft_saved_at TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS admissions_status_submitted_idx ON admissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS admissions_applicant_email_idx ON admissions(applicant_email);

CREATE TABLE IF NOT EXISTS admission_status_histories (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT 'system',
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS admission_status_histories_app_changed_idx ON admission_status_histories(application_id, changed_at);

-- ============================================================================
-- DOCUMENTS & FILE ASSETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_base64 TEXT DEFAULT '',
  storage_provider TEXT NOT NULL DEFAULT 'r2',
  storage_key TEXT,
  checksum_sha256 TEXT,
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS documents_owner_archived_idx ON documents(owner_user_id, is_archived);
CREATE INDEX IF NOT EXISTS documents_course_category_idx ON documents(course_id, category);

CREATE TABLE IF NOT EXISTS admission_documents (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  file_asset_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  verified_status TEXT NOT NULL DEFAULT 'Pending',
  verification_remarks TEXT NOT NULL DEFAULT '',
  verified_by_user_id TEXT,
  verified_by_name TEXT,
  verified_at TEXT,
  is_latest INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(application_id, file_asset_id)
);

-- ============================================================================
-- FINANCE, FEE STRUCTURES, PAYMENTS & ALLOCATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS fee_structures (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  batch_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  fee_plan_id TEXT REFERENCES fee_plans(id) ON DELETE SET NULL,
  tuition_amount TEXT NOT NULL,
  registration_fee TEXT NOT NULL DEFAULT '0.00',
  lab_fee TEXT NOT NULL DEFAULT '0.00',
  effective_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS fee_structures_course_active_idx ON fee_structures(course_id, is_active);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enrollment_id TEXT REFERENCES enrollments(id) ON DELETE SET NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  subtotal TEXT,
  discount_total TEXT NOT NULL DEFAULT '0.00',
  scholarship_total TEXT NOT NULL DEFAULT '0.00',
  amount_due TEXT NOT NULL,
  amount_paid TEXT NOT NULL DEFAULT '0.00',
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'Unpaid',
  due_date TEXT NOT NULL,
  issued_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS fee_invoices_student_status_idx ON fee_invoices(student_id, status);
CREATE INDEX IF NOT EXISTS fee_invoices_created_at_idx ON fee_invoices(created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'Tuition',
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price TEXT NOT NULL,
  line_total TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL,
  method TEXT NOT NULL,
  reference_code TEXT NOT NULL DEFAULT '',
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS payments_student_paid_at_idx ON payments(student_id, paid_at);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
  allocated_amount TEXT NOT NULL,
  allocated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(payment_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON payment_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY NOT NULL,
  refund_number TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Processed',
  processed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS refunds_student_processed_idx ON refunds(student_id, processed_at);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'Percentage',
  value TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS scholarships (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sponsor_name TEXT NOT NULL DEFAULT '',
  coverage_type TEXT NOT NULL DEFAULT 'Percentage',
  coverage_value TEXT NOT NULL,
  max_recipients INTEGER NOT NULL DEFAULT 10,
  academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================================
-- CERTIFICATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS certificate_templates (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title_format TEXT NOT NULL DEFAULT 'Certificate of Completion',
  signatory_name TEXT NOT NULL DEFAULT 'Academy Director',
  signatory_title TEXT NOT NULL DEFAULT 'Academy Director',
  min_completion_pct INTEGER NOT NULL DEFAULT 100,
  min_score INTEGER NOT NULL DEFAULT 60,
  min_attendance_pct INTEGER NOT NULL DEFAULT 75,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY NOT NULL,
  certificate_code TEXT NOT NULL UNIQUE,
  verification_hash TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  template_id TEXT REFERENCES certificate_templates(id) ON DELETE SET NULL,
  final_score TEXT NOT NULL,
  letter_grade TEXT NOT NULL,
  attendance_rate INTEGER NOT NULL,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_by_name TEXT NOT NULL,
  course_title_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'Issued',
  revoked_reason TEXT,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(student_id, course_id)
);
CREATE INDEX IF NOT EXISTS certificates_issued_at_idx ON certificates(issued_at);

-- ============================================================================
-- COMMUNICATION & DELIVERY
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_course_id TEXT,
  related_session_id TEXT,
  dedupe_key TEXT UNIQUE,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx ON notifications(user_id, read, created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'in_app',
  kind TEXT NOT NULL DEFAULT 'all',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, channel, kind)
);

CREATE TABLE IF NOT EXISTS delivery_logs (
  id TEXT PRIMARY KEY NOT NULL,
  notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  application_id TEXT REFERENCES admissions(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Delivered',
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS delivery_logs_user_sent_idx ON delivery_logs(user_id, sent_at);
CREATE INDEX IF NOT EXISTS delivery_logs_app_sent_idx ON delivery_logs(application_id, sent_at);
CREATE INDEX IF NOT EXISTS delivery_logs_notification_idx ON delivery_logs(notification_id);

-- ============================================================================
-- GOVERNANCE & AUDIT LOGGING
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  ip_address TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_user_id);

-- ============================================================================
-- PERSISTENT BACKGROUND JOB QUEUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error TEXT,
  worker_id TEXT,
  locked_at TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS background_jobs_status_run_after_idx ON background_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS background_jobs_status_lease_idx ON background_jobs(status, lease_expires_at);
