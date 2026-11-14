import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function normalizePagination(params: PaginationParams): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(params.pageSize) || 20)));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export async function listAuditLogsPaginated(params: PaginationParams & {
  action?: string;
  entityType?: string;
}) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const where: Prisma.AuditLogWhereInput = {
    ...(params.action ? { action: params.action } : {}),
    ...(params.entityType ? { entityType: params.entityType } : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((a) => ({
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
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    throw new Error('Failed to load paginated audit logs.', { cause: err });
  }
}

export async function listPaymentsPaginated(params: PaginationParams & {
  studentId?: string;
}) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const where: Prisma.PaymentWhereInput = {
    ...(params.studentId ? { studentId: params.studentId } : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip,
        take,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      items: rows.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        invoiceId: p.invoiceId,
        studentId: p.studentId,
        amount: p.amount.toString(),
        method: p.method,
        referenceCode: p.referenceCode,
        recordedByUserId: p.recordedByUserId,
        notes: p.notes,
        paidAt: p.paidAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    throw new Error('Failed to load paginated payments.', { cause: err });
  }
}

export async function listNotificationsPaginated(params: PaginationParams & {
  userId: string;
  unreadOnly?: boolean;
}) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const where: Prisma.NotificationWhereInput = {
    userId: params.userId,
    ...(params.unreadOnly ? { read: false } : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      items: rows.map((n) => ({
        id: n.id,
        userId: n.userId,
        kind: n.kind,
        title: n.title,
        message: n.message,
        relatedCourseId: n.relatedCourseId,
        relatedSessionId: n.relatedSessionId,
        dedupeKey: n.dedupeKey,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    throw new Error('Failed to load paginated notifications.', { cause: err });
  }
}

export async function listEnrollmentsPaginated(params: PaginationParams & {
  courseId?: string;
  courseIds?: string[];
  studentId?: string;
  status?: string;
}) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const where: Prisma.EnrollmentWhereInput = {
    ...(params.courseId ? { courseId: params.courseId } : {}),
    ...(params.courseIds ? { courseId: { in: params.courseIds } } : {}),
    ...(params.studentId ? { studentId: params.studentId } : {}),
    ...(params.status ? { status: params.status } : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        orderBy: { enrolledAt: 'desc' },
        skip,
        take,
      }),
      prisma.enrollment.count({ where }),
    ]);

    return {
      items: rows.map((e) => ({
        id: e.id,
        studentId: e.studentId,
        courseId: e.courseId,
        cohortId: e.cohortId,
        cohort: e.cohort,
        status: e.status,
        enrolledAt: e.enrolledAt.toISOString(),
        completedModuleIds: Array.isArray(e.completedModuleIds)
          ? (e.completedModuleIds as string[])
          : [],
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    throw new Error('Failed to load paginated enrollments.', { cause: err });
  }
}

export async function createAuthSessionRecord(params: {
  id: string;
  tokenHash: string;
  userId: string;
  roleCode: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.authSession.create({
    data: {
      id: params.id,
      tokenHash: params.tokenHash,
      userId: params.userId,
      roleCode: params.roleCode,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ? params.userAgent.slice(0, 255) : null,
      expiresAt: params.expiresAt,
    },
  });
}

export async function findActiveAuthSessionByTokenHash(tokenHash: string) {
  if (!tokenHash) return null;
  const row = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function revokeAuthSessionByTokenHash(
  tokenHash: string,
  reason = 'logout'
): Promise<void> {
  if (!tokenHash) return;
  try {
    await prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  } catch (err) {
    console.error('AuthSession revocation failed:', err);
  }
}

export async function revokeOtherUserSessionsInDb(
  userId: string,
  keepSessionId: string,
  reason = 'password_changed'
): Promise<void> {
  try {
    await prisma.authSession.updateMany({
      where: {
        userId,
        id: { not: keepSessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  } catch (err) {
    console.error('Other user sessions revocation failed:', err);
  }
}

export async function revokeAllUserSessionsInDb(
  userId: string,
  reason = 'account_updated'
): Promise<void> {
  try {
    await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  } catch (err) {
    console.error('User sessions bulk revocation failed:', err);
  }
}

export async function listStudentsPaginated(params: PaginationParams & {
  search?: string;
  status?: string;
  courseId?: string;
  sortBy?: 'name' | 'createdAt' | 'studentCode';
  sortDir?: 'asc' | 'desc';
}) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const search = params.search?.trim();
  const where: Prisma.UserWhereInput = {
    role: 'student',
    ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
    ...(params.courseId && params.courseId !== 'all'
      ? {
          enrollments: {
            some: {
              courseId: params.courseId,
              status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
            },
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { studentCode: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const sortField =
    params.sortBy === 'name' || params.sortBy === 'studentCode'
      ? params.sortBy
      : 'createdAt';
  const sortOrder = params.sortDir === 'asc' ? 'asc' : 'desc';

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        studentProfile: { include: { department: true } },
        enrollments: { select: { status: true } },
        invoices: {
          where: { isArchived: false, status: { not: 'Voided' } },
          select: { amountDue: true, amountPaid: true },
        },
        attendanceRecords: { select: { status: true } },
      },
      orderBy: { [sortField]: sortOrder },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: rows.map((u) => {
      const totalAtt = u.attendanceRecords.length;
      const presentCount = u.attendanceRecords.filter((a) => a.status === 'Present').length;
      const lateCount = u.attendanceRecords.filter((a) => a.status === 'Late').length;
      const attendanceRate =
        totalAtt > 0 ? Math.round(((presentCount + lateCount * 0.75) / totalAtt) * 100) : 100;

      const outstandingCents = u.invoices.reduce((sum, inv) => {
        const due = Math.round(Number(inv.amountDue) * 100);
        const paid = Math.round(Number(inv.amountPaid) * 100);
        return sum + Math.max(0, due - paid);
      }, 0);

      return {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: 'student' as const,
          status: u.status as 'active' | 'inactive' | 'suspended' | 'archived',
          studentCode: u.studentCode,
          staffCode: u.staffCode,
          department: u.studentProfile?.department?.name ?? u.department,
          phone: u.phone,
          createdAt: u.createdAt.toISOString(),
        },
        profile: u.studentProfile
          ? {
              id: u.studentProfile.id,
              departmentId: u.studentProfile.departmentId,
              departmentName: u.studentProfile.department?.name ?? null,
              dateOfBirth: u.studentProfile.dateOfBirth
                ? u.studentProfile.dateOfBirth.toISOString()
                : null,
              address: u.studentProfile.address,
              emergencyContact: u.studentProfile.emergencyContact,
              academicStanding: u.studentProfile.academicStanding,
              enrollmentDate: u.studentProfile.enrollmentDate.toISOString(),
            }
          : null,
        activeEnrollmentsCount: u.enrollments.filter((e) => e.status === 'Active').length,
        completedCoursesCount: u.enrollments.filter((e) => e.status === 'Completed').length,
        outstandingCents,
        attendanceRate,
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

