/**
 * Reproducible PostgreSQL -> Cloudflare D1 (SQLite) Export Script
 *
 * Exports existing PostgreSQL production tables in dependency-safe foreign-key order
 * as idempotent SQLite INSERT statements suitable for:
 *   npx wrangler d1 execute igs-infocom-db --remote --file=./d1-export.sql
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/pg-to-d1-export.ts --out ./data/d1-export.sql
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma, disconnectPrisma } from '../server/db/prisma.ts';

function sqlString(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (typeof value === 'object') {
    const maybeDecimal = value as { toFixed?: (digits: number) => string };
    if (typeof maybeDecimal.toFixed === 'function') {
      return `'${maybeDecimal.toFixed(2).replace(/'/g, "''")}'`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsert(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>
): string[] {
  if (!rows.length) return [`-- Table ${table}: 0 rows`];
  const lines: string[] = [`-- Table ${table}: ${rows.length} rows`];
  const colSql = columns.join(', ');
  for (const row of rows) {
    const vals = columns.map((c) => sqlString(row[c]));
    lines.push(`INSERT OR REPLACE INTO ${table} (${colSql}) VALUES (${vals.join(', ')});`);
  }
  return lines;
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

const CUSTOM_COLUMN_MAP: Record<string, Record<string, string>> = {
  class_sessions: { startIso: 'start_at', endIso: 'end_at' },
};

function mapRows(table: string, items: Array<Record<string, unknown>>): {
  columns: string[];
  rows: Array<Record<string, unknown>>;
} {
  if (!items.length) return { columns: [], rows: [] };
  const overrides = CUSTOM_COLUMN_MAP[table] ?? {};
  const sampleKeys = Object.keys(items[0]);
  const columns = sampleKeys.map((k) => overrides[k] ?? toSnake(k));
  const rows = items.map((item) => {
    const out: Record<string, unknown> = {};
    sampleKeys.forEach((k, idx) => {
      out[columns[idx]] = item[k];
    });
    return out;
  });
  return { columns, rows };
}

async function runExport() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : 'data/d1-export.sql';

  const counts: Record<string, number> = {};
  const lines: string[] = [
    '-- IGS — InfoCom Global Services · Complete PostgreSQL -> Cloudflare D1 Export',
    `-- Exported At: ${new Date().toISOString()}`,
    'PRAGMA foreign_keys = OFF;',
    '',
  ];

  const extractors: Array<{
    table: string;
    load: () => Promise<Array<Record<string, unknown>>>;
  }> = [
    { table: 'roles', load: () => prisma.role.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'users', load: () => prisma.user.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'user_roles', load: () => prisma.userRole.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'auth_sessions', load: () => prisma.authSession.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'password_reset_tokens', load: () => prisma.passwordResetToken.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'academies', load: () => prisma.academy.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'academy_settings', load: () => prisma.academySetting.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'departments', load: () => prisma.department.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'academic_years', load: () => prisma.academicYear.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'academic_terms', load: () => prisma.academicTerm.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'classrooms', load: () => prisma.classroom.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'student_profiles', load: () => prisma.studentProfile.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'instructor_profiles', load: () => prisma.instructorProfile.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'guardians', load: () => prisma.guardian.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'courses', load: () => prisma.course.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'course_modules', load: () => prisma.courseModule.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'cohorts', load: () => prisma.batch.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'instructor_assignments', load: () => prisma.instructorAssignment.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'enrollments', load: () => prisma.enrollment.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'enrollment_histories', load: () => prisma.enrollmentHistory.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'class_sessions', load: () => prisma.classSession.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'attendance_records', load: () => prisma.attendance.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'assessments', load: () => prisma.assessment.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'module_grades', load: () => prisma.grade.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'progress_remarks', load: () => prisma.progressRemark.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'fee_plans', load: () => prisma.feePlan.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'admissions', load: () => prisma.admissionApplication.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'admission_status_histories', load: () => prisma.admissionStatusHistory.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'documents', load: () => prisma.fileAsset.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'admission_documents', load: () => prisma.admissionDocument.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'fee_structures', load: () => prisma.feeStructure.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'fee_invoices', load: () => prisma.invoice.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'invoice_items', load: () => prisma.invoiceItem.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'payments', load: () => prisma.payment.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'payment_allocations', load: () => prisma.paymentAllocation.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'refunds', load: () => prisma.refund.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'discounts', load: () => prisma.discount.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'scholarships', load: () => prisma.scholarship.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'certificate_templates', load: () => prisma.certificateTemplate.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'certificates', load: () => prisma.certificate.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'notifications', load: () => prisma.notification.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'notification_preferences', load: () => prisma.notificationPreference.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'delivery_logs', load: () => prisma.deliveryLog.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'audit_logs', load: () => prisma.auditLog.findMany() as Promise<Array<Record<string, unknown>>> },
    { table: 'background_jobs', load: () => prisma.backgroundJob.findMany() as Promise<Array<Record<string, unknown>>> },
  ];

  for (const item of extractors) {
    const raw = await item.load();
    counts[item.table] = raw.length;
    const { columns, rows } = mapRows(item.table, raw);
    if (columns.length > 0) {
      lines.push(...buildInsert(item.table, columns, rows), '');
    } else {
      lines.push(`-- Table ${item.table}: 0 rows`, '');
    }
  }

  lines.push('PRAGMA foreign_keys = ON;', '');

  const absOut = path.resolve(process.cwd(), outFile);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, lines.join('\n'), 'utf8');
  console.log(`Exported PostgreSQL snapshot to ${absOut}`);
  console.log('Row counts summary:', JSON.stringify(counts));
}

runExport()
  .catch((err) => {
    console.error('PG -> D1 export failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
