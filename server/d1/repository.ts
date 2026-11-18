import type {
  UserAccountStatus,
  UserPublic,
  UserRole,
} from '../../src/shared/types.ts';
import { toCents } from '../../src/shared/academic.ts';
import {
  d1All,
  d1First,
  d1Run,
  getActiveD1,
  inPlaceholders,
  nowIso,
  sqlBool,
  sqlJson,
  type D1DatabaseLike,
} from './client.ts';

export interface DbUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  student_code: string | null;
  staff_code: string | null;
  department: string | null;
  phone: string | null;
  password_hash: string | null;
  password_updated_at: string | null;
  must_change_password: number;
  session_version: number;
  created_at: string;
  updated_at: string;
}

export function toPublicUserD1(user: DbUserRow): UserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    status: user.status as UserAccountStatus,
    studentCode: user.student_code,
    staffCode: user.staff_code,
    department: user.department,
    phone: user.phone,
    mustChangePassword: sqlBool(user.must_change_password),
    createdAt: user.created_at,
  };
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
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

export async function createAuthSessionRecordD1(
  params: {
    id: string;
    tokenHash: string;
    userId: string;
    roleCode: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  await d1Run(
    `INSERT INTO auth_sessions (id, user_id, role_code, token_hash, ip_address, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.userId,
      params.roleCode,
      params.tokenHash,
      params.ipAddress ?? null,
      params.userAgent ? params.userAgent.slice(0, 255) : null,
      params.expiresAt.toISOString(),
      nowIso(),
    ],
    db
  );
}

export async function findActiveAuthSessionByTokenHashD1(
  tokenHash: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<{
  session: {
    id: string;
    userId: string;
    roleCode: string;
    expiresAt: string;
  };
  user: DbUserRow;
} | null> {
  if (!tokenHash) return null;
  const row = await d1First<
    DbUserRow & {
      session_id: string;
      session_role_code: string;
      session_expires_at: string;
      session_revoked_at: string | null;
    }
  >(
    `SELECT s.id AS session_id, s.role_code AS session_role_code, s.expires_at AS session_expires_at,
            s.revoked_at AS session_revoked_at, u.*
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash],
    db
  );
  if (!row) return null;
  if (row.session_revoked_at !== null) return null;
  if (Date.parse(row.session_expires_at) <= Date.now()) return null;
  return {
    session: {
      id: row.session_id,
      userId: row.id,
      roleCode: row.session_role_code,
      expiresAt: row.session_expires_at,
    },
    user: row,
  };
}

export async function revokeAuthSessionByTokenHashD1(
  tokenHash: string,
  reason = 'logout',
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  if (!tokenHash) return;
  await d1Run(
    'UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [nowIso(), reason, tokenHash],
    db
  );
}

export async function revokeOtherUserSessionsD1(
  userId: string,
  keepSessionId: string,
  reason = 'password_changed',
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  await d1Run(
    'UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
    [nowIso(), reason, userId, keepSessionId],
    db
  );
}

export async function revokeAllUserSessionsD1(
  userId: string,
  reason = 'account_updated',
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  await d1Run(
    'UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
    [nowIso(), reason, userId],
    db
  );
}

export async function listAuditLogsPaginatedD1(
  params: PaginationParams & { action?: string; entityType?: string },
  db: D1DatabaseLike = getActiveD1()
) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.action) {
    clauses.push('action = ?');
    binds.push(params.action);
  }
  if (params.entityType) {
    clauses.push('entity_type = ?');
    binds.push(params.entityType);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    d1All<{
      id: string;
      actor_user_id: string | null;
      actor_email: string;
      actor_role: string;
      action: string;
      entity_type: string;
      entity_id: string;
      summary: string;
      metadata: string;
      created_at: string;
    }>(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...binds, take, skip],
      db
    ),
    d1First<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
      binds,
      db
    ),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    items: rows.map((a) => ({
      id: a.id,
      actorUserId: a.actor_user_id,
      actorEmail: a.actor_email,
      actorRole: a.actor_role,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      summary: a.summary,
      metadata: sqlJson<Record<string, unknown>>(a.metadata, {}),
      createdAt: a.created_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listPaymentsPaginatedD1(
  params: PaginationParams & { studentId?: string },
  db: D1DatabaseLike = getActiveD1()
) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const whereSql = params.studentId ? 'WHERE student_id = ?' : '';
  const binds = params.studentId ? [params.studentId] : [];

  const [rows, countRow] = await Promise.all([
    d1All<{
      id: string;
      receipt_number: string;
      invoice_id: string;
      student_id: string;
      amount: string;
      method: string;
      reference_code: string;
      recorded_by_user_id: string;
      notes: string;
      paid_at: string;
    }>(
      `SELECT * FROM payments ${whereSql} ORDER BY paid_at DESC LIMIT ? OFFSET ?`,
      [...binds, take, skip],
      db
    ),
    d1First<{ total: number }>(
      `SELECT COUNT(*) AS total FROM payments ${whereSql}`,
      binds,
      db
    ),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    items: rows.map((p) => ({
      id: p.id,
      receiptNumber: p.receipt_number,
      invoiceId: p.invoice_id,
      studentId: p.student_id,
      amount: p.amount,
      method: p.method,
      referenceCode: p.reference_code,
      recordedByUserId: p.recorded_by_user_id,
      notes: p.notes,
      paidAt: p.paid_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listNotificationsPaginatedD1(
  params: PaginationParams & { userId: string; unreadOnly?: boolean },
  db: D1DatabaseLike = getActiveD1()
) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const whereSql = params.unreadOnly ? 'WHERE user_id = ? AND read = 0' : 'WHERE user_id = ?';
  const binds = [params.userId];

  const [rows, countRow] = await Promise.all([
    d1All<{
      id: string;
      user_id: string;
      kind: string;
      title: string;
      message: string;
      related_course_id: string | null;
      related_session_id: string | null;
      dedupe_key: string | null;
      read: number;
      created_at: string;
    }>(
      `SELECT * FROM notifications ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...binds, take, skip],
      db
    ),
    d1First<{ total: number }>(
      `SELECT COUNT(*) AS total FROM notifications ${whereSql}`,
      binds,
      db
    ),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    items: rows.map((n) => ({
      id: n.id,
      userId: n.user_id,
      kind: n.kind,
      title: n.title,
      message: n.message,
      relatedCourseId: n.related_course_id,
      relatedSessionId: n.related_session_id,
      dedupeKey: n.dedupe_key,
      read: sqlBool(n.read),
      createdAt: n.created_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listEnrollmentsPaginatedD1(
  params: PaginationParams & {
    courseId?: string;
    courseIds?: string[];
    studentId?: string;
    status?: string;
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (params.courseId) {
    clauses.push('course_id = ?');
    binds.push(params.courseId);
  }
  if (params.courseIds) {
    if (params.courseIds.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 1 };
    }
    clauses.push(`course_id IN (${inPlaceholders(params.courseIds.length)})`);
    binds.push(...params.courseIds);
  }
  if (params.studentId) {
    clauses.push('student_id = ?');
    binds.push(params.studentId);
  }
  if (params.status) {
    clauses.push('status = ?');
    binds.push(params.status);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    d1All<{
      id: string;
      student_id: string;
      course_id: string;
      cohort_id: string | null;
      cohort: string;
      status: string;
      enrolled_at: string;
      completed_module_ids: string;
    }>(
      `SELECT * FROM enrollments ${whereSql} ORDER BY enrolled_at DESC LIMIT ? OFFSET ?`,
      [...binds, take, skip],
      db
    ),
    d1First<{ total: number }>(
      `SELECT COUNT(*) AS total FROM enrollments ${whereSql}`,
      binds,
      db
    ),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    items: rows.map((e) => ({
      id: e.id,
      studentId: e.student_id,
      courseId: e.course_id,
      cohortId: e.cohort_id,
      cohort: e.cohort,
      status: e.status,
      enrolledAt: e.enrolled_at,
      completedModuleIds: sqlJson<string[]>(e.completed_module_ids, []),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listStudentsPaginatedD1(
  params: PaginationParams & {
    search?: string;
    status?: string;
    courseId?: string;
    sortBy?: 'name' | 'createdAt' | 'studentCode';
    sortDir?: 'asc' | 'desc';
  },
  db: D1DatabaseLike = getActiveD1()
) {
  const { page, pageSize, skip, take } = normalizePagination(params);
  const clauses: string[] = ["u.role = 'student'"];
  const binds: unknown[] = [];

  if (params.status && params.status !== 'all') {
    clauses.push('u.status = ?');
    binds.push(params.status);
  }
  if (params.courseId && params.courseId !== 'all') {
    clauses.push(
      `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = u.id AND e.course_id = ? AND e.status NOT IN ('Dropped', 'Cancelled', 'Withdrawn'))`
    );
    binds.push(params.courseId);
  }
  const search = params.search?.trim();
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    clauses.push(
      '(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.student_code, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)'
    );
    binds.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  const orderCol =
    params.sortBy === 'name'
      ? 'u.name'
      : params.sortBy === 'studentCode'
        ? 'u.student_code'
        : 'u.created_at';
  const orderDir = params.sortDir === 'asc' ? 'ASC' : 'DESC';

  const [users, countRow] = await Promise.all([
    d1All<
      DbUserRow & {
        sp_id: string | null;
        sp_department_id: string | null;
        sp_dept_name: string | null;
        sp_dob: string | null;
        sp_address: string | null;
        sp_emergency_contact: string | null;
        sp_academic_standing: string | null;
        sp_enrollment_date: string | null;
      }
    >(
      `SELECT u.*, sp.id AS sp_id, sp.department_id AS sp_department_id, d.name AS sp_dept_name,
              sp.date_of_birth AS sp_dob, sp.address AS sp_address, sp.emergency_contact AS sp_emergency_contact,
              sp.academic_standing AS sp_academic_standing, sp.enrollment_date AS sp_enrollment_date
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN departments d ON d.id = sp.department_id
       ${whereSql}
       ORDER BY ${orderCol} ${orderDir}
       LIMIT ? OFFSET ?`,
      [...binds, take, skip],
      db
    ),
    d1First<{ total: number }>(
      `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
      binds,
      db
    ),
  ]);

  const userIds = users.map((u) => u.id);
  const [enrRows, invRows, attRows] =
    userIds.length > 0
      ? await Promise.all([
          d1All<{ student_id: string; status: string }>(
            `SELECT student_id, status FROM enrollments WHERE student_id IN (${inPlaceholders(userIds.length)})`,
            userIds,
            db
          ),
          d1All<{ student_id: string; amount_due: string; amount_paid: string }>(
            `SELECT student_id, amount_due, amount_paid FROM fee_invoices WHERE is_archived = 0 AND status != 'Voided' AND student_id IN (${inPlaceholders(userIds.length)})`,
            userIds,
            db
          ),
          d1All<{ student_id: string; status: string }>(
            `SELECT student_id, status FROM attendance_records WHERE student_id IN (${inPlaceholders(userIds.length)})`,
            userIds,
            db
          ),
        ])
      : [[], [], []];

  const total = Number(countRow?.total ?? 0);
  return {
    items: users.map((u) => {
      const myEnr = enrRows.filter((e) => e.student_id === u.id);
      const myInv = invRows.filter((i) => i.student_id === u.id);
      const myAtt = attRows.filter((a) => a.student_id === u.id);
      const present = myAtt.filter((a) => a.status === 'Present').length;
      const late = myAtt.filter((a) => a.status === 'Late').length;
      const attendanceRate =
        myAtt.length > 0 ? Math.round(((present + late * 0.75) / myAtt.length) * 100) : 100;
      const outstandingCents = myInv.reduce(
        (sum, inv) => sum + Math.max(0, toCents(inv.amount_due) - toCents(inv.amount_paid)),
        0
      );

      return {
        user: {
          ...toPublicUserD1(u),
          role: 'student' as const,
          department: u.sp_dept_name ?? u.department,
        },
        profile: u.sp_id
          ? {
              id: u.sp_id,
              departmentId: u.sp_department_id,
              departmentName: u.sp_dept_name,
              dateOfBirth: u.sp_dob,
              address: u.sp_address ?? '',
              emergencyContact: u.sp_emergency_contact ?? '',
              academicStanding: u.sp_academic_standing ?? 'Good Standing',
              enrollmentDate: u.sp_enrollment_date ?? u.created_at,
            }
          : null,
        activeEnrollmentsCount: myEnr.filter((e) => e.status === 'Active').length,
        completedCoursesCount: myEnr.filter((e) => e.status === 'Completed').length,
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
