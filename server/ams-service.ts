import crypto from 'node:crypto';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import {
  buildAttendanceNotification,
  buildEnrollmentTrendSeries,
  buildMonthlyRevenueSeries,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeAcademyAnalytics,
  computeCertificateEligibility,
  computeInvoiceStatus,
  findUpcomingSessionsNeedingReminders,
  formatInvoiceNumber,
  fromCents,
  isInactiveEnrollmentStatus,
  isPendingAdmissionStatus,
  resolveAnalyticsDateWindow,
  shouldActivatePortalOnPayment,
  toCents,
} from '../src/shared/academic.ts';
import type {
  AcademySettingsPayload,
  AdminAnalyticsDetail,
  AdmissionApplication,
  AdmissionStatus,
  AnalyticsPreset,
  AttendanceStatus,
  CertificateRecord,
  Course,
  DashboardPayload,
  DocumentRecord,
  EnrollmentStatus,
  FeePlanSummary,
  InstructorDetailPayload,
  InstructorDirectoryRow,
  InstructorPermissionKey,
  NotificationItem,
  PaymentMethod,
  PortalActivationPolicy,
  StudentDetailPayload,
  UserPublic,
  UserRole,
} from '../src/shared/types.ts';
import { hashPassword } from './auth.ts';
import { prisma } from './db/prisma.ts';
import {
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  canInstructorAccessCourse,
  canInstructorAccessStudent,
  getInstructorScope,
} from './security/permissions.ts';

type PrismaDbClient = Prisma.TransactionClient | typeof prisma;

export async function generateUniqueStudentCode(db: PrismaDbClient = prisma): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const suffix = crypto.randomInt(1000, 9999);
    const candidate = `NTA-${year}-${suffix}`;
    const exists = await db.user.findUnique({
      where: { studentCode: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `NTA-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueStaffCode(db: PrismaDbClient = prisma): Promise<string> {
  for (let i = 0; i < 12; i += 1) {
    const suffix = crypto.randomInt(1000, 9999);
    const candidate = `INF-STF-${suffix}`;
    const exists = await db.user.findUnique({
      where: { staffCode: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `INF-STF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateNextInvoiceNumber(db: PrismaDbClient = prisma): Promise<string> {
  const [prefixRow, seqRow] = await Promise.all([
    db.academySetting.findFirst({ where: { key: 'academy.invoice_prefix' } }),
    db.academySetting.findFirst({ where: { key: 'academy.invoice_next_seq' } }),
  ]);
  const prefix = prefixRow?.value || 'INV-2026';
  let seq = Number(seqRow?.value || '1050');
  if (!Number.isFinite(seq) || seq < 1) seq = 1050;

  for (let i = 0; i < 20; i += 1) {
    const candidate = formatInvoiceNumber(prefix, seq + i);
    const existing = await db.invoice.findUnique({
      where: { invoiceNumber: candidate },
      select: { id: true },
    });
    if (!existing) {
      if (seqRow) {
        await db.academySetting.update({
          where: { id: seqRow.id },
          data: { value: String(seq + i + 1) },
        });
      }
      return candidate;
    }
  }
  return `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueReceiptNumber(db: PrismaDbClient = prisma): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const candidate = `RCPT-${year}-${crypto.randomInt(10000, 99999)}`;
    const exists = await db.payment.findUnique({
      where: { receiptNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `RCPT-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueApplicationNumber(db: PrismaDbClient = prisma): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const candidate = `ADM-${year}-${crypto.randomInt(1000, 9999)}`;
    const exists = await db.admissionApplication.findUnique({
      where: { applicationNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `ADM-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function getPortalActivationPolicy(
  db: PrismaDbClient = prisma
): Promise<PortalActivationPolicy> {
  const row = await db.academySetting.findFirst({
    where: { key: 'admission.portal_activation_policy' },
    select: { value: true },
  });
  const val = row?.value;
  if (
    val === 'immediate' ||
    val === 'on_approval' ||
    val === 'manual_activation' ||
    val === 'after_first_payment'
  ) {
    return val;
  }
  return 'on_approval';
}

export function toPublicUser(u: PrismaUser): UserPublic {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role as UserRole) || 'student',
    status: (u.status as UserPublic['status']) || 'active',
    studentCode: u.studentCode,
    staffCode: u.staffCode,
    department: u.department,
    phone: u.phone,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function recordAuditLog(params: {
  actor: UserPublic | { id?: string | null; email: string; role: string };
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        actorUserId: params.actor.id ?? null,
        actorEmail: params.actor.email,
        actorRole: params.actor.role,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        summary: params.summary,
        ipAddress: params.ipAddress ?? null,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export async function findUserById(id: string): Promise<PrismaUser | null> {
  try {
    return await prisma.user.findUnique({ where: { id } });
  } catch (err) {
    throw new Error('Failed to load user record.', { cause: err });
  }
}

export async function findUserByEmail(email: string): Promise<PrismaUser | null> {
  try {
    return await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  } catch (err) {
    throw new Error('Failed to query user by email.', { cause: err });
  }
}

export async function syncFirebaseUser(params: {
  uid: string;
  email: string;
  name: string;
}): Promise<PrismaUser> {
  const normalizedEmail = params.email.trim().toLowerCase();
  try {
    const existingByUid = await prisma.user.findUnique({
      where: { firebaseUid: params.uid },
    });
    if (existingByUid) return existingByUid;

    const existingByEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingByEmail) {
      return await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { firebaseUid: params.uid },
      });
    }

    // Public Google SSO provisioning is strictly restricted to the student role.
    // Admin and Instructor roles must be granted via bootstrap CLI or an existing Admin.
    const newId = `stu-${crypto.randomUUID().slice(0, 8)}`;
    const studentCode = await generateUniqueStudentCode();
    const roleCode = 'student';

    const user = await prisma.$transaction(async (tx) => {
      const upserted = await tx.user.upsert({
        where: { email: normalizedEmail },
        update: { firebaseUid: params.uid },
        create: {
          id: newId,
          firebaseUid: params.uid,
          name: params.name.trim() || normalizedEmail.split('@')[0],
          email: normalizedEmail,
          role: roleCode,
          status: 'active',
          studentCode,
          staffCode: null,
          department: null,
        },
      });

      const roleRow = await tx.role.findUnique({ where: { code: upserted.role } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: upserted.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${upserted.id}-${roleRow.code}`,
            userId: upserted.id,
            roleId: roleRow.id,
          },
        });
      }

      if (upserted.role === 'student' && upserted.studentCode) {
        await tx.studentProfile.upsert({
          where: { userId: upserted.id },
          update: {},
          create: {
            id: `sp-${upserted.id}`,
            userId: upserted.id,
            studentCode: upserted.studentCode,
          },
        });
      }

      return upserted;
    });

    await recordAuditLog({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'USER_SSO_PROVISIONED',
      entityType: 'user',
      entityId: user.id,
      summary: `Provisioned ${user.role} account via Google Sign-In for ${user.email}.`,
    });
    return user;
  } catch (err) {
    throw new Error('Failed to synchronize authenticated user.', { cause: err });
  }
}

export async function registerStudentAccount(params: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<{ ok: true; user: PrismaUser } | { ok: false; error: string }> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const studentCode = await generateUniqueStudentCode();
  const newId = `stu-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const createdUser = await prisma.$transaction(async (tx) => {
      const inserted = await tx.user.create({
        data: {
          id: newId,
          name: params.name.trim(),
          email: normalizedEmail,
          role: 'student', // Public registration ALWAYS creates student role
          status: 'active',
          studentCode,
          phone: params.phone?.trim() || null,
          passwordHash: await hashPassword(params.password),
          passwordUpdatedAt: new Date(),
        },
      });

      const roleRow = await tx.role.findUnique({ where: { code: 'student' } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: inserted.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${inserted.id}-student`,
            userId: inserted.id,
            roleId: roleRow.id,
          },
        });
      }

      await tx.studentProfile.create({
        data: {
          id: `sp-${inserted.id}`,
          userId: inserted.id,
          studentCode,
        },
      });

      const firstCourse = await tx.course.findFirst({
        where: { isArchived: false },
        include: { instructor: true },
        orderBy: { createdAt: 'asc' },
      });

      if (firstCourse) {
        const matchingBatch = await tx.batch.findFirst({
          where: { courseId: firstCourse.id, status: 'Active' },
          orderBy: { startDate: 'asc' },
        });
        const cohortName = matchingBatch?.name ?? 'Cohort A · Autumn';
        const enrId = `enr-${crypto.randomUUID().slice(0, 8)}`;

        await tx.enrollment.create({
          data: {
            id: enrId,
            studentId: inserted.id,
            courseId: firstCourse.id,
            cohortId: matchingBatch?.id ?? null,
            cohort: cohortName,
            status: 'Active',
            completedModuleIds: [],
            tuitionSnapshot: firstCourse.tuitionFee,
            batchNameSnapshot: cohortName,
            instructorNameSnapshot: firstCourse.instructor?.name ?? null,
          },
        });

        await tx.enrollmentHistory.create({
          data: {
            id: `eh-${crypto.randomUUID().slice(0, 8)}`,
            enrollmentId: enrId,
            previousStatus: null,
            newStatus: 'Active',
            newBatchId: matchingBatch?.id ?? null,
            reason: 'Initial student self-registration',
            changedByUserId: inserted.id,
          },
        });

        const notif = await tx.notification.create({
          data: {
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: inserted.id,
            kind: 'enrollment',
            title: `Welcome · ${firstCourse.code}`,
            message: `Welcome to InfoCom AMS. You have been enrolled in ${firstCourse.title} (${cohortName}).`,
            relatedCourseId: firstCourse.id,
            read: false,
          },
        });

        await tx.deliveryLog.create({
          data: {
            id: `del-${crypto.randomUUID().slice(0, 8)}`,
            notificationId: notif.id,
            userId: inserted.id,
            channel: 'in_app',
            recipient: inserted.email,
            status: 'Delivered',
          },
        });
      }
      return inserted;
    });

    await recordAuditLog({
      actor: { id: createdUser.id, email: createdUser.email, role: createdUser.role },
      action: 'STUDENT_REGISTERED',
      entityType: 'user',
      entityId: createdUser.id,
      summary: `New student registered: ${createdUser.name} (${createdUser.email}).`,
    });

    return { ok: true, user: createdUser };
  } catch (err) {
    throw new Error('Failed to create student account.', { cause: err });
  }
}

export async function runSessionReminderSweep(nowMs = Date.now()): Promise<NotificationItem[]> {
  try {
    const [allCourses, allSessions, allEnrollments, allNotifs, allUsers] =
      await Promise.all([
        prisma.course.findMany(),
        prisma.classSession.findMany(),
        prisma.enrollment.findMany(),
        prisma.notification.findMany({
          where: { kind: 'reminder' },
        }),
        prisma.user.findMany({ select: { id: true, name: true, email: true } }),
      ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const mappedCourses: Course[] = allCourses.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      track: c.track,
      description: c.description,
      instructorId: c.instructorId,
      instructorName: userMap.get(c.instructorId)?.name ?? 'Instructor',
      durationWeeks: c.durationWeeks,
      tuitionFee: c.tuitionFee.toString(),
      isArchived: c.isArchived,
      modules: [],
    }));

    const pending = findUpcomingSessionsNeedingReminders({
      sessions: allSessions.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        cohortId: s.cohortId,
        cohort: s.cohort,
        title: s.title,
        topic: s.topic,
        room: s.room,
        instructorId: s.instructorId,
        instructorName: s.instructorName,
        startIso: s.startIso.toISOString(),
        endIso: s.endIso.toISOString(),
        status: s.status as 'Scheduled' | 'Completed' | 'Cancelled',
      })),
      courses: mappedCourses,
      enrollments: allEnrollments.map((e) => ({
        id: e.id,
        studentId: e.studentId,
        courseId: e.courseId,
        cohortId: e.cohortId,
        cohort: e.cohort,
        status: e.status as EnrollmentStatus,
        enrolledAt: e.enrolledAt.toISOString(),
        completedModuleIds: Array.isArray(e.completedModuleIds)
          ? (e.completedModuleIds as string[])
          : [],
      })),
      existingNotifications: allNotifs.map((n) => ({
        id: n.id,
        userId: n.userId,
        kind: n.kind as NotificationItem['kind'],
        title: n.title,
        message: n.message,
        relatedCourseId: n.relatedCourseId,
        relatedSessionId: n.relatedSessionId,
        dedupeKey: n.dedupeKey,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      nowMs,
      windowHours: 24,
    });

    if (pending.length === 0) return [];

    const created: NotificationItem[] = [];
    for (const item of pending) {
      try {
        const inserted = await prisma.$transaction(async (tx) => {
          if (item.dedupeKey) {
            const exists = await tx.notification.findUnique({
              where: { dedupeKey: item.dedupeKey },
              select: { id: true },
            });
            if (exists) return null;
          }
          const notif = await tx.notification.create({
            data: {
              id: `not-${crypto.randomUUID().slice(0, 8)}`,
              userId: item.userId,
              kind: item.kind,
              title: item.title,
              message: item.message,
              relatedCourseId: item.relatedCourseId ?? null,
              relatedSessionId: item.relatedSessionId ?? null,
              dedupeKey: item.dedupeKey ?? null,
              read: false,
              createdAt: new Date(item.createdAt),
            },
          });

          const recipientEmail = userMap.get(item.userId)?.email ?? item.userId;
          await tx.deliveryLog.create({
            data: {
              id: `del-${crypto.randomUUID().slice(0, 8)}`,
              notificationId: notif.id,
              userId: item.userId,
              channel: 'in_app',
              recipient: recipientEmail,
              status: 'Delivered',
            },
          });
          return notif;
        });

        if (inserted) {
          created.push({
            id: inserted.id,
            userId: inserted.userId,
            kind: inserted.kind as NotificationItem['kind'],
            title: inserted.title,
            message: inserted.message,
            relatedCourseId: inserted.relatedCourseId,
            relatedSessionId: inserted.relatedSessionId,
            dedupeKey: inserted.dedupeKey,
            read: inserted.read,
            createdAt: inserted.createdAt.toISOString(),
          });
        }
      } catch {
        // Ignore unique dedupeKey race condition
      }
    }
    return created;
  } catch (err) {
    throw new Error('Failed to run session reminder sweep.', { cause: err });
  }
}

export async function buildDashboardForUser(userRow: PrismaUser): Promise<DashboardPayload> {
  try {
    const publicUser = toPublicUser(userRow);

    const [
      academyRow,
      allDepartments,
      allClassrooms,
      allAcademicYears,
      allAcademicTerms,
      allFeePlans,
      allUsers,
      allCourses,
      allModules,
      allCohorts,
      allAdmissions,
      allAdmissionDocs,
      allEnrollments,
      allSessions,
      allAttendance,
      allGrades,
      allRemarks,
      allInvoices,
      allPayments,
      allDocs,
      allCerts,
      allNotifs,
      recentAudits,
    ] = await Promise.all([
      prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.classroom.findMany({ orderBy: { code: 'asc' } }),
      prisma.academicYear.findMany({ orderBy: { startDate: 'desc' } }),
      prisma.academicTerm.findMany({ orderBy: { startDate: 'desc' } }),
      prisma.feePlan.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
      prisma.user.findMany(),
      prisma.course.findMany(),
      prisma.courseModule.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.batch.findMany(),
      prisma.admissionApplication.findMany({ orderBy: { submittedAt: 'desc' } }),
      prisma.admissionDocument.findMany(),
      prisma.enrollment.findMany({ orderBy: { enrolledAt: 'desc' } }),
      prisma.classSession.findMany(),
      prisma.attendance.findMany(),
      prisma.grade.findMany(),
      prisma.progressRemark.findMany(),
      prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.payment.findMany({ orderBy: { paidAt: 'desc' } }),
      prisma.fileAsset.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ownerUserId: true,
          courseId: true,
          title: true,
          category: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          uploadedByUserId: true,
          isArchived: true,
          createdAt: true,
        },
      }),
      prisma.certificate.findMany({ orderBy: { issuedAt: 'desc' } }),
      prisma.notification.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 80 }),
    ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const courseMap = new Map(allCourses.map((c) => [c.id, c]));
    const deptMap = new Map(allDepartments.map((d) => [d.id, d]));
    const roomMap = new Map(allClassrooms.map((r) => [r.id, r]));
    const yearMap = new Map(allAcademicYears.map((y) => [y.id, y]));

    const mappedCourses: Course[] = allCourses.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      track: c.track,
      category: c.category,
      departmentId: c.departmentId,
      departmentName: c.departmentId ? deptMap.get(c.departmentId)?.name ?? null : null,
      description: c.description,
      prerequisites: c.prerequisites,
      learningObjectives: Array.isArray(c.learningObjectives)
        ? (c.learningObjectives as string[])
        : [],
      passingScore: c.passingScore,
      minAttendanceRate: c.minAttendanceRate,
      gradingConfig:
        c.gradingConfig && typeof c.gradingConfig === 'object'
          ? (c.gradingConfig as Course['gradingConfig'])
          : {},
      instructorId: c.instructorId,
      instructorName: userMap.get(c.instructorId)?.name ?? 'Instructor',
      durationWeeks: c.durationWeeks,
      tuitionFee: c.tuitionFee.toFixed(2),
      isArchived: c.isArchived,
      modules: allModules
        .filter((m) => m.courseId === c.id)
        .map((m) => ({
          id: m.id,
          code: m.code,
          title: m.title,
          weight: m.weight,
          labHours: m.labHours,
          sortOrder: m.sortOrder,
        })),
    }));

    const mappedCohorts = allCohorts.map((coh) => ({
      id: coh.id,
      code: coh.code,
      name: coh.name,
      courseId: coh.courseId,
      termId: coh.termId,
      instructorId: coh.instructorId,
      instructorName: userMap.get(coh.instructorId)?.name ?? 'Instructor',
      classroomId: coh.classroomId,
      classroomName: coh.classroomId ? roomMap.get(coh.classroomId)?.name ?? null : null,
      capacity: coh.capacity,
      startDate: coh.startDate.toISOString(),
      endDate: coh.endDate.toISOString(),
      status: coh.status as 'Planned' | 'Active' | 'Completed' | 'Archived',
    }));

    const mappedAcademy = academyRow
      ? {
          id: academyRow.id,
          code: academyRow.code,
          name: academyRow.name,
          legalName: academyRow.legalName,
          email: academyRow.email,
          phone: academyRow.phone,
          website: academyRow.website,
          address: academyRow.address,
          logoDataUrl: academyRow.logoDataUrl,
          timezone: academyRow.timezone,
          currency: academyRow.currency,
        }
      : undefined;

    const mappedDepartments = allDepartments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      headUserId: d.headUserId,
      status: d.status,
      courseCount: allCourses.filter((c) => c.departmentId === d.id).length,
    }));

    const mappedClassrooms = allClassrooms.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      building: r.building,
      capacity: r.capacity,
      equipment: r.equipment,
      isActive: r.isActive,
    }));

    const mappedYears = allAcademicYears.map((y) => ({
      id: y.id,
      code: y.code,
      name: y.name,
      startDate: y.startDate.toISOString(),
      endDate: y.endDate.toISOString(),
      isCurrent: y.isCurrent,
      status: y.status,
    }));

    const mappedTerms = allAcademicTerms.map((t) => ({
      id: t.id,
      academicYearId: t.academicYearId,
      academicYearName: yearMap.get(t.academicYearId)?.name ?? '',
      code: t.code,
      name: t.name,
      startDate: t.startDate.toISOString(),
      endDate: t.endDate.toISOString(),
      isCurrent: t.isCurrent,
      status: t.status,
    }));

    const mappedEnrollments = allEnrollments.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      courseId: e.courseId,
      cohortId: e.cohortId,
      cohort: e.cohort,
      status: e.status as EnrollmentStatus,
      enrolledAt: e.enrolledAt.toISOString(),
      completedModuleIds: Array.isArray(e.completedModuleIds)
        ? (e.completedModuleIds as string[])
        : [],
    }));

    const mappedSessions = allSessions.map((s) => ({
      id: s.id,
      courseId: s.courseId,
      cohortId: s.cohortId,
      cohort: s.cohort,
      title: s.title,
      topic: s.topic,
      room: s.room,
      instructorId: s.instructorId,
      instructorName: s.instructorName,
      startIso: s.startIso.toISOString(),
      endIso: s.endIso.toISOString(),
      status: s.status as 'Scheduled' | 'Completed' | 'Cancelled',
    }));

    const mappedAttendance = allAttendance.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      courseId: a.courseId,
      studentId: a.studentId,
      status: a.status as AttendanceStatus,
      note: a.note,
      updatedAt: a.updatedAt.toISOString(),
      updatedBy: a.updatedBy,
    }));

    const mappedGrades = allGrades.map((g) => ({
      id: g.id,
      studentId: g.studentId,
      courseId: g.courseId,
      moduleId: g.moduleId,
      score: g.score,
      feedback: g.feedback,
      gradedAt: g.gradedAt.toISOString(),
      gradedBy: g.gradedBy,
    }));

    const mappedRemarks = allRemarks.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      courseId: r.courseId,
      summary: r.summary,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedBy,
    }));

    const mappedInvoices = allInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      studentId: inv.studentId,
      enrollmentId: inv.enrollmentId,
      courseId: inv.courseId,
      description: inv.description,
      amountDue: inv.amountDue.toFixed(2),
      amountPaid: inv.amountPaid.toFixed(2),
      currency: inv.currency,
      status: inv.status as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
      dueDate: inv.dueDate.toISOString(),
      isArchived: inv.isArchived,
      createdAt: inv.createdAt.toISOString(),
    }));

    const mappedPayments = allPayments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      invoiceId: p.invoiceId,
      studentId: p.studentId,
      amount: p.amount.toFixed(2),
      method: p.method as PaymentMethod,
      referenceCode: p.referenceCode,
      recordedByUserId: p.recordedByUserId,
      notes: p.notes,
      paidAt: p.paidAt.toISOString(),
    }));

    const mappedDocs: DocumentRecord[] = allDocs.map((d) => ({
      id: d.id,
      ownerUserId: d.ownerUserId ?? '',
      courseId: d.courseId,
      title: d.title,
      category: d.category as DocumentRecord['category'],
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedByUserId: d.uploadedByUserId ?? '',
      isArchived: d.isArchived,
      createdAt: d.createdAt.toISOString(),
    }));

    const mappedCerts: CertificateRecord[] = allCerts.map((c) => ({
      id: c.id,
      certificateCode: c.certificateCode,
      verificationHash: c.verificationHash,
      studentId: c.studentId,
      studentName: userMap.get(c.studentId)?.name,
      courseId: c.courseId,
      courseCode: courseMap.get(c.courseId)?.code,
      courseTitle: c.courseTitleSnapshot ?? courseMap.get(c.courseId)?.title,
      enrollmentId: c.enrollmentId,
      finalScore: c.finalScore.toFixed(2),
      letterGrade: c.letterGrade,
      attendanceRate: c.attendanceRate,
      issuedByName: c.issuedByName,
      status: c.status as CertificateRecord['status'],
      revokedReason: c.revokedReason,
      issuedAt: c.issuedAt.toISOString(),
    }));

    const mappedNotifs: NotificationItem[] = allNotifs.map((n) => ({
      id: n.id,
      userId: n.userId,
      kind: n.kind as NotificationItem['kind'],
      title: n.title,
      message: n.message,
      relatedCourseId: n.relatedCourseId,
      relatedSessionId: n.relatedSessionId,
      dedupeKey: n.dedupeKey,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));

    const publicUsers = allUsers.map(toPublicUser);
    const studentsList = publicUsers.filter((u) => u.role === 'student');

    const mappedAdmissions: AdmissionApplication[] = allAdmissions.map((a) => {
      const appDocs = allAdmissionDocs.filter((ad) => ad.applicationId === a.id);
      return {
        id: a.id,
        applicationNumber: a.applicationNumber,
        applicantName: a.applicantName,
        applicantEmail: a.applicantEmail,
        phone: a.phone,
        dateOfBirth: a.dateOfBirth ? a.dateOfBirth.toISOString().slice(0, 10) : null,
        gender: a.gender,
        nationality: a.nationality,
        address: a.address,
        city: a.city,
        postalCode: a.postalCode,
        guardianName: a.guardianName,
        guardianRelationship: a.guardianRelationship,
        guardianPhone: a.guardianPhone,
        guardianEmail: a.guardianEmail,
        previousQualification: a.previousQualification,
        previousInstitution: a.previousInstitution,
        graduationYear: a.graduationYear,
        previousScore: a.previousScore,
        targetCourseId: a.targetCourseId,
        targetBatchId: a.targetBatchId,
        allocatedBatchId: a.allocatedBatchId,
        feePlanId: a.feePlanId,
        preferredCohort: a.preferredCohort,
        status: a.status as AdmissionStatus,
        notes: a.notes,
        applicantRemarks: a.applicantRemarks,
        reviewRemarks: a.reviewRemarks,
        rejectionReason: a.rejectionReason,
        reviewedByUserId: a.reviewedByUserId,
        convertedUserId: a.convertedUserId,
        portalActivated: a.portalActivated,
        portalActivatedAt: a.portalActivatedAt ? a.portalActivatedAt.toISOString() : null,
        submittedAt: a.submittedAt.toISOString(),
        draftSavedAt: a.draftSavedAt ? a.draftSavedAt.toISOString() : null,
        reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
        approvedAt: a.approvedAt ? a.approvedAt.toISOString() : null,
        updatedAt: a.updatedAt.toISOString(),
        documentsCount: appDocs.length,
        verifiedDocumentsCount: appDocs.filter((ad) => ad.verifiedStatus === 'Verified').length,
      };
    });

    const mappedFeePlans: FeePlanSummary[] = allFeePlans.map((fp) => ({
      id: fp.id,
      code: fp.code,
      name: fp.name,
      description: fp.description,
      installmentCount: fp.installmentCount,
      currency: fp.currency,
      isActive: fp.isActive,
    }));

    const analytics = computeAcademyAnalytics({
      users: publicUsers,
      admissions: mappedAdmissions,
      enrollments: mappedEnrollments,
      invoices: mappedInvoices,
      certificates: mappedCerts,
      attendance: mappedAttendance,
    });

    if (publicUser.role === 'admin') {
      return {
        user: publicUser,
        academy: mappedAcademy,
        departments: mappedDepartments,
        classrooms: mappedClassrooms,
        academicYears: mappedYears,
        academicTerms: mappedTerms,
        feePlans: mappedFeePlans,
        courses: mappedCourses,
        cohorts: mappedCohorts,
        users: publicUsers,
        students: studentsList,
        admissions: mappedAdmissions,
        enrollments: mappedEnrollments,
        sessions: mappedSessions,
        attendance: mappedAttendance,
        grades: mappedGrades,
        remarks: mappedRemarks,
        invoices: mappedInvoices,
        payments: mappedPayments,
        documents: mappedDocs,
        certificates: mappedCerts,
        notifications: mappedNotifs,
        auditLogs: recentAudits.map((a) => ({
          id: a.id,
          actorUserId: a.actorUserId,
          actorEmail: a.actorEmail,
          actorRole: a.actorRole,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          summary: a.summary,
          metadata: (a.metadata as Record<string, unknown>) ?? {},
          createdAt: a.createdAt.toISOString(),
        })),
        analytics,
      };
    }

    if (publicUser.role === 'instructor') {
      const scope = await getInstructorScope(publicUser.id);
      const scopedCourses = mappedCourses.filter((c) => scope.courseIds.has(c.id));
      const scopedCohorts = mappedCohorts.filter(
        (coh) => scope.batchIds.has(coh.id) || scope.courseIds.has(coh.courseId)
      );
      const scopedEnrollments = mappedEnrollments.filter(
        (e) =>
          scope.courseIds.has(e.courseId) ||
          (e.cohortId ? scope.batchIds.has(e.cohortId) : false)
      );
      const scopedStudentIds = new Set(
        scopedEnrollments
          .filter((e) => !isInactiveEnrollmentStatus(e.status))
          .map((e) => e.studentId)
      );
      const scopedStudents = studentsList.filter((s) => scopedStudentIds.has(s.id));
      const scopedSessions = mappedSessions.filter(
        (s) =>
          scope.courseIds.has(s.courseId) ||
          s.instructorId === publicUser.id ||
          (s.cohortId ? scope.batchIds.has(s.cohortId) : false)
      );
      const scopedAttendance = mappedAttendance.filter(
        (a) => scope.courseIds.has(a.courseId) && scopedStudentIds.has(a.studentId)
      );
      const scopedGrades = mappedGrades.filter(
        (g) => scope.courseIds.has(g.courseId) && scopedStudentIds.has(g.studentId)
      );
      const scopedRemarks = mappedRemarks.filter(
        (r) => scope.courseIds.has(r.courseId) && scopedStudentIds.has(r.studentId)
      );
      const scopedCerts = mappedCerts.filter((c) => scope.courseIds.has(c.courseId));
      const scopedDocs = mappedDocs.filter(
        (d) =>
          !d.isArchived &&
          d.category !== 'Receipt' &&
          (d.ownerUserId === publicUser.id ||
            d.uploadedByUserId === publicUser.id ||
            (d.courseId ? scope.courseIds.has(d.courseId) : false) ||
            (d.ownerUserId ? scopedStudentIds.has(d.ownerUserId) : false))
      );
      const scopedNotifs = mappedNotifs.filter(
        (n) =>
          n.userId === publicUser.id ||
          (n.relatedCourseId ? scope.courseIds.has(n.relatedCourseId) : false)
      );
      const scopedAnalytics = computeAcademyAnalytics({
        users: [publicUser, ...scopedStudents],
        admissions: [],
        enrollments: scopedEnrollments,
        invoices: [],
        certificates: scopedCerts,
        attendance: scopedAttendance,
      });

      return {
        user: publicUser,
        academy: mappedAcademy,
        departments: mappedDepartments,
        classrooms: mappedClassrooms,
        courses: scopedCourses,
        cohorts: scopedCohorts,
        users: [publicUser, ...scopedStudents],
        students: scopedStudents,
        admissions: [],
        enrollments: scopedEnrollments,
        sessions: scopedSessions,
        attendance: scopedAttendance,
        grades: scopedGrades,
        remarks: scopedRemarks,
        invoices: [],
        payments: [],
        documents: scopedDocs,
        certificates: scopedCerts,
        notifications: scopedNotifs,
        auditLogs: [],
        analytics: {
          ...scopedAnalytics,
          totalBilledCents: 0,
          totalCollectedCents: 0,
          outstandingCents: 0,
          collectionRatePct: 0,
        },
      };
    }

    // Student strictly scoped view
    const myEnrollments = mappedEnrollments.filter((e) => e.studentId === publicUser.id);
    const myCourseIds = new Set(myEnrollments.map((e) => e.courseId));

    return {
      user: publicUser,
      academy: mappedAcademy,
      courses: mappedCourses,
      cohorts: mappedCohorts.filter((coh) => myCourseIds.has(coh.courseId)),
      users: [publicUser],
      students: [publicUser],
      admissions: [],
      enrollments: myEnrollments,
      sessions: mappedSessions.filter((s) => myCourseIds.has(s.courseId)),
      attendance: mappedAttendance.filter((a) => a.studentId === publicUser.id),
      grades: mappedGrades.filter((g) => g.studentId === publicUser.id),
      remarks: mappedRemarks.filter((r) => r.studentId === publicUser.id),
      invoices: mappedInvoices.filter((i) => i.studentId === publicUser.id && !i.isArchived),
      payments: mappedPayments.filter((p) => p.studentId === publicUser.id),
      documents: mappedDocs.filter(
        (d) =>
          !d.isArchived &&
          (d.ownerUserId === publicUser.id ||
            (d.category === 'Syllabus' && d.courseId && myCourseIds.has(d.courseId)))
      ),
      certificates: mappedCerts.filter((c) => c.studentId === publicUser.id),
      notifications: mappedNotifs.filter((n) => n.userId === publicUser.id),
      auditLogs: [],
      analytics: {
        totalStudents: 1,
        totalInstructors: 0,
        activeEnrollments: myEnrollments.filter((e) => e.status === 'Active').length,
        completedEnrollments: myEnrollments.filter((e) => e.status === 'Completed').length,
        pendingAdmissions: 0,
        totalBilledCents: 0,
        totalCollectedCents: 0,
        outstandingCents: 0,
        collectionRatePct: 100,
        certificatesIssued: mappedCerts.filter(
          (c) => c.studentId === publicUser.id && c.status === 'Issued'
        ).length,
        meanAttendanceRate: calculateAttendanceStats(
          mappedAttendance.filter((a) => a.studentId === publicUser.id)
        ).rate,
      },
    };
  } catch (err) {
    throw new Error('Failed to load InfoCom dashboard.', { cause: err });
  }
}

export async function createEnrollmentWithOptionalInvoice(params: {
  actor: UserPublic;
  studentId: string;
  courseId: string;
  cohort: string;
  cohortId?: string;
  status: 'Active' | 'Waitlisted';
  issueTuitionInvoice: boolean;
}) {
  try {
    if (params.actor.role === 'instructor') {
      if (params.issueTuitionInvoice) {
        return {
          ok: false as const,
          status: 403,
          error: 'Instructors cannot create tuition invoices or modify financial records.',
        };
      }
      const allowed = await canInstructorAccessCourse(params.actor.id, params.courseId);
      if (!allowed) {
        return {
          ok: false as const,
          status: 403,
          error: 'You are not assigned to manage enrollments for this course.',
        };
      }
    }

    const [student, course] = await Promise.all([
      prisma.user.findFirst({
        where: { id: params.studentId, role: 'student' },
      }),
      prisma.course.findUnique({
        where: { id: params.courseId },
        include: { instructor: true },
      }),
    ]);

    if (!student || !course) {
      return { ok: false as const, status: 400, error: 'Valid student and course are required.' };
    }

    const activeDuplicate = await prisma.enrollment.findFirst({
      where: {
        studentId: params.studentId,
        courseId: params.courseId,
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });

    if (activeDuplicate) {
      return {
        ok: false as const,
        status: 409,
        error: `${student.name} already has an active or waitlisted enrollment in ${course.code}.`,
      };
    }

    const matchedBatch = params.cohortId
      ? await prisma.batch.findUnique({ where: { id: params.cohortId } })
      : await prisma.batch.findFirst({
          where: { courseId: course.id, name: params.cohort },
        });

    const enrollmentId = `enr-${crypto.randomUUID().slice(0, 8)}`;

    await prisma.$transaction(async (tx) => {
      await tx.enrollment.create({
        data: {
          id: enrollmentId,
          studentId: params.studentId,
          courseId: params.courseId,
          cohortId: matchedBatch?.id ?? params.cohortId ?? null,
          cohort: params.cohort,
          status: params.status,
          completedModuleIds: [],
          tuitionSnapshot: course.tuitionFee,
          batchNameSnapshot: params.cohort,
          instructorNameSnapshot: course.instructor?.name ?? null,
        },
      });

      await tx.enrollmentHistory.create({
        data: {
          id: `eh-${crypto.randomUUID().slice(0, 8)}`,
          enrollmentId,
          previousStatus: null,
          newStatus: params.status,
          newBatchId: matchedBatch?.id ?? params.cohortId ?? null,
          reason: 'Enrollment created by academy staff',
          changedByUserId: params.actor.id,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: params.studentId,
          kind: 'enrollment',
          title: `Enrollment Confirmed · ${course.code}`,
          message: `You were enrolled in ${course.title} (${params.cohort}) with status ${params.status}.`,
          relatedCourseId: course.id,
          read: false,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: student.id,
          channel: 'in_app',
          recipient: student.email,
          status: 'Delivered',
        },
      });

      if (params.issueTuitionInvoice && toCents(course.tuitionFee.toString()) > 0) {
        const feeStruct = await tx.feeStructure.findFirst({
          where: { courseId: course.id, isActive: true },
        });
        const invId = `inv-${crypto.randomUUID().slice(0, 8)}`;
        const invNum = await generateNextInvoiceNumber(tx);
        const desc = `${course.code} ${course.title} Tuition (${params.cohort})`;

        await tx.invoice.create({
          data: {
            id: invId,
            invoiceNumber: invNum,
            studentId: params.studentId,
            enrollmentId,
            courseId: course.id,
            feeStructureId: feeStruct?.id ?? null,
            description: desc,
            subtotal: course.tuitionFee,
            amountDue: course.tuitionFee,
            amountPaid: '0.00',
            currency: 'USD',
            status: 'Unpaid',
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            issuedByUserId: params.actor.id,
          },
        });

        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId: invId,
            itemType: 'Tuition',
            description: desc,
            quantity: 1,
            unitPrice: course.tuitionFee,
            lineTotal: course.tuitionFee,
          },
        });
      }
    });

    await recordAuditLog({
      actor: params.actor,
      action: 'ENROLLMENT_CREATED',
      entityType: 'enrollment',
      entityId: enrollmentId,
      summary: `Enrolled ${student.name} in ${course.code} (${params.cohort}).`,
    });

    await runSessionReminderSweep();
    return { ok: true as const, enrollmentId };
  } catch (err) {
    throw new Error('Failed to create enrollment.', { cause: err });
  }
}

export async function recordInvoicePayment(params: {
  actor: UserPublic;
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  referenceCode: string;
  notes: string;
}) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: params.invoiceId },
        include: { student: { select: { email: true } } },
      });
      if (!invoice) {
        return { ok: false as const, status: 404, error: 'Invoice not found.' };
      }
      if (invoice.status === 'Voided' || invoice.isArchived) {
        return {
          ok: false as const,
          status: 400,
          error: 'Cannot record payment on a voided or archived invoice.',
        };
      }

      const dueCents = toCents(invoice.amountDue.toString());
      const paidCents = toCents(invoice.amountPaid.toString());
      const payCents = toCents(params.amount);
      const remainingCents = dueCents - paidCents;

      if (payCents <= 0) {
        return { ok: false as const, status: 400, error: 'Payment amount must be positive.' };
      }
      if (payCents > remainingCents) {
        return {
          ok: false as const,
          status: 400,
          error: `Payment exceeds remaining balance ($${fromCents(remainingCents)}).`,
        };
      }

      const newPaidStr = fromCents(paidCents + payCents);
      const newStatus = computeInvoiceStatus(invoice.amountDue.toString(), newPaidStr);
      const paymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
      const receiptNumber = await generateUniqueReceiptNumber(tx);
      const formattedPay = fromCents(payCents);

      await tx.payment.create({
        data: {
          id: paymentId,
          receiptNumber,
          invoiceId: invoice.id,
          studentId: invoice.studentId,
          amount: formattedPay,
          method: params.method,
          referenceCode: params.referenceCode,
          recordedByUserId: params.actor.id,
          notes: params.notes,
        },
      });

      await tx.paymentAllocation.create({
        data: {
          id: `alloc-${crypto.randomUUID().slice(0, 8)}`,
          paymentId,
          invoiceId: invoice.id,
          allocatedAmount: formattedPay,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newPaidStr,
          status: newStatus,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: invoice.studentId,
          kind: 'finance',
          title: `Payment Receipt · ${receiptNumber}`,
          message: `Payment of $${formattedPay} via ${params.method} applied to invoice ${invoice.invoiceNumber}. Status: ${newStatus}.`,
          relatedCourseId: invoice.courseId,
          read: false,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: invoice.studentId,
          channel: 'in_app',
          recipient: invoice.student?.email ?? invoice.studentId,
          status: 'Delivered',
        },
      });

      let portalAutoActivated = false;
      const activationPolicy = await getPortalActivationPolicy(tx);
      if (shouldActivatePortalOnPayment(activationPolicy)) {
        const studentRow = await tx.user.findUnique({
          where: { id: invoice.studentId },
          select: { id: true, status: true, email: true },
        });
        if (studentRow && studentRow.status === 'inactive') {
          const pendingAdmission = await tx.admissionApplication.findFirst({
            where: {
              convertedUserId: studentRow.id,
              status: { in: ['Approved', 'Enrolled', 'Accepted'] },
              portalActivated: false,
            },
          });
          if (pendingAdmission) {
            const now = new Date();
            await tx.user.update({
              where: { id: studentRow.id },
              data: { status: 'active' },
            });
            await tx.admissionApplication.updateMany({
              where: {
                convertedUserId: studentRow.id,
                portalActivated: false,
              },
              data: {
                portalActivated: true,
                portalActivatedAt: now,
              },
            });
            const actNotif = await tx.notification.create({
              data: {
                id: `not-${crypto.randomUUID().slice(0, 8)}`,
                userId: studentRow.id,
                kind: 'admission',
                title: 'Student Portal Activated',
                message: `Your student portal access is now active following payment receipt ${receiptNumber}.`,
                relatedCourseId: invoice.courseId,
                read: false,
              },
            });
            await tx.deliveryLog.create({
              data: {
                id: `del-${crypto.randomUUID().slice(0, 8)}`,
                notificationId: actNotif.id,
                userId: studentRow.id,
                applicationId: pendingAdmission.id,
                channel: 'in_app',
                recipient: studentRow.email,
                status: 'Delivered',
              },
            });
            portalAutoActivated = true;
          }
        }
      }

      return {
        ok: true as const,
        paymentId,
        receiptNumber,
        newStatus,
        invoiceNumber: invoice.invoiceNumber,
        portalAutoActivated,
        studentId: invoice.studentId,
      };
    });

    if (result.ok) {
      await recordAuditLog({
        actor: params.actor,
        action: 'PAYMENT_RECORDED',
        entityType: 'payment',
        entityId: result.paymentId,
        summary: `Recorded $${params.amount} payment (${result.receiptNumber}) on ${result.invoiceNumber} -> ${result.newStatus}.`,
      });
      if (result.portalAutoActivated) {
        await recordAuditLog({
          actor: params.actor,
          action: 'PORTAL_AUTO_ACTIVATED_ON_PAYMENT',
          entityType: 'user',
          entityId: result.studentId,
          summary: `Automatically activated student portal access after payment ${result.receiptNumber} per academy policy.`,
        });
      }
    }
    return result;
  } catch (err) {
    throw new Error('Failed to record payment.', { cause: err });
  }
}

export async function issueVerifiedCertificate(params: {
  actor: UserPublic;
  studentId: string;
  courseId: string;
}) {
  try {
    if (params.actor.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(params.actor.id, params.courseId);
      if (!allowed) {
        return {
          ok: false as const,
          status: 403,
          error: 'You are not assigned to issue certificates for this course.',
        };
      }
    }

    const [student, course] = await Promise.all([
      prisma.user.findFirst({
        where: { id: params.studentId, role: 'student' },
      }),
      prisma.course.findUnique({ where: { id: params.courseId } }),
    ]);

    if (!student || !course) {
      return { ok: false as const, status: 404, error: 'Student or course not found.' };
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: course.id,
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });

    if (!enrollment) {
      return { ok: false as const, status: 400, error: 'Student is not enrolled in this course.' };
    }

    const existingCert = await prisma.certificate.findUnique({
      where: {
        studentId_courseId: { studentId: student.id, courseId: course.id },
      },
    });

    if (existingCert && existingCert.status === 'Issued') {
      return {
        ok: false as const,
        status: 409,
        error: `Certificate ${existingCert.certificateCode} has already been issued for this course.`,
      };
    }

    const [mods, grades, att, template] = await Promise.all([
      prisma.courseModule.findMany({ where: { courseId: course.id } }),
      prisma.grade.findMany({
        where: { studentId: student.id, courseId: course.id },
      }),
      prisma.attendance.findMany({
        where: { studentId: student.id, courseId: course.id },
      }),
      prisma.certificateTemplate.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const completedIds = Array.isArray(enrollment.completedModuleIds)
      ? (enrollment.completedModuleIds as string[])
      : [];
    const completionPct = calculateCourseCompletion(completedIds, mods.length);

    const weightedScore = calculateWeightedAverage(
      mods
        .map((m) => {
          const g = grades.find((gr) => gr.moduleId === m.id);
          return g ? { score: g.score, weight: m.weight } : null;
        })
        .filter((x): x is { score: number; weight: number } => x !== null)
    );

    const attendanceStats = calculateAttendanceStats(
      att.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        courseId: a.courseId,
        studentId: a.studentId,
        status: a.status as AttendanceStatus,
        note: a.note,
        updatedAt: a.updatedAt.toISOString(),
        updatedBy: a.updatedBy,
      }))
    );

    const eligibility = computeCertificateEligibility({
      enrollmentStatus: enrollment.status as EnrollmentStatus,
      completionPct,
      weightedScore,
      attendanceRate: attendanceStats.rate,
    });

    if (!eligibility.eligible || weightedScore === null) {
      return {
        ok: false as const,
        status: 400,
        error: `Student is not eligible for certification: ${eligibility.reasons.join(' ')}`,
      };
    }

    const letterGrade = calculateLetterGrade(weightedScore);
    const prefixSetting = await prisma.academySetting.findFirst({
      where: { key: 'certificate.code_prefix' },
    });
    const certPrefix = prefixSetting?.value || 'INF-CERT-2026';
    const certCode = `${certPrefix}-${course.code.replace(/[^A-Z0-9]/g, '')}-${crypto.randomInt(1000, 9999)}`;
    const verificationHash = crypto
      .createHash('sha256')
      .update(`${certCode}:${student.id}:${course.id}:${weightedScore.toFixed(2)}`)
      .digest('hex')
      .slice(0, 24)
      .toUpperCase();

    const certId = `cert-${crypto.randomUUID().slice(0, 8)}`;

    await prisma.$transaction(async (tx) => {
      if (existingCert) {
        await tx.certificate.update({
          where: { id: existingCert.id },
          data: {
            certificateCode: certCode,
            verificationHash,
            templateId: template?.id ?? null,
            finalScore: weightedScore.toFixed(2),
            letterGrade,
            attendanceRate: attendanceStats.rate,
            issuedByUserId: params.actor.id,
            issuedByName: params.actor.name,
            courseTitleSnapshot: course.title,
            status: 'Issued',
            revokedReason: null,
            issuedAt: new Date(),
          },
        });
      } else {
        await tx.certificate.create({
          data: {
            id: certId,
            certificateCode: certCode,
            verificationHash,
            studentId: student.id,
            courseId: course.id,
            enrollmentId: enrollment.id,
            templateId: template?.id ?? null,
            finalScore: weightedScore.toFixed(2),
            letterGrade,
            attendanceRate: attendanceStats.rate,
            issuedByUserId: params.actor.id,
            issuedByName: params.actor.name,
            courseTitleSnapshot: course.title,
            status: 'Issued',
          },
        });
      }

      if (enrollment.status !== 'Completed') {
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: { status: 'Completed' },
        });
        await tx.enrollmentHistory.create({
          data: {
            id: `eh-${crypto.randomUUID().slice(0, 8)}`,
            enrollmentId: enrollment.id,
            previousStatus: enrollment.status,
            newStatus: 'Completed',
            reason: `Certificate ${certCode} issued`,
            changedByUserId: params.actor.id,
          },
        });
      }

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: student.id,
          kind: 'certificate',
          title: `Certificate Issued · ${course.code}`,
          message: `Congratulations! Official certificate ${certCode} has been issued for ${course.title} (Final Grade: ${weightedScore}% ${letterGrade}).`,
          relatedCourseId: course.id,
          read: false,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: student.id,
          channel: 'in_app',
          recipient: student.email,
          status: 'Delivered',
        },
      });
    });

    await recordAuditLog({
      actor: params.actor,
      action: 'CERTIFICATE_ISSUED',
      entityType: 'certificate',
      entityId: existingCert?.id ?? certId,
      summary: `Issued verified certificate ${certCode} to ${student.name} for ${course.code}.`,
    });

    return { ok: true as const, certificateCode: certCode };
  } catch (err) {
    throw new Error('Failed to issue certificate.', { cause: err });
  }
}

export async function verifyCertificateByCode(codeOrHash: string) {
  const clean = codeOrHash.trim().toUpperCase();
  if (!clean) return null;
  try {
    const cert = await prisma.certificate.findFirst({
      where: clean.startsWith('INF-CERT')
        ? { certificateCode: clean }
        : { verificationHash: clean },
      include: {
        student: { select: { name: true, studentCode: true } },
        course: { select: { code: true, title: true } },
      },
    });
    if (!cert) return null;

    return {
      certificateCode: cert.certificateCode,
      verificationHash: cert.verificationHash,
      studentName: cert.student?.name ?? 'Student',
      studentCode: cert.student?.studentCode ?? '',
      courseCode: cert.course?.code ?? '',
      courseTitle: cert.courseTitleSnapshot ?? cert.course?.title ?? '',
      finalScore: cert.finalScore.toFixed(2),
      letterGrade: cert.letterGrade,
      attendanceRate: cert.attendanceRate,
      issuedByName: cert.issuedByName,
      status: cert.status,
      revokedReason: cert.revokedReason,
      issuedAt: cert.issuedAt.toISOString(),
    };
  } catch (err) {
    throw new Error('Failed to verify certificate.', { cause: err });
  }
}

export async function markAttendanceAndNotify(params: {
  actor: UserPublic;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  note: string;
}) {
  try {
    const session = await prisma.classSession.findUnique({
      where: { id: params.sessionId },
    });
    if (!session) return { ok: false as const, status: 404, error: 'Session not found.' };

    if (params.actor.role === 'instructor') {
      const assigned = await canInstructorAccessCourse(params.actor.id, session.courseId);
      if (!assigned && session.instructorId !== params.actor.id) {
        return {
          ok: false as const,
          status: 403,
          error: 'You are not authorized to mark attendance for this session.',
        };
      }
    }

    const [course, student] = await Promise.all([
      prisma.course.findUnique({ where: { id: session.courseId } }),
      prisma.user.findFirst({ where: { id: params.studentId, role: 'student' } }),
    ]);
    if (!course || !student) {
      return { ok: false as const, status: 404, error: 'Course or student not found.' };
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        courseId: course.id,
        cohort: session.cohort,
        status: { in: ['Active', 'Completed', 'Waitlisted'] },
      },
    });

    if (!enrollment) {
      return {
        ok: false as const,
        status: 400,
        error: 'Student does not have an active enrollment in this session cohort.',
      };
    }

    const now = new Date();
    const notifData = buildAttendanceNotification({
      id: `not-${crypto.randomUUID().slice(0, 8)}`,
      studentId: student.id,
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        track: course.track,
        instructorId: course.instructorId,
        instructorName: params.actor.name,
        durationWeeks: course.durationWeeks,
        tuitionFee: course.tuitionFee.toFixed(2),
        modules: [],
      },
      session: {
        id: session.id,
        courseId: session.courseId,
        cohort: session.cohort,
        title: session.title,
        topic: session.topic,
        room: session.room,
        instructorName: session.instructorName,
        startIso: session.startIso.toISOString(),
        endIso: session.endIso.toISOString(),
      },
      status: params.status,
      note: params.note,
      createdAt: now.toISOString(),
    });

    await prisma.$transaction(async (tx) => {
      await tx.attendance.upsert({
        where: {
          sessionId_studentId: { sessionId: session.id, studentId: student.id },
        },
        update: {
          status: params.status,
          note: params.note.trim(),
          enrollmentId: enrollment.id,
          updatedAt: now,
          updatedByUserId: params.actor.id,
          updatedBy: params.actor.name,
        },
        create: {
          id: `att-${crypto.randomUUID().slice(0, 8)}`,
          sessionId: session.id,
          courseId: course.id,
          enrollmentId: enrollment.id,
          studentId: student.id,
          status: params.status,
          note: params.note.trim(),
          updatedAt: now,
          updatedByUserId: params.actor.id,
          updatedBy: params.actor.name,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: notifData.id,
          userId: notifData.userId,
          kind: notifData.kind,
          title: notifData.title,
          message: notifData.message,
          relatedCourseId: notifData.relatedCourseId,
          relatedSessionId: notifData.relatedSessionId,
          read: false,
          createdAt: now,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: student.id,
          channel: 'in_app',
          recipient: student.email,
          status: 'Delivered',
        },
      });
    });

    await recordAuditLog({
      actor: params.actor,
      action: 'ATTENDANCE_RECORDED',
      entityType: 'attendance',
      entityId: `${session.id}:${student.id}`,
      summary: `Marked ${student.name} as ${params.status} for "${session.title}".`,
    });

    return { ok: true as const };
  } catch (err) {
    throw new Error('Failed to record attendance.', { cause: err });
  }
}

export async function getUserDashboardById(userId: string): Promise<DashboardPayload> {
  const row = await findUserById(userId);
  if (!row) {
    throw new Error('Authenticated user record not found.');
  }
  return buildDashboardForUser(row);
}

export async function getActiveDocumentContent(
  docId: string,
  requester: UserPublic
) {
  try {
    const doc = await prisma.fileAsset.findUnique({ where: { id: docId } });
    if (!doc || doc.isArchived) return null;

    if (requester.role === 'student') {
      const isOwner = doc.ownerUserId === requester.id;
      let isSyllabusForEnrolledCourse = false;
      if (doc.category === 'Syllabus' && doc.courseId) {
        const enrolled = await prisma.enrollment.findFirst({
          where: {
            studentId: requester.id,
            courseId: doc.courseId,
            status: { in: ['Active', 'Completed'] },
          },
          select: { id: true },
        });
        isSyllabusForEnrolledCourse = Boolean(enrolled);
      }
      if (!isOwner && !isSyllabusForEnrolledCourse) {
        return 'FORBIDDEN' as const;
      }
    } else if (requester.role === 'instructor') {
      if (doc.category === 'Receipt') {
        return 'FORBIDDEN' as const;
      }
      const isOwnerOrUploader =
        doc.ownerUserId === requester.id || doc.uploadedByUserId === requester.id;
      const inAssignedCourse = doc.courseId
        ? await canInstructorAccessCourse(requester.id, doc.courseId)
        : false;
      const isAuthorizedStudent = doc.ownerUserId
        ? await canInstructorAccessStudent(requester.id, doc.ownerUserId)
        : false;
      if (!isOwnerOrUploader && !inAssignedCourse && !isAuthorizedStudent) {
        return 'FORBIDDEN' as const;
      }
    }
    return doc;
  } catch (err) {
    throw new Error('Failed to retrieve document content.', { cause: err });
  }
}

// ============================================================================
// PHASE 4: ADMIN ANALYTICS, STUDENT/INSTRUCTOR DETAILS & ACADEMY SETTINGS
// ============================================================================

export async function computeAdminAnalyticsSummary(params: {
  preset: AnalyticsPreset;
  from?: string;
  to?: string;
}): Promise<AdminAnalyticsDetail> {
  const window = resolveAnalyticsDateWindow(params.preset, params.from, params.to);
  const inWindow = (dt: Date) => {
    const ms = dt.getTime();
    if (window.fromMs !== null && ms < window.fromMs) return false;
    if (window.toMs !== null && ms > window.toMs) return false;
    return true;
  };

  const [
    academy,
    users,
    courses,
    batches,
    admissions,
    enrollments,
    sessions,
    attendance,
    invoices,
    payments,
    certificates,
  ] = await Promise.all([
    prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.user.findMany({ select: { id: true, name: true, role: true, status: true } }),
    prisma.course.findMany({ select: { id: true, isArchived: true } }),
    prisma.batch.findMany({ select: { id: true, status: true } }),
    prisma.admissionApplication.findMany({ orderBy: { submittedAt: 'desc' } }),
    prisma.enrollment.findMany({ orderBy: { enrolledAt: 'desc' } }),
    prisma.classSession.findMany({ orderBy: { startIso: 'asc' } }),
    prisma.attendance.findMany(),
    prisma.invoice.findMany({
      where: { isArchived: false, status: { not: 'Voided' } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.findMany({
      include: {
        invoice: { select: { invoiceNumber: true } },
        student: { select: { name: true } },
      },
      orderBy: { paidAt: 'desc' },
    }),
    prisma.certificate.findMany(),
  ]);

  const activeStudents = users.filter((u) => u.role === 'student' && u.status === 'active').length;
  const activeInstructors = users.filter(
    (u) => u.role === 'instructor' && u.status === 'active'
  ).length;
  const admissionsPending = admissions.filter((a) => isPendingAdmissionStatus(a.status)).length;
  const activeCourses = courses.filter((c) => !c.isArchived).length;
  const totalBatches = batches.filter((b) => b.status !== 'Archived').length;

  const tz = academy?.timezone || 'Asia/Kolkata';
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const todaysClasses = sessions
    .filter((s) => {
      if (s.status === 'Cancelled') return false;
      const sKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(s.startIso);
      return sKey === todayKey;
    })
    .map((s) => ({
      id: s.id,
      courseId: s.courseId,
      cohortId: s.cohortId,
      classroomId: s.classroomId,
      cohort: s.cohort,
      title: s.title,
      topic: s.topic,
      room: s.room,
      instructorId: s.instructorId,
      instructorName: s.instructorName,
      startIso: s.startIso.toISOString(),
      endIso: s.endIso.toISOString(),
      status: s.status as 'Scheduled' | 'Completed' | 'Cancelled',
    }));

  const windowedAttendance = attendance
    .filter((a) => inWindow(a.updatedAt))
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
  const attendanceOverview = calculateAttendanceStats(windowedAttendance);

  let outstandingFeesCents = 0;
  for (const inv of invoices) {
    const due = toCents(inv.amountDue.toFixed(2));
    const paid = toCents(inv.amountPaid.toFixed(2));
    outstandingFeesCents += Math.max(0, due - paid);
  }

  const now = new Date();
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let monthlyRevenueCents = 0;
  let totalCollectedCents = 0;

  for (const pay of payments) {
    const cents = toCents(pay.amount.toFixed(2));
    if (inWindow(pay.paidAt)) {
      totalCollectedCents += cents;
    }
    if (pay.paidAt.getTime() >= currentMonthStart) {
      monthlyRevenueCents += cents;
    }
  }

  const certificatesIssued = certificates.filter(
    (c) => c.status === 'Issued' && inWindow(c.issuedAt)
  ).length;

  const mappedInvoices = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    studentId: inv.studentId,
    enrollmentId: inv.enrollmentId,
    courseId: inv.courseId,
    description: inv.description,
    amountDue: inv.amountDue.toFixed(2),
    amountPaid: inv.amountPaid.toFixed(2),
    currency: inv.currency,
    status: inv.status as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
    dueDate: inv.dueDate.toISOString(),
    isArchived: inv.isArchived,
    createdAt: inv.createdAt.toISOString(),
  }));

  const mappedPayments = payments.map((p) => ({
    amount: p.amount.toFixed(2),
    paidAt: p.paidAt.toISOString(),
  }));

  const mappedEnrollments = enrollments.map((e) => ({
    id: e.id,
    studentId: e.studentId,
    courseId: e.courseId,
    cohortId: e.cohortId,
    cohort: e.cohort,
    status: e.status as EnrollmentStatus,
    enrolledAt: e.enrolledAt.toISOString(),
    completedModuleIds: Array.isArray(e.completedModuleIds)
      ? (e.completedModuleIds as string[])
      : [],
  }));

  const monthlyRevenueSeries = buildMonthlyRevenueSeries({
    invoices: mappedInvoices,
    payments: mappedPayments,
    monthsCount: 6,
  });

  const enrollmentTrendSeries = buildEnrollmentTrendSeries({
    enrollments: mappedEnrollments,
    monthsCount: 6,
  });

  const recentTransactions = payments
    .filter((p) => inWindow(p.paidAt))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      invoiceNumber: p.invoice?.invoiceNumber ?? '—',
      studentName: p.student?.name ?? 'Student',
      amount: p.amount.toFixed(2),
      method: p.method as PaymentMethod,
      paidAt: p.paidAt.toISOString(),
    }));

  const pendingActions: AdminAnalyticsDetail['pendingActions'] = [];
  for (const adm of admissions) {
    if (adm.status === 'Submitted' || adm.status === 'Under Review' || adm.status === 'Accepted') {
      pendingActions.push({
        id: `act-adm-${adm.id}`,
        kind: 'admission',
        title: `Admission ${adm.status}: ${adm.applicantName}`,
        detail: `${adm.preferredCohort} · Submitted ${adm.submittedAt.toLocaleDateString('en-US')}`,
        targetSection: 'admissions',
      });
    }
  }
  const userNameMap = new Map(users.map((u) => [u.id, u.name]));
  for (const inv of invoices) {
    const remaining = toCents(inv.amountDue.toFixed(2)) - toCents(inv.amountPaid.toFixed(2));
    if (remaining > 0 && inv.dueDate.getTime() < Date.now()) {
      pendingActions.push({
        id: `act-inv-${inv.id}`,
        kind: 'overdue_invoice',
        title: `Overdue Invoice ${inv.invoiceNumber}`,
        detail: `${userNameMap.get(inv.studentId) ?? 'Student'} · Balance $${fromCents(remaining)}`,
        targetSection: 'finance',
      });
    }
  }

  return {
    dateRange: {
      preset: params.preset,
      fromIso: window.fromIso,
      toIso: window.toIso,
    },
    kpis: {
      activeStudents,
      activeInstructors,
      admissionsPending,
      activeCourses,
      totalBatches,
      todaysClassesCount: todaysClasses.length,
      attendanceOverview,
      outstandingFeesCents,
      monthlyRevenueCents,
      totalCollectedCents,
      certificatesIssued,
      pendingAdminActionsCount: pendingActions.length,
    },
    monthlyRevenueSeries,
    enrollmentTrendSeries,
    todaysClasses,
    recentTransactions,
    pendingActions: pendingActions.slice(0, 8),
  };
}

export async function getStudentDetail(studentId: string): Promise<StudentDetailPayload | null> {
  const user = await prisma.user.findFirst({
    where: { id: studentId, role: 'student' },
    include: {
      studentProfile: { include: { department: true } },
    },
  });
  if (!user) return null;

  const [enrollments, grades, attendance, documents, certificates, invoices, payments] =
    await Promise.all([
      prisma.enrollment.findMany({
        where: { studentId },
        include: {
          course: { include: { modules: { orderBy: { sortOrder: 'asc' } } } },
          batch: true,
          history: { orderBy: { changedAt: 'desc' } },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      prisma.grade.findMany({ where: { studentId } }),
      prisma.attendance.findMany({ where: { studentId } }),
      prisma.fileAsset.findMany({
        where: { ownerUserId: studentId, isArchived: false },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.certificate.findMany({
        where: { studentId },
        include: { course: { select: { code: true, title: true } } },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { studentId, isArchived: false },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: { studentId },
        orderBy: { paidAt: 'desc' },
      }),
    ]);

  const mappedAttendance = attendance.map((a) => ({
    id: a.id,
    sessionId: a.sessionId,
    courseId: a.courseId,
    studentId: a.studentId,
    status: a.status as AttendanceStatus,
    note: a.note,
    updatedAt: a.updatedAt.toISOString(),
    updatedBy: a.updatedBy,
  }));
  const overallAttStats = calculateAttendanceStats(mappedAttendance);

  let totalBilledCents = 0;
  let totalPaidCents = 0;
  for (const inv of invoices) {
    if (inv.status === 'Voided') continue;
    totalBilledCents += toCents(inv.amountDue.toFixed(2));
    totalPaidCents += Math.min(
      toCents(inv.amountDue.toFixed(2)),
      toCents(inv.amountPaid.toFixed(2))
    );
  }
  const outstandingCents = Math.max(0, totalBilledCents - totalPaidCents);

  const historyList = enrollments
    .flatMap((e) =>
      e.history.map((h) => ({
        id: h.id,
        enrollmentId: h.enrollmentId,
        previousStatus: h.previousStatus,
        newStatus: h.newStatus,
        previousBatchId: h.previousBatchId,
        newBatchId: h.newBatchId,
        reason: h.reason,
        changedByUserId: h.changedByUserId,
        changedAt: h.changedAt.toISOString(),
      }))
    )
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt));

  return {
    student: {
      user: toPublicUser(user),
      profile: user.studentProfile
        ? {
            id: user.studentProfile.id,
            departmentId: user.studentProfile.departmentId,
            departmentName: user.studentProfile.department?.name ?? null,
            dateOfBirth: user.studentProfile.dateOfBirth
              ? user.studentProfile.dateOfBirth.toISOString()
              : null,
            address: user.studentProfile.address,
            emergencyContact: user.studentProfile.emergencyContact,
            academicStanding: user.studentProfile.academicStanding,
            enrollmentDate: user.studentProfile.enrollmentDate.toISOString(),
          }
        : null,
      activeEnrollmentsCount: enrollments.filter((e) => e.status === 'Active').length,
      completedCoursesCount: enrollments.filter((e) => e.status === 'Completed').length,
      outstandingCents,
      attendanceRate: overallAttStats.rate,
    },
    enrollments: enrollments.map((e) => {
      const completedIds = Array.isArray(e.completedModuleIds)
        ? (e.completedModuleIds as string[])
        : [];
      const completionPct = calculateCourseCompletion(completedIds, e.course.modules.length);
      const gradedItems = e.course.modules
        .map((m) => {
          const gr = grades.find((g) => g.courseId === e.courseId && g.moduleId === m.id);
          return gr ? { score: gr.score, weight: m.weight } : null;
        })
        .filter((x): x is { score: number; weight: number } => x !== null);
      const weightedScore = calculateWeightedAverage(gradedItems);
      const courseAtt = mappedAttendance.filter((a) => a.courseId === e.courseId);
      return {
        id: e.id,
        studentId: e.studentId,
        courseId: e.courseId,
        cohortId: e.cohortId,
        cohort: e.cohort,
        status: e.status as EnrollmentStatus,
        enrolledAt: e.enrolledAt.toISOString(),
        completedModuleIds: completedIds,
        courseCode: e.course.code,
        courseTitle: e.course.title,
        batchCode: e.batch?.code ?? null,
        completionPct,
        weightedScore,
        letterGrade: calculateLetterGrade(weightedScore),
        attendanceRate: calculateAttendanceStats(courseAtt).rate,
      };
    }),
    enrollmentHistory: historyList,
    documents: documents.map((d) => ({
      id: d.id,
      ownerUserId: d.ownerUserId ?? '',
      courseId: d.courseId,
      title: d.title,
      category: d.category as DocumentRecord['category'],
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedByUserId: d.uploadedByUserId ?? '',
      isArchived: d.isArchived,
      createdAt: d.createdAt.toISOString(),
    })),
    certificates: certificates.map((c) => ({
      id: c.id,
      certificateCode: c.certificateCode,
      verificationHash: c.verificationHash,
      studentId: c.studentId,
      studentName: user.name,
      courseId: c.courseId,
      courseCode: c.course?.code,
      courseTitle: c.courseTitleSnapshot ?? c.course?.title,
      enrollmentId: c.enrollmentId,
      finalScore: c.finalScore.toFixed(2),
      letterGrade: c.letterGrade,
      attendanceRate: c.attendanceRate,
      issuedByName: c.issuedByName,
      status: c.status as CertificateRecord['status'],
      revokedReason: c.revokedReason,
      issuedAt: c.issuedAt.toISOString(),
    })),
    feeStatement: {
      totalBilledCents,
      totalPaidCents,
      outstandingCents,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        studentId: inv.studentId,
        enrollmentId: inv.enrollmentId,
        courseId: inv.courseId,
        description: inv.description,
        amountDue: inv.amountDue.toFixed(2),
        amountPaid: inv.amountPaid.toFixed(2),
        currency: inv.currency,
        status: inv.status as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
        dueDate: inv.dueDate.toISOString(),
        isArchived: inv.isArchived,
        createdAt: inv.createdAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        invoiceId: p.invoiceId,
        studentId: p.studentId,
        amount: p.amount.toFixed(2),
        method: p.method as PaymentMethod,
        referenceCode: p.referenceCode,
        recordedByUserId: p.recordedByUserId,
        notes: p.notes,
        paidAt: p.paidAt.toISOString(),
      })),
    },
  };
}

export async function listInstructorsWithMetrics(): Promise<InstructorDirectoryRow[]> {
  const [instructors, courses, batches, assignments, enrollments, sessions, attendance, grades] =
    await Promise.all([
      prisma.user.findMany({
        where: { role: 'instructor' },
        include: {
          instructorProfile: { include: { department: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.course.findMany(),
      prisma.batch.findMany(),
      prisma.instructorAssignment.findMany({ where: { isActive: true } }),
      prisma.enrollment.findMany({ where: { status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] } } }),
      prisma.classSession.findMany(),
      prisma.attendance.findMany(),
      prisma.grade.findMany(),
    ]);

  const validPermSet = new Set<string>(DEFAULT_INSTRUCTOR_PERMISSIONS);
  const nowMs = Date.now();

  return instructors.map((ins) => {
    const courseIds = new Set<string>(
      courses.filter((c) => c.instructorId === ins.id).map((c) => c.id)
    );
    const batchIds = new Set<string>(
      batches.filter((b) => b.instructorId === ins.id).map((b) => b.id)
    );
    for (const b of batches) {
      if (b.instructorId === ins.id) courseIds.add(b.courseId);
    }
    for (const a of assignments) {
      if (a.instructorId === ins.id) {
        courseIds.add(a.courseId);
        batchIds.add(a.batchId);
      }
    }

    const assignedStudents = new Set<string>();
    for (const e of enrollments) {
      if (courseIds.has(e.courseId) || (e.cohortId && batchIds.has(e.cohortId))) {
        assignedStudents.add(e.studentId);
      }
    }

    const insSessions = sessions.filter(
      (s) =>
        s.status !== 'Cancelled' &&
        (s.instructorId === ins.id ||
          courseIds.has(s.courseId) ||
          (s.cohortId && batchIds.has(s.cohortId)))
    );
    const sessionsTaughtCount = insSessions.filter(
      (s) => s.status === 'Completed' || s.endIso.getTime() < nowMs
    ).length;
    const upcomingSessionsCount = insSessions.filter(
      (s) => s.status === 'Scheduled' && s.startIso.getTime() >= nowMs
    ).length;

    const sessionIds = new Set(insSessions.map((s) => s.id));
    const relevantAtt = attendance
      .filter((a) => sessionIds.has(a.sessionId) || courseIds.has(a.courseId))
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
    const meanAttendanceRate = calculateAttendanceStats(relevantAtt).rate;

    const relevantGrades = grades.filter(
      (g) => g.gradedByUserId === ins.id || courseIds.has(g.courseId)
    );
    const meanGradedScore =
      relevantGrades.length > 0
        ? Math.round(
            (relevantGrades.reduce((sum, g) => sum + g.score, 0) / relevantGrades.length) * 10
          ) / 10
        : null;

    const profile = ins.instructorProfile;
    const configured = Boolean(profile?.permissionsConfigured);
    const rawPerms = Array.isArray(profile?.permissions) ? profile.permissions : [];
    const permissions: InstructorPermissionKey[] = configured
      ? rawPerms.filter(
          (p): p is InstructorPermissionKey => typeof p === 'string' && validPermSet.has(p)
        )
      : [...DEFAULT_INSTRUCTOR_PERMISSIONS];

    return {
      user: toPublicUser(ins),
      profile: {
        id: profile?.id ?? `ip-${ins.id}`,
        staffCode: profile?.staffCode ?? ins.staffCode ?? '',
        departmentId: profile?.departmentId ?? null,
        departmentName: profile?.department?.name ?? ins.department ?? null,
        specialization: profile?.specialization ?? '',
        qualification: profile?.qualification ?? '',
        bio: profile?.bio ?? '',
        hireDate: profile?.hireDate ? profile.hireDate.toISOString() : null,
        permissionsConfigured: configured,
        permissions,
      },
      assignedCoursesCount: courseIds.size,
      assignedBatchesCount: batchIds.size,
      assignedStudentsCount: assignedStudents.size,
      sessionsTaughtCount,
      upcomingSessionsCount,
      meanAttendanceRate,
      meanGradedScore,
    };
  });
}

export async function getInstructorDetail(
  instructorId: string
): Promise<InstructorDetailPayload | null> {
  const list = await listInstructorsWithMetrics();
  const row = list.find((r) => r.user.id === instructorId);
  if (!row) return null;

  const scope = await getInstructorScope(instructorId);
  const courseIds = Array.from(scope.courseIds);
  const batchIds = Array.from(scope.batchIds);

  const [courses, batches, sessions, enrollments, departments, classrooms] = await Promise.all([
    courseIds.length > 0
      ? prisma.course.findMany({
          where: { id: { in: courseIds } },
          include: { modules: { orderBy: { sortOrder: 'asc' } }, instructor: true },
        })
      : [],
    batchIds.length > 0 || courseIds.length > 0
      ? prisma.batch.findMany({
          where: {
            OR: [
              ...(batchIds.length > 0 ? [{ id: { in: batchIds } }] : []),
              ...(courseIds.length > 0 ? [{ courseId: { in: courseIds } }] : []),
            ],
          },
          include: { course: true, instructor: true },
        })
      : [],
    prisma.classSession.findMany({
      where: {
        OR: [
          { instructorId },
          ...(courseIds.length > 0 ? [{ courseId: { in: courseIds } }] : []),
        ],
      },
      orderBy: { startIso: 'desc' },
      take: 40,
    }),
    prisma.enrollment.findMany({ where: { status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] } } }),
    prisma.department.findMany(),
    prisma.classroom.findMany(),
  ]);

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const roomMap = new Map(classrooms.map((r) => [r.id, r.name]));

  return {
    instructor: row,
    assignedCourses: courses.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      track: c.track,
      category: c.category,
      departmentId: c.departmentId,
      departmentName: c.departmentId ? deptMap.get(c.departmentId) ?? null : null,
      description: c.description,
      prerequisites: c.prerequisites,
      learningObjectives: Array.isArray(c.learningObjectives)
        ? (c.learningObjectives as string[])
        : [],
      passingScore: c.passingScore,
      minAttendanceRate: c.minAttendanceRate,
      instructorId: c.instructorId,
      instructorName: c.instructor?.name ?? row.user.name,
      durationWeeks: c.durationWeeks,
      tuitionFee: c.tuitionFee.toFixed(2),
      isArchived: c.isArchived,
      modules: c.modules.map((m) => ({
        id: m.id,
        code: m.code,
        title: m.title,
        weight: m.weight,
        labHours: m.labHours,
        sortOrder: m.sortOrder,
      })),
    })),
    assignedBatches: batches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      courseId: b.courseId,
      termId: b.termId,
      instructorId: b.instructorId,
      instructorName: b.instructor?.name ?? row.user.name,
      classroomId: b.classroomId,
      classroomName: b.classroomId ? roomMap.get(b.classroomId) ?? null : null,
      capacity: b.capacity,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      status: b.status as 'Planned' | 'Active' | 'Completed' | 'Archived',
      courseCode: b.course.code,
      courseTitle: b.course.title,
      enrolledCount: enrollments.filter(
        (e) => e.courseId === b.courseId && (e.cohortId === b.id || e.cohort === b.name)
      ).length,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      courseId: s.courseId,
      cohortId: s.cohortId,
      classroomId: s.classroomId,
      cohort: s.cohort,
      title: s.title,
      topic: s.topic,
      room: s.room,
      instructorId: s.instructorId,
      instructorName: s.instructorName,
      startIso: s.startIso.toISOString(),
      endIso: s.endIso.toISOString(),
      status: s.status as 'Scheduled' | 'Completed' | 'Cancelled',
    })),
  };
}

export async function getAcademySettingsPayload(): Promise<AcademySettingsPayload> {
  const [academy, settingsRows, certTemplate, years, terms, departments, classrooms, courses] =
    await Promise.all([
      prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } }),
      prisma.academySetting.findMany(),
      prisma.certificateTemplate.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.academicYear.findMany({ orderBy: { startDate: 'desc' } }),
      prisma.academicTerm.findMany({ orderBy: { startDate: 'desc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.classroom.findMany({ orderBy: { code: 'asc' } }),
      prisma.course.findMany({ select: { departmentId: true } }),
    ]);

  const map = new Map(settingsRows.map((s) => [s.key, s.value]));
  const num = (key: string, fallback: number) => {
    const val = Number(map.get(key));
    return Number.isFinite(val) ? val : fallback;
  };
  const yearMap = new Map(years.map((y) => [y.id, y.name]));

  return {
    academy: academy
      ? {
          id: academy.id,
          code: academy.code,
          name: academy.name,
          legalName: academy.legalName,
          email: academy.email,
          phone: academy.phone,
          website: academy.website,
          address: academy.address,
          logoDataUrl: academy.logoDataUrl,
          timezone: academy.timezone || 'Asia/Kolkata',
          currency: academy.currency || 'USD',
        }
      : {
          id: 'acad-infocom',
          code: 'INFOCOM-MAIN',
          name: 'InfoCom Academy',
          legalName: 'InfoCom Computer Training & Engineering Institute',
          email: 'registrar@infocom.edu',
          phone: '+91 80 4120 8800',
          website: 'https://infocom.edu',
          address: '420 Innovation Way, Suite 300, Bengaluru',
          logoDataUrl: '',
          timezone: 'Asia/Kolkata',
          currency: 'USD',
        },
    policies: {
      invoicePrefix: map.get('academy.invoice_prefix') || 'INV-2026',
      invoiceNextSeq: num('academy.invoice_next_seq', 1050),
      feeDueDays: num('academy.fee_due_days', 14),
      lateFeePct: num('academy.late_fee_pct', 5),
      passingScore: num('grading.passing_score', 60),
      distinctionScore: num('grading.distinction_score', 90),
      minAttendanceRatePct: num('attendance.min_rate_pct', 75),
      lateWeightPct: num('attendance.late_weight_pct', 75),
      reminderWindowHours: num('session.reminder_window_hours', 24),
      certificateCodePrefix: map.get('certificate.code_prefix') || 'INF-CERT-2026',
      certificateMinCompletionPct: num('certificate.min_completion_pct', 100),
      certificateMinScore: num('certificate.min_weighted_score', 60),
      certificateMinAttendancePct: num('certificate.min_attendance_pct', 75),
      portalActivationPolicy: (() => {
        const val = map.get('admission.portal_activation_policy');
        if (
          val === 'immediate' ||
          val === 'on_approval' ||
          val === 'manual_activation' ||
          val === 'after_first_payment'
        ) {
          return val;
        }
        return 'on_approval';
      })(),
    },
    certificateTemplate: certTemplate
      ? {
          id: certTemplate.id,
          code: certTemplate.code,
          name: certTemplate.name,
          titleFormat: certTemplate.titleFormat,
          signatoryName: certTemplate.signatoryName,
          signatoryTitle: certTemplate.signatoryTitle,
          minCompletionPct: certTemplate.minCompletionPct,
          minScore: certTemplate.minScore,
          minAttendancePct: certTemplate.minAttendancePct,
          isActive: certTemplate.isActive,
        }
      : null,
    academicYears: years.map((y) => ({
      id: y.id,
      code: y.code,
      name: y.name,
      startDate: y.startDate.toISOString(),
      endDate: y.endDate.toISOString(),
      isCurrent: y.isCurrent,
      status: y.status,
    })),
    academicTerms: terms.map((t) => ({
      id: t.id,
      academicYearId: t.academicYearId,
      academicYearName: yearMap.get(t.academicYearId) ?? '',
      code: t.code,
      name: t.name,
      startDate: t.startDate.toISOString(),
      endDate: t.endDate.toISOString(),
      isCurrent: t.isCurrent,
      status: t.status,
    })),
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      headUserId: d.headUserId,
      status: d.status,
      courseCount: courses.filter((c) => c.departmentId === d.id).length,
    })),
    classrooms: classrooms.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      building: r.building,
      capacity: r.capacity,
      equipment: r.equipment,
      isActive: r.isActive,
    })),
  };
}

