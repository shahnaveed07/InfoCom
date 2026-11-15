import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import test from 'node:test';
import 'dotenv/config';
import { createApiApp } from './app.ts';
import { SESSION_COOKIE_NAME, hashPassword } from './auth.ts';
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

test('Phase F Academic Operations (Multi-Type Assessments, Bulk Attendance, Excused & Audit) Integration Suite', async (t) => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminId = `adm-pf-${runSuffix}`;
  const adminEmail = `admin.pf.${runSuffix}@infocom.test`;
  const instId = `ins-pf-${runSuffix}`;
  const instEmail = `inst.pf.${runSuffix}@infocom.test`;
  const otherInstId = `ins2-pf-${runSuffix}`;
  const otherInstEmail = `inst2.pf.${runSuffix}@infocom.test`;
  const stu1Id = `stu1-pf-${runSuffix}`;
  const stu1Email = `stu1.pf.${runSuffix}@infocom.test`;
  const stu2Id = `stu2-pf-${runSuffix}`;
  const stu2Email = `stu2.pf.${runSuffix}@infocom.test`;
  const password = 'PhaseFTest!2026';

  const createdUserIds = [adminId, instId, otherInstId, stu1Id, stu2Id];
  const createdCourseIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdEnrollmentIds: string[] = [];

  async function apiFetch(
    path: string,
    opts: { method?: string; cookie?: string; body?: unknown } = {}
  ) {
    const headers: Record<string, string> = {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie
        ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}` }
        : {}),
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
    return { res, text, json };
  }

  let adminCookie = '';
  let instCookie = '';
  let otherInstCookie = '';
  let stu1Cookie = '';
  let courseId = '';
  let moduleId = '';
  let batchId = '';
  let sessionId = '';

  try {
    resetAuthRateLimiters();
    const pwHash = await hashPassword(password);
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'PhaseF Admin',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: instId,
          name: 'PhaseF Instructor',
          email: instEmail,
          role: 'instructor',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: otherInstId,
          name: 'Unassigned Instructor',
          email: otherInstEmail,
          role: 'instructor',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: stu1Id,
          name: 'Student One',
          email: stu1Email,
          role: 'student',
          status: 'active',
          studentCode: `IGS-PF1-${runSuffix.slice(0, 4).toUpperCase()}`,
          passwordHash: pwHash,
        },
        {
          id: stu2Id,
          name: 'Student Two',
          email: stu2Email,
          role: 'student',
          status: 'active',
          studentCode: `IGS-PF2-${runSuffix.slice(0, 4).toUpperCase()}`,
          passwordHash: pwHash,
        },
      ],
    });

    const [lAdmin, lInst, lOtherInst, lStu1] = await Promise.all([
      apiFetch('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: instEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: otherInstEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: stu1Email, password } }),
    ]);
    adminCookie = extractSessionCookie(lAdmin.res);
    instCookie = extractSessionCookie(lInst.res);
    otherInstCookie = extractSessionCookie(lOtherInst.res);
    stu1Cookie = extractSessionCookie(lStu1.res);

    const crsRes = await apiFetch('/api/courses', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `PF-${runSuffix.slice(0, 4).toUpperCase()}`,
        title: `Phase F Operations ${runSuffix}`,
        track: 'Engineering',
        instructorId: instId,
        durationWeeks: 8,
        tuitionFee: '18000.00',
        modules: [{ code: 'M1', title: 'Core Fundamentals', weight: 100, labHours: 16 }],
      },
    });
    assert.equal(crsRes.res.status, 201);
    courseId = String(crsRes.json?.courseId);
    createdCourseIds.push(courseId);

    const courseRow = await prisma.course.findUnique({
      where: { id: courseId },
      include: { modules: true },
    });
    assert.ok(courseRow && courseRow.modules.length === 1);
    moduleId = courseRow.modules[0].id;

    const batchRes = await apiFetch('/api/cohorts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `BPF-${runSuffix.slice(0, 4).toUpperCase()}`,
        name: `PF Cohort ${runSuffix}`,
        courseId,
        instructorId: instId,
        capacity: 20,
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2027-01-31T00:00:00.000Z',
        status: 'Active',
      },
    });
    assert.equal(batchRes.res.status, 201);
    batchId = String(batchRes.json?.cohortId);
    createdBatchIds.push(batchId);

    for (const sId of [stu1Id, stu2Id]) {
      const enrRes = await apiFetch('/api/enrollments', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          studentId: sId,
          courseId,
          cohort: `PF Cohort ${runSuffix}`,
          cohortId: batchId,
          status: 'Active',
          issueTuitionInvoice: false,
        },
      });
      assert.equal(enrRes.res.status, 201);
      const enr = (enrRes.json?.dashboard as { enrollments: Array<{ id: string; studentId: string; courseId: string }> })
        .enrollments.find((e) => e.studentId === sId && e.courseId === courseId);
      if (enr) createdEnrollmentIds.push(enr.id);
    }

    const sesRes = await apiFetch('/api/sessions', {
      method: 'POST',
      cookie: instCookie,
      body: {
        courseId,
        cohortId: batchId,
        cohort: `PF Cohort ${runSuffix}`,
        title: `Lab Session ${runSuffix}`,
        topic: 'Bulk Attendance & Assessment Audit',
        room: 'Lab 301',
        startIso: '2026-11-16T10:00:00.000Z',
        durationHours: 2,
      },
    });
    assert.equal(sesRes.res.status, 201);
    sessionId = String(sesRes.json?.sessionId);
    createdSessionIds.push(sessionId);

    let quizAssessmentId = '';
    let unusedLabId = '';

    await t.test('1. Multi-type assessment CRUD, RBAC enforcement, maxScore validation & deletion guard', async () => {
      // Student & unassigned instructor blocked
      const stuCreate = await apiFetch('/api/assessments', {
        method: 'POST',
        cookie: stu1Cookie,
        body: {
          courseId,
          title: 'Unauthorized Quiz',
          assessmentType: 'Quiz',
          maxScore: 50,
          weight: 20,
        },
      });
      assert.equal(stuCreate.res.status, 403);

      const otherInstCreate = await apiFetch('/api/assessments', {
        method: 'POST',
        cookie: otherInstCookie,
        body: {
          courseId,
          title: 'Wrong Instructor Quiz',
          assessmentType: 'Quiz',
          maxScore: 50,
          weight: 20,
        },
      });
      assert.equal(otherInstCreate.res.status, 403);

      // Assigned instructor creates Quiz + Lab
      const createQuiz = await apiFetch('/api/assessments', {
        method: 'POST',
        cookie: instCookie,
        body: {
          courseId,
          moduleId,
          batchId,
          title: `Week 2 Quiz ${runSuffix}`,
          assessmentType: 'Quiz',
          maxScore: 50,
          weight: 25,
        },
      });
      assert.equal(createQuiz.res.status, 201);
      quizAssessmentId = String(createQuiz.json?.assessmentId);

      const createLab = await apiFetch('/api/assessments', {
        method: 'POST',
        cookie: instCookie,
        body: {
          courseId,
          title: `Unused Lab ${runSuffix}`,
          assessmentType: 'Lab',
          maxScore: 20,
          weight: 10,
        },
      });
      assert.equal(createLab.res.status, 201);
      unusedLabId = String(createLab.json?.assessmentId);

      // Score exceeding maxScore -> 400
      const overMax = await apiFetch(`/api/assessments/${quizAssessmentId}/grades`, {
        method: 'PUT',
        cookie: instCookie,
        body: { studentId: stu1Id, score: 55, feedback: 'Too high' },
      });
      assert.equal(overMax.res.status, 400);

      // Valid score recorded -> 200 & reflected in student dashboard
      const saveQuizGrade = await apiFetch(`/api/assessments/${quizAssessmentId}/grades`, {
        method: 'PUT',
        cookie: instCookie,
        body: { studentId: stu1Id, score: 45, feedback: 'Great quiz work' },
      });
      assert.equal(saveQuizGrade.res.status, 200);

      // Module assessment grade remains separate in grades matrix
      const saveModGrade = await apiFetch('/api/grades', {
        method: 'PUT',
        cookie: instCookie,
        body: { studentId: stu1Id, courseId, moduleId, score: 86, feedback: 'Solid module exam' },
      });
      assert.equal(saveModGrade.res.status, 200);

      // Deleting graded assessment is blocked (409); deleting ungraded Lab succeeds (200)
      const deleteGraded = await apiFetch(`/api/assessments/${quizAssessmentId}`, {
        method: 'DELETE',
        cookie: instCookie,
      });
      assert.equal(deleteGraded.res.status, 409);

      const deleteUnused = await apiFetch(`/api/assessments/${unusedLabId}`, {
        method: 'DELETE',
        cookie: instCookie,
      });
      assert.equal(deleteUnused.res.status, 200);

      // Student dashboard sees both Module Assessment & Quiz grades cleanly without collision
      const stuDash = await apiFetch('/api/dashboard', { cookie: stu1Cookie });
      assert.equal(stuDash.res.status, 200);
      const assessments = stuDash.json?.assessments as Array<{ id: string; assessmentType: string }>;
      const assessmentGrades = stuDash.json?.assessmentGrades as Array<{ assessmentId: string; score: number }>;
      const moduleGrades = stuDash.json?.grades as Array<{ moduleId: string; score: number }>;
      assert.ok(assessments.some((a) => a.id === quizAssessmentId));
      assert.equal(assessmentGrades.find((g) => g.assessmentId === quizAssessmentId)?.score, 45);
      assert.equal(moduleGrades.find((g) => g.moduleId === moduleId)?.score, 86);
    });

    await t.test('2. Bulk attendance marking (incl. Excused), unchanged diff-skip & session audit history', async () => {
      // Unassigned instructor blocked from bulk marking
      const badBulk = await apiFetch('/api/attendance/bulk', {
        method: 'POST',
        cookie: otherInstCookie,
        body: {
          sessionId,
          entries: [{ studentId: stu1Id, status: 'Present', note: '' }],
        },
      });
      assert.equal(badBulk.res.status, 403);

      // Bulk mark stu1 Present, stu2 Excused
      const bulk1 = await apiFetch('/api/attendance/bulk', {
        method: 'POST',
        cookie: instCookie,
        body: {
          sessionId,
          entries: [
            { studentId: stu1Id, status: 'Present', note: 'On time' },
            { studentId: stu2Id, status: 'Excused', note: 'Approved medical note' },
          ],
        },
      });
      assert.equal(bulk1.res.status, 200);
      assert.equal(bulk1.json?.updatedCount, 2);

      // Re-submitting identical entries updates 0 rows (diff-skip)
      const bulkRepeat = await apiFetch('/api/attendance/bulk', {
        method: 'POST',
        cookie: instCookie,
        body: {
          sessionId,
          entries: [
            { studentId: stu1Id, status: 'Present', note: 'On time' },
            { studentId: stu2Id, status: 'Excused', note: 'Approved medical note' },
          ],
        },
      });
      assert.equal(bulkRepeat.res.status, 200);
      assert.equal(bulkRepeat.json?.updatedCount, 0);

      // Change stu1 from Present -> Excused individually
      const singleChange = await apiFetch('/api/attendance', {
        method: 'POST',
        cookie: instCookie,
        body: {
          sessionId,
          studentId: stu1Id,
          status: 'Excused',
          note: 'Official institute hackathon',
        },
      });
      assert.equal(singleChange.res.status, 200);

      // Fetch session attendance audit history
      const histRes = await apiFetch(`/api/attendance/history?sessionId=${encodeURIComponent(sessionId)}`, {
        cookie: instCookie,
      });
      assert.equal(histRes.res.status, 200);
      const entries = histRes.json?.entries as Array<{
        studentId: string;
        previousStatus: string | null;
        newStatus: string;
      }>;
      assert.ok(entries.length >= 3);
      const stu1Latest = entries.find((e) => e.studentId === stu1Id);
      assert.equal(stu1Latest?.previousStatus, 'Present');
      assert.equal(stu1Latest?.newStatus, 'Excused');

      // Student cannot access attendance history endpoint
      const stuHist = await apiFetch(`/api/attendance/history?sessionId=${encodeURIComponent(sessionId)}`, {
        cookie: stu1Cookie,
      });
      assert.equal(stuHist.res.status, 403);
    });
  } finally {
    if (createdSessionIds.length > 0 || createdUserIds.length > 0 || createdCourseIds.length > 0) {
      await prisma.attendance
        .deleteMany({
          where: {
            OR: [
              { sessionId: { in: createdSessionIds } },
              { studentId: { in: createdUserIds } },
              { courseId: { in: createdCourseIds } },
            ],
          },
        })
        .catch(() => undefined);
      await prisma.classSession
        .deleteMany({
          where: {
            OR: [{ id: { in: createdSessionIds } }, { courseId: { in: createdCourseIds } }],
          },
        })
        .catch(() => undefined);
    }

    if (createdCourseIds.length > 0 || createdUserIds.length > 0) {
      await prisma.grade
        .deleteMany({
          where: {
            OR: [{ courseId: { in: createdCourseIds } }, { studentId: { in: createdUserIds } }],
          },
        })
        .catch(() => undefined);
      await prisma.assessment
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.enrollmentHistory
        .deleteMany({
          where: {
            enrollment: {
              OR: [{ id: { in: createdEnrollmentIds } }, { courseId: { in: createdCourseIds } }],
            },
          },
        })
        .catch(() => undefined);
      await prisma.enrollment
        .deleteMany({
          where: {
            OR: [
              { id: { in: createdEnrollmentIds } },
              { courseId: { in: createdCourseIds } },
              { studentId: { in: createdUserIds } },
            ],
          },
        })
        .catch(() => undefined);
    }

    if (createdBatchIds.length > 0) {
      await prisma.instructorAssignment
        .deleteMany({ where: { batchId: { in: createdBatchIds } } })
        .catch(() => undefined);
      await prisma.batch
        .deleteMany({ where: { id: { in: createdBatchIds } } })
        .catch(() => undefined);
    }

    if (createdCourseIds.length > 0) {
      await prisma.feeStructure
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.courseModule
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.course
        .deleteMany({ where: { id: { in: createdCourseIds } } })
        .catch(() => undefined);
    }

    if (createdUserIds.length > 0) {
      await prisma.auditLog
        .deleteMany({ where: { actorUserId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.deliveryLog
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.notification
        .deleteMany({ where: { userId: { in: createdUserIds } } })
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
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
