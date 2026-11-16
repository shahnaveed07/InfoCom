import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import http, { type Server } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import 'dotenv/config';
import { createApiApp } from './app.ts';
import { SESSION_COOKIE_NAME, hashPassword } from './auth.ts';
import { prisma } from './db/prisma.ts';
import { setEmailSenderOverride } from './email/mailer.ts';
import {
  claimPendingJobs,
  processPendingJobs,
  queueTransactionalEmail,
  recoverStaleProcessingJobs,
} from './jobs/worker.ts';
import { resetAuthRateLimiters } from './routes/auth.routes.ts';
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from './storage/index.ts';
import { migrateLegacyDocuments } from './storage/migrate-legacy.ts';

const execFileAsync = promisify(execFile);

function extractSessionCookie(res: Response): string {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);

  for (const header of setCookies) {
    const match = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return '';
}

test('Stabilization Suite: RBAC Boundaries, Demo Seed Guards, Legacy Doc Migration & Transactional Email Queue', async (t) => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminId = `adm-stab-${runSuffix}`;
  const instId = `ins-stab-${runSuffix}`;
  const stuId = `stu-stab-${runSuffix}`;
  const adminEmail = `admin.stab.${runSuffix}@infocom.test`;
  const instEmail = `inst.stab.${runSuffix}@infocom.test`;
  const stuEmail = `stu.stab.${runSuffix}@infocom.test`;
  const password = 'StabVerify!2026';

  const createdUserIds = [adminId, instId, stuId];
  const createdCourseIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdAdmissionIds: string[] = [];
  const createdEnrollmentIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdDocIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdStorageFiles: Array<{ storageProvider: string; storageKey: string }> = [];

  async function apiFetch(
    path: string,
    opts: { method?: string; cookie?: string; body?: unknown } = {}
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.cookie
          ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}` }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, text, json };
  }

  let adminCookie = '';
  let instCookie = '';
  let stuCookie = '';
  let prodCourseId = '';
  let demoCourseId = '';
  let batchId = '';
  let sessionId = '';
  let provisionedStudentId = '';
  let provisionedStudentEmail = '';

  const origNodeEnv = process.env.NODE_ENV;
  const origSmtpHost = process.env.SMTP_HOST;
  const origSmtpFrom = process.env.SMTP_FROM;

  try {
    resetAuthRateLimiters();
    const pwHash = await hashPassword(password);
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Stab Admin',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          staffCode: `STF-SA-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
        {
          id: instId,
          name: 'Stab Instructor',
          email: instEmail,
          role: 'instructor',
          status: 'active',
          staffCode: `STF-SI-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
        {
          id: stuId,
          name: 'Stab Student',
          email: stuEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-SS-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
      ],
    });

    const [lAdm, lIns, lStu] = await Promise.all([
      apiFetch('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: instEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: stuEmail, password } }),
    ]);
    adminCookie = extractSessionCookie(lAdm.res);
    instCookie = extractSessionCookie(lIns.res);
    stuCookie = extractSessionCookie(lStu.res);
    assert.ok(adminCookie && instCookie && stuCookie);

    const crsRes = await apiFetch('/api/courses', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `STB-${runSuffix.slice(0, 4).toUpperCase()}`,
        slug: `stab-prod-course-${runSuffix}`,
        title: `Stabilization Course ${runSuffix}`,
        track: 'Engineering',
        instructorId: instId,
        durationWeeks: 8,
        tuitionFee: '12000.00',
        isPublished: true,
        showTuitionPublicly: true,
        modules: [{ code: 'M1', title: 'Core Module', weight: 100, labHours: 10 }],
      },
    });
    assert.equal(crsRes.res.status, 201);
    prodCourseId = String(crsRes.json?.courseId);
    createdCourseIds.push(prodCourseId);

    demoCourseId = `crs-demo-${runSuffix}`;
    await prisma.course.create({
      data: {
        id: demoCourseId,
        code: `DMO-${runSuffix.slice(0, 4).toUpperCase()}`,
        slug: `stab-demo-course-${runSuffix}`,
        title: `Demo Course ${runSuffix}`,
        track: 'Demo',
        instructorId: instId,
        durationWeeks: 4,
        tuitionFee: '5000.00',
        isPublished: true,
        showTuitionPublicly: true,
        isDemo: true,
      },
    });
    createdCourseIds.push(demoCourseId);

    const batchRes = await apiFetch('/api/cohorts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `BSTB-${runSuffix.slice(0, 4).toUpperCase()}`,
        name: `Stab Batch ${runSuffix}`,
        courseId: prodCourseId,
        instructorId: instId,
        capacity: 15,
        startDate: '2026-11-10T00:00:00.000Z',
        endDate: '2027-02-10T00:00:00.000Z',
        status: 'Active',
      },
    });
    assert.equal(batchRes.res.status, 201);
    batchId = String(batchRes.json?.cohortId);
    createdBatchIds.push(batchId);

    await t.test('1. Phase 3: Admin-controlled student onboarding & RBAC permission boundaries', async () => {
      // Public self-registration disabled
      const regRes = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: { name: 'Rogue', email: `rogue.${runSuffix}@infocom.test`, password },
      });
      assert.equal(regRes.res.status, 410);

      // Non-admins blocked from creating students, instructors, resetting passwords, enrolling
      const stuCreateStu = await apiFetch('/api/students', {
        method: 'POST',
        cookie: stuCookie,
        body: { name: 'Bad Stu', email: `bad.stu.${runSuffix}@infocom.test` },
      });
      assert.equal(stuCreateStu.res.status, 403);

      const instCreateStu = await apiFetch('/api/students', {
        method: 'POST',
        cookie: instCookie,
        body: { name: 'Bad Stu 2', email: `bad.stu2.${runSuffix}@infocom.test` },
      });
      assert.equal(instCreateStu.res.status, 403);

      const anonCreateStu = await apiFetch('/api/students', {
        method: 'POST',
        body: { name: 'Anon Stu', email: `anon.stu.${runSuffix}@infocom.test` },
      });
      assert.equal(anonCreateStu.res.status, 401);

      const stuCreateIns = await apiFetch('/api/instructors', {
        method: 'POST',
        cookie: stuCookie,
        body: { name: 'Bad Ins', email: `bad.ins.${runSuffix}@infocom.test` },
      });
      assert.equal(stuCreateIns.res.status, 403);

      const stuEnroll = await apiFetch('/api/enrollments', {
        method: 'POST',
        cookie: stuCookie,
        body: {
          studentId: stuId,
          courseId: prodCourseId,
          cohort: `Stab Batch ${runSuffix}`,
          status: 'Active',
        },
      });
      assert.equal(stuEnroll.res.status, 403);

      const instResetStu = await apiFetch(`/api/students/${stuId}/reset-password`, {
        method: 'POST',
        cookie: instCookie,
      });
      assert.equal(instResetStu.res.status, 403);

      // Admin provisions student without preset password -> issues onboarding token & server studentCode
      provisionedStudentEmail = `onboard.${runSuffix}@infocom.test`;
      const admCreateStu = await apiFetch('/api/students', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: `Onboarded Student ${runSuffix}`,
          email: provisionedStudentEmail,
          initialCourseId: prodCourseId,
          initialCohortId: batchId,
          issueTuitionInvoice: true,
        },
      });
      assert.equal(admCreateStu.res.status, 201);
      const createdStuObj = admCreateStu.json?.student as {
        id: string;
        studentCode: string;
        mustChangePassword: boolean;
      };
      provisionedStudentId = createdStuObj.id;
      createdUserIds.push(provisionedStudentId);
      assert.ok(createdStuObj.studentCode.startsWith('IGS-'));
      assert.equal(createdStuObj.mustChangePassword, true);
      const onboardingToken = String(admCreateStu.json?.onboardingToken || '');
      assert.ok(onboardingToken.length > 20);

      // Complete password setup using single-use onboarding token
      const newPw = 'StudentOnboard!2026';
      const setupRes = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: onboardingToken, newPassword: newPw },
      });
      assert.equal(setupRes.res.status, 200);

      const loginNewStu = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: provisionedStudentEmail, password: newPw },
      });
      assert.equal(loginNewStu.res.status, 200);
      assert.equal((loginNewStu.json?.user as { mustChangePassword: boolean }).mustChangePassword, false);

      // Track enrollment & invoice created for cleanup
      const createdEnr = await prisma.enrollment.findFirst({
        where: { studentId: provisionedStudentId, courseId: prodCourseId },
      });
      if (createdEnr) createdEnrollmentIds.push(createdEnr.id);
      const createdInv = await prisma.invoice.findFirst({
        where: { studentId: provisionedStudentId, courseId: prodCourseId },
      });
      if (createdInv) createdInvoiceIds.push(createdInv.id);
    });

    await t.test('2. Phase 4: Production seed & demo course filtering isolation', async () => {
      // seed-demo.ts must refuse to run in production or when ALLOW_DEMO_SEED=false
      let failedInProd = false;
      try {
        await execFileAsync('npx', ['tsx', 'prisma/seed-demo.ts'], {
          env: { ...process.env, NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' },
        });
      } catch {
        failedInProd = true;
      }
      assert.equal(failedInProd, true, 'seed-demo.ts must abort when NODE_ENV=production');

      let failedWhenDisabled = false;
      try {
        await execFileAsync('npx', ['tsx', 'prisma/seed-demo.ts'], {
          env: { ...process.env, NODE_ENV: 'development', ALLOW_DEMO_SEED: 'false' },
        });
      } catch {
        failedWhenDisabled = true;
      }
      assert.equal(failedWhenDisabled, true, 'seed-demo.ts must abort when ALLOW_DEMO_SEED=false');

      let failedWhenMissingPasswords = false;
      try {
        await execFileAsync('npx', ['tsx', 'prisma/seed-demo.ts'], {
          env: {
            ...process.env,
            NODE_ENV: 'development',
            ALLOW_DEMO_SEED: 'true',
            SEED_ADMIN_PASSWORD: '',
            SEED_INSTRUCTOR_PASSWORD: '',
            SEED_STUDENT_PASSWORD: '',
          },
        });
      } catch {
        failedWhenMissingPasswords = true;
      }
      assert.equal(
        failedWhenMissingPasswords,
        true,
        'seed-demo.ts must fail early when SEED_*_PASSWORD variables are missing'
      );

      let failedWhenWeakPassword = false;
      try {
        await execFileAsync('npx', ['tsx', 'prisma/seed-demo.ts'], {
          env: {
            ...process.env,
            NODE_ENV: 'development',
            ALLOW_DEMO_SEED: 'true',
            SEED_ADMIN_PASSWORD: 'weak',
            SEED_INSTRUCTOR_PASSWORD: 'StrongDemoPassword1!',
            SEED_STUDENT_PASSWORD: 'StrongDemoPassword2!',
          },
        });
      } catch {
        failedWhenWeakPassword = true;
      }
      assert.equal(
        failedWhenWeakPassword,
        true,
        'seed-demo.ts must reject weak local development passwords'
      );

      // /api/public/courses and detail endpoint hide isDemo=true courses in production
      process.env.NODE_ENV = 'production';
      const prodCatalog = await apiFetch('/api/public/courses');
      assert.equal(prodCatalog.res.status, 200);
      assert.equal(prodCatalog.json?.isDemoEnvironment, false);
      const prodList = prodCatalog.json?.courses as Array<{ id: string }>;
      assert.ok(prodList.some((c) => c.id === prodCourseId));
      assert.equal(
        prodList.some((c) => c.id === demoCourseId),
        false,
        'Demo courses must be excluded from public catalog in production'
      );
      const prodDemoDetail = await apiFetch(`/api/public/courses/${demoCourseId}`);
      assert.equal(prodDemoDetail.res.status, 404);
      const prodRealDetail = await apiFetch(`/api/public/courses/${prodCourseId}`);
      assert.equal(prodRealDetail.res.status, 200);
      assert.equal(prodRealDetail.json?.isDemoEnvironment, false);

      // /api/public/courses exposes isDemo=true courses with indicator in development
      process.env.NODE_ENV = 'development';
      const devCatalog = await apiFetch('/api/public/courses');
      assert.equal(devCatalog.res.status, 200);
      assert.equal(devCatalog.json?.isDemoEnvironment, true);
      const devList = devCatalog.json?.courses as Array<{ id: string; isDemo?: boolean }>;
      const foundDemo = devList.find((c) => c.id === demoCourseId);
      assert.ok(foundDemo);
      assert.equal(foundDemo.isDemo, true);
      const devDemoDetail = await apiFetch(`/api/public/courses/${demoCourseId}`);
      assert.equal(devDemoDetail.res.status, 200);
      assert.equal(devDemoDetail.json?.isDemoEnvironment, true);
    });

    await t.test('3. Phase 5: Legacy Base64 document migration (confirmation guard, local & S3 round-trip, failure isolation)', async () => {
      const legacyValidId = `doc-leg-ok-${runSuffix}`;
      const legacyBadId = `doc-leg-bad-${runSuffix}`;
      const legacyS3Id = `doc-leg-s3-${runSuffix}`;
      createdDocIds.push(legacyValidId, legacyBadId, legacyS3Id);

      const payloadBytes = Buffer.from(`Legacy DB certificate scan ${runSuffix}`, 'utf8');
      const expectedSha = crypto.createHash('sha256').update(payloadBytes).digest('hex');

      await prisma.fileAsset.createMany({
        data: [
          {
            id: legacyValidId,
            ownerUserId: stuId,
            title: 'Legacy Transcript',
            category: 'Transcript',
            fileName: 'legacy-transcript.txt',
            mimeType: 'text/plain',
            sizeBytes: payloadBytes.length,
            contentBase64: payloadBytes.toString('base64'),
            storageProvider: 'postgres',
            storageKey: null,
            checksumSha256: null,
          },
          {
            id: legacyBadId,
            ownerUserId: stuId,
            title: 'Corrupt Legacy File',
            category: 'Other',
            fileName: 'corrupt.bin',
            mimeType: 'application/octet-stream',
            sizeBytes: 12,
            contentBase64: 'not!valid!base64',
            storageProvider: 'postgres',
            storageKey: null,
            checksumSha256: null,
          },
          {
            id: legacyS3Id,
            ownerUserId: stuId,
            title: 'Legacy S3 Transcript',
            category: 'Transcript',
            fileName: 'legacy-s3.txt',
            mimeType: 'text/plain',
            sizeBytes: payloadBytes.length,
            contentBase64: payloadBytes.toString('base64'),
            storageProvider: 'postgres',
            storageKey: null,
            checksumSha256: null,
          },
        ],
      });

      // Must refuse destructive clearing without confirmClearBase64: true
      await assert.rejects(
        () =>
          migrateLegacyDocuments({
            dryRun: false,
            keepBase64: false,
            recordIds: [legacyValidId],
          }),
        /Refusing destructive Base64 payload clearing/
      );

      const dryReport = await migrateLegacyDocuments({
        dryRun: true,
        recordIds: [legacyValidId, legacyBadId],
      });
      assert.equal(dryReport.dryRun, true);
      assert.equal(dryReport.scanned, 2);
      assert.equal(dryReport.migrated, 1);
      assert.equal(dryReport.failed, 1);

      const unchangedRow = await prisma.fileAsset.findUnique({ where: { id: legacyValidId } });
      assert.equal(unchangedRow?.storageProvider, 'postgres');

      const realReport = await migrateLegacyDocuments({
        dryRun: false,
        confirmClearBase64: true,
        recordIds: [legacyValidId, legacyBadId],
      });
      assert.equal(realReport.dryRun, false);
      assert.equal(realReport.confirmClearBase64, true);
      assert.equal(realReport.migrated, 1);
      assert.equal(realReport.failed, 1);

      const migratedRow = await prisma.fileAsset.findUnique({ where: { id: legacyValidId } });
      assert.ok(migratedRow);
      assert.equal(migratedRow.storageProvider, 'local');
      assert.ok(migratedRow.storageKey);
      assert.equal(migratedRow.contentBase64, '');
      assert.equal(migratedRow.checksumSha256, expectedSha);
      createdStorageFiles.push({
        storageProvider: migratedRow.storageProvider,
        storageKey: migratedRow.storageKey,
      });

      const diskBytes = await readPrivateDocument({
        storageProvider: migratedRow.storageProvider,
        storageKey: migratedRow.storageKey,
        contentBase64: migratedRow.contentBase64,
      });
      assert.equal(diskBytes.toString('utf8'), payloadBytes.toString('utf8'));

      // Verify S3-compatible provider upload, read-back, and legacy migration using local mock S3 endpoint
      const s3Objects = new Map<string, Buffer>();
      const s3MockServer = http.createServer((req, res) => {
        const key = (req.url || '/').split('?')[0];
        if (req.method === 'PUT') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          req.on('end', () => {
            s3Objects.set(key, Buffer.concat(chunks));
            res.statusCode = 200;
            res.end();
          });
          return;
        }
        if (req.method === 'GET') {
          const data = s3Objects.get(key);
          if (!data) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          res.statusCode = 200;
          res.end(data);
          return;
        }
        if (req.method === 'DELETE') {
          s3Objects.delete(key);
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 405;
        res.end();
      });

      await new Promise<void>((resolve) => s3MockServer.listen(0, '127.0.0.1', () => resolve()));
      const s3Addr = s3MockServer.address();
      assert.ok(s3Addr && typeof s3Addr !== 'string');

      const origProvider = process.env.STORAGE_PROVIDER;
      const origEndpoint = process.env.STORAGE_S3_ENDPOINT;
      const origBucket = process.env.STORAGE_S3_BUCKET;
      const origKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
      const origSecret = process.env.STORAGE_S3_SECRET_ACCESS_KEY;

      try {
        process.env.STORAGE_PROVIDER = 's3';
        process.env.STORAGE_S3_ENDPOINT = `http://127.0.0.1:${s3Addr.port}`;
        process.env.STORAGE_S3_BUCKET = 'igs-test-bucket';
        process.env.STORAGE_S3_ACCESS_KEY_ID = 'test-access-key';
        process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'test-secret-key';

        const directS3 = await storePrivateDocument({
          fileName: 's3-direct.txt',
          mimeType: 'text/plain',
          contentBase64: payloadBytes.toString('base64'),
        });
        assert.equal(directS3.storageProvider, 's3');
        const readBackS3 = await readPrivateDocument({
          storageProvider: directS3.storageProvider,
          storageKey: directS3.storageKey,
        });
        assert.equal(readBackS3.toString('utf8'), payloadBytes.toString('utf8'));

        const s3Report = await migrateLegacyDocuments({
          dryRun: false,
          keepBase64: true,
          recordIds: [legacyS3Id],
        });
        assert.equal(s3Report.targetProvider, 's3');
        assert.equal(s3Report.migrated, 1);
        const s3Row = await prisma.fileAsset.findUnique({ where: { id: legacyS3Id } });
        assert.equal(s3Row?.storageProvider, 's3');
        assert.ok(s3Row?.storageKey);
        assert.ok((s3Row?.contentBase64 || '').length > 0, '--keep-base64 must retain Base64');

        // Clearing pass with explicit confirmation verifies existing S3 SHA-256 and clears Base64
        const s3ClearReport = await migrateLegacyDocuments({
          dryRun: false,
          confirmClearBase64: true,
          recordIds: [legacyS3Id],
        });
        assert.equal(s3ClearReport.migrated, 1);
        const s3ClearedRow = await prisma.fileAsset.findUnique({ where: { id: legacyS3Id } });
        assert.equal(s3ClearedRow?.contentBase64, '');
      } finally {
        if (origProvider !== undefined) process.env.STORAGE_PROVIDER = origProvider;
        else delete process.env.STORAGE_PROVIDER;
        if (origEndpoint !== undefined) process.env.STORAGE_S3_ENDPOINT = origEndpoint;
        else delete process.env.STORAGE_S3_ENDPOINT;
        if (origBucket !== undefined) process.env.STORAGE_S3_BUCKET = origBucket;
        else delete process.env.STORAGE_S3_BUCKET;
        if (origKeyId !== undefined) process.env.STORAGE_S3_ACCESS_KEY_ID = origKeyId;
        else delete process.env.STORAGE_S3_ACCESS_KEY_ID;
        if (origSecret !== undefined) process.env.STORAGE_S3_SECRET_ACCESS_KEY = origSecret;
        else delete process.env.STORAGE_S3_SECRET_ACCESS_KEY;
        await new Promise<void>((resolve) => s3MockServer.close(() => resolve()));
      }
    });

    await t.test('4. Phase 6: All 7 transactional email triggers, payload redaction, Skipped fallback & retry exhaustion', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_FROM;

      // (1) Public admission application creates AdmissionApplication ONLY (no user/enrollment) + queues admission email
      const applicantEmail = `public.app.${runSuffix}@infocom.test`;
      const pubAdm = await apiFetch('/api/admissions/public', {
        method: 'POST',
        body: {
          applicantName: `Public Applicant ${runSuffix}`,
          applicantEmail,
          phone: '9800000001',
          targetCourseId: prodCourseId,
          preferredCohort: `Stab Batch ${runSuffix}`,
          status: 'Submitted',
        },
      });
      assert.equal(pubAdm.res.status, 201);
      const admId = String(pubAdm.json?.admissionId);
      createdAdmissionIds.push(admId);
      const userAfterPubAdm = await prisma.user.findUnique({ where: { email: applicantEmail } });
      assert.equal(userAfterPubAdm, null, 'Public admission must never auto-create a user account');

      // (2) Student setup email was queued earlier when admin created provisionedStudentId
      const setupDlog = await prisma.deliveryLog.findFirst({
        where: { userId: provisionedStudentId, channel: 'email' },
      });
      assert.ok(setupDlog, 'Student onboarding should queue an email DeliveryLog');

      // (3) Password reset email via forgot-password
      const forgotRes = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: provisionedStudentEmail },
      });
      assert.equal(forgotRes.res.status, 200);

      // (4) Class reminder + (5) Attendance alert
      const enrollStuRes = await apiFetch('/api/enrollments', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          studentId: stuId,
          courseId: prodCourseId,
          cohortId: batchId,
          cohort: `Stab Batch ${runSuffix}`,
          status: 'Active',
          issueTuitionInvoice: false,
        },
      });
      assert.equal(enrollStuRes.res.status, 201);
      const stuEnr = await prisma.enrollment.findFirst({
        where: { studentId: stuId, courseId: prodCourseId },
      });
      if (stuEnr) createdEnrollmentIds.push(stuEnr.id);

      const startSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const sesRes = await apiFetch('/api/sessions', {
        method: 'POST',
        cookie: instCookie,
        body: {
          courseId: prodCourseId,
          cohortId: batchId,
          cohort: `Stab Batch ${runSuffix}`,
          title: `Upcoming Session ${runSuffix}`,
          topic: 'Email Reminder Trigger',
          room: 'LAB-101',
          startIso: startSoon,
          durationHours: 2,
        },
      });
      assert.equal(sesRes.res.status, 201);
      sessionId = String(sesRes.json?.sessionId);
      createdSessionIds.push(sessionId);
      assert.ok(
        Number(sesRes.json?.remindersCreatedCount) >= 1,
        'Scheduling an imminent session must immediately generate a class reminder'
      );

      // Re-running sweep must remain idempotent via advisory lock + dedupeKey
      const remSweepRes = await apiFetch('/api/notifications/run-reminders', {
        method: 'POST',
        cookie: adminCookie,
      });
      assert.equal(remSweepRes.res.status, 200);
      assert.equal(Number(remSweepRes.json?.createdCount), 0);

      const attRes = await apiFetch('/api/attendance', {
        method: 'POST',
        cookie: instCookie,
        body: {
          sessionId,
          studentId: stuId,
          status: 'Late',
          note: 'Arrived 10m late',
        },
      });
      assert.equal(attRes.res.status, 200);

      // (6) Fee invoice + Overdue Fee Reminder + (7) Payment confirmation
      const invRes = await apiFetch('/api/invoices', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          studentId: stuId,
          courseId: prodCourseId,
          description: `Stab Tuition ${runSuffix}`,
          amountDue: '4500.00',
          dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      assert.equal(invRes.res.status, 201);
      const invId = String(invRes.json?.invoiceId);
      createdInvoiceIds.push(invId);

      const feeRemRes = await apiFetch('/api/invoices/send-reminders', {
        method: 'POST',
        cookie: adminCookie,
        body: { includeUpcomingDays: 3 },
      });
      assert.equal(feeRemRes.res.status, 200);
      assert.ok(Number(feeRemRes.json?.queuedCount) >= 1);

      const payRes = await apiFetch(`/api/invoices/${invId}/payments`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          amount: '4500.00',
          method: 'Cash',
          referenceCode: `CASH-${runSuffix}`,
          notes: 'Full payment',
        },
      });
      assert.equal(payRes.res.status, 201);

      // Process pending email jobs under unconfigured SMTP -> marks Skipped cleanly + redacts tokens
      await processPendingJobs(50);

      const emailLogs = await prisma.deliveryLog.findMany({
        where: {
          channel: 'email',
          OR: [
            { userId: { in: [stuId, provisionedStudentId] } },
            { applicationId: admId },
          ],
        },
      });
      assert.ok(emailLogs.length >= 6, `Expected >=6 email delivery logs across triggers, got ${emailLogs.length}`);
      assert.ok(emailLogs.every((l) => l.status === 'Skipped'), 'Unconfigured SMTP must mark DeliveryLog as Skipped');

      // Verify sensitive token links were redacted in BackgroundJob payload after completion
      const sensitiveJobs = await prisma.backgroundJob.findMany({
        where: {
          jobType: 'notification_email',
          status: 'Completed',
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      const redactedJob = sensitiveJobs.find((j) => {
        const p = j.payload as Record<string, unknown>;
        return p.userId === provisionedStudentId && p.redactSensitive === true;
      });
      assert.ok(redactedJob, 'Expected completed sensitive email job');
      assert.equal(
        (redactedJob.payload as Record<string, unknown>).bodyText,
        '[REDACTED AFTER DELIVERY]'
      );

      // Test successful email delivery logging via email sender override
      setEmailSenderOverride(async () => ({
        status: 'Delivered',
        messageId: `<msg-${runSuffix}@igs.test>`,
        reason: null,
      }));
      const queuedSuccess = await queueTransactionalEmail(prisma, {
        userId: stuId,
        kind: 'finance',
        recipientEmail: stuEmail,
        subject: 'Success Delivery Test',
        bodyText: 'Testing successful SMTP delivery',
      });
      assert.ok(queuedSuccess);
      createdJobIds.push(queuedSuccess.jobId);
      await processPendingJobs(25);
      const deliveredLog = await prisma.deliveryLog.findUnique({
        where: { id: queuedSuccess.deliveryLogId },
      });
      assert.equal(deliveredLog?.status, 'Delivered');
      assert.equal(deliveredLog?.providerMessageId, `<msg-${runSuffix}@igs.test>`);

      // Test retry backoff and final failure logging via email sender override
      setEmailSenderOverride(async () => ({
        status: 'Failed',
        messageId: null,
        reason: 'Simulated transient SMTP 421 error',
      }));

      const queuedFail = await queueTransactionalEmail(prisma, {
        userId: stuId,
        kind: 'finance',
        recipientEmail: stuEmail,
        subject: 'Retry Test',
        bodyText: 'Testing retry',
        maxAttempts: 2,
      });
      assert.ok(queuedFail);
      createdJobIds.push(queuedFail.jobId);

      // Attempt 1 -> should schedule retry (status stays Pending, deliveryLog stays Queued with errorMessage)
      await processPendingJobs(25);
      const jobAfterAttempt1 = await prisma.backgroundJob.findUnique({ where: { id: queuedFail.jobId } });
      assert.equal(jobAfterAttempt1?.status, 'Pending');
      assert.equal(jobAfterAttempt1?.attempts, 1);
      assert.ok(jobAfterAttempt1!.runAfter.getTime() > Date.now());
      const logAfterAttempt1 = await prisma.deliveryLog.findUnique({ where: { id: queuedFail.deliveryLogId } });
      assert.equal(logAfterAttempt1?.status, 'Queued');
      assert.ok(logAfterAttempt1?.errorMessage?.includes('attempt 1/2'));

      // Advance runAfter -> Attempt 2 exhausts retries and marks both job & DeliveryLog Failed
      await prisma.backgroundJob.update({
        where: { id: queuedFail.jobId },
        data: { runAfter: new Date(Date.now() - 1000) },
      });
      await processPendingJobs(25);

      const jobAfterAttempt2 = await prisma.backgroundJob.findUnique({ where: { id: queuedFail.jobId } });
      assert.equal(jobAfterAttempt2?.status, 'Failed');
      assert.equal(jobAfterAttempt2?.attempts, 2);
      const logAfterAttempt2 = await prisma.deliveryLog.findUnique({ where: { id: queuedFail.deliveryLogId } });
      assert.equal(logAfterAttempt2?.status, 'Failed');

      // Test worker atomic claim (concurrent claims never duplicate) + stale lease recovery
      setEmailSenderOverride(async () => ({
        status: 'Delivered',
        messageId: `<lease-${runSuffix}@igs.test>`,
        reason: null,
      }));
      const staleJob = await queueTransactionalEmail(prisma, {
        userId: stuId,
        kind: 'reminder',
        recipientEmail: stuEmail,
        subject: 'Lease Recovery Test',
        bodyText: 'Testing stale lease recovery',
        dedupeKey: `lease-test-${runSuffix}`,
      });
      assert.ok(staleJob);
      createdJobIds.push(staleJob.jobId);

      // Duplicate dedupeKey enqueue returns existing job without creating a duplicate row
      const dedupedJob = await queueTransactionalEmail(prisma, {
        userId: stuId,
        kind: 'reminder',
        recipientEmail: stuEmail,
        subject: 'Lease Recovery Test',
        bodyText: 'Duplicate attempt',
        dedupeKey: `lease-test-${runSuffix}`,
      });
      assert.equal(dedupedJob?.jobId, staleJob.jobId);

      // Simulate crashed worker leaving job in Processing with expired lease
      await prisma.backgroundJob.update({
        where: { id: staleJob.jobId },
        data: {
          status: 'Processing',
          workerId: 'crashed-pod-1',
          lockedAt: new Date(Date.now() - 600_000),
          leaseExpiresAt: new Date(Date.now() - 60_000),
          attempts: 1,
        },
      });
      const recovery = await recoverStaleProcessingJobs();
      assert.ok(recovery.recoveredPending >= 1);
      const recoveredRow = await prisma.backgroundJob.findUnique({ where: { id: staleJob.jobId } });
      assert.equal(recoveredRow?.status, 'Pending');

      // Concurrent claims must claim each job at most once
      const [claimA, claimB] = await Promise.all([
        claimPendingJobs(10, { workerId: 'worker-A' }),
        claimPendingJobs(10, { workerId: 'worker-B' }),
      ]);
      const claimedIds = [...claimA.map((j) => j.id), ...claimB.map((j) => j.id)];
      assert.equal(new Set(claimedIds).size, claimedIds.length, 'Concurrent worker claims must never double-claim a job');

      // Admin email & worker telemetry endpoints
      const stuTel = await apiFetch('/api/admin/email-delivery', { cookie: stuCookie });
      assert.equal(stuTel.res.status, 403);
      const admTel = await apiFetch('/api/admin/email-delivery', { cookie: adminCookie });
      assert.equal(admTel.res.status, 200);
      assert.equal(admTel.json?.smtpConfigured, false);
      const counts = admTel.json?.countsByStatus as Record<string, number>;
      assert.ok(counts.Skipped >= 1 && counts.Failed >= 1 && counts.Delivered >= 1);
      const workerTel = await apiFetch('/api/admin/worker-status', { cookie: adminCookie });
      assert.equal(workerTel.res.status, 200);
      assert.ok((workerTel.json as Record<string, unknown>).countsByStatus);
    });
  } finally {
    setEmailSenderOverride(null);
    process.env.NODE_ENV = origNodeEnv;
    if (origSmtpHost !== undefined) process.env.SMTP_HOST = origSmtpHost;
    else delete process.env.SMTP_HOST;
    if (origSmtpFrom !== undefined) process.env.SMTP_FROM = origSmtpFrom;
    else delete process.env.SMTP_FROM;

    for (const obj of createdStorageFiles) {
      await deletePrivateDocument(obj).catch(() => undefined);
    }

    await prisma.paymentAllocation
      .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
      .catch(() => undefined);
    await prisma.payment
      .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
      .catch(() => undefined);
    await prisma.invoiceItem
      .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
      .catch(() => undefined);
    await prisma.invoice
      .deleteMany({ where: { id: { in: createdInvoiceIds } } })
      .catch(() => undefined);
    await prisma.attendance
      .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
      .catch(() => undefined);
    await prisma.classSession
      .deleteMany({ where: { id: { in: createdSessionIds } } })
      .catch(() => undefined);
    await prisma.enrollmentHistory
      .deleteMany({ where: { enrollmentId: { in: createdEnrollmentIds } } })
      .catch(() => undefined);
    await prisma.enrollment
      .deleteMany({ where: { id: { in: createdEnrollmentIds } } })
      .catch(() => undefined);
    await prisma.admissionStatusHistory
      .deleteMany({ where: { applicationId: { in: createdAdmissionIds } } })
      .catch(() => undefined);
    await prisma.admissionApplication
      .deleteMany({ where: { id: { in: createdAdmissionIds } } })
      .catch(() => undefined);
    await prisma.feeStructure
      .deleteMany({ where: { courseId: { in: createdCourseIds } } })
      .catch(() => undefined);
    await prisma.instructorAssignment
      .deleteMany({ where: { batchId: { in: createdBatchIds } } })
      .catch(() => undefined);
    await prisma.batch
      .deleteMany({ where: { id: { in: createdBatchIds } } })
      .catch(() => undefined);
    await prisma.courseModule
      .deleteMany({ where: { courseId: { in: createdCourseIds } } })
      .catch(() => undefined);
    await prisma.course
      .deleteMany({ where: { id: { in: createdCourseIds } } })
      .catch(() => undefined);
    await prisma.fileAsset
      .deleteMany({ where: { id: { in: createdDocIds } } })
      .catch(() => undefined);
    await prisma.deliveryLog
      .deleteMany({
        where: {
          OR: [
            { userId: { in: createdUserIds } },
            { applicationId: { in: createdAdmissionIds } },
          ],
        },
      })
      .catch(() => undefined);
    await prisma.notification
      .deleteMany({ where: { userId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.backgroundJob
      .deleteMany({ where: { id: { in: createdJobIds } } })
      .catch(() => undefined);
    await prisma.passwordResetToken
      .deleteMany({ where: { userId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.auditLog
      .deleteMany({ where: { actorUserId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.authSession
      .deleteMany({ where: { userId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.userRole
      .deleteMany({ where: { userId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.studentProfile
      .deleteMany({ where: { userId: { in: createdUserIds } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: createdUserIds } } })
      .catch(() => undefined);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
