import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { hashPassword } from '../server/auth.ts';
import { disconnectPrisma, prisma } from '../server/db/prisma.ts';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateWeightedAverage,
  fromCents,
  toCents,
} from '../src/shared/academic.ts';
import type { AttendanceStatus } from '../src/shared/types.ts';

interface LegacyJsonUser {
  id: string;
  name: string;
  email: string;
  role: string;
  studentCode?: string;
  department?: string;
  passwordHash?: string;
}

interface LegacyJsonCourse {
  id: string;
  code: string;
  title: string;
  track: string;
  instructorId: string;
  instructorName: string;
  durationWeeks: number;
  modules: Array<{
    id: string;
    code: string;
    title: string;
    weight: number;
    labHours: number;
  }>;
}

interface LegacyJsonEnrollment {
  id: string;
  studentId: string;
  courseId: string;
  cohort: string;
  status: string;
  enrolledAt: string;
  completedModuleIds: string[];
}

interface LegacyJsonSession {
  id: string;
  courseId: string;
  cohort: string;
  title: string;
  topic: string;
  room: string;
  instructorName: string;
  startIso: string;
  endIso: string;
}

interface LegacyJsonAttendance {
  id: string;
  sessionId: string;
  courseId: string;
  studentId: string;
  status: string;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

interface LegacyJsonGrade {
  id: string;
  studentId: string;
  courseId: string;
  moduleId: string;
  score: number;
  feedback: string;
  gradedAt: string;
  gradedBy: string;
}

interface LegacyJsonRemark {
  id: string;
  studentId: string;
  courseId: string;
  summary: string;
  updatedAt: string;
  updatedBy: string;
}

interface LegacyJsonNotification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  message: string;
  relatedCourseId?: string;
  relatedSessionId?: string;
  dedupeKey?: string;
  read: boolean;
  createdAt: string;
}

interface LegacyJsonDb {
  users?: LegacyJsonUser[];
  courses?: LegacyJsonCourse[];
  enrollments?: LegacyJsonEnrollment[];
  sessions?: LegacyJsonSession[];
  attendance?: LegacyJsonAttendance[];
  grades?: LegacyJsonGrade[];
  remarks?: LegacyJsonRemark[];
  notifications?: LegacyJsonNotification[];
}

interface MigrationIssue {
  entity: string;
  id: string;
  type: 'invalid' | 'duplicate' | 'warning';
  reason: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SOURCE_JSON_PATH = path.join(DATA_DIR, 'centre-db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const DEFAULT_TUITION_BY_CODE: Record<string, string> = {
  'CS-204': '1450.00',
  'CL-310': '1600.00',
  'DA-215': '1350.00',
  'CY-402': '1750.00',
};

function isValidIsoDate(val: string | undefined): boolean {
  return Boolean(val && !Number.isNaN(Date.parse(val)));
}

function isValidEmail(val: string | undefined): boolean {
  return Boolean(val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()));
}

function createPreMigrationBackup(sourcePath: string): string {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source JSON database not found at ${sourcePath}`);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `centre-db.pre-migrate-${stamp}.json`);
  fs.copyFileSync(sourcePath, backupPath);

  const canonicalBackupPath = path.join(DATA_DIR, 'centre-db.backup.json');
  if (!fs.existsSync(canonicalBackupPath)) {
    fs.copyFileSync(sourcePath, canonicalBackupPath);
  }
  return backupPath;
}

export async function runJsonMigration(): Promise<{
  backupPath: string;
  issues: MigrationIssue[];
  counts: Record<string, number>;
}> {
  const backupPath = createPreMigrationBackup(SOURCE_JSON_PATH);
  const raw = fs.readFileSync(SOURCE_JSON_PATH, 'utf8');
  const legacy = JSON.parse(raw) as LegacyJsonDb;
  const issues: MigrationIssue[] = [];

  const validRoles = new Set(['admin', 'instructor', 'student']);
  const validEnrollStatuses = new Set(['Active', 'Completed', 'Waitlisted', 'Dropped']);
  const validAttendanceStatuses = new Set(['Present', 'Late', 'Absent']);

  // 1. Validate & deduplicate input records before opening transaction
  const seenEmails = new Set<string>();
  const validUsers: LegacyJsonUser[] = [];
  for (const u of legacy.users ?? []) {
    const email = (u.email || '').trim().toLowerCase();
    if (!u.id || !u.name || !isValidEmail(email)) {
      issues.push({ entity: 'user', id: u.id || 'unknown', type: 'invalid', reason: 'Missing id, name, or valid email.' });
      continue;
    }
    if (seenEmails.has(email)) {
      issues.push({ entity: 'user', id: u.id, type: 'duplicate', reason: `Duplicate user email ${email}.` });
      continue;
    }
    seenEmails.add(email);
    validUsers.push({
      ...u,
      email,
      role: validRoles.has(u.role) ? u.role : 'student',
    });
  }
  const validUserIds = new Set(validUsers.map((u) => u.id));

  const seenCourseCodes = new Set<string>();
  const validCourses: LegacyJsonCourse[] = [];
  const moduleToCourseMap = new Map<string, string>();
  for (const c of legacy.courses ?? []) {
    const code = (c.code || '').trim().toUpperCase();
    if (!c.id || !code || !c.title || !Array.isArray(c.modules) || c.modules.length === 0) {
      issues.push({ entity: 'course', id: c.id || 'unknown', type: 'invalid', reason: 'Missing required course fields or modules.' });
      continue;
    }
    if (seenCourseCodes.has(code)) {
      issues.push({ entity: 'course', id: c.id, type: 'duplicate', reason: `Duplicate course code ${code}.` });
      continue;
    }
    const weightSum = c.modules.reduce((acc, m) => acc + Number(m.weight || 0), 0);
    if (weightSum !== 100) {
      issues.push({ entity: 'course', id: c.id, type: 'warning', reason: `Module weights sum to ${weightSum} (expected 100).` });
    }
    seenCourseCodes.add(code);
    validCourses.push({ ...c, code });
    for (const m of c.modules) {
      moduleToCourseMap.set(m.id, c.id);
    }
  }
  const validCourseIds = new Set(validCourses.map((c) => c.id));

  const seenActiveEnrollmentPairs = new Set<string>();
  const validEnrollments: LegacyJsonEnrollment[] = [];
  for (const e of legacy.enrollments ?? []) {
    if (!e.id || !validUserIds.has(e.studentId) || !validCourseIds.has(e.courseId)) {
      issues.push({ entity: 'enrollment', id: e.id || 'unknown', type: 'invalid', reason: 'Missing enrollment id or invalid student/course FK.' });
      continue;
    }
    const status = validEnrollStatuses.has(e.status) ? e.status : 'Active';
    const pairKey = `${e.studentId}:${e.courseId}`;
    if (status !== 'Dropped') {
      if (seenActiveEnrollmentPairs.has(pairKey)) {
        issues.push({ entity: 'enrollment', id: e.id, type: 'duplicate', reason: `Duplicate non-dropped enrollment for ${pairKey}.` });
        continue;
      }
      seenActiveEnrollmentPairs.add(pairKey);
    }
    validEnrollments.push({ ...e, status });
  }

  const validSessions: LegacyJsonSession[] = [];
  for (const s of legacy.sessions ?? []) {
    if (!s.id || !validCourseIds.has(s.courseId) || !isValidIsoDate(s.startIso) || !isValidIsoDate(s.endIso)) {
      issues.push({ entity: 'session', id: s.id || 'unknown', type: 'invalid', reason: 'Invalid courseId or session timestamp.' });
      continue;
    }
    validSessions.push(s);
  }
  const validSessionIds = new Set(validSessions.map((s) => s.id));

  const seenAttendanceKeys = new Set<string>();
  const validAttendance: LegacyJsonAttendance[] = [];
  for (const a of legacy.attendance ?? []) {
    if (!a.id || !validSessionIds.has(a.sessionId) || !validCourseIds.has(a.courseId) || !validUserIds.has(a.studentId) || !validAttendanceStatuses.has(a.status)) {
      issues.push({ entity: 'attendance', id: a.id || 'unknown', type: 'invalid', reason: 'Invalid session, course, student, or status.' });
      continue;
    }
    const key = `${a.sessionId}:${a.studentId}`;
    if (seenAttendanceKeys.has(key)) {
      issues.push({ entity: 'attendance', id: a.id, type: 'duplicate', reason: `Duplicate attendance for ${key}.` });
      continue;
    }
    seenAttendanceKeys.add(key);
    validAttendance.push(a);
  }

  const seenGradeKeys = new Set<string>();
  const validGrades: LegacyJsonGrade[] = [];
  for (const g of legacy.grades ?? []) {
    if (!g.id || !validUserIds.has(g.studentId) || !validCourseIds.has(g.courseId) || moduleToCourseMap.get(g.moduleId) !== g.courseId || g.score < 0 || g.score > 100) {
      issues.push({ entity: 'grade', id: g.id || 'unknown', type: 'invalid', reason: 'Invalid student/course/module FK or out-of-range score.' });
      continue;
    }
    const key = `${g.studentId}:${g.courseId}:${g.moduleId}`;
    if (seenGradeKeys.has(key)) {
      issues.push({ entity: 'grade', id: g.id, type: 'duplicate', reason: `Duplicate grade for ${key}.` });
      continue;
    }
    seenGradeKeys.add(key);
    validGrades.push(g);
  }

  const validRemarks: LegacyJsonRemark[] = [];
  for (const r of legacy.remarks ?? []) {
    if (!r.id || !validUserIds.has(r.studentId) || !validCourseIds.has(r.courseId) || !r.summary?.trim()) {
      issues.push({ entity: 'remark', id: r.id || 'unknown', type: 'invalid', reason: 'Invalid student/course FK or empty remark.' });
      continue;
    }
    validRemarks.push(r);
  }

  const validNotifications: LegacyJsonNotification[] = [];
  for (const n of legacy.notifications ?? []) {
    if (!n.id || !validUserIds.has(n.userId) || !n.title || !n.message) {
      issues.push({ entity: 'notification', id: n.id || 'unknown', type: 'invalid', reason: 'Invalid user FK or empty title/message.' });
      continue;
    }
    validNotifications.push(n);
  }

  // 2. Execute idempotent transactional reconciliation into PostgreSQL via Prisma
  await prisma.$transaction(async (tx) => {
    // Structural Academy + Roles + Term + Classrooms
    for (const r of [
      { id: 'role-admin', code: 'admin', name: 'Academy Administrator' },
      { id: 'role-instructor', code: 'instructor', name: 'Faculty Instructor' },
      { id: 'role-student', code: 'student', name: 'Enrolled Student' },
    ]) {
      await tx.role.upsert({
        where: { code: r.code },
        update: { name: r.name },
        create: r,
      });
    }

    await tx.academy.upsert({
      where: { code: 'INFOCOM-MAIN' },
      update: {},
      create: {
        id: 'acad-infocom',
        code: 'INFOCOM-MAIN',
        name: 'InfoCom Academy',
        legalName: 'InfoCom Computer Training & Engineering Institute',
        currency: 'USD',
      },
    });

    await tx.department.upsert({
      where: { code: 'SWE-CLOUD' },
      update: {},
      create: { id: 'dept-swe', academyId: 'acad-infocom', code: 'SWE-CLOUD', name: 'Software & Cloud Systems' },
    });
    await tx.department.upsert({
      where: { code: 'DATA-SEC' },
      update: {},
      create: { id: 'dept-data-sec', academyId: 'acad-infocom', code: 'DATA-SEC', name: 'Data & Security Lab' },
    });

    await tx.academicYear.upsert({
      where: { code: 'AY-2026' },
      update: {},
      create: {
        id: 'ay-2026',
        academyId: 'acad-infocom',
        code: 'AY-2026',
        name: 'Academic Year 2026',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T23:59:59Z'),
        isCurrent: true,
        status: 'Active',
      },
    });

    await tx.academicTerm.upsert({
      where: { code: 'AUT-2026' },
      update: {},
      create: {
        id: 'term-aut-2026',
        academicYearId: 'ay-2026',
        code: 'AUT-2026',
        name: 'Autumn 2026',
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-12-20T23:59:59Z'),
        isCurrent: true,
        status: 'Active',
      },
    });

    // Migrate Users + Role assignments + Student/Instructor Profiles
    for (let idx = 0; idx < validUsers.length; idx += 1) {
      const u = validUsers[idx];
      const existing = await tx.user.findUnique({ where: { id: u.id } });
      const fallbackHash = u.passwordHash
        ? u.passwordHash
        : await hashPassword(crypto.randomBytes(16).toString('hex'));
      const userRecord = await tx.user.upsert({
        where: { id: u.id },
        update: {
          name: u.name,
          department: u.department ?? existing?.department ?? null,
          studentCode: u.studentCode ?? existing?.studentCode ?? null,
        },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: 'active',
          studentCode: u.studentCode ?? null,
          staffCode: u.role === 'instructor' ? `INF-INS-00${idx + 1}` : null,
          department: u.department ?? null,
          passwordHash: fallbackHash,
        },
      });

      const roleRow = await tx.role.findUnique({ where: { code: userRecord.role } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: userRecord.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${userRecord.id}-${roleRow.code}`,
            userId: userRecord.id,
            roleId: roleRow.id,
          },
        });
      }

      if (userRecord.role === 'student' && userRecord.studentCode) {
        await tx.studentProfile.upsert({
          where: { userId: userRecord.id },
          update: {},
          create: {
            id: `sp-${userRecord.id}`,
            userId: userRecord.id,
            studentCode: userRecord.studentCode,
            departmentId: 'dept-swe',
          },
        });
      } else if (userRecord.role === 'instructor' && userRecord.staffCode) {
        await tx.instructorProfile.upsert({
          where: { userId: userRecord.id },
          update: {},
          create: {
            id: `ip-${userRecord.id}`,
            userId: userRecord.id,
            staffCode: userRecord.staffCode,
            departmentId: userRecord.department?.includes('Data') ? 'dept-data-sec' : 'dept-swe',
            specialization: userRecord.department ?? 'Computer Engineering',
          },
        });
      }
    }

    // Migrate Courses, Modules & Assessments + FeeStructures
    for (const c of validCourses) {
      const tuition = DEFAULT_TUITION_BY_CODE[c.code] ?? '1400.00';
      const deptId = c.track.toLowerCase().includes('data') || c.track.toLowerCase().includes('security')
        ? 'dept-data-sec'
        : 'dept-swe';

      await tx.course.upsert({
        where: { id: c.id },
        update: {
          title: c.title,
          track: c.track,
          departmentId: deptId,
        },
        create: {
          id: c.id,
          code: c.code,
          title: c.title,
          track: c.track,
          description: `${c.title} — structured hands-on computer training track.`,
          departmentId: deptId,
          instructorId: c.instructorId,
          durationWeeks: c.durationWeeks,
          tuitionFee: tuition,
          isArchived: false,
        },
      });

      await tx.feeStructure.upsert({
        where: { id: `fs-${c.id}` },
        update: { tuitionAmount: tuition },
        create: {
          id: `fs-${c.id}`,
          courseId: c.id,
          tuitionAmount: tuition,
          isActive: true,
        },
      });

      for (let mIdx = 0; mIdx < c.modules.length; mIdx += 1) {
        const m = c.modules[mIdx];
        await tx.courseModule.upsert({
          where: { id: m.id },
          update: { title: m.title, weight: m.weight, labHours: m.labHours, sortOrder: mIdx + 1 },
          create: {
            id: m.id,
            courseId: c.id,
            code: m.code,
            title: m.title,
            weight: m.weight,
            labHours: m.labHours,
            sortOrder: mIdx + 1,
          },
        });

        await tx.assessment.upsert({
          where: { id: `asmt-${m.id}` },
          update: { title: `${m.code}: ${m.title}`, weight: m.weight },
          create: {
            id: `asmt-${m.id}`,
            courseId: c.id,
            moduleId: m.id,
            title: `${m.code}: ${m.title}`,
            assessmentType: 'Module Assessment',
            maxScore: 100,
            weight: m.weight,
          },
        });
      }
    }

    // Reconcile Batches / InstructorAssignments
    const batchSeeds = [
      { id: 'coh-ts-a', code: 'CS204-AUT26-A', name: 'Cohort A · Autumn', courseId: 'crs-ts', instructorId: 'inst-elena', capacity: 24 },
      { id: 'coh-cl-a', code: 'CL310-AUT26-A', name: 'Cohort A · Autumn', courseId: 'crs-cloud', instructorId: 'inst-elena', capacity: 20 },
      { id: 'coh-da-b', code: 'DA215-AUT26-B', name: 'Cohort B · Autumn', courseId: 'crs-data', instructorId: 'inst-david', capacity: 22 },
      { id: 'coh-cy-a', code: 'CY402-AUT26-A', name: 'Cohort A · Autumn', courseId: 'crs-sec', instructorId: 'inst-david', capacity: 18 },
    ];

    for (const b of batchSeeds) {
      if (!validCourseIds.has(b.courseId)) continue;
      await tx.batch.upsert({
        where: { id: b.id },
        update: { termId: 'term-aut-2026' },
        create: {
          ...b,
          termId: 'term-aut-2026',
          startDate: new Date(Date.now() - 40 * 86400_000),
          endDate: new Date(Date.now() + 40 * 86400_000),
          status: 'Active',
        },
      });
      await tx.instructorAssignment.upsert({
        where: { instructorId_batchId: { instructorId: b.instructorId, batchId: b.id } },
        update: { isActive: true },
        create: {
          id: `ia-${b.id}`,
          instructorId: b.instructorId,
          batchId: b.id,
          courseId: b.courseId,
          role: 'Lead',
          isActive: true,
        },
      });
    }

    const resolveBatch = (courseId: string, cohortName: string) =>
      batchSeeds.find((b) => b.courseId === courseId && b.name === cohortName) ?? null;

    // Migrate Enrollments + initial EnrollmentHistory
    for (const e of validEnrollments) {
      const batch = resolveBatch(e.courseId, e.cohort);
      const courseRec = validCourses.find((c) => c.id === e.courseId);
      const tuition = courseRec ? DEFAULT_TUITION_BY_CODE[courseRec.code] ?? '1400.00' : '1400.00';

      await tx.enrollment.upsert({
        where: { id: e.id },
        update: {
          cohortId: batch?.id ?? undefined,
          tuitionSnapshot: tuition,
          batchNameSnapshot: e.cohort,
          instructorNameSnapshot: courseRec?.instructorName ?? null,
        },
        create: {
          id: e.id,
          studentId: e.studentId,
          courseId: e.courseId,
          cohortId: batch?.id ?? null,
          cohort: e.cohort,
          status: e.status,
          enrolledAt: new Date(e.enrolledAt),
          completedModuleIds: e.completedModuleIds ?? [],
          tuitionSnapshot: tuition,
          batchNameSnapshot: e.cohort,
          instructorNameSnapshot: courseRec?.instructorName ?? null,
        },
      });

      await tx.enrollmentHistory.upsert({
        where: { id: `eh-${e.id}-init` },
        update: {},
        create: {
          id: `eh-${e.id}-init`,
          enrollmentId: e.id,
          previousStatus: null,
          newStatus: e.status,
          newBatchId: batch?.id ?? null,
          reason: 'Migrated from legacy JSON training database',
          changedAt: new Date(e.enrolledAt),
        },
      });
    }

    // Migrate Class Sessions
    const nowMs = Date.now();
    for (const s of validSessions) {
      const courseRec = validCourses.find((c) => c.id === s.courseId);
      const batch = resolveBatch(s.courseId, s.cohort);
      let startDate = new Date(s.startIso);
      let endDate = new Date(s.endIso);
      if (s.id.startsWith('ses-upcoming') && startDate.getTime() < nowMs) {
        const offsetHours =
          s.id === 'ses-upcoming-1' ? 6 : s.id === 'ses-upcoming-2' ? 18 : s.id === 'ses-upcoming-3' ? 12 : 48;
        startDate = new Date(nowMs + offsetHours * 3600_000);
        endDate = new Date(nowMs + (offsetHours + 2) * 3600_000);
      }

      await tx.classSession.upsert({
        where: { id: s.id },
        update: {
          cohortId: batch?.id ?? undefined,
          instructorId: courseRec?.instructorId ?? undefined,
        },
        create: {
          id: s.id,
          courseId: s.courseId,
          cohortId: batch?.id ?? null,
          cohort: s.cohort,
          title: s.title,
          topic: s.topic,
          room: s.room,
          instructorId: courseRec?.instructorId ?? null,
          instructorName: s.instructorName,
          startIso: startDate,
          endIso: endDate,
          status: startDate.getTime() < nowMs ? 'Completed' : 'Scheduled',
        },
      });
    }

    // Helper lookup for enrollmentId per (studentId, courseId)
    const enrollmentLookup = new Map<string, string>();
    const dbEnrollments = await tx.enrollment.findMany({
      select: { id: true, studentId: true, courseId: true, status: true },
    });
    for (const enr of dbEnrollments) {
      if (enr.status !== 'Dropped') {
        enrollmentLookup.set(`${enr.studentId}:${enr.courseId}`, enr.id);
      }
    }

    // Migrate Attendance (linked to enrollmentId + sessionId)
    for (const a of validAttendance) {
      const enrollmentId = enrollmentLookup.get(`${a.studentId}:${a.courseId}`) ?? null;
      await tx.attendance.upsert({
        where: {
          sessionId_studentId: { sessionId: a.sessionId, studentId: a.studentId },
        },
        update: { enrollmentId },
        create: {
          id: a.id,
          sessionId: a.sessionId,
          courseId: a.courseId,
          enrollmentId,
          studentId: a.studentId,
          status: a.status,
          note: a.note ?? '',
          updatedAt: new Date(a.updatedAt),
          updatedBy: a.updatedBy,
        },
      });
    }

    // Migrate Grades (linked to enrollmentId + assessmentId)
    for (const g of validGrades) {
      const enrollmentId = enrollmentLookup.get(`${g.studentId}:${g.courseId}`) ?? null;
      const assessmentId = `asmt-${g.moduleId}`;
      await tx.grade.upsert({
        where: {
          studentId_courseId_moduleId: {
            studentId: g.studentId,
            courseId: g.courseId,
            moduleId: g.moduleId,
          },
        },
        update: { enrollmentId, assessmentId },
        create: {
          id: g.id,
          studentId: g.studentId,
          courseId: g.courseId,
          moduleId: g.moduleId,
          enrollmentId,
          assessmentId,
          score: g.score,
          maxScore: 100,
          feedback: g.feedback ?? '',
          gradedAt: new Date(g.gradedAt),
          gradedBy: g.gradedBy,
        },
      });
    }

    // Migrate Progress Remarks (linked to enrollmentId)
    for (const r of validRemarks) {
      const enrollmentId = enrollmentLookup.get(`${r.studentId}:${r.courseId}`) ?? null;
      await tx.progressRemark.upsert({
        where: {
          studentId_courseId: { studentId: r.studentId, courseId: r.courseId },
        },
        update: { enrollmentId },
        create: {
          id: r.id,
          studentId: r.studentId,
          courseId: r.courseId,
          enrollmentId,
          summary: r.summary,
          updatedAt: new Date(r.updatedAt),
          updatedBy: r.updatedBy,
        },
      });
    }

    // Migrate Notifications + DeliveryLog
    for (const n of validNotifications) {
      await tx.notification.upsert({
        where: { id: n.id },
        update: {},
        create: {
          id: n.id,
          userId: n.userId,
          kind: n.kind,
          title: n.title,
          message: n.message,
          relatedCourseId: n.relatedCourseId ?? null,
          relatedSessionId: n.relatedSessionId ?? null,
          dedupeKey: n.dedupeKey ?? null,
          read: n.read,
          createdAt: new Date(n.createdAt),
        },
      });
    }

    // Backfill InvoiceItem & PaymentAllocation for existing Invoices/Payments
    const allInvoices = await tx.invoice.findMany({ include: { items: true } });
    for (const inv of allInvoices) {
      if (inv.items.length === 0) {
        await tx.invoiceItem.create({
          data: {
            id: `item-${inv.id}-1`,
            invoiceId: inv.id,
            itemType: 'Tuition',
            description: inv.description,
            quantity: 1,
            unitPrice: inv.amountDue,
            lineTotal: inv.amountDue,
          },
        });
      }
    }

    const allPayments = await tx.payment.findMany();
    for (const pay of allPayments) {
      await tx.paymentAllocation.upsert({
        where: { paymentId_invoiceId: { paymentId: pay.id, invoiceId: pay.invoiceId } },
        update: {},
        create: {
          id: `alloc-${pay.id}`,
          paymentId: pay.id,
          invoiceId: pay.invoiceId,
          allocatedAmount: pay.amount,
          allocatedAt: pay.paidAt,
        },
      });
    }

    // Record AuditLog entry for migration verification
    await tx.auditLog.create({
      data: {
        id: `aud-mig-${crypto.randomUUID().slice(0, 8)}`,
        actorEmail: 'system-migration@infocom.edu',
        actorRole: 'admin',
        action: 'PRISMA_JSON_MIGRATION',
        entityType: 'database',
        entityId: 'postgresql-prisma',
        summary: `Idempotent JSON->PostgreSQL migration verified (${validUsers.length} users, ${validCourses.length} courses, ${validEnrollments.length} enrollments).`,
        metadata: {
          backupPath,
          issueCount: issues.length,
        },
      },
    });
  });

  // 3. Verify imported record counts & reconcile academic + financial math
  const [
    userCount,
    courseCount,
    moduleCount,
    enrollmentCount,
    sessionCount,
    attendanceCount,
    gradeCount,
    remarkCount,
    notificationCount,
    allCoursesDb,
    allEnrollmentsDb,
    allGradesDb,
    allAttDb,
    allInvoicesDb,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.course.count(),
    prisma.courseModule.count(),
    prisma.enrollment.count(),
    prisma.classSession.count(),
    prisma.attendance.count(),
    prisma.grade.count(),
    prisma.progressRemark.count(),
    prisma.notification.count(),
    prisma.course.findMany({ include: { modules: true } }),
    prisma.enrollment.findMany(),
    prisma.grade.findMany(),
    prisma.attendance.findMany(),
    prisma.invoice.findMany(),
  ]);

  // Reconcile academic calculations across active/completed enrollments
  const moduleWeightMap = new Map<string, number>();
  const courseModuleCount = new Map<string, number>();
  for (const c of allCoursesDb) {
    courseModuleCount.set(c.id, c.modules.length);
    for (const m of c.modules) moduleWeightMap.set(m.id, m.weight);
  }

  for (const enr of allEnrollmentsDb) {
    const completedIds = Array.isArray(enr.completedModuleIds)
      ? (enr.completedModuleIds as string[])
      : [];
    const completionPct = calculateCourseCompletion(
      completedIds,
      courseModuleCount.get(enr.courseId) ?? 0
    );
    const enrGrades = allGradesDb
      .filter((g) => g.studentId === enr.studentId && g.courseId === enr.courseId)
      .map((g) => ({ score: g.score, weight: moduleWeightMap.get(g.moduleId) ?? 0 }))
      .filter((x) => x.weight > 0);
    const weightedAvg = calculateWeightedAverage(enrGrades);
    const enrAtt = allAttDb
      .filter((a) => a.studentId === enr.studentId && a.courseId === enr.courseId)
      .map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        courseId: a.courseId,
        studentId: a.studentId,
        status: a.status as AttendanceStatus,
        note: a.note,
        updatedAt: a.updatedAt.toISOString(),
        updatedBy: a.updatedBy,
      }));
    const attStats = calculateAttendanceStats(enrAtt);
    if (completionPct < 0 || completionPct > 100) {
      throw new Error(`Reconciliation error: invalid completionPct ${completionPct} for ${enr.id}`);
    }
    if (weightedAvg !== null && (weightedAvg < 0 || weightedAvg > 100)) {
      throw new Error(`Reconciliation error: invalid weightedAvg ${weightedAvg} for ${enr.id}`);
    }
    if (attStats.rate < 0 || attStats.rate > 100) {
      throw new Error(`Reconciliation error: invalid attendanceRate ${attStats.rate} for ${enr.id}`);
    }
  }

  for (const inv of allInvoicesDb) {
    const dueCents = toCents(inv.amountDue.toString());
    const paidCents = toCents(inv.amountPaid.toString());
    if (paidCents > dueCents) {
      throw new Error(`Financial reconciliation error on ${inv.invoiceNumber}: paid ${fromCents(paidCents)} > due ${fromCents(dueCents)}`);
    }
  }

  const counts = {
    users: userCount,
    courses: courseCount,
    modules: moduleCount,
    enrollments: enrollmentCount,
    sessions: sessionCount,
    attendance: attendanceCount,
    grades: gradeCount,
    remarks: remarkCount,
    notifications: notificationCount,
  };

  console.log('Migration backup created:', backupPath);
  console.log('Database counts verified:', counts);
  console.log('Validation/Duplicate issues detected:', issues.length);
  if (issues.length > 0) {
    console.table(issues);
  }

  return { backupPath, issues, counts };
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('migrate-json.ts')
) {
  runJsonMigration()
    .then(() => {
      console.log('JSON migration and reconciliation completed cleanly.');
    })
    .catch((err) => {
      console.error('JSON migration failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
