import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import test from 'node:test';
import 'dotenv/config';
import { createApiApp } from './app.ts';
import {
  SESSION_COOKIE_NAME,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
} from './auth.ts';
import { prisma } from './db/prisma.ts';
import { resetAuthRateLimiters } from './routes/auth.routes.ts';

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

function getSetCookieHeaders(res: Response): string[] {
  return typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
}

test('Phase 3 Security & Authorization Integration Suite', async (t) => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const createdUserIds: string[] = [];
  const createdCourseIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdDocIds: string[] = [];
  const createdCertIds: string[] = [];
  const createdEnrollmentIds: string[] = [];
  const createdClassSessionIds: string[] = [];

  const adminId = `adm-sec-${runSuffix}`;
  const instAId = `ins-sec-a-${runSuffix}`;
  const instBId = `ins-sec-b-${runSuffix}`;
  const stuAId = `stu-sec-a-${runSuffix}`;
  const stuBId = `stu-sec-b-${runSuffix}`;
  const legacyStuId = `stu-sec-leg-${runSuffix}`;

  const courseAId = `crs-sec-a-${runSuffix}`;
  const courseBId = `crs-sec-b-${runSuffix}`;
  const modA1Id = `mod-sec-a1-${runSuffix}`;
  const modB1Id = `mod-sec-b1-${runSuffix}`;
  const enrAId = `enr-sec-a-${runSuffix}`;
  const enrBId = `enr-sec-b-${runSuffix}`;
  const classSesAId = `ses-sec-a-${runSuffix}`;
  const classSesBId = `ses-sec-b-${runSuffix}`;
  const docAId = `doc-sec-a-${runSuffix}`;
  const docBId = `doc-sec-b-${runSuffix}`;
  const certAId = `crt-sec-a-${runSuffix}`;
  const certBId = `crt-sec-b-${runSuffix}`;

  const adminEmail = `admin.sec.${runSuffix}@infocom.test`;
  const instAEmail = `inst.a.${runSuffix}@infocom.test`;
  const instBEmail = `inst.b.${runSuffix}@infocom.test`;
  const stuAEmail = `stu.a.${runSuffix}@infocom.test`;
  const stuBEmail = `stu.b.${runSuffix}@infocom.test`;
  const legacyStuEmail = `stu.legacy.${runSuffix}@infocom.test`;
  const selfRegEmail = `self.reg.${runSuffix}@infocom.test`;
  const password = 'SecTestPass!2026';
  const legacySalt = crypto.randomBytes(16).toString('hex');
  const legacyHash = `${legacySalt}:${crypto.scryptSync(password, legacySalt, 64).toString('hex')}`;

  async function apiFetch(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ) {
    const headers: Record<string, string> = {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}` } : {}),
      ...(opts.headers ?? {}),
    };
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, json, text };
  }

  try {
    resetAuthRateLimiters();
    const argonHash = await hashPassword(password);

    // Provision isolated users & academic fixtures
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Security Admin',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          staffCode: `INF-ADM-${runSuffix}`,
          passwordHash: argonHash,
        },
        {
          id: instAId,
          name: 'Instructor Alpha',
          email: instAEmail,
          role: 'instructor',
          status: 'active',
          staffCode: `INF-IA-${runSuffix}`,
          passwordHash: argonHash,
        },
        {
          id: instBId,
          name: 'Instructor Beta',
          email: instBEmail,
          role: 'instructor',
          status: 'active',
          staffCode: `INF-IB-${runSuffix}`,
          passwordHash: argonHash,
        },
        {
          id: stuAId,
          name: 'Student Alpha',
          email: stuAEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-SA-${runSuffix}`,
          passwordHash: argonHash,
        },
        {
          id: stuBId,
          name: 'Student Beta',
          email: stuBEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-SB-${runSuffix}`,
          passwordHash: argonHash,
        },
        {
          id: legacyStuId,
          name: 'Legacy Scrypt Student',
          email: legacyStuEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-LG-${runSuffix}`,
          passwordHash: legacyHash,
        },
      ],
    });
    createdUserIds.push(adminId, instAId, instBId, stuAId, stuBId, legacyStuId);

    await prisma.course.createMany({
      data: [
        {
          id: courseAId,
          code: `SECA-${runSuffix.toUpperCase()}`,
          title: 'Security Alpha Track',
          track: 'Security',
          description: 'Alpha course',
          instructorId: instAId,
          durationWeeks: 6,
          tuitionFee: '950.00',
        },
        {
          id: courseBId,
          code: `SECB-${runSuffix.toUpperCase()}`,
          title: 'Security Beta Track',
          track: 'Security',
          description: 'Beta course',
          instructorId: instBId,
          durationWeeks: 6,
          tuitionFee: '1150.00',
        },
      ],
    });
    createdCourseIds.push(courseAId, courseBId);

    await prisma.courseModule.createMany({
      data: [
        { id: modA1Id, courseId: courseAId, code: 'MOD-1', title: 'Alpha Mod 1', weight: 100, labHours: 12, sortOrder: 1 },
        { id: modB1Id, courseId: courseBId, code: 'MOD-1', title: 'Beta Mod 1', weight: 100, labHours: 12, sortOrder: 1 },
      ],
    });

    await prisma.enrollment.createMany({
      data: [
        {
          id: enrAId,
          studentId: stuAId,
          courseId: courseAId,
          cohort: 'Cohort Alpha',
          status: 'Active',
          completedModuleIds: [],
        },
        {
          id: enrBId,
          studentId: stuBId,
          courseId: courseBId,
          cohort: 'Cohort Beta',
          status: 'Active',
          completedModuleIds: [],
        },
      ],
    });
    createdEnrollmentIds.push(enrAId, enrBId);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowEnd = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);
    await prisma.classSession.createMany({
      data: [
        {
          id: classSesAId,
          courseId: courseAId,
          cohort: 'Cohort Alpha',
          title: 'Alpha Lab',
          topic: 'Alpha Security Lab',
          room: 'Lab 1',
          instructorId: instAId,
          instructorName: 'Instructor Alpha',
          startIso: tomorrow,
          endIso: tomorrowEnd,
          status: 'Scheduled',
        },
        {
          id: classSesBId,
          courseId: courseBId,
          cohort: 'Cohort Beta',
          title: 'Beta Lab',
          topic: 'Beta Security Lab',
          room: 'Lab 2',
          instructorId: instBId,
          instructorName: 'Instructor Beta',
          startIso: tomorrow,
          endIso: tomorrowEnd,
          status: 'Scheduled',
        },
      ],
    });
    createdClassSessionIds.push(classSesAId, classSesBId);

    await prisma.fileAsset.createMany({
      data: [
        {
          id: docAId,
          ownerUserId: stuAId,
          courseId: courseAId,
          title: 'Student A Assignment',
          category: 'Assignment',
          fileName: 'a.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
          contentBase64: Buffer.from('alpha').toString('base64'),
          uploadedByUserId: stuAId,
        },
        {
          id: docBId,
          ownerUserId: stuBId,
          courseId: courseBId,
          title: 'Student B Receipt',
          category: 'Receipt',
          fileName: 'b.txt',
          mimeType: 'text/plain',
          sizeBytes: 4,
          contentBase64: Buffer.from('beta').toString('base64'),
          uploadedByUserId: adminId,
        },
      ],
    });
    createdDocIds.push(docAId, docBId);

    await prisma.certificate.createMany({
      data: [
        {
          id: certAId,
          certificateCode: `INF-SEC-A-${runSuffix}`,
          verificationHash: crypto.createHash('sha256').update(`cert-a-${runSuffix}`).digest('hex'),
          studentId: stuAId,
          courseId: courseAId,
          enrollmentId: enrAId,
          finalScore: '91.00',
          letterGrade: 'A',
          attendanceRate: 95,
          issuedByUserId: adminId,
          issuedByName: 'Security Admin',
          courseTitleSnapshot: 'Security Alpha Track',
          status: 'Issued',
        },
        {
          id: certBId,
          certificateCode: `INF-SEC-B-${runSuffix}`,
          verificationHash: crypto.createHash('sha256').update(`cert-b-${runSuffix}`).digest('hex'),
          studentId: stuBId,
          courseId: courseBId,
          enrollmentId: enrBId,
          finalScore: '88.00',
          letterGrade: 'B+',
          attendanceRate: 92,
          issuedByUserId: adminId,
          issuedByName: 'Security Admin',
          courseTitleSnapshot: 'Security Beta Track',
          status: 'Issued',
        },
      ],
    });
    createdCertIds.push(certAId, certBId);

    let adminCookie = '';
    let instACookie = '';
    let stuACookie = '';
    let stuBCookie = '';

    await t.test('1. Security headers omit X-Frame-Options and include X-Content-Type-Options', async () => {
      const { res } = await apiFetch('/api/auth/me');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), null);
      assert.ok(res.headers.get('permissions-policy'));
    });

    await t.test('2. Unauthenticated access to protected endpoints is rejected (401)', async () => {
      const checks = await Promise.all([
        apiFetch('/api/dashboard'),
        apiFetch('/api/enrollments'),
        apiFetch('/api/audit-logs'),
        apiFetch('/api/payments'),
        apiFetch(`/api/students/${stuAId}`),
        apiFetch(`/api/courses/${courseAId}`),
        apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: { currentPassword: password, newPassword: 'NewPassword!2026' },
        }),
      ]);
      for (const c of checks) {
        assert.equal(c.res.status, 401);
      }
    });

    await t.test('3. Privilege escalation via public registration is strictly blocked (403)', async () => {
      const adminAttempt = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Rogue Admin',
          email: `rogue.adm.${runSuffix}@infocom.test`,
          password,
          role: 'admin',
        },
      });
      assert.equal(adminAttempt.res.status, 403);

      const instAttempt = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Rogue Instructor',
          email: `rogue.ins.${runSuffix}@infocom.test`,
          password,
          role: 'instructor',
        },
      });
      assert.equal(instAttempt.res.status, 403);

      // Valid public registration creates ONLY a student account with HttpOnly cookie
      const studentOk = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Public Learner',
          email: selfRegEmail,
          password,
        },
      });
      assert.equal(studentOk.res.status, 201);
      assert.equal((studentOk.json?.user as { role: string }).role, 'student');
      const regUserId = (studentOk.json?.user as { id: string }).id;
      createdUserIds.push(regUserId);

      const cookies = getSetCookieHeaders(studentOk.res);
      assert.ok(cookies.some((c) => c.includes('HttpOnly') && c.includes('SameSite=Lax') && c.includes('Path=/')));
    });

    await t.test('4. Login sets opaque session cookie hashed in DB and upgrades legacy scrypt to Argon2id', async () => {
      // Login admin, instA, stuA, stuB
      const admRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: adminEmail, password },
      });
      assert.equal(admRes.res.status, 200);
      adminCookie = extractSessionCookie(admRes.res);
      assert.ok(adminCookie.length >= 40);

      // Verify raw cookie token is NOT stored in DB, only its SHA-256 hash
      const dbSession = await prisma.authSession.findUnique({
        where: { tokenHash: hashSessionToken(adminCookie) },
      });
      assert.ok(dbSession);
      assert.equal(dbSession.userId, adminId);
      assert.notEqual(dbSession.tokenHash, adminCookie);

      const instARes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: instAEmail, password },
      });
      assert.equal(instARes.res.status, 200);
      instACookie = extractSessionCookie(instARes.res);

      const stuARes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: stuAEmail, password },
      });
      assert.equal(stuARes.res.status, 200);
      stuACookie = extractSessionCookie(stuARes.res);

      const stuBRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: stuBEmail, password },
      });
      assert.equal(stuBRes.res.status, 200);
      stuBCookie = extractSessionCookie(stuBRes.res);

      // Legacy scrypt student upgrades automatically to Argon2id upon successful login
      const legRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: legacyStuEmail, password },
      });
      assert.equal(legRes.res.status, 200);
      const upgradedUser = await prisma.user.findUnique({ where: { id: legacyStuId } });
      assert.ok(upgradedUser?.passwordHash?.startsWith('$argon2id$'));
    });

    await t.test('5. Student attempting instructor/admin operations is rejected (403)', async () => {
      const checks = await Promise.all([
        apiFetch('/api/users', {
          method: 'POST',
          cookie: stuACookie,
          body: { name: 'X', email: 'x@test.edu', role: 'student', password },
        }),
        apiFetch('/api/audit-logs', { cookie: stuACookie }),
        apiFetch('/api/enrollments', { cookie: stuACookie }),
        apiFetch('/api/courses', {
          method: 'POST',
          cookie: stuACookie,
          body: {
            code: 'HACK-101',
            title: 'Hack',
            track: 'Hack',
            description: 'Hack',
            instructorId: instAId,
            durationWeeks: 4,
            tuitionFee: '100.00',
            modules: [{ code: 'M1', title: 'M1', weight: 100, labHours: 5 }],
          },
        }),
        apiFetch('/api/grades', {
          method: 'PUT',
          cookie: stuACookie,
          body: {
            studentId: stuAId,
            courseId: courseAId,
            moduleId: modA1Id,
            score: 100,
            feedback: 'Self graded',
          },
        }),
        apiFetch('/api/attendance', {
          method: 'POST',
          cookie: stuACookie,
          body: {
            sessionId: classSesAId,
            studentId: stuAId,
            status: 'Present',
            note: 'Self marked',
          },
        }),
        apiFetch('/api/certificates', {
          method: 'POST',
          cookie: stuACookie,
          body: { studentId: stuAId, courseId: courseAId },
        }),
      ]);
      for (const c of checks) {
        assert.equal(c.res.status, 403);
      }
    });

    await t.test('6. Instructor attempting admin or financial operations is rejected (403)', async () => {
      const checks = await Promise.all([
        apiFetch('/api/audit-logs', { cookie: instACookie }),
        apiFetch('/api/payments', { cookie: instACookie }),
        apiFetch(`/api/students/${stuAId}/finance`, { cookie: instACookie }),
        apiFetch('/api/users', {
          method: 'POST',
          cookie: instACookie,
          body: { name: 'Y', email: 'y@test.edu', role: 'student', password },
        }),
        apiFetch('/api/invoices', {
          method: 'POST',
          cookie: instACookie,
          body: {
            studentId: stuAId,
            courseId: courseAId,
            description: 'Tuition',
            amountDue: '500.00',
            dueDate: new Date().toISOString(),
          },
        }),
        apiFetch('/api/courses', {
          method: 'POST',
          cookie: instACookie,
          body: {
            code: `UNAUTH-${runSuffix}`,
            title: 'Unauthorized Course',
            track: 'Test',
            description: 'Test',
            instructorId: instAId,
            durationWeeks: 4,
            tuitionFee: '500.00',
            modules: [{ code: 'M1', title: 'M1', weight: 100, labHours: 5 }],
          },
        }),
        apiFetch('/api/enrollments', {
          method: 'POST',
          cookie: instACookie,
          body: {
            studentId: stuAId,
            courseId: courseAId,
            cohort: 'Cohort Alpha',
            status: 'Active',
            issueTuitionInvoice: true,
          },
        }),
        apiFetch('/api/documents', {
          method: 'POST',
          cookie: instACookie,
          body: {
            ownerUserId: stuAId,
            courseId: courseAId,
            title: 'Fake Receipt',
            category: 'Receipt',
            fileName: 'r.txt',
            mimeType: 'text/plain',
            contentBase64: Buffer.from('receipt').toString('base64'),
          },
        }),
      ]);
      for (const c of checks) {
        assert.equal(c.res.status, 403);
      }
    });

    await t.test('7. Cross-student IDOR and unauthorized course access are blocked (403)', async () => {
      // Student A accessing Student B records
      const studentIdor = await Promise.all([
        apiFetch(`/api/students/${stuBId}`, { cookie: stuACookie }),
        apiFetch(`/api/students/${stuBId}/finance`, { cookie: stuACookie }),
        apiFetch(`/api/payments?studentId=${stuBId}`, { cookie: stuACookie }),
        apiFetch(`/api/certificates/${certBId}/download`, { cookie: stuACookie }),
        apiFetch(`/api/documents/${docBId}/download`, { cookie: stuACookie }),
        apiFetch(`/api/courses/${courseBId}`, { cookie: stuACookie }),
      ]);
      for (const c of studentIdor) {
        assert.equal(c.res.status, 403);
      }

      // Student A CAN access own student record, own course, own cert, own doc
      const ownStudent = await apiFetch(`/api/students/${stuAId}`, { cookie: stuACookie });
      assert.equal(ownStudent.res.status, 200);
      const ownCert = await apiFetch(`/api/certificates/${certAId}/download`, { cookie: stuACookie });
      assert.equal(ownCert.res.status, 200);

      // Instructor A accessing unassigned Course B & Student B
      const instUnassigned = await Promise.all([
        apiFetch(`/api/courses/${courseBId}`, { cookie: instACookie }),
        apiFetch(`/api/students/${stuBId}`, { cookie: instACookie }),
        apiFetch(`/api/enrollments?courseId=${courseBId}`, { cookie: instACookie }),
        apiFetch(`/api/enrollments?studentId=${stuBId}`, { cookie: instACookie }),
        apiFetch(`/api/enrollments/${enrBId}`, {
          method: 'PATCH',
          cookie: instACookie,
          body: { status: 'Completed' },
        }),
        apiFetch('/api/grades', {
          method: 'PUT',
          cookie: instACookie,
          body: {
            studentId: stuBId,
            courseId: courseBId,
            moduleId: modB1Id,
            score: 88,
            feedback: 'Unauthorized course grade',
          },
        }),
        apiFetch('/api/sessions', {
          method: 'POST',
          cookie: instACookie,
          body: {
            courseId: courseBId,
            cohort: 'Cohort Beta',
            title: 'Rogue Session',
            topic: 'Rogue',
            room: 'Lab 9',
            startIso: tomorrow.toISOString(),
            durationHours: 2,
          },
        }),
        apiFetch('/api/attendance', {
          method: 'POST',
          cookie: instACookie,
          body: {
            sessionId: classSesBId,
            studentId: stuBId,
            status: 'Present',
            note: 'Rogue attendance',
          },
        }),
        apiFetch(`/api/certificates/${certBId}/download`, { cookie: instACookie }),
        apiFetch(`/api/documents/${docBId}/download`, { cookie: instACookie }),
      ]);
      for (const c of instUnassigned) {
        assert.equal(c.res.status, 403);
      }

      // Instructor A CAN access assigned Course A and Student A
      const instOwnCourse = await apiFetch(`/api/courses/${courseAId}`, { cookie: instACookie });
      assert.equal(instOwnCourse.res.status, 200);
      const instOwnStudent = await apiFetch(`/api/students/${stuAId}`, { cookie: instACookie });
      assert.equal(instOwnStudent.res.status, 200);
    });

    await t.test('8. CSRF attacks with cross-origin, null origin, or cross-site Fetch metadata are blocked (403)', async () => {
      const badOrigin = await apiFetch('/api/notifications/read-all', {
        method: 'POST',
        cookie: stuACookie,
        headers: { Origin: 'https://attacker.example' },
      });
      assert.equal(badOrigin.res.status, 403);

      const nullOrigin = await apiFetch('/api/notifications/read-all', {
        method: 'POST',
        cookie: stuACookie,
        headers: { Origin: 'null' },
      });
      assert.equal(nullOrigin.res.status, 403);

      const crossSiteFetch = await apiFetch('/api/notifications/read-all', {
        method: 'POST',
        cookie: stuACookie,
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      assert.equal(crossSiteFetch.res.status, 403);
    });

    await t.test('9. Session replay after logout and expired DB sessions are rejected (401)', async () => {
      const logoutRes = await apiFetch('/api/auth/logout', {
        method: 'POST',
        cookie: stuBCookie,
      });
      assert.equal(logoutRes.res.status, 200);

      const replayAfterLogout = await apiFetch('/api/dashboard', {
        cookie: stuBCookie,
      });
      assert.equal(replayAfterLogout.res.status, 401);

      // Insert an already-expired opaque session directly in PostgreSQL
      const expiredRaw = `expired-${crypto.randomBytes(24).toString('base64url')}`;
      const expiredSessionId = `ses-exp-${runSuffix}`;
      await prisma.authSession.create({
        data: {
          id: expiredSessionId,
          userId: stuBId,
          roleCode: 'student',
          tokenHash: hashSessionToken(expiredRaw),
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      createdSessionIds.push(expiredSessionId);

      const expiredCheck = await apiFetch('/api/dashboard', {
        cookie: expiredRaw,
      });
      assert.equal(expiredCheck.res.status, 401);
    });

    await t.test('10. Account suspension revokes active sessions and blocks future login (401/403)', async () => {
      // Suspend stuA as admin
      const suspendRes = await apiFetch(`/api/users/${stuAId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'suspended' },
      });
      assert.equal(suspendRes.res.status, 200);

      // stuA's previously issued cookie is immediately rejected (401)
      const suspendedSessionCheck = await apiFetch('/api/dashboard', {
        cookie: stuACookie,
      });
      assert.equal(suspendedSessionCheck.res.status, 401);

      // Suspended user cannot sign in again (403)
      const suspendedLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: stuAEmail, password },
      });
      assert.equal(suspendedLogin.res.status, 403);

      // Re-activate stuA for cleanup/completion check
      const reactivateRes = await apiFetch(`/api/users/${stuAId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'active' },
      });
      assert.equal(reactivateRes.res.status, 200);
    });

    await t.test('11. Password change, forgot-password, reset-password, and brute-force rate limiting (429)', async () => {
      // Login as stuB cleanly
      const stuBLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: stuBEmail, password },
      });
      assert.equal(stuBLogin.res.status, 200);
      const freshStuBCookie = extractSessionCookie(stuBLogin.res);

      // Change password with wrong current password -> 401
      const wrongChange = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        cookie: freshStuBCookie,
        body: { currentPassword: 'WrongCurrent!2026', newPassword: 'ChangedPass!2026' },
      });
      assert.equal(wrongChange.res.status, 401);

      // Change password validly -> 200
      const updatedPass = 'ChangedPass!2026';
      const okChange = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        cookie: freshStuBCookie,
        body: { currentPassword: password, newPassword: updatedPass },
      });
      assert.equal(okChange.res.status, 200);

      // Forgot-password always returns generic 200 for existing and non-existing accounts
      const forgotExisting = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: stuBEmail },
      });
      assert.equal(forgotExisting.res.status, 200);

      const forgotMissing = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: `nonexistent.${runSuffix}@infocom.test` },
      });
      assert.equal(forgotMissing.res.status, 200);

      // Issue a deterministic password reset token to test single-use consumption + session revocation
      const rawResetToken = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          id: `prt-test-${runSuffix}`,
          userId: stuBId,
          tokenHash: hashPasswordResetToken(rawResetToken),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      const resetDone = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: rawResetToken, newPassword: 'FinalResetPass!2026' },
      });
      assert.equal(resetDone.res.status, 200);

      // Re-using the same reset token must fail (400)
      const resetReplay = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: rawResetToken, newPassword: 'AnotherPass!2026' },
      });
      assert.equal(resetReplay.res.status, 400);

      // Active session before password reset must be revoked (401)
      const postResetSession = await apiFetch('/api/dashboard', {
        cookie: freshStuBCookie,
      });
      assert.equal(postResetSession.res.status, 401);

      // Brute-force login rate limiter triggers 429 after max attempts
      resetAuthRateLimiters();
      const bruteEmail = `brute.${runSuffix}@infocom.test`;
      let hit429 = false;
      for (let i = 0; i < 12; i += 1) {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: { email: bruteEmail, password: 'WrongPassword!123' },
        });
        if (res.res.status === 429) {
          hit429 = true;
          assert.ok(res.res.headers.get('retry-after'));
          break;
        }
      }
      assert.equal(hit429, true);
      resetAuthRateLimiters();
    });

    await t.test('12. Onboarding setup tokens, mustChangePassword gate, and admin reset-token endpoint', async () => {
      resetAuthRateLimiters();
      // 1) Create user via invite mode (no password) -> issues single-use onboardingToken + sets mustChangePassword=true
      const inviteEmail = `invite.${runSuffix}@infocom.test`;
      const inviteRes = await apiFetch('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: 'Invited Learner',
          email: inviteEmail,
          role: 'student',
        },
      });
      assert.equal(inviteRes.res.status, 201);
      const inviteBody = inviteRes.json as {
        user: { id: string; mustChangePassword?: boolean };
        onboardingToken?: string;
        onboardingPath?: string;
      };
      assert.ok(inviteBody.user.id);
      createdUserIds.push(inviteBody.user.id);
      assert.equal(inviteBody.user.mustChangePassword, true);
      assert.ok(inviteBody.onboardingToken && inviteBody.onboardingToken.length >= 20);
      assert.ok(inviteBody.onboardingPath?.startsWith('/?setupToken='));

      // Consuming onboarding token sets password, clears mustChangePassword, and enables login
      const invitedPass = 'InvitedPass!2026';
      const setupConsume = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: inviteBody.onboardingToken, newPassword: invitedPass },
      });
      assert.equal(setupConsume.res.status, 200);

      const invitedLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: inviteEmail, password: invitedPass },
      });
      assert.equal(invitedLogin.res.status, 200);
      assert.equal((invitedLogin.json?.user as { mustChangePassword?: boolean }).mustChangePassword, false);

      // 2) Create user with temporary password + requirePasswordChange: true -> blocks /api/dashboard until changed
      const tempEmail = `temppw.${runSuffix}@infocom.test`;
      const tempPass = 'TempPass!2026';
      const tempCreate = await apiFetch('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: 'Temp Password User',
          email: tempEmail,
          role: 'student',
          password: tempPass,
          requirePasswordChange: true,
        },
      });
      assert.equal(tempCreate.res.status, 201);
      const tempUserId = (tempCreate.json?.user as { id: string }).id;
      createdUserIds.push(tempUserId);

      const tempLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: tempEmail, password: tempPass },
      });
      assert.equal(tempLogin.res.status, 200);
      assert.equal((tempLogin.json?.user as { mustChangePassword?: boolean }).mustChangePassword, true);
      const tempCookie = extractSessionCookie(tempLogin.res);

      // Dashboard is blocked with 403 PASSWORD_CHANGE_REQUIRED while mustChangePassword is true
      const blockedDash = await apiFetch('/api/dashboard', { cookie: tempCookie });
      assert.equal(blockedDash.res.status, 403);
      assert.equal(blockedDash.json?.code, 'PASSWORD_CHANGE_REQUIRED');

      // /api/auth/me remains accessible and returns mustChangePassword: true
      const meDuringGate = await apiFetch('/api/auth/me', { cookie: tempCookie });
      assert.equal(meDuringGate.res.status, 200);
      assert.equal((meDuringGate.json?.user as { mustChangePassword?: boolean }).mustChangePassword, true);

      // Changing password clears mustChangePassword and unlocks /api/dashboard
      const newTempPass = 'PermanentPass!2026';
      const changeRes = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        cookie: tempCookie,
        body: { currentPassword: tempPass, newPassword: newTempPass },
      });
      assert.equal(changeRes.res.status, 200);
      assert.equal((changeRes.json?.user as { mustChangePassword?: boolean }).mustChangePassword, false);

      const unblockedDash = await apiFetch('/api/dashboard', { cookie: tempCookie });
      assert.equal(unblockedDash.res.status, 200);

      // 3) Admin-only POST /api/users/:id/reset-token
      const nonAdminAttempt = await apiFetch(`/api/users/${tempUserId}/reset-token`, {
        method: 'POST',
        cookie: instACookie,
      });
      assert.equal(nonAdminAttempt.res.status, 403);

      const adminResetToken = await apiFetch(`/api/users/${tempUserId}/reset-token`, {
        method: 'POST',
        cookie: adminCookie,
      });
      assert.equal(adminResetToken.res.status, 200);
      const resetBody = adminResetToken.json as { onboardingToken: string; onboardingPath: string };
      assert.ok(resetBody.onboardingToken.length >= 20);

      const resetApply = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetBody.onboardingToken, newPassword: 'ReissuedPass!2026' },
      });
      assert.equal(resetApply.res.status, 200);
    });
  } finally {
    resetAuthRateLimiters();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Clean up test fixtures cleanly without touching seeded or migrated records
    await prisma.certificate.deleteMany({ where: { id: { in: createdCertIds } } }).catch(() => undefined);
    await prisma.fileAsset.deleteMany({
      where: {
        OR: [
          { id: { in: createdDocIds } },
          { ownerUserId: { in: createdUserIds } },
        ],
      },
    }).catch(() => undefined);
    await prisma.classSession.deleteMany({ where: { id: { in: createdClassSessionIds } } }).catch(() => undefined);
    await prisma.deliveryLog.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.enrollment.deleteMany({
      where: {
        OR: [
          { id: { in: createdEnrollmentIds } },
          { studentId: { in: createdUserIds } },
        ],
      },
    }).catch(() => undefined);
    await prisma.courseModule.deleteMany({ where: { courseId: { in: createdCourseIds } } }).catch(() => undefined);
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } }).catch(() => undefined);
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.authSession.deleteMany({
      where: {
        OR: [
          { id: { in: createdSessionIds } },
          { userId: { in: createdUserIds } },
        ],
      },
    }).catch(() => undefined);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: createdUserIds } },
          { actorEmail: { contains: runSuffix } },
        ],
      },
    }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);
  }
});
