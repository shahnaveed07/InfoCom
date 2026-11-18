import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import wranglerPkg from 'wrangler';
import {
  d1All,
  d1First,
  d1Run,
  runWithD1Database,
} from './d1/client.ts';
import {
  handleD1WorkerQueueBatch,
  handleD1WorkerScheduledSweep,
  queueD1TransactionalEmail,
} from './jobs/d1-worker.ts';
import { hashPasswordWorker, SESSION_COOKIE_NAME } from './worker-auth.ts';

const execFileAsync = promisify(execFile);
const { unstable_dev } = wranglerPkg;

function sqlStr(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

function extractCookieHeader(res: {
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
}): string {
  const rawList =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  for (const header of rawList) {
    const m = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    if (m?.[1]) return `${SESSION_COOKIE_NAME}=${m[1]}`;
  }
  return '';
}

test('Cloudflare D1 + R2 + Static Assets end-to-end Worker verification suite (real workerd runtime)', async () => {
  const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
  const distExists = await fs
    .access(distIndexPath)
    .then(() => true)
    .catch(() => false);
  if (!distExists) {
    await execFileAsync('npm', ['run', 'build'], {
      cwd: process.cwd(),
      timeout: 60_000,
    });
  }

  const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'igs-cf-d1-e2e-'));
  const seedSqlFile = path.join(os.tmpdir(), `igs-e2e-seed-${Date.now()}.sql`);

  // Apply D1 SQLite schema migrations to isolated temporary Wrangler persistence
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );

  // Generate ephemeral random credentials purely in memory
  const adminPassword = `Adm-${crypto.randomBytes(8).toString('hex')}!9`;
  const instPassword = `Ins-${crypto.randomBytes(8).toString('hex')}!9`;
  const tempPassword = `Tmp-${crypto.randomBytes(8).toString('hex')}!9`;
  const changedPassword = `Chg-${crypto.randomBytes(8).toString('hex')}!9`;
  const applicantNewPassword = `App-${crypto.randomBytes(8).toString('hex')}!9`;

  const [adminHash, instHash, tempHash] = await Promise.all([
    hashPasswordWorker(adminPassword),
    hashPasswordWorker(instPassword),
    hashPasswordWorker(tempPassword),
  ]);

  const now = new Date().toISOString();
  const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const seedSql = `
    PRAGMA foreign_keys = ON;
    UPDATE academy_settings
    SET value = 'after_first_payment'
    WHERE academy_id = 'acad-infocom' AND key = 'admission.portal_activation_policy';

    INSERT INTO departments (id, academy_id, code, name, status) VALUES
      ('dept-swe', 'acad-infocom', 'SWE', 'Software Engineering', 'active');

    INSERT INTO classrooms (id, academy_id, code, name, building, capacity, is_active) VALUES
      ('room-1', 'acad-infocom', 'LAB-01', 'Computing Lab 01', 'Main Campus', 25, 1);

    INSERT INTO academic_years (id, academy_id, code, name, start_date, end_date, is_current, status) VALUES
      ('ay-2026', 'acad-infocom', 'AY-2026', '2026 Academic Year', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z', 1, 'Active');

    INSERT INTO academic_terms (id, academic_year_id, code, name, start_date, end_date, is_current, status) VALUES
      ('term-1', 'ay-2026', 'SPR-2026', 'Spring 2026', '2026-01-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z', 1, 'Active');

    INSERT INTO users (id, name, email, role, status, staff_code, student_code, department, password_hash, must_change_password) VALUES
      ('u-admin', 'IGS Admin', 'admin@igs.test', 'admin', 'active', 'ADM-01', NULL, 'Administration', ${sqlStr(adminHash)}, 0),
      ('u-inst', 'IGS Instructor', 'instructor@igs.test', 'instructor', 'active', 'INS-01', NULL, 'Software Engineering', ${sqlStr(instHash)}, 0),
      ('u-mustchange', 'Must Change User', 'mustchange@igs.test', 'student', 'active', NULL, 'STU-TEMP-1', 'Software Engineering', ${sqlStr(tempHash)}, 1),
      ('u-argon', 'Legacy Argon User', 'argon@igs.test', 'student', 'active', NULL, 'STU-ARG-1', 'Software Engineering', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g', 0);

    INSERT INTO instructor_profiles (id, user_id, staff_code, department_id, status) VALUES
      ('ip-1', 'u-inst', 'INS-01', 'dept-swe', 'active');

    INSERT INTO student_profiles (id, user_id, student_code, department_id) VALUES
      ('sp-must', 'u-mustchange', 'STU-TEMP-1', 'dept-swe'),
      ('sp-arg', 'u-argon', 'STU-ARG-1', 'dept-swe');

    INSERT INTO courses (id, code, slug, title, track, category, description, department_id, instructor_id, duration_weeks, tuition_fee, is_published, show_tuition_publicly, is_demo, is_archived) VALUES
      ('crs-prod', 'IGS-WEB-101', 'web-development', 'Full-Stack Web Development', 'Software Engineering', 'Diploma', 'Production full-stack course', 'dept-swe', 'u-inst', 16, '10000.00', 1, 1, 0, 0),
      ('crs-demo', 'IGS-DEMO-999', 'demo-only-course', 'Demo Sandbox Course', 'Sandbox', 'Certificate', 'Should be filtered in production', 'dept-swe', 'u-inst', 4, '500.00', 1, 1, 1, 0);

    INSERT INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order) VALUES
      ('mod-1', 'crs-prod', 'M1', 'TypeScript Foundations', 50, 12, 1),
      ('mod-2', 'crs-prod', 'M2', 'Cloudflare & SQL Systems', 50, 16, 2);

    INSERT INTO cohorts (id, code, name, course_id, term_id, instructor_id, classroom_id, capacity, start_date, end_date, status) VALUES
      ('coh-1', 'WEB-A', 'Morning Batch A', 'crs-prod', 'term-1', 'u-inst', 'room-1', 20, ${sqlStr(pastStart)}, ${sqlStr(futureEnd)}, 'Active');

    INSERT INTO instructor_assignments (id, instructor_id, batch_id, course_id, role, is_active) VALUES
      ('ia-1', 'u-inst', 'coh-1', 'crs-prod', 'Lead', 1);

    INSERT INTO fee_plans (id, code, name, installment_count, currency, is_active) VALUES
      ('fp-1', 'FULL', 'Full Tuition', 1, 'INR', 1);

    INSERT INTO fee_invoices (id, invoice_number, student_id, course_id, description, subtotal, amount_due, amount_paid, currency, status, due_date) VALUES
      ('inv-other', 'INV-OTHER-01', 'u-mustchange', 'crs-prod', 'Tuition Other Student', '5000.00', '5000.00', '0.00', 'INR', 'Unpaid', ${sqlStr(futureStart)});
  `;

  await fs.writeFile(seedSqlFile, seedSql, 'utf8');
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
      '--file',
      seedSqlFile,
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );

  const worker = await unstable_dev('server/worker.ts', {
    config: 'wrangler.jsonc',
    persist: true,
    persistTo: persistDir,
    experimental: { disableExperimentalWarning: true },
    logLevel: 'error',
  });

  try {
    // 1. D1 readiness check passes after migration
    const readyRes = await worker.fetch('/api/health/ready');
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as Record<string, unknown>;
    assert.equal(readyJson.status, 'ok');
    assert.equal(readyJson.database, 'connected');
    assert.equal(readyJson.mode, 'd1');

    // 2. Public catalog excludes is_demo = 1 in NODE_ENV=production
    const pubCoursesRes = await worker.fetch('/api/public/courses');
    assert.equal(pubCoursesRes.status, 200);
    const pubCoursesJson = (await pubCoursesRes.json()) as {
      courses: Array<{ code: string; slug: string }>;
    };
    assert.equal(pubCoursesJson.courses.length, 1);
    assert.equal(pubCoursesJson.courses[0].slug, 'web-development');

    // 3. Disabled student self-registration -> 410
    const regRes = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'self@igs.test', name: 'Self', password: adminPassword }),
    });
    assert.equal(regRes.status, 410);

    // 4. Legacy $argon2id hash -> explicit 501 ARGON2_REHASH_REQUIRED
    const argonRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'argon@igs.test', password: adminPassword }),
    });
    assert.equal(argonRes.status, 501);
    const argonJson = (await argonRes.json()) as { code: string };
    assert.equal(argonJson.code, 'ARGON2_REHASH_REQUIRED');

    // 5. must_change_password gate blocks portal access until password changed
    const mustChangeLogin = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mustchange@igs.test', password: tempPassword }),
    });
    assert.equal(mustChangeLogin.status, 200);
    const mustChangeCookie = extractCookieHeader(mustChangeLogin);
    assert.ok(mustChangeCookie);

    const blockedDash = await worker.fetch('/api/dashboard', {
      headers: { Cookie: mustChangeCookie },
    });
    assert.equal(blockedDash.status, 403);
    assert.equal(((await blockedDash.json()) as { code: string }).code, 'PASSWORD_CHANGE_REQUIRED');

    const changePassRes = await worker.fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mustChangeCookie,
      },
      body: JSON.stringify({
        currentPassword: tempPassword,
        newPassword: changedPassword,
      }),
    });
    assert.equal(changePassRes.status, 200);

    const unlockedDash = await worker.fetch('/api/dashboard', {
      headers: { Cookie: mustChangeCookie },
    });
    assert.equal(unlockedDash.status, 200);

    // 6. RBAC: Student cannot access /api/students (403)
    const studentListDenied = await worker.fetch('/api/students', {
      headers: { Cookie: mustChangeCookie },
    });
    assert.equal(studentListDenied.status, 403);

    // 7. Public admission submission with PDF attachment (stored in Cloudflare R2)
    const samplePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const pubAdmitRes = await worker.fetch('/api/admissions/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantName: 'Zainab Farooq Mir',
        applicantEmail: 'zainab.mir@igs.test',
        phone: '+91 9906000011',
        targetCourseId: 'crs-prod',
        targetBatchId: 'coh-1',
        preferredCohort: 'Morning Batch A',
        status: 'Submitted',
        documents: [
          {
            documentType: 'ID Verification',
            title: 'Aadhaar Scan',
            category: 'ID Verification',
            fileName: 'id-card.pdf',
            mimeType: 'application/pdf',
            contentBase64: `data:application/pdf;base64,${samplePdfBytes.toString('base64')}`,
          },
        ],
      }),
    });
    assert.equal(pubAdmitRes.status, 201);
    const { admissionId } = (await pubAdmitRes.json()) as { admissionId: string };
    assert.ok(admissionId);

    // 8. Admin sign-in + CSRF rejection check
    const adminLoginRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@igs.test', password: adminPassword }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminCookie = extractCookieHeader(adminLoginRes);
    assert.ok(adminCookie);

    const csrfBlockedRes = await worker.fetch('/api/fee-plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'https://evil-attacker.example',
      },
      body: JSON.stringify({ code: 'EVIL', name: 'Evil Plan', installmentCount: 1 }),
    });
    assert.equal(csrfBlockedRes.status, 403);
    assert.equal(((await csrfBlockedRes.json()) as { code: string }).code, 'CSRF_ORIGIN_REJECTED');

    // 9. Admin inspects admission + downloads R2 document binary
    const admDetailRes = await worker.fetch(`/api/admissions/${admissionId}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(admDetailRes.status, 200);
    const admDetailJson = (await admDetailRes.json()) as {
      documents: Array<{ id: string }>;
    };
    assert.equal(admDetailJson.documents.length, 1);

    const admDocDownload = await worker.fetch(
      `/api/admissions/${admissionId}/documents/${admDetailJson.documents[0].id}/download`,
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(admDocDownload.status, 200);
    const downloadedBuf = Buffer.from(await admDocDownload.arrayBuffer());
    assert.equal(downloadedBuf.equals(samplePdfBytes), true);

    // 10. Admin approves admission -> creates student (inactive pending payment), enrollment, invoice, onboardingToken
    const approveRes = await worker.fetch(`/api/admissions/${admissionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        targetCourseId: 'crs-prod',
        targetBatchId: 'coh-1',
        feePlanId: 'fp-1',
        issueInvoice: true,
      }),
    });
    assert.equal(approveRes.status, 200);
    const approved = (await approveRes.json()) as {
      studentId: string;
      enrollmentId: string;
      invoiceId: string;
      onboardingToken: string;
      portalActivated: boolean;
    };
    assert.ok(approved.studentId);
    assert.ok(approved.enrollmentId);
    assert.ok(approved.invoiceId);
    assert.ok(approved.onboardingToken);
    assert.equal(approved.portalActivated, false);

    // 11. Applicant completes password onboarding via single-use token
    const onboardRes = await worker.fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: approved.onboardingToken,
        newPassword: applicantNewPassword,
      }),
    });
    assert.equal(onboardRes.status, 200);

    // 12. Full invoice payment auto-activates student portal
    const payRes = await worker.fetch(`/api/invoices/${approved.invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        amount: '10000.00',
        method: 'Bank Transfer',
        referenceCode: 'NEFT-2026-88',
        notes: 'Full upfront tuition settlement',
      }),
    });
    assert.equal(payRes.status, 201);
    const payJson = (await payRes.json()) as { paymentId: string; receiptNumber: string };
    assert.ok(payJson.paymentId);

    // Student can now sign in and verify IDOR protection against other student's invoice
    const studentLoginRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'zainab.mir@igs.test', password: applicantNewPassword }),
    });
    assert.equal(studentLoginRes.status, 200);
    const studentCookie = extractCookieHeader(studentLoginRes);

    const idorInvoiceRes = await worker.fetch('/api/invoices/inv-other', {
      headers: { Cookie: studentCookie },
    });
    assert.equal(idorInvoiceRes.status, 403);

    // 13. Academic progression -> complete modules, assessment + grade, session + attendance -> issue certificate -> PDF & public verification
    for (const modId of ['mod-1', 'mod-2']) {
      const modRes = await worker.fetch('/api/progress/module-completion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          enrollmentId: approved.enrollmentId,
          moduleId: modId,
          completed: true,
        }),
      });
      assert.equal(modRes.status, 200);
    }

    const assessRes = await worker.fetch('/api/assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        courseId: 'crs-prod',
        moduleId: 'mod-1',
        batchId: 'coh-1',
        title: 'Module 1 Capstone',
        assessmentType: 'Module Assessment',
        maxScore: 100,
        weight: 100,
      }),
    });
    assert.equal(assessRes.status, 201);
    const { assessmentId } = (await assessRes.json()) as { assessmentId: string };
    assert.ok(assessmentId);

    const gradeRes = await worker.fetch(`/api/assessments/${assessmentId}/grades`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        studentId: approved.studentId,
        score: 92,
        feedback: 'Excellent TypeScript craftsmanship.',
      }),
    });
    assert.equal(gradeRes.status, 200);

    const sesRes = await worker.fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        courseId: 'crs-prod',
        cohortId: 'coh-1',
        cohort: 'Morning Batch A',
        title: 'Final Capstone Review',
        room: 'LAB-01',
        startIso: pastStart,
        durationHours: 2,
      }),
    });
    assert.equal(sesRes.status, 201);
    const { sessionId } = (await sesRes.json()) as { sessionId: string };

    const attRes = await worker.fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        sessionId,
        studentId: approved.studentId,
        status: 'Present',
        note: 'Attended full lab',
      }),
    });
    assert.equal(attRes.status, 200);

    const certRes = await worker.fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        studentId: approved.studentId,
        courseId: 'crs-prod',
      }),
    });
    assert.equal(certRes.status, 201);
    const certJson = (await certRes.json()) as {
      certificateCode: string;
      dashboard: {
        certificates: Array<{ id: string; certificateCode: string; verificationHash: string }>;
      };
    };
    assert.ok(certJson.certificateCode);
    const issuedCert = certJson.dashboard.certificates.find(
      (c) => c.certificateCode === certJson.certificateCode
    );
    assert.ok(issuedCert?.id);

    // Pure-JS Certificate PDF download
    const certPdfRes = await worker.fetch(`/api/certificates/${issuedCert.id}/download`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(certPdfRes.status, 200);
    assert.equal(certPdfRes.headers.get('content-type'), 'application/pdf');
    const certPdfHeader = Buffer.from(await certPdfRes.arrayBuffer())
      .subarray(0, 7)
      .toString('utf8');
    assert.equal(certPdfHeader, '%PDF-1.');

    // Public Certificate Verification
    const verifyRes = await worker.fetch(
      `/api/certificates/verify/${encodeURIComponent(issuedCert.certificateCode)}`
    );
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as {
      certificate: { studentName: string; status: string };
    };
    assert.equal(verifyJson.certificate.studentName, 'Zainab Farooq Mir');
    assert.equal(verifyJson.certificate.status, 'Issued');

    // 14. Finance refund updates balance cleanly
    const refundRes = await worker.fetch(`/api/payments/${payJson.paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ amount: '500.00', reason: 'Scholarship fee concession refund' }),
    });
    assert.equal(refundRes.status, 201);

    // 15. General R2 document upload & download
    const docBytes = Buffer.from('IGS Syllabus Document Content 2026');
    const docUpRes = await worker.fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        ownerUserId: approved.studentId,
        courseId: 'crs-prod',
        title: 'Student Handbook 2026',
        category: 'Syllabus',
        fileName: 'handbook.txt',
        mimeType: 'text/plain',
        contentBase64: docBytes.toString('base64'),
      }),
    });
    assert.equal(docUpRes.status, 201);
    const { documentId } = (await docUpRes.json()) as { documentId: string };
    const docDownRes = await worker.fetch(`/api/documents/${documentId}/download`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(docDownRes.status, 200);
    assert.equal(Buffer.from(await docDownRes.arrayBuffer()).toString('utf8'), docBytes.toString('utf8'));

    // 16. CSV & PDF reports
    const csvRep = await worker.fetch('/api/reports/academic-progress?format=csv', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(csvRep.status, 200);
    assert.ok((csvRep.headers.get('content-type') || '').includes('text/csv'));
    const csvText = await csvRep.text();
    assert.ok(csvText.includes('Zainab Farooq Mir'));

    const pdfRep = await worker.fetch('/api/reports/financial-collections?format=pdf', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(pdfRep.status, 200);
    assert.equal(pdfRep.headers.get('content-type'), 'application/pdf');
    assert.equal(
      Buffer.from(await pdfRep.arrayBuffer())
        .subarray(0, 7)
        .toString('utf8'),
      '%PDF-1.'
    );

    // 17. Audit logs, email delivery logs, worker telemetry status
    const [auditRes, emailRes, workerStatusRes] = await Promise.all([
      worker.fetch('/api/audit-logs', { headers: { Cookie: adminCookie } }),
      worker.fetch('/api/admin/email-delivery', { headers: { Cookie: adminCookie } }),
      worker.fetch('/api/admin/worker-status', { headers: { Cookie: adminCookie } }),
    ]);
    assert.equal(auditRes.status, 200);
    assert.equal(emailRes.status, 200);
    assert.equal(workerStatusRes.status, 200);

    // Instructor password test confirms login works too
    const instLogin = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'instructor@igs.test', password: instPassword }),
    });
    assert.equal(instLogin.status, 200);
  } finally {
    await worker.stop();
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(seedSqlFile, { force: true }).catch(() => undefined);
  }
});

test('D1 Queue consumer retry/failure exhaustion + Cron sweep behavior with disabled vs failing HTTP email', async () => {
  // Minimal in-memory SQLite D1 harness for deterministic queue/cron assertions
  // using built-in node:sqlite if available, or mocked SQL state store
  const bgJobs = new Map<string, Record<string, unknown>>();
  const deliveryLogs = new Map<string, Record<string, unknown>>();
  const authSessions = new Map<string, { id: string; expires_at: string; revoked_at: string | null }>();
  const resetTokens = new Map<string, { id: string; expires_at: string; used_at: string | null }>();

  authSessions.set('ses-exp', {
    id: 'ses-exp',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    revoked_at: null,
  });
  resetTokens.set('prt-exp', {
    id: 'prt-exp',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    used_at: null,
  });

  const makeStmt = (sql: string, bound: unknown[] = []) => ({
    bind: (...vals: unknown[]) => makeStmt(sql, vals),
    first: async <T = Record<string, unknown>>() => {
      if (sql.includes("FROM background_jobs WHERE id = ? AND status = 'Pending'")) {
        const job = bgJobs.get(String(bound[0]));
        if (job && job.status === 'Pending') return { ...job } as T;
        return null;
      }
      if (sql.includes('FROM background_jobs WHERE dedupe_key = ?')) {
        for (const j of bgJobs.values()) {
          if (j.dedupe_key === bound[0]) return { ...j } as T;
        }
        return null;
      }
      return null;
    },
    run: async () => {
      if (sql.startsWith('INSERT INTO delivery_logs')) {
        deliveryLogs.set(String(bound[0]), {
          id: bound[0],
          status: 'Queued',
          error_message: null,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('INSERT INTO background_jobs')) {
        bgJobs.set(String(bound[0]), {
          id: bound[0],
          job_type: bound[1],
          dedupe_key: null,
          payload: bound[2],
          status: 'Pending',
          attempts: 0,
          max_attempts: Number(bound[3] ?? 2),
          run_after: bound[4],
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes("SET status = 'Processing'")) {
        const id = String(bound[5]);
        const job = bgJobs.get(id);
        if (job && job.status === 'Pending' && Number(job.attempts) === Number(bound[6])) {
          job.status = 'Processing';
          job.attempts = Number(job.attempts) + 1;
          job.run_after = new Date().toISOString();
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes("SET status = 'Completed'")) {
        const id = String(bound[3]);
        const job = bgJobs.get(id);
        if (job) job.status = 'Completed';
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes('SET status = ?')) {
        const id = String(bound[7]);
        const job = bgJobs.get(id);
        if (job) {
          job.status = bound[0];
          job.last_error = bound[2];
          job.run_after = bound[4];
          job.payload = bound[5];
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE delivery_logs')) {
        const log = deliveryLogs.get(String(bound[bound.length - 1]));
        if (log) {
          if (sql.includes("'Failed'")) {
            log.status = 'Failed';
            log.error_message = bound[0] ?? null;
          } else {
            log.status = String(bound[0]);
            log.error_message = bound.length >= 5 ? bound[2] : bound[1];
          }
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('DELETE FROM auth_sessions')) {
        const before = authSessions.size;
        authSessions.delete('ses-exp');
        return { success: true, meta: { changes: before - authSessions.size } };
      }
      if (sql.startsWith('DELETE FROM password_reset_tokens')) {
        const before = resetTokens.size;
        resetTokens.delete('prt-exp');
        return { success: true, meta: { changes: before - resetTokens.size } };
      }
      return { success: true, meta: { changes: 0 } };
    },
    all: async <T = Record<string, unknown>>() => ({
      success: true,
      results: [] as T[],
    }),
    raw: async () => [],
  });

  const mockDb = {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: Array<{ run: () => Promise<{ success: boolean }> }>) =>
      Promise.all(stmts.map((s) => s.run())),
  };

  // 1. Disabled email logs Skipped cleanly without errors
  await runWithD1Database(mockDb, async () => {
    const queued = await queueD1TransactionalEmail(
      {
        recipientEmail: 'student@igs.test',
        subject: 'Welcome to IGS',
        bodyText: 'Hello student',
        maxAttempts: 2,
      },
      mockDb
    );
    assert.ok(queued);

    let ackedCount = 0;
    const outcome = await handleD1WorkerQueueBatch(
      {
        queue: 'igs-ams-jobs',
        messages: [
          {
            id: 'msg-1',
            attempts: 1,
            body: {
              jobId: queued.jobId,
              jobType: 'notification_email',
              enqueuedAt: new Date().toISOString(),
            },
            ack: () => {
              ackedCount += 1;
            },
            retry: () => {
              throw new Error('Should not retry disabled email provider');
            },
          },
        ],
      },
      { DB: mockDb, EMAIL_PROVIDER: 'disabled' }
    );
    assert.equal(outcome.acked, 1);
    assert.equal(ackedCount, 1);
    assert.equal(deliveryLogs.get(queued.deliveryLogId)?.status, 'Skipped');
  });

  // 2. Failing HTTP email retries then exhausts cleanly into Failed status & redacts sensitive payload
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Upstream error', { status: 500 })) as typeof fetch;
  try {
    await runWithD1Database(mockDb, async () => {
      const queued = await queueD1TransactionalEmail(
        {
          recipientEmail: 'reset@igs.test',
          subject: 'Password Reset',
          bodyText: 'secret-token-should-redact',
          redactSensitive: true,
          maxAttempts: 2,
        },
        mockDb
      );
      assert.ok(queued);

      // Attempt 1 -> Pending + retry()
      const firstRun = await handleD1WorkerQueueBatch(
        {
          queue: 'igs-ams-jobs',
          messages: [
            {
              id: 'msg-r1',
              attempts: 1,
              body: {
                jobId: queued.jobId,
                jobType: 'notification_email',
                enqueuedAt: new Date().toISOString(),
              },
              ack: () => {
                throw new Error('Should retry on first attempt');
              },
              retry: () => {},
            },
          ],
        },
        {
          DB: mockDb,
          EMAIL_PROVIDER: 'http',
          EMAIL_HTTP_URL: 'https://mail.example/send',
          EMAIL_FROM: 'noreply@igs.test',
        }
      );
      assert.equal(firstRun.retried, 1);
      assert.equal(bgJobs.get(queued.jobId)?.status, 'Pending');

      // Attempt 2 -> exhausted -> Failed + ack() + redacted payload
      const secondRun = await handleD1WorkerQueueBatch(
        {
          queue: 'igs-ams-jobs',
          messages: [
            {
              id: 'msg-r2',
              attempts: 2,
              body: {
                jobId: queued.jobId,
                jobType: 'notification_email',
                enqueuedAt: new Date().toISOString(),
              },
              ack: () => {},
              retry: () => {
                throw new Error('Should ack exhausted failure to prevent infinite queue loop');
              },
            },
          ],
        },
        {
          DB: mockDb,
          EMAIL_PROVIDER: 'http',
          EMAIL_HTTP_URL: 'https://mail.example/send',
          EMAIL_FROM: 'noreply@igs.test',
        }
      );
      assert.equal(secondRun.acked, 1);
      assert.equal(bgJobs.get(queued.jobId)?.status, 'Failed');
      assert.equal(deliveryLogs.get(queued.deliveryLogId)?.status, 'Failed');
      assert.ok(String(bgJobs.get(queued.jobId)?.payload).includes('[REDACTED AFTER FAILURE]'));
    });

    // 3. Cron scheduled sweep housekeeping removes expired sessions & reset tokens
    const sweep = await handleD1WorkerScheduledSweep(
      { cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry: () => {} },
      { DB: mockDb, EMAIL_PROVIDER: 'disabled' }
    );
    assert.equal(sweep.expiredSessionsDeleted, 1);
    assert.equal(sweep.expiredResetTokensDeleted, 1);
  } finally {
    globalThis.fetch = origFetch;
  }

  // Silence unused helpers check
  assert.equal(typeof d1All, 'function');
  assert.equal(typeof d1First, 'function');
  assert.equal(typeof d1Run, 'function');
});
