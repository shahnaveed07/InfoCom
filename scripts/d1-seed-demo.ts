import 'dotenv/config';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sqlString(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const allowDemo =
    process.env.ALLOW_DEMO_SEED === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test';
  if (!allowDemo || process.env.NODE_ENV === 'production') {
    throw new Error(
      'Demo D1 seeding is disabled in production. Use NODE_ENV=development or ALLOW_DEMO_SEED=true only in local/staging environments.'
    );
  }

  // Cloudflare Workers Free uses first-party WebAuthn passkeys; demo users have NULL password_hash.
  const adminHash: string | null = null;
  const instructorHash: string | null = null;
  const studentHash: string | null = null;

  const now = new Date().toISOString();
  const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const statements: string[] = [
    'PRAGMA foreign_keys = ON;',
    `INSERT OR IGNORE INTO academy_settings (id, academy_id, key, value, value_type, updated_at) VALUES
      ('set-pass-score', 'acad-infocom', 'grading.passing_score', '60', 'number', ${sqlString(now)}),
      ('set-min-att', 'acad-infocom', 'attendance.min_rate_pct', '75', 'number', ${sqlString(now)}),
      ('set-inv-prefix', 'acad-infocom', 'academy.invoice_prefix', 'INV-2026', 'string', ${sqlString(now)}),
      ('set-cert-prefix', 'acad-infocom', 'certificate.code_prefix', 'IGS-CERT-2026', 'string', ${sqlString(now)}),
      ('set-portal-policy', 'acad-infocom', 'admission.portal_activation_policy', 'on_approval', 'string', ${sqlString(now)});`,
    `INSERT OR IGNORE INTO departments (id, academy_id, code, name, status, created_at, updated_at) VALUES
      ('dept-software', 'acad-infocom', 'SWE', 'Software Engineering', 'active', ${sqlString(now)}, ${sqlString(now)}),
      ('dept-data', 'acad-infocom', 'DATA', 'Data & Applied Computing', 'active', ${sqlString(now)}, ${sqlString(now)});`,
    `INSERT OR IGNORE INTO classrooms (id, academy_id, code, name, building, capacity, equipment, is_active, created_at) VALUES
      ('room-lab-1', 'acad-infocom', 'LAB-01', 'Computing Lab 01', 'Main Campus', 30, 'Workstations & Projector', 1, ${sqlString(now)}),
      ('room-lab-2', 'acad-infocom', 'LAB-02', 'Systems & Cloud Lab 02', 'Main Campus', 24, 'Cloud Terminals', 1, ${sqlString(now)});`,
    `INSERT OR IGNORE INTO academic_years (id, academy_id, code, name, start_date, end_date, is_current, status, created_at) VALUES
      ('ay-2026', 'acad-infocom', 'AY-2026', 'Academic Year 2026', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z', 1, 'Active', ${sqlString(now)});`,
    `INSERT OR IGNORE INTO academic_terms (id, academic_year_id, code, name, start_date, end_date, is_current, status, created_at) VALUES
      ('term-2026-q1', 'ay-2026', '2026-SPR', 'Spring Term 2026', '2026-01-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z', 1, 'Active', ${sqlString(now)});`,
    `INSERT OR IGNORE INTO users (
      id, name, email, role, status, student_code, staff_code, department, phone,
      password_hash, must_change_password, session_version, created_at, updated_at
    ) VALUES
      ('usr-demo-admin', 'IGS Principal Administrator', 'admin.demo@igssopore.local', 'admin', 'active', NULL, 'ADM-0001', 'Administration', '+91 9906100001', ${sqlString(adminHash)}, 0, 1, ${sqlString(now)}, ${sqlString(now)}),
      ('usr-demo-inst', 'Tariq Ahmad Mir', 'instructor.demo@igssopore.local', 'instructor', 'active', NULL, 'INS-0001', 'Software Engineering', '+91 9906100002', ${sqlString(instructorHash)}, 0, 1, ${sqlString(now)}, ${sqlString(now)}),
      ('usr-demo-stu', 'Amina Rashid Lone', 'student.demo@igssopore.local', 'student', 'active', 'STU-2026-0001', NULL, 'Software Engineering', '+91 9906100003', ${sqlString(studentHash)}, 0, 1, ${sqlString(now)}, ${sqlString(now)});`,
    `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_at) VALUES
      ('ur-demo-admin', 'usr-demo-admin', 'role-admin', ${sqlString(now)}),
      ('ur-demo-inst', 'usr-demo-inst', 'role-instructor', ${sqlString(now)}),
      ('ur-demo-stu', 'usr-demo-stu', 'role-student', ${sqlString(now)});`,
    `INSERT OR IGNORE INTO student_profiles (
      id, user_id, student_code, department_id, academic_standing, enrollment_date, created_at, updated_at
    ) VALUES (
      'sp-demo-1', 'usr-demo-stu', 'STU-2026-0001', 'dept-software', 'Good Standing', ${sqlString(pastStart)}, ${sqlString(now)}, ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO instructor_profiles (
      id, user_id, staff_code, department_id, specialization, bio, status, created_at, updated_at
    ) VALUES (
      'ip-demo-1', 'usr-demo-inst', 'INS-0001', 'dept-software', 'Full-Stack Engineering', 'Senior Full-Stack & Cloud Instructor at IGS Sopore', 'active', ${sqlString(now)}, ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO courses (
      id, code, slug, title, track, category, description, prerequisites,
      learning_objectives, grading_config, department_id, instructor_id,
      duration_weeks, tuition_fee, passing_score, min_attendance_rate,
      is_published, show_tuition_publicly, is_demo, is_archived, created_at, updated_at
    ) VALUES
      (
        'crs-demo-web',
        'IGS-WEB-101',
        'web-development',
        'Full-Stack Web Development',
        'Software Engineering',
        'Diploma',
        'Production TypeScript, React, REST API architecture, SQL data modeling, and deployment engineering.',
        'Basic computer literacy and problem-solving aptitude',
        ${sqlString(JSON.stringify(['Build responsive React web apps', 'Design relational databases', 'Deploy full-stack cloud applications']))},
        '{}',
        'dept-software',
        'usr-demo-inst',
        16,
        '18000.00',
        60,
        75,
        1,
        1,
        1,
        0,
        ${sqlString(now)},
        ${sqlString(now)}
      ),
      (
        'crs-demo-python',
        'IGS-DAT-102',
        'python-data-analytics',
        'Python & Data Analytics',
        'Data & Applied Computing',
        'Certificate',
        'Python programming, data pipelines, SQL reporting, and applied business analytics for Kashmir enterprises.',
        'High school mathematics',
        ${sqlString(JSON.stringify(['Write clean Python scripts', 'Analyze structured datasets', 'Generate analytical dashboards']))},
        '{}',
        'dept-data',
        'usr-demo-inst',
        12,
        '15000.00',
        60,
        75,
        1,
        1,
        1,
        0,
        ${sqlString(now)},
        ${sqlString(now)}
      );`,
    `INSERT OR IGNORE INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order) VALUES
      ('mod-web-1', 'crs-demo-web', 'MOD-01', 'HTML, CSS & Modern JavaScript', 25, 16, 1),
      ('mod-web-2', 'crs-demo-web', 'MOD-02', 'React 19 & TypeScript Frontends', 35, 24, 2),
      ('mod-web-3', 'crs-demo-web', 'MOD-03', 'Backend APIs, SQL & Security', 40, 28, 3),
      ('mod-py-1', 'crs-demo-python', 'MOD-01', 'Python Core & Data Structures', 40, 20, 1),
      ('mod-py-2', 'crs-demo-python', 'MOD-02', 'SQL & Exploratory Analytics', 60, 28, 2);`,
    `INSERT OR IGNORE INTO cohorts (
      id, code, name, course_id, term_id, instructor_id, classroom_id,
      capacity, start_date, end_date, status, created_at
    ) VALUES (
      'coh-demo-web-1',
      'WEB-2026-A',
      'Web Dev Morning Cohort A',
      'crs-demo-web',
      'term-2026-q1',
      'usr-demo-inst',
      'room-lab-1',
      25,
      ${sqlString(pastStart)},
      ${sqlString(futureEnd)},
      'Active',
      ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO instructor_assignments (id, instructor_id, batch_id, course_id, role, is_active, assigned_at) VALUES
      ('ia-demo-1', 'usr-demo-inst', 'coh-demo-web-1', 'crs-demo-web', 'Lead', 1, ${sqlString(now)});`,
    `INSERT OR IGNORE INTO fee_plans (id, code, name, description, installment_count, currency, is_active, created_at) VALUES
      ('fp-demo-full', 'FULL-PAY', 'Full Single Installment', 'Single upfront tuition payment', 1, 'INR', 1, ${sqlString(now)});`,
    `INSERT OR IGNORE INTO enrollments (
      id, student_id, course_id, cohort_id, cohort, status, enrolled_at,
      completed_module_ids, tuition_snapshot, batch_name_snapshot, instructor_name_snapshot, updated_at
    ) VALUES (
      'enr-demo-1',
      'usr-demo-stu',
      'crs-demo-web',
      'coh-demo-web-1',
      'Web Dev Morning Cohort A',
      'Active',
      ${sqlString(pastStart)},
      '["mod-web-1","mod-web-2","mod-web-3"]',
      '18000.00',
      'Web Dev Morning Cohort A',
      'Tariq Ahmad Mir',
      ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO fee_invoices (
      id, invoice_number, student_id, enrollment_id, course_id, description,
      subtotal, discount_total, scholarship_total, amount_due, amount_paid, currency,
      status, due_date, issued_by_user_id, is_archived, created_at, updated_at
    ) VALUES (
      'inv-demo-1',
      'INV-2026-0001',
      'usr-demo-stu',
      'enr-demo-1',
      'crs-demo-web',
      'Full-Stack Web Development Tuition',
      '18000.00',
      '0.00',
      '0.00',
      '18000.00',
      '18000.00',
      'INR',
      'Paid',
      ${sqlString(dueDate)},
      'usr-demo-admin',
      0,
      ${sqlString(now)},
      ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO payments (
      id, receipt_number, invoice_id, student_id, amount, method, reference_code,
      recorded_by_user_id, notes, paid_at
    ) VALUES (
      'pay-demo-1',
      'REC-2026-0001',
      'inv-demo-1',
      'usr-demo-stu',
      '18000.00',
      'UPI',
      'UPI-DEMO-2026-01',
      'usr-demo-admin',
      'Demo tuition settlement',
      ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO payment_allocations (id, payment_id, invoice_id, allocated_amount, allocated_at) VALUES
      ('pa-demo-1', 'pay-demo-1', 'inv-demo-1', '18000.00', ${sqlString(now)});`,
    `INSERT OR IGNORE INTO class_sessions (
      id, course_id, cohort_id, classroom_id, cohort, title, topic, room,
      instructor_id, instructor_name, start_at, end_at, status, created_at
    ) VALUES (
      'ses-demo-1',
      'crs-demo-web',
      'coh-demo-web-1',
      'room-lab-1',
      'Web Dev Morning Cohort A',
      'TypeScript State Architecture Lab',
      'Full-stack React architecture and state discipline',
      'LAB-01 · Computing Lab 01',
      'usr-demo-inst',
      'Tariq Ahmad Mir',
      ${sqlString(futureStart)},
      ${sqlString(new Date(Date.parse(futureStart) + 2 * 60 * 60 * 1000).toISOString())},
      'Scheduled',
      ${sqlString(now)}
    );`,
    `INSERT OR IGNORE INTO attendance_records (
      id, session_id, course_id, enrollment_id, student_id, status, note,
      updated_at, updated_by_user_id, updated_by
    ) VALUES (
      'att-demo-1',
      'ses-demo-1',
      'crs-demo-web',
      'enr-demo-1',
      'usr-demo-stu',
      'Present',
      'Demo session attendance',
      ${sqlString(now)},
      'usr-demo-inst',
      'Tariq Ahmad Mir'
    );`,
    `INSERT OR IGNORE INTO certificates (
      id, certificate_code, verification_hash, student_id, course_id, enrollment_id,
      final_score, letter_grade, attendance_rate, issued_by_user_id, issued_by_name,
      course_title_snapshot, status, issued_at
    ) VALUES (
      'cert-demo-1',
      'IGS-2026-0001',
      'VERIF-DEMO-SOPORE-2026',
      'usr-demo-stu',
      'crs-demo-web',
      'enr-demo-1',
      '91.50',
      'A',
      100,
      'usr-demo-admin',
      'IGS Principal Administrator',
      'Full-Stack Web Development',
      'Issued',
      ${sqlString(now)}
    );`,
  ];

  const persistIdx = process.argv.indexOf('--persist-to');
  const persistDir =
    persistIdx !== -1 && process.argv[persistIdx + 1] ? process.argv[persistIdx + 1] : null;

  const tmpFile = path.join(os.tmpdir(), `igs-d1-seed-${Date.now()}.sql`);
  await fs.writeFile(tmpFile, statements.join('\n\n'), 'utf8');
  try {
    const wranglerArgs = ['wrangler', 'd1', 'execute', 'igs-infocom-db', '--local', '--file', tmpFile];
    if (persistDir) {
      wranglerArgs.push('--persist-to', persistDir);
    }
    const { stdout, stderr } = await execFileAsync('npx', wranglerArgs, {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    console.log('Seeded local D1 demo data cleanly.');
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
