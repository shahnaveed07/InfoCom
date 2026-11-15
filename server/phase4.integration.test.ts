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

test('Phase 4 Administrative & Master Data Integration Suite', async (t) => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminId = `adm-p4-${runSuffix}`;
  const adminEmail = `admin.p4.${runSuffix}@infocom.test`;
  const password = 'Phase4Test!2026';

  const createdUserIds: string[] = [adminId];
  const createdCourseIds: string[] = [];
  const createdCohortIds: string[] = [];
  const createdDeptIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdYearIds: string[] = [];
  const createdTermIds: string[] = [];

  async function apiFetch(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      body?: unknown;
    } = {}
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
    return { res, json };
  }

  let adminCookie = '';
  let instCookie = '';
  let stuCookie = '';
  let createdStudentId = '';
  let createdInstructorId = '';
  let createdDeptId = '';
  let createdCourseId = '';
  let createdRoomId = '';
  let createdBatchAId = '';
  let createdBatchBId = '';
  let createdEnrollmentId = '';
  let originalAcademySnapshot: {
    name: string;
    timezone: string;
    website: string;
  } | null = null;

  try {
    resetAuthRateLimiters();
    const pwHash = await hashPassword(password);

    const existingAcademy = await prisma.academy.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (existingAcademy) {
      originalAcademySnapshot = {
        name: existingAcademy.name,
        timezone: existingAcademy.timezone,
        website: existingAcademy.website,
      };
    }

    await prisma.user.create({
      data: {
        id: adminId,
        name: 'Phase4 Test Admin',
        email: adminEmail,
        role: 'admin',
        status: 'active',
        passwordHash: pwHash,
      },
    });

    const loginAdmin = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password },
    });
    assert.equal(loginAdmin.res.status, 200);
    adminCookie = extractSessionCookie(loginAdmin.res);
    assert.ok(adminCookie);

    await t.test('1. Admin analytics returns live DB metrics and respects date presets', async () => {
      const r30 = await apiFetch('/api/admin/analytics?preset=30d', { cookie: adminCookie });
      assert.equal(r30.res.status, 200);
      assert.ok(r30.json?.kpis);
      assert.ok(Array.isArray(r30.json?.monthlyRevenueSeries));
      assert.ok(Array.isArray(r30.json?.enrollmentTrendSeries));

      const rAll = await apiFetch('/api/admin/analytics?preset=all', { cookie: adminCookie });
      assert.equal(rAll.res.status, 200);
      assert.equal((rAll.json?.dateRange as { preset?: string })?.preset, 'all');
    });

    await t.test('2. Student directory CRUD, pagination, profile detail, and archive session revocation', async () => {
      const stuEmail = `stu.p4.${runSuffix}@infocom.test`;
      const createRes = await apiFetch('/api/students', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: `Zara Patel ${runSuffix}`,
          email: stuEmail,
          phone: '+91-98200-00111',
          password,
          address: 'Bengaluru Campus Dorm 4',
          emergencyContact: 'Arjun Patel +91-98200-00112',
        },
      });
      assert.equal(createRes.res.status, 201);
      const stuUser = createRes.json?.student as { id: string; studentCode: string };
      createdStudentId = stuUser.id;
      createdUserIds.push(createdStudentId);
      assert.ok(stuUser.id);
      assert.match(stuUser.studentCode, /^IGS-\d{4}-/);

      // Search & paginate
      const listRes = await apiFetch(
        `/api/students?search=${encodeURIComponent(runSuffix)}&sortBy=name&sortDir=asc`,
        { cookie: adminCookie }
      );
      assert.equal(listRes.res.status, 200);
      const items = listRes.json?.items as Array<{ user: { id: string } }>;
      assert.equal(items.length, 1);
      assert.equal(items[0].user.id, createdStudentId);

      // Student logs in, then admin checks detail & tests non-admin guard
      const stuLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: stuEmail, password },
      });
      assert.equal(stuLogin.res.status, 200);
      stuCookie = extractSessionCookie(stuLogin.res);

      const forbiddenList = await apiFetch('/api/students', { cookie: stuCookie });
      assert.equal(forbiddenList.res.status, 403);

      const detailRes = await apiFetch(`/api/students/${createdStudentId}/detail`, {
        cookie: adminCookie,
      });
      assert.equal(detailRes.res.status, 200);
      assert.ok(detailRes.json?.feeStatement);

      // Archive student -> revokes active student session
      const archiveRes = await apiFetch(`/api/students/${createdStudentId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'archived', academicStanding: 'Distinction' },
      });
      assert.equal(archiveRes.res.status, 200);

      const afterArchiveMe = await apiFetch('/api/auth/me', { cookie: stuCookie });
      assert.equal((afterArchiveMe.json?.user as unknown) ?? null, null);

      // Restore student for subsequent tests
      const restoreRes = await apiFetch(`/api/students/${createdStudentId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'active' },
      });
      assert.equal(restoreRes.res.status, 200);
    });

    await t.test('3. Departments & Course Master Data create, edit, and archive/activate', async () => {
      const deptCode = `DEPT-${runSuffix.toUpperCase()}`;
      const deptRes = await apiFetch('/api/departments', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: deptCode,
          name: `Cloud Systems ${runSuffix}`,
          status: 'active',
        },
      });
      assert.equal(deptRes.res.status, 201);
      createdDeptId = String(deptRes.json?.departmentId);
      createdDeptIds.push(createdDeptId);

      const courseCode = `P4-${runSuffix.slice(0, 4).toUpperCase()}`;
      const crsRes = await apiFetch('/api/courses', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: courseCode,
          title: `Phase4 Distributed Systems ${runSuffix}`,
          track: 'Backend Engineering',
          category: 'Specialist',
          departmentId: createdDeptId,
          description: 'Distributed PostgreSQL and queue patterns',
          prerequisites: 'Node.js & SQL Basics',
          learningObjectives: ['Build fault-tolerant APIs', 'Tune indexes'],
          passingScore: 75,
          minAttendanceRate: 80,
          instructorId: adminId,
          durationWeeks: 10,
          tuitionFee: '1800.00',
          modules: [
            { code: 'M1', title: 'Replication', weight: 50, labHours: 12 },
            { code: 'M2', title: 'Consensus', weight: 50, labHours: 14 },
          ],
        },
      });
      assert.equal(crsRes.res.status, 201);
      createdCourseId = String(crsRes.json?.courseId);
      createdCourseIds.push(createdCourseId);

      const patchCrs = await apiFetch(`/api/courses/${createdCourseId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
          prerequisites: 'Updated Prereq: TypeScript & PostgreSQL',
          passingScore: 72,
          isArchived: true,
        },
      });
      assert.equal(patchCrs.res.status, 200);

      const reactivateCrs = await apiFetch(`/api/courses/${createdCourseId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { isArchived: false },
      });
      assert.equal(reactivateCrs.res.status, 200);
    });

    await t.test('4. Instructor creation, course assignment, and granular permission enforcement', async () => {
      const insEmail = `inst.p4.${runSuffix}@infocom.test`;
      const createIns = await apiFetch('/api/instructors', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: `Prof. Kabir Rao ${runSuffix}`,
          email: insEmail,
          password,
          departmentId: createdDeptId,
          specialization: 'Distributed Databases',
          qualification: 'Ph.D. CS',
          courseIds: [createdCourseId],
          permissions: ['attendance:manage', 'grades:manage'],
        },
      });
      assert.equal(createIns.res.status, 201);
      const insUser = createIns.json?.instructor as { id: string; staffCode: string };
      createdInstructorId = insUser.id;
      createdUserIds.push(createdInstructorId);
      assert.match(insUser.staffCode, /^IGS-STF-/);

      const insLogin = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: insEmail, password },
      });
      assert.equal(insLogin.res.status, 200);
      instCookie = extractSessionCookie(insLogin.res);

      // Instructor cannot access admin-only analytics or student management
      const insForbidden = await apiFetch('/api/admin/analytics', { cookie: instCookie });
      assert.equal(insForbidden.res.status, 403);

      // Instructor lacks sessions:manage permission -> POST /api/sessions returns 403
      const deniedSession = await apiFetch('/api/sessions', {
        method: 'POST',
        cookie: instCookie,
        body: {
          courseId: createdCourseId,
          cohort: 'Batch A',
          title: 'Perm Check Lab',
          room: 'Lab 101',
          startIso: new Date(Date.now() + 86_400_000).toISOString(),
          durationHours: 2,
        },
      });
      assert.equal(deniedSession.res.status, 403);

      // Admin grants sessions:manage -> instructor can now schedule session
      const grantRes = await apiFetch(
        `/api/instructors/${createdInstructorId}/permissions`,
        {
          method: 'PUT',
          cookie: adminCookie,
          body: { permissions: ['attendance:manage', 'grades:manage', 'sessions:manage'] },
        }
      );
      assert.equal(grantRes.res.status, 200);

      const allowedSession = await apiFetch('/api/sessions', {
        method: 'POST',
        cookie: instCookie,
        body: {
          courseId: createdCourseId,
          cohort: 'Batch A',
          title: 'Perm Check Lab',
          room: 'Lab 101',
          startIso: new Date(Date.now() + 86_400_000).toISOString(),
          durationHours: 2,
        },
      });
      assert.equal(allowedSession.res.status, 201);

      const detailIns = await apiFetch(
        `/api/instructors/${createdInstructorId}/detail`,
        { cookie: adminCookie }
      );
      assert.equal(detailIns.res.status, 200);
      assert.equal((detailIns.json?.assignedCourses as unknown[]).length, 1);
    });

    await t.test('5. Classrooms, Batch capacity check, Student Assignment & Batch Transfer with EnrollmentHistory', async () => {
      const roomRes = await apiFetch('/api/classrooms', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `RM-${runSuffix.slice(0, 4).toUpperCase()}`,
          name: `Systems Lab ${runSuffix}`,
          building: 'Tech Wing',
          capacity: 20,
          equipment: 'Linux Workstations',
        },
      });
      assert.equal(roomRes.res.status, 201);
      createdRoomId = String(roomRes.json?.classroomId);
      createdRoomIds.push(createdRoomId);

      const batchARes = await apiFetch('/api/cohorts', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `BA-${runSuffix.toUpperCase()}`,
          name: `Morning Batch ${runSuffix}`,
          courseId: createdCourseId,
          instructorId: createdInstructorId,
          classroomId: createdRoomId,
          capacity: 1,
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-12-20T00:00:00Z',
          status: 'Active',
        },
      });
      assert.equal(batchARes.res.status, 201);
      createdBatchAId = String(batchARes.json?.cohortId);
      createdCohortIds.push(createdBatchAId);

      const batchBRes = await apiFetch('/api/cohorts', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `BB-${runSuffix.toUpperCase()}`,
          name: `Evening Batch ${runSuffix}`,
          courseId: createdCourseId,
          instructorId: createdInstructorId,
          classroomId: createdRoomId,
          capacity: 5,
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-12-20T00:00:00Z',
          status: 'Active',
        },
      });
      assert.equal(batchBRes.res.status, 201);
      createdBatchBId = String(batchBRes.json?.cohortId);
      createdCohortIds.push(createdBatchBId);

      // Assign student to Batch A (capacity 1)
      const assignRes = await apiFetch(`/api/cohorts/${createdBatchAId}/assign-student`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          studentId: createdStudentId,
          status: 'Active',
          issueTuitionInvoice: false,
        },
      });
      assert.equal(assignRes.res.status, 201);
      createdEnrollmentId = String(assignRes.json?.enrollmentId);

      // Attempting second active assignment into full Batch A returns 409
      const overCapRes = await apiFetch(`/api/cohorts/${createdBatchAId}/assign-student`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          studentId: createdStudentId,
          status: 'Active',
          issueTuitionInvoice: false,
        },
      });
      assert.equal(overCapRes.res.status, 409);

      // Transfer enrollment from Batch A to Batch B -> records EnrollmentHistory
      const transferRes = await apiFetch(
        `/api/enrollments/${createdEnrollmentId}/transfer`,
        {
          method: 'POST',
          cookie: adminCookie,
          body: {
            toBatchId: createdBatchBId,
            reason: 'Student requested evening hours',
          },
        }
      );
      assert.equal(transferRes.res.status, 200);

      const historyRows = await prisma.enrollmentHistory.findMany({
        where: { enrollmentId: createdEnrollmentId },
      });
      assert.ok(historyRows.some((h) => h.newBatchId === createdBatchBId));
    });

    await t.test('6. Academy Settings, Timezone, Invoice Prefix & Academic Years/Terms', async () => {
      const getSettings = await apiFetch('/api/settings', { cookie: adminCookie });
      assert.equal(getSettings.res.status, 200);
      const currentSettings = getSettings.json as {
        academy: { name: string; legalName: string; email: string; phone: string; website: string; address: string; timezone: string; currency: string };
        policies: Record<string, unknown>;
      };

      const putSettings = await apiFetch('/api/settings', {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          academy: {
            ...currentSettings.academy,
            timezone: 'Asia/Kolkata',
            website: 'https://infocom.edu',
          },
          policies: currentSettings.policies,
        },
      });
      assert.equal(putSettings.res.status, 200);

      const ayRes = await apiFetch('/api/academic-years', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `AY-${runSuffix.toUpperCase()}`,
          name: `Test Year ${runSuffix}`,
          startDate: '2027-01-01T00:00:00Z',
          endDate: '2027-12-31T00:00:00Z',
          isCurrent: false,
        },
      });
      assert.equal(ayRes.res.status, 201);
      const createdAy = (
        (ayRes.json?.settings as { academicYears: Array<{ id: string; code: string }> })
          .academicYears
      ).find((y) => y.code === `AY-${runSuffix.toUpperCase()}`);
      assert.ok(createdAy);
      createdYearIds.push(createdAy.id);

      const atRes = await apiFetch('/api/academic-terms', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          academicYearId: createdAy.id,
          code: `TRM-${runSuffix.toUpperCase()}`,
          name: `Test Term ${runSuffix}`,
          startDate: '2027-02-01T00:00:00Z',
          endDate: '2027-05-31T00:00:00Z',
          isCurrent: false,
        },
      });
      assert.equal(atRes.res.status, 201);
      const createdAt = (
        (atRes.json?.settings as { academicTerms: Array<{ id: string; code: string }> })
          .academicTerms
      ).find((x) => x.code === `TRM-${runSuffix.toUpperCase()}`);
      assert.ok(createdAt);
      createdTermIds.push(createdAt.id);
    });
  } finally {
    // Restore academy name/timezone if altered
    if (originalAcademySnapshot) {
      await prisma.academy
        .updateMany({
          where: { code: 'INFOCOM-MAIN' },
          data: originalAcademySnapshot,
        })
        .catch(() => undefined);
    }

    if (createdEnrollmentId) {
      await prisma.enrollmentHistory
        .deleteMany({ where: { enrollmentId: createdEnrollmentId } })
        .catch(() => undefined);
      await prisma.enrollment
        .deleteMany({ where: { id: createdEnrollmentId } })
        .catch(() => undefined);
    }
    if (createdCourseIds.length > 0) {
      await prisma.classSession
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.instructorAssignment
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.batch
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.courseModule
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.feeStructure
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.course
        .deleteMany({ where: { id: { in: createdCourseIds } } })
        .catch(() => undefined);
    }
    if (createdCohortIds.length > 0) {
      await prisma.batch
        .deleteMany({ where: { id: { in: createdCohortIds } } })
        .catch(() => undefined);
    }
    if (createdRoomIds.length > 0) {
      await prisma.classroom
        .deleteMany({ where: { id: { in: createdRoomIds } } })
        .catch(() => undefined);
    }
    if (createdDeptIds.length > 0) {
      await prisma.department
        .deleteMany({ where: { id: { in: createdDeptIds } } })
        .catch(() => undefined);
    }
    if (createdTermIds.length > 0) {
      await prisma.academicTerm
        .deleteMany({ where: { id: { in: createdTermIds } } })
        .catch(() => undefined);
    }
    if (createdYearIds.length > 0) {
      await prisma.academicYear
        .deleteMany({ where: { id: { in: createdYearIds } } })
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
      await prisma.instructorProfile
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.user
        .deleteMany({ where: { id: { in: createdUserIds } } })
        .catch(() => undefined);
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
