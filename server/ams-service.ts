import crypto from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  admissions,
  attendanceRecords,
  auditLogs,
  certificates,
  classSessions,
  cohorts,
  courseModules,
  courses,
  documents,
  enrollments,
  feeInvoices,
  moduleGrades,
  notifications,
  payments,
  progressRemarks,
  users,
} from '../src/db/schema.ts';
import {
  buildAttendanceNotification,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeAcademyAnalytics,
  computeCertificateEligibility,
  computeInvoiceStatus,
  findUpcomingSessionsNeedingReminders,
  fromCents,
  toCents,
} from '../src/shared/academic.ts';
import type {
  AttendanceStatus,
  CertificateRecord,
  Course,
  DashboardPayload,
  DocumentRecord,
  EnrollmentStatus,
  NotificationItem,
  PaymentMethod,
  UserPublic,
  UserRole,
} from '../src/shared/types.ts';
import { hashPassword } from './auth.ts';
import { ensureDatabaseMigratedAndSeeded } from './migrate.ts';

type DbUserRow = typeof users.$inferSelect;

export function toPublicUser(u: DbUserRow): UserPublic {
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
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      actorUserId: params.actor.id ?? null,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export async function findUserById(id: string): Promise<DbUserRow | null> {
  await ensureDatabaseMigratedAndSeeded();
  try {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  } catch (err) {
    throw new Error('Failed to load user record.', { cause: err });
  }
}

export async function findUserByEmail(email: string): Promise<DbUserRow | null> {
  await ensureDatabaseMigratedAndSeeded();
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    throw new Error('Failed to query user by email.', { cause: err });
  }
}

export async function syncFirebaseUser(params: {
  uid: string;
  email: string;
  name: string;
}): Promise<DbUserRow> {
  await ensureDatabaseMigratedAndSeeded();
  const normalizedEmail = params.email.trim().toLowerCase();
  try {
    const existingByUid = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, params.uid))
      .limit(1);
    if (existingByUid[0]) {
      return existingByUid[0];
    }

    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail[0]) {
      const updated = await db
        .update(users)
        .set({ firebaseUid: params.uid, updatedAt: new Date() })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      return updated[0];
    }

    // Bootstrap runtime owner or create standard student account (never trust client role!)
    const isBootstrappedAdmin = normalizedEmail === 'snave9401@gmail.com';
    const newId = `${isBootstrappedAdmin ? 'adm' : 'stu'}-${crypto.randomUUID().slice(0, 8)}`;
    const studentCode = isBootstrappedAdmin
      ? null
      : `NTA-2026-${Math.floor(100 + Math.random() * 899)}`;
    const staffCode = isBootstrappedAdmin ? 'INF-ADM-OWNER' : null;

    const inserted = await db
      .insert(users)
      .values({
        id: newId,
        firebaseUid: params.uid,
        name: params.name.trim() || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role: isBootstrappedAdmin ? 'admin' : 'student',
        status: 'active',
        studentCode,
        staffCode,
        department: isBootstrappedAdmin ? 'Academy Administration' : null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { firebaseUid: params.uid, updatedAt: new Date() },
      })
      .returning();

    const user = inserted[0];
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
}): Promise<{ ok: true; user: DbUserRow } | { ok: false; error: string }> {
  await ensureDatabaseMigratedAndSeeded();
  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const studentCode = `NTA-2026-${Math.floor(100 + Math.random() * 899)}`;
  const newId = `stu-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const createdUser = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(users)
        .values({
          id: newId,
          name: params.name.trim(),
          email: normalizedEmail,
          role: 'student', // Public registration ALWAYS creates student role
          status: 'active',
          studentCode,
          phone: params.phone?.trim() || null,
          passwordHash: hashPassword(params.password),
        })
        .returning();

      const allCourses = await tx.select().from(courses).limit(1);
      if (allCourses[0]) {
        await tx.insert(enrollments).values({
          id: `enr-${crypto.randomUUID().slice(0, 8)}`,
          studentId: inserted.id,
          courseId: allCourses[0].id,
          cohort: 'Cohort A · Autumn',
          status: 'Active',
          completedModuleIds: [],
        });
        await tx.insert(notifications).values({
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: inserted.id,
          kind: 'enrollment',
          title: `Welcome · ${allCourses[0].code}`,
          message: `Welcome to InfoCom AMS. You have been enrolled in ${allCourses[0].title} (Cohort A · Autumn).`,
          relatedCourseId: allCourses[0].id,
          read: false,
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const [allCourses, allSessions, allEnrollments, allNotifs, allUsers] =
      await Promise.all([
        db.select().from(courses),
        db.select().from(classSessions),
        db.select().from(enrollments),
        db.select().from(notifications),
        db.select().from(users),
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
      tuitionFee: String(c.tuitionFee),
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
        completedModuleIds: e.completedModuleIds ?? [],
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
      const id = `not-${crypto.randomUUID().slice(0, 8)}`;
      const [inserted] = await db
        .insert(notifications)
        .values({
          id,
          userId: item.userId,
          kind: item.kind,
          title: item.title,
          message: item.message,
          relatedCourseId: item.relatedCourseId ?? null,
          relatedSessionId: item.relatedSessionId ?? null,
          dedupeKey: item.dedupeKey ?? null,
          read: false,
          createdAt: new Date(item.createdAt),
        })
        .onConflictDoNothing()
        .returning();

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
    }
    return created;
  } catch (err) {
    throw new Error('Failed to run session reminder sweep.', { cause: err });
  }
}

export async function buildDashboardForUser(userRow: DbUserRow): Promise<DashboardPayload> {
  await ensureDatabaseMigratedAndSeeded();
  try {
    const publicUser = toPublicUser(userRow);

    const [
      allUsers,
      allCourses,
      allModules,
      allCohorts,
      allAdmissions,
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
      db.select().from(users),
      db.select().from(courses),
      db.select().from(courseModules),
      db.select().from(cohorts),
      db.select().from(admissions).orderBy(desc(admissions.submittedAt)),
      db.select().from(enrollments).orderBy(desc(enrollments.enrolledAt)),
      db.select().from(classSessions),
      db.select().from(attendanceRecords),
      db.select().from(moduleGrades),
      db.select().from(progressRemarks),
      db.select().from(feeInvoices).orderBy(desc(feeInvoices.createdAt)),
      db.select().from(payments).orderBy(desc(payments.paidAt)),
      db.select().from(documents).orderBy(desc(documents.createdAt)),
      db.select().from(certificates).orderBy(desc(certificates.issuedAt)),
      db.select().from(notifications).orderBy(desc(notifications.createdAt)),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(80),
    ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const courseMap = new Map(allCourses.map((c) => [c.id, c]));

    const mappedCourses: Course[] = allCourses.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      track: c.track,
      description: c.description,
      instructorId: c.instructorId,
      instructorName: userMap.get(c.instructorId)?.name ?? 'Instructor',
      durationWeeks: c.durationWeeks,
      tuitionFee: String(c.tuitionFee),
      isArchived: c.isArchived,
      modules: allModules
        .filter((m) => m.courseId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
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
      instructorId: coh.instructorId,
      instructorName: userMap.get(coh.instructorId)?.name ?? 'Instructor',
      capacity: coh.capacity,
      startDate: coh.startDate.toISOString(),
      endDate: coh.endDate.toISOString(),
      status: coh.status as 'Planned' | 'Active' | 'Completed' | 'Archived',
    }));

    const mappedEnrollments = allEnrollments.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      courseId: e.courseId,
      cohortId: e.cohortId,
      cohort: e.cohort,
      status: e.status as EnrollmentStatus,
      enrolledAt: e.enrolledAt.toISOString(),
      completedModuleIds: e.completedModuleIds ?? [],
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
      amountDue: String(inv.amountDue),
      amountPaid: String(inv.amountPaid),
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
      amount: String(p.amount),
      method: p.method as PaymentMethod,
      referenceCode: p.referenceCode,
      recordedByUserId: p.recordedByUserId,
      notes: p.notes,
      paidAt: p.paidAt.toISOString(),
    }));

    const mappedDocs: DocumentRecord[] = allDocs.map((d) => ({
      id: d.id,
      ownerUserId: d.ownerUserId,
      courseId: d.courseId,
      title: d.title,
      category: d.category as DocumentRecord['category'],
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedByUserId: d.uploadedByUserId,
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
      courseTitle: courseMap.get(c.courseId)?.title,
      enrollmentId: c.enrollmentId,
      finalScore: String(c.finalScore),
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

    const mappedAdmissions = allAdmissions.map((a) => ({
      id: a.id,
      applicantName: a.applicantName,
      applicantEmail: a.applicantEmail,
      phone: a.phone,
      targetCourseId: a.targetCourseId,
      preferredCohort: a.preferredCohort,
      status: a.status as 'Submitted' | 'Under Review' | 'Accepted' | 'Rejected' | 'Enrolled',
      notes: a.notes,
      reviewedByUserId: a.reviewedByUserId,
      convertedUserId: a.convertedUserId,
      submittedAt: a.submittedAt.toISOString(),
      reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
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
          metadata: a.metadata ?? {},
          createdAt: a.createdAt.toISOString(),
        })),
        analytics,
      };
    }

    if (publicUser.role === 'instructor') {
      return {
        user: publicUser,
        courses: mappedCourses,
        cohorts: mappedCohorts,
        users: publicUsers.filter((u) => u.role === 'instructor' || u.role === 'student'),
        students: studentsList,
        admissions: [],
        enrollments: mappedEnrollments,
        sessions: mappedSessions,
        attendance: mappedAttendance,
        grades: mappedGrades,
        remarks: mappedRemarks,
        invoices: [],
        payments: [],
        documents: mappedDocs.filter((d) => d.category !== 'Receipt' && !d.isArchived),
        certificates: mappedCerts,
        notifications: mappedNotifs,
        auditLogs: [],
        analytics: {
          ...analytics,
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const [student] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, params.studentId), eq(users.role, 'student')))
      .limit(1);
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, params.courseId))
      .limit(1);

    if (!student || !course) {
      return { ok: false as const, status: 400, error: 'Valid student and course are required.' };
    }

    const existing = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.studentId, params.studentId),
          eq(enrollments.courseId, params.courseId)
        )
      );
    const activeDuplicate = existing.find((e) => e.status !== 'Dropped');
    if (activeDuplicate) {
      return {
        ok: false as const,
        status: 409,
        error: `${student.name} already has an active or waitlisted enrollment in ${course.code}.`,
      };
    }

    const enrollmentId = `enr-${crypto.randomUUID().slice(0, 8)}`;
    await db.transaction(async (tx) => {
      await tx.insert(enrollments).values({
        id: enrollmentId,
        studentId: params.studentId,
        courseId: params.courseId,
        cohortId: params.cohortId ?? null,
        cohort: params.cohort,
        status: params.status,
        completedModuleIds: [],
      });

      await tx.insert(notifications).values({
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: params.studentId,
        kind: 'enrollment',
        title: `Enrollment Confirmed · ${course.code}`,
        message: `You were enrolled in ${course.title} (${params.cohort}) with status ${params.status}.`,
        relatedCourseId: course.id,
        read: false,
      });

      if (params.issueTuitionInvoice && toCents(String(course.tuitionFee)) > 0) {
        const invNum = `INV-2026-${Math.floor(1000 + Math.random() * 8999)}`;
        await tx.insert(feeInvoices).values({
          id: `inv-${crypto.randomUUID().slice(0, 8)}`,
          invoiceNumber: invNum,
          studentId: params.studentId,
          enrollmentId,
          courseId: course.id,
          description: `${course.code} ${course.title} Tuition (${params.cohort})`,
          amountDue: String(course.tuitionFee),
          amountPaid: '0.00',
          currency: 'USD',
          status: 'Unpaid',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          issuedByUserId: params.actor.id,
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(feeInvoices)
        .where(eq(feeInvoices.id, params.invoiceId))
        .limit(1);
      if (!invoice) {
        return { ok: false as const, status: 404, error: 'Invoice not found.' };
      }
      if (invoice.status === 'Voided' || invoice.isArchived) {
        return { ok: false as const, status: 400, error: 'Cannot record payment on a voided or archived invoice.' };
      }

      const dueCents = toCents(String(invoice.amountDue));
      const paidCents = toCents(String(invoice.amountPaid));
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
      const newStatus = computeInvoiceStatus(String(invoice.amountDue), newPaidStr);
      const paymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
      const receiptNumber = `RCPT-2026-${Math.floor(1000 + Math.random() * 8999)}`;

      await tx.insert(payments).values({
        id: paymentId,
        receiptNumber,
        invoiceId: invoice.id,
        studentId: invoice.studentId,
        amount: fromCents(payCents),
        method: params.method,
        referenceCode: params.referenceCode,
        recordedByUserId: params.actor.id,
        notes: params.notes,
      });

      await tx
        .update(feeInvoices)
        .set({
          amountPaid: newPaidStr,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(feeInvoices.id, invoice.id));

      await tx.insert(notifications).values({
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: invoice.studentId,
        kind: 'finance',
        title: `Payment Receipt · ${receiptNumber}`,
        message: `Payment of $${fromCents(payCents)} via ${params.method} applied to invoice ${invoice.invoiceNumber}. Status: ${newStatus}.`,
        relatedCourseId: invoice.courseId,
        read: false,
      });

      return { ok: true as const, paymentId, receiptNumber, newStatus, invoiceNumber: invoice.invoiceNumber };
    });

    if (result.ok) {
      await recordAuditLog({
        actor: params.actor,
        action: 'PAYMENT_RECORDED',
        entityType: 'payment',
        entityId: result.paymentId,
        summary: `Recorded $${params.amount} payment (${result.receiptNumber}) on ${result.invoiceNumber} -> ${result.newStatus}.`,
      });
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const [student] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, params.studentId), eq(users.role, 'student')))
      .limit(1);
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, params.courseId))
      .limit(1);

    if (!student || !course) {
      return { ok: false as const, status: 404, error: 'Student or course not found.' };
    }

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.studentId, student.id),
          eq(enrollments.courseId, course.id)
        )
      )
      .limit(1);

    if (!enrollment) {
      return { ok: false as const, status: 400, error: 'Student is not enrolled in this course.' };
    }

    const [existingCert] = await db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.studentId, student.id),
          eq(certificates.courseId, course.id)
        )
      )
      .limit(1);

    if (existingCert && existingCert.status === 'Issued') {
      return {
        ok: false as const,
        status: 409,
        error: `Certificate ${existingCert.certificateCode} has already been issued for this course.`,
      };
    }

    const [mods, grades, att] = await Promise.all([
      db.select().from(courseModules).where(eq(courseModules.courseId, course.id)),
      db
        .select()
        .from(moduleGrades)
        .where(
          and(
            eq(moduleGrades.studentId, student.id),
            eq(moduleGrades.courseId, course.id)
          )
        ),
      db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, student.id),
            eq(attendanceRecords.courseId, course.id)
          )
        ),
    ]);

    const completionPct = calculateCourseCompletion(
      enrollment.completedModuleIds ?? [],
      mods.length
    );

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
    const certCode = `INF-CERT-2026-${course.code.replace(/[^A-Z0-9]/g, '')}-${Math.floor(100 + Math.random() * 899)}`;
    const verificationHash = crypto
      .createHash('sha256')
      .update(`${certCode}:${student.id}:${course.id}:${weightedScore.toFixed(2)}`)
      .digest('hex')
      .slice(0, 24)
      .toUpperCase();

    const certId = `cert-${crypto.randomUUID().slice(0, 8)}`;

    await db.transaction(async (tx) => {
      if (existingCert) {
        await tx
          .update(certificates)
          .set({
            certificateCode: certCode,
            verificationHash,
            finalScore: weightedScore.toFixed(2),
            letterGrade,
            attendanceRate: attendanceStats.rate,
            issuedByUserId: params.actor.id,
            issuedByName: params.actor.name,
            status: 'Issued',
            revokedReason: null,
            issuedAt: new Date(),
          })
          .where(eq(certificates.id, existingCert.id));
      } else {
        await tx.insert(certificates).values({
          id: certId,
          certificateCode: certCode,
          verificationHash,
          studentId: student.id,
          courseId: course.id,
          enrollmentId: enrollment.id,
          finalScore: weightedScore.toFixed(2),
          letterGrade,
          attendanceRate: attendanceStats.rate,
          issuedByUserId: params.actor.id,
          issuedByName: params.actor.name,
          status: 'Issued',
        });
      }

      if (enrollment.status !== 'Completed') {
        await tx
          .update(enrollments)
          .set({ status: 'Completed', updatedAt: new Date() })
          .where(eq(enrollments.id, enrollment.id));
      }

      await tx.insert(notifications).values({
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: student.id,
        kind: 'certificate',
        title: `Certificate Issued · ${course.code}`,
        message: `Congratulations! Official certificate ${certCode} has been issued for ${course.title} (Final Grade: ${weightedScore}% ${letterGrade}).`,
        relatedCourseId: course.id,
        read: false,
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
  await ensureDatabaseMigratedAndSeeded();
  const clean = codeOrHash.trim().toUpperCase();
  if (!clean) return null;
  try {
    const rows = await db
      .select()
      .from(certificates)
      .where(
        clean.startsWith('INF-CERT')
          ? eq(certificates.certificateCode, clean)
          : eq(certificates.verificationHash, clean)
      )
      .limit(1);

    const cert = rows[0];
    if (!cert) return null;

    const [studentRows, courseRows] = await Promise.all([
      db.select().from(users).where(eq(users.id, cert.studentId)).limit(1),
      db.select().from(courses).where(eq(courses.id, cert.courseId)).limit(1),
    ]);

    return {
      certificateCode: cert.certificateCode,
      verificationHash: cert.verificationHash,
      studentName: studentRows[0]?.name ?? 'Student',
      studentCode: studentRows[0]?.studentCode ?? '',
      courseCode: courseRows[0]?.code ?? '',
      courseTitle: courseRows[0]?.title ?? '',
      finalScore: String(cert.finalScore),
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const [session] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.id, params.sessionId))
      .limit(1);
    if (!session) return { ok: false as const, error: 'Session not found.' };

    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, session.courseId))
      .limit(1);
    const [student] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, params.studentId), eq(users.role, 'student')))
      .limit(1);
    if (!course || !student) {
      return { ok: false as const, error: 'Course or student not found.' };
    }

    const now = new Date();
    const notif = buildAttendanceNotification({
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
        tuitionFee: String(course.tuitionFee),
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

    await db.transaction(async (tx) => {
      const attId = `att-${crypto.randomUUID().slice(0, 8)}`;
      await tx
        .insert(attendanceRecords)
        .values({
          id: attId,
          sessionId: session.id,
          courseId: course.id,
          studentId: student.id,
          status: params.status,
          note: params.note.trim(),
          updatedAt: now,
          updatedByUserId: params.actor.id,
          updatedBy: params.actor.name,
        })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.studentId],
          set: {
            status: params.status,
            note: params.note.trim(),
            updatedAt: now,
            updatedByUserId: params.actor.id,
            updatedBy: params.actor.name,
          },
        });

      await tx.insert(notifications).values({
        id: notif.id,
        userId: notif.userId,
        kind: notif.kind,
        title: notif.title,
        message: notif.message,
        relatedCourseId: notif.relatedCourseId,
        relatedSessionId: notif.relatedSessionId,
        read: false,
        createdAt: now,
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
  await ensureDatabaseMigratedAndSeeded();
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1);
    if (!doc || doc.isArchived) return null;

    if (requester.role === 'student') {
      const isOwner = doc.ownerUserId === requester.id;
      let isSyllabusForEnrolledCourse = false;
      if (doc.category === 'Syllabus' && doc.courseId) {
        const enrolled = await db
          .select()
          .from(enrollments)
          .where(
            and(
              eq(enrollments.studentId, requester.id),
              eq(enrollments.courseId, doc.courseId),
              inArray(enrollments.status, ['Active', 'Completed'])
            )
          )
          .limit(1);
        isSyllabusForEnrolledCourse = enrolled.length > 0;
      }
      if (!isOwner && !isSyllabusForEnrolledCourse) {
        return 'FORBIDDEN' as const;
      }
    }
    return doc;
  } catch (err) {
    throw new Error('Failed to retrieve document content.', { cause: err });
  }
}
