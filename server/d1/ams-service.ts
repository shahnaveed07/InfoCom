import crypto from 'node:crypto';
import {
  buildEnrollmentTrendSeries,
  buildMonthlyRevenueSeries,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeAcademyAnalytics,
  formatCents,
  formatInvoiceNumber,
  fromCents,
  isInactiveEnrollmentStatus,
  isPendingAdmissionStatus,
  resolveAnalyticsDateWindow,
  slugifyCourseTitle,
  toCents,
} from '../../src/shared/academic.ts';
import type {
  AcademyPolicySummary,
  AcademySettingsPayload,
  AdminAnalyticsDetail,
  AdmissionApplication,
  AdmissionDetailPayload,
  AdmissionDocumentRecord,
  AdmissionDocumentStatus,
  AdmissionStatus,
  AdmissionStatusHistoryEntry,
  AnalyticsPreset,
  AssessmentGradeRecord,
  AssessmentRecord,
  AssessmentType,
  AttendanceStatus,
  CertificateRecord,
  Cohort,
  CohortStatus,
  Course,
  DashboardPayload,
  DiscountRecord,
  DocumentRecord,
  Enrollment,
  EnrollmentStatus,
  FeePlanSummary,
  FeeStructureRecord,
  InstructorDetailPayload,
  InstructorDirectoryRow,
  InstructorPermissionKey,
  InvoiceDetailPayload,
  ModuleGrade,
  NotificationItem,
  PaymentMethod,
  PortalActivationPolicy,
  RefundRecord,
  ScholarshipRecord,
  StudentDetailPayload,
  UserPublic,
} from '../../src/shared/types.ts';
import { DEFAULT_INSTRUCTOR_PERMISSIONS } from '../security/permission-constants.ts';
import { generateOpaqueToken, sha256Hex } from '../worker-auth.ts';
import { readWorkerR2Document } from '../worker-storage.ts';
import {
  d1All,
  d1First,
  d1Run,
  getActiveD1,
  inPlaceholders,
  nowIso,
  randomId,
  sqlBool,
  sqlFixed,
  sqlJson,
  type D1DatabaseLike,
} from './client.ts';
import {
  canInstructorAccessCourseD1,
  canInstructorAccessStudentD1,
  getInstructorScopeD1,
} from './permissions.ts';
import { toPublicUserD1, type DbUserRow } from './repository.ts';

export async function findUserByIdD1(
  id: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<DbUserRow | null> {
  return d1First<DbUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id], db);
}

export async function getAcademySettingsMapD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<Map<string, string>> {
  const rows = await d1All<{ key: string; value: string }>(
    'SELECT key, value FROM academy_settings',
    [],
    db
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function getPortalActivationPolicyD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<PortalActivationPolicy> {
  const row = await d1First<{ value: string }>(
    "SELECT value FROM academy_settings WHERE key = 'admission.portal_activation_policy' LIMIT 1",
    [],
    db
  );
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

export async function loadAcademyPoliciesSummaryD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<AcademyPolicySummary> {
  const map = await getAcademySettingsMapD1(db);
  const num = (key: string, fallback: number) => {
    const parsed = Number(map.get(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    passingScore: num('grading.passing_score', 60),
    distinctionScore: num('grading.distinction_score', 90),
    minAttendanceRatePct: num('attendance.min_rate_pct', 75),
    lateWeightPct: num('attendance.late_weight_pct', 75),
    certificateMinCompletionPct: num('certificate.min_completion_pct', 100),
    certificateMinScore: num('certificate.min_weighted_score', 60),
    certificateMinAttendancePct: num('certificate.min_attendance_pct', 75),
  };
}

export async function generateUniqueStudentCodeD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefixRow = await d1First<{ value: string }>(
    "SELECT value FROM academy_settings WHERE key = 'academy.student_id_prefix' LIMIT 1",
    [],
    db
  );
  const prefix =
    (prefixRow?.value || 'IGS').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'IGS';
  const yearPrefix = `${prefix}-${year}-`;

  const existingCodes = await d1All<{ student_code: string | null }>(
    'SELECT student_code FROM users WHERE student_code LIKE ?',
    [`${yearPrefix}%`],
    db
  );

  let maxSeq = 0;
  for (const row of existingCodes) {
    const code = row.student_code ?? '';
    const suffixPart = code.slice(yearPrefix.length);
    if (/^\d{1,7}$/.test(suffixPart)) {
      const n = Number(suffixPart);
      if (n > maxSeq) maxSeq = n;
    }
  }

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = `${yearPrefix}${String(maxSeq + attempt).padStart(5, '0')}`;
    const [existsUser, existsProfile] = await Promise.all([
      d1First<{ id: string }>('SELECT id FROM users WHERE student_code = ? LIMIT 1', [candidate], db),
      d1First<{ id: string }>(
        'SELECT id FROM student_profiles WHERE student_code = ? LIMIT 1',
        [candidate],
        db
      ),
    ]);
    if (!existsUser && !existsProfile) return candidate;
  }
  return `${yearPrefix}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueStaffCodeD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  for (let i = 0; i < 12; i += 1) {
    const candidate = `IGS-STF-${crypto.randomInt(1000, 9999)}`;
    const exists = await d1First<{ id: string }>(
      'SELECT id FROM users WHERE staff_code = ? LIMIT 1',
      [candidate],
      db
    );
    if (!exists) return candidate;
  }
  return `IGS-STF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateNextInvoiceNumberD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  const [prefixRow, seqRow] = await Promise.all([
    d1First<{ id: string; value: string }>(
      "SELECT id, value FROM academy_settings WHERE key = 'academy.invoice_prefix' LIMIT 1",
      [],
      db
    ),
    d1First<{ id: string; value: string }>(
      "SELECT id, value FROM academy_settings WHERE key = 'academy.invoice_next_seq' LIMIT 1",
      [],
      db
    ),
  ]);
  const prefix = prefixRow?.value || 'INV-2026';
  let seq = Number(seqRow?.value || '1050');
  if (!Number.isFinite(seq) || seq < 1) seq = 1050;

  for (let i = 0; i < 25; i += 1) {
    const candidate = formatInvoiceNumber(prefix, seq + i);
    const existing = await d1First<{ id: string }>(
      'SELECT id FROM fee_invoices WHERE invoice_number = ? LIMIT 1',
      [candidate],
      db
    );
    if (!existing) {
      if (seqRow) {
        await d1Run(
          'UPDATE academy_settings SET value = ?, updated_at = ? WHERE id = ?',
          [String(seq + i + 1), nowIso(), seqRow.id],
          db
        );
      }
      return candidate;
    }
  }
  return `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueReceiptNumberD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const candidate = `RCPT-${year}-${crypto.randomInt(10000, 99999)}`;
    const exists = await d1First<{ id: string }>(
      'SELECT id FROM payments WHERE receipt_number = ? LIMIT 1',
      [candidate],
      db
    );
    if (!exists) return candidate;
  }
  return `RCPT-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueRefundNumberD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const candidate = `REF-${year}-${crypto.randomInt(10000, 99999)}`;
    const exists = await d1First<{ id: string }>(
      'SELECT id FROM refunds WHERE refund_number = ? LIMIT 1',
      [candidate],
      db
    );
    if (!exists) return candidate;
  }
  return `REF-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function generateUniqueApplicationNumberD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<string> {
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < 12; i += 1) {
    const candidate = `ADM-${year}-${crypto.randomInt(1000, 9999)}`;
    const exists = await d1First<{ id: string }>(
      'SELECT id FROM admissions WHERE application_number = ? LIMIT 1',
      [candidate],
      db
    );
    if (!exists) return candidate;
  }
  return `ADM-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function isActiveStudentCourseDuplicateD1(
  studentId: string,
  courseId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  const row = await d1First<{ id: string }>(
    "SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND status IN ('Active', 'Waitlisted', 'Completed') LIMIT 1",
    [studentId, courseId],
    db
  );
  return Boolean(row);
}

export async function recordAuditLogD1(
  params: {
    actor: Pick<UserPublic, 'id' | 'email' | 'role'> | null;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<void> {
  try {
    const actorUserId =
      params.actor?.id && params.actor.id.trim().length > 0 ? params.actor.id : null;
    await d1Run(
      `INSERT INTO audit_logs (id, actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, ip_address, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomId('aud', 10),
        actorUserId,
        params.actor?.email ?? 'system@infocom.edu',
        params.actor?.role ?? 'system',
        params.action,
        params.entityType,
        params.entityId,
        params.summary,
        params.ipAddress ?? null,
        JSON.stringify(params.metadata ?? {}),
        nowIso(),
      ],
      db
    );
  } catch (err) {
    console.error('Failed to persist D1 audit log:', err);
  }
}

export async function issueAccountSetupTokenD1(
  params: {
    userId: string;
    createdByUserId?: string;
    expiresInHours?: number;
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ rawToken: string; expiresAtIso: string }> {
  const rawToken = generateOpaqueToken(24);
  const tokenHash = await sha256Hex(rawToken);
  const hours = params.expiresInHours ?? 72;
  const expiresAtIso = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const now = nowIso();

  await d1Run(
    'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
    [now, params.userId],
    db
  );
  await d1Run(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomId('prt', 8), params.userId, tokenHash, expiresAtIso, params.createdByUserId ?? null, now],
    db
  );

  return { rawToken, expiresAtIso };
}

export async function revokeActiveOnboardingTokensD1(
  userId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<number> {
  const now = nowIso();
  const res = await d1Run(
    'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
    [now, userId],
    db
  );
  return Number(res.meta?.changes ?? 0);
}

export async function getUserDashboardByIdD1(
  userId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<DashboardPayload> {
  const row = await findUserByIdD1(userId, db);
  if (!row) {
    throw new Error('Authenticated user record not found.');
  }
  return buildDashboardForUserD1(row, db);
}

export async function buildDashboardForUserD1(
  userRow: DbUserRow,
  db: D1DatabaseLike = getActiveD1()
): Promise<DashboardPayload> {
  const publicUser = toPublicUserD1(userRow);
  const isAdmin = publicUser.role === 'admin';
  const isInstructor = publicUser.role === 'instructor';
  const scope = isInstructor ? await getInstructorScopeD1(publicUser.id, db) : null;

  const [
    academyRow,
    policies,
    allDepartments,
    allClassrooms,
    allYears,
    allTerms,
    allFeePlans,
    allFeeStructures,
    allDiscounts,
    allScholarships,
    allRefunds,
    allCourses,
    allModules,
    allBatches,
    allUsers,
    allAdmissions,
    allAdmissionDocs,
    allEnrollments,
    allSessions,
    allAttendance,
    allAssessments,
    allGrades,
    allRemarks,
    allInvoices,
    allPayments,
    allDocs,
    allCerts,
    allNotifs,
    allAudits,
  ] = await Promise.all([
    d1First<Record<string, unknown>>('SELECT * FROM academies ORDER BY created_at ASC LIMIT 1', [], db),
    loadAcademyPoliciesSummaryD1(db),
    d1All<Record<string, unknown>>('SELECT * FROM departments ORDER BY name ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM classrooms ORDER BY code ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM academic_years ORDER BY start_date DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM academic_terms ORDER BY start_date DESC', [], db),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM fee_plans ORDER BY code ASC', [], db) : Promise.resolve([]),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM fee_structures ORDER BY created_at DESC', [], db) : Promise.resolve([]),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM discounts ORDER BY created_at DESC', [], db) : Promise.resolve([]),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM scholarships ORDER BY created_at DESC', [], db) : Promise.resolve([]),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM refunds ORDER BY processed_at DESC', [], db) : Promise.resolve([]),
    d1All<Record<string, unknown>>('SELECT * FROM courses ORDER BY created_at ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM course_modules ORDER BY sort_order ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM cohorts ORDER BY start_date ASC', [], db),
    d1All<DbUserRow>('SELECT * FROM users ORDER BY created_at DESC', [], db),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM admissions ORDER BY submitted_at DESC', [], db) : Promise.resolve([]),
    isAdmin ? d1All<Record<string, unknown>>('SELECT id, application_id, verified_status FROM admission_documents', [], db) : Promise.resolve([]),
    d1All<Record<string, unknown>>('SELECT * FROM enrollments ORDER BY enrolled_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM class_sessions ORDER BY start_at ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM attendance_records ORDER BY updated_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM assessments ORDER BY created_at ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM module_grades ORDER BY graded_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM progress_remarks ORDER BY updated_at DESC', [], db),
    isInstructor
      ? Promise.resolve([])
      : isAdmin
        ? d1All<Record<string, unknown>>('SELECT * FROM fee_invoices ORDER BY created_at DESC', [], db)
        : d1All<Record<string, unknown>>('SELECT * FROM fee_invoices WHERE student_id = ? ORDER BY created_at DESC', [publicUser.id], db),
    isInstructor
      ? Promise.resolve([])
      : isAdmin
        ? d1All<Record<string, unknown>>('SELECT * FROM payments ORDER BY paid_at DESC', [], db)
        : d1All<Record<string, unknown>>('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_at DESC', [publicUser.id], db),
    d1All<Record<string, unknown>>('SELECT * FROM documents WHERE is_archived = 0 ORDER BY created_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM certificates ORDER BY issued_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 80', [publicUser.id], db),
    isAdmin ? d1All<Record<string, unknown>>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 120', [], db) : Promise.resolve([]),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const deptMap = new Map(allDepartments.map((d) => [String(d.id), String(d.name)]));
  const yearMap = new Map(allYears.map((y) => [String(y.id), String(y.name)]));
  const roomMap = new Map(allClassrooms.map((r) => [String(r.id), String(r.name)]));

  const mappedAcademy = academyRow
    ? {
        id: String(academyRow.id),
        code: String(academyRow.code),
        name: String(academyRow.name),
        legalName: String(academyRow.legal_name ?? ''),
        email: String(academyRow.email ?? ''),
        phone: String(academyRow.phone ?? ''),
        website: String(academyRow.website ?? ''),
        address: String(academyRow.address ?? ''),
        logoDataUrl: String(academyRow.logo_data_url ?? ''),
        timezone: String(academyRow.timezone || 'Asia/Kolkata'),
        currency: String(academyRow.currency || 'INR'),
      }
    : {
        id: 'acad-infocom',
        code: 'INFOCOM-MAIN',
        name: 'IGS — InfoCom Global Services',
        legalName: 'InfoCom Global Services — Computer Institute',
        email: '',
        phone: '',
        website: '',
        address:
          'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
        logoDataUrl: '',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      };

  const modulesByCourse = new Map<string, Array<Record<string, unknown>>>();
  for (const m of allModules) {
    const cid = String(m.course_id);
    const list = modulesByCourse.get(cid) ?? [];
    list.push(m);
    modulesByCourse.set(cid, list);
  }

  const mappedCourses: Course[] = allCourses.map((c) => {
    const cid = String(c.id);
    const mods = modulesByCourse.get(cid) ?? [];
    return {
      id: cid,
      code: String(c.code),
      slug: c.slug ? String(c.slug) : slugifyCourseTitle(String(c.title)),
      title: String(c.title),
      track: String(c.track),
      category: String(c.category ?? 'Technical Bootcamp'),
      departmentId: c.department_id ? String(c.department_id) : null,
      departmentName: c.department_id ? deptMap.get(String(c.department_id)) ?? null : null,
      description: String(c.description ?? ''),
      prerequisites: String(c.prerequisites ?? ''),
      learningObjectives: sqlJson<string[]>(c.learning_objectives, []),
      passingScore: Number(c.passing_score ?? 60),
      minAttendanceRate: Number(c.min_attendance_rate ?? 75),
      gradingConfig: sqlJson<Course['gradingConfig']>(c.grading_config, {}),
      instructorId: String(c.instructor_id),
      instructorName: userMap.get(String(c.instructor_id))?.name ?? 'Faculty',
      durationWeeks: Number(c.duration_weeks ?? 8),
      tuitionFee: sqlFixed(c.tuition_fee, '1200.00'),
      isPublished: sqlBool(c.is_published),
      showTuitionPublicly: sqlBool(c.show_tuition_publicly),
      isDemo: sqlBool(c.is_demo),
      isArchived: sqlBool(c.is_archived),
      modules: mods.map((m) => ({
        id: String(m.id),
        code: String(m.code),
        title: String(m.title),
        weight: Number(m.weight),
        labHours: Number(m.lab_hours),
        sortOrder: Number(m.sort_order),
      })),
    };
  });
  const courseMap = new Map(mappedCourses.map((c) => [c.id, c]));

  const mappedCohorts: Cohort[] = allBatches.map((b) => ({
    id: String(b.id),
    code: String(b.code),
    name: String(b.name),
    courseId: String(b.course_id),
    termId: b.term_id ? String(b.term_id) : null,
    instructorId: String(b.instructor_id),
    instructorName: userMap.get(String(b.instructor_id))?.name ?? 'Faculty',
    classroomId: b.classroom_id ? String(b.classroom_id) : null,
    classroomName: b.classroom_id ? roomMap.get(String(b.classroom_id)) ?? null : null,
    capacity: Number(b.capacity ?? 24),
    startDate: String(b.start_date),
    endDate: String(b.end_date),
    status: String(b.status) as CohortStatus,
  }));

  const mappedEnrollments: Enrollment[] = allEnrollments.map((e) => ({
    id: String(e.id),
    studentId: String(e.student_id),
    courseId: String(e.course_id),
    cohortId: e.cohort_id ? String(e.cohort_id) : null,
    cohort: String(e.cohort),
    status: String(e.status) as EnrollmentStatus,
    enrolledAt: String(e.enrolled_at),
    completedModuleIds: sqlJson<string[]>(e.completed_module_ids, []),
  }));

  const mappedSessions = allSessions.map((s) => ({
    id: String(s.id),
    courseId: String(s.course_id),
    cohortId: s.cohort_id ? String(s.cohort_id) : null,
    classroomId: s.classroom_id ? String(s.classroom_id) : null,
    cohort: String(s.cohort),
    title: String(s.title),
    topic: String(s.topic ?? ''),
    room: String(s.room),
    instructorId: s.instructor_id ? String(s.instructor_id) : null,
    instructorName: String(s.instructor_name),
    startIso: String(s.start_at),
    endIso: String(s.end_at),
    status: String(s.status) as 'Scheduled' | 'Completed' | 'Cancelled',
  }));

  const mappedAttendance = allAttendance.map((a) => ({
    id: String(a.id),
    sessionId: String(a.session_id),
    courseId: String(a.course_id),
    studentId: String(a.student_id),
    status: String(a.status) as AttendanceStatus,
    note: String(a.note ?? ''),
    updatedAt: String(a.updated_at),
    updatedBy: String(a.updated_by),
  }));

  const mappedAssessments: AssessmentRecord[] = allAssessments.map((a) => ({
    id: String(a.id),
    courseId: String(a.course_id),
    moduleId: a.module_id ? String(a.module_id) : null,
    batchId: a.batch_id ? String(a.batch_id) : null,
    title: String(a.title),
    assessmentType: String(a.assessment_type) as AssessmentType,
    maxScore: Number(a.max_score ?? 100),
    weight: Number(a.weight ?? 25),
    dueDate: a.due_date ? String(a.due_date) : null,
    createdAt: String(a.created_at),
  }));
  const assessmentMap = new Map(mappedAssessments.map((a) => [a.id, a]));

  const mappedAssessmentGrades: AssessmentGradeRecord[] = allGrades.map((g) => {
    const asmt = assessmentMap.get(String(g.assessment_id));
    const maxScore = asmt?.maxScore ?? Number(g.max_score ?? 100);
    const score = Number(g.score ?? 0);
    return {
      id: String(g.id),
      assessmentId: String(g.assessment_id),
      studentId: String(g.student_id),
      courseId: String(g.course_id),
      moduleId: g.module_id ? String(g.module_id) : null,
      score,
      maxScore,
      percentage: Math.round((score / Math.max(1, maxScore)) * 1000) / 10,
      feedback: String(g.feedback ?? ''),
      gradedAt: String(g.graded_at),
      gradedBy: String(g.graded_by),
    };
  });

  const mappedGrades: ModuleGrade[] = allGrades
    .filter((g) => {
      if (!g.module_id) return false;
      const asmt = assessmentMap.get(String(g.assessment_id));
      return !asmt || asmt.assessmentType === 'Module Assessment';
    })
    .map((g) => ({
      id: String(g.id),
      studentId: String(g.student_id),
      courseId: String(g.course_id),
      moduleId: String(g.module_id),
      assessmentId: String(g.assessment_id),
      score: Number(g.score ?? 0),
      feedback: String(g.feedback ?? ''),
      gradedAt: String(g.graded_at),
      gradedBy: String(g.graded_by),
    }));

  const mappedRemarks = allRemarks.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    courseId: String(r.course_id),
    summary: String(r.summary),
    updatedAt: String(r.updated_at),
    updatedBy: String(r.updated_by),
  }));

  const refundedByPaymentCents = new Map<string, number>();
  for (const ref of allRefunds) {
    if (String(ref.status) === 'Cancelled') continue;
    const pid = String(ref.payment_id);
    refundedByPaymentCents.set(pid, (refundedByPaymentCents.get(pid) ?? 0) + toCents(String(ref.amount)));
  }

  const mappedInvoices = allInvoices.map((inv) => ({
    id: String(inv.id),
    invoiceNumber: String(inv.invoice_number),
    studentId: String(inv.student_id),
    enrollmentId: inv.enrollment_id ? String(inv.enrollment_id) : null,
    courseId: String(inv.course_id),
    feeStructureId: inv.fee_structure_id ? String(inv.fee_structure_id) : null,
    description: String(inv.description),
    subtotal: sqlFixed(inv.subtotal ?? inv.amount_due),
    discountTotal: sqlFixed(inv.discount_total),
    scholarshipTotal: sqlFixed(inv.scholarship_total),
    amountDue: sqlFixed(inv.amount_due),
    amountPaid: sqlFixed(inv.amount_paid),
    currency: String(inv.currency || 'INR'),
    status: String(inv.status) as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
    dueDate: String(inv.due_date),
    isArchived: sqlBool(inv.is_archived),
    createdAt: String(inv.created_at),
  }));

  const mappedPayments = allPayments.map((p) => ({
    id: String(p.id),
    receiptNumber: String(p.receipt_number),
    invoiceId: String(p.invoice_id),
    studentId: String(p.student_id),
    amount: sqlFixed(p.amount),
    refundedAmount: fromCents(refundedByPaymentCents.get(String(p.id)) ?? 0),
    method: String(p.method) as PaymentMethod,
    referenceCode: String(p.reference_code ?? ''),
    recordedByUserId: String(p.recorded_by_user_id),
    notes: String(p.notes ?? ''),
    paidAt: String(p.paid_at),
  }));

  const mappedDocs: DocumentRecord[] = allDocs.map((d) => ({
    id: String(d.id),
    ownerUserId: d.owner_user_id ? String(d.owner_user_id) : '',
    courseId: d.course_id ? String(d.course_id) : null,
    title: String(d.title),
    category: String(d.category) as DocumentRecord['category'],
    fileName: String(d.file_name),
    mimeType: String(d.mime_type),
    sizeBytes: Number(d.size_bytes ?? 0),
    uploadedByUserId: d.uploaded_by_user_id ? String(d.uploaded_by_user_id) : '',
    isArchived: sqlBool(d.is_archived),
    createdAt: String(d.created_at),
  }));

  const mappedCerts: CertificateRecord[] = allCerts.map((c) => ({
    id: String(c.id),
    certificateCode: String(c.certificate_code),
    verificationHash: String(c.verification_hash),
    studentId: String(c.student_id),
    studentName: userMap.get(String(c.student_id))?.name,
    courseId: String(c.course_id),
    courseCode: courseMap.get(String(c.course_id))?.code,
    courseTitle: c.course_title_snapshot
      ? String(c.course_title_snapshot)
      : courseMap.get(String(c.course_id))?.title,
    enrollmentId: String(c.enrollment_id),
    finalScore: sqlFixed(c.final_score),
    letterGrade: String(c.letter_grade),
    attendanceRate: Number(c.attendance_rate),
    issuedByName: String(c.issued_by_name),
    status: String(c.status) as CertificateRecord['status'],
    revokedReason: c.revoked_reason ? String(c.revoked_reason) : null,
    issuedAt: String(c.issued_at),
  }));

  const mappedNotifs: NotificationItem[] = allNotifs.map((n) => ({
    id: String(n.id),
    userId: String(n.user_id),
    kind: String(n.kind) as NotificationItem['kind'],
    title: String(n.title),
    message: String(n.message),
    relatedCourseId: n.related_course_id ? String(n.related_course_id) : null,
    relatedSessionId: n.related_session_id ? String(n.related_session_id) : null,
    dedupeKey: n.dedupe_key ? String(n.dedupe_key) : null,
    read: sqlBool(n.read),
    createdAt: String(n.created_at),
  }));

  const publicUsers = allUsers.map(toPublicUserD1);
  const studentsList = publicUsers.filter((u) => u.role === 'student');

  const mappedAdmissions: AdmissionApplication[] = allAdmissions.map((a) => {
    const aid = String(a.id);
    const appDocs = allAdmissionDocs.filter((ad) => String(ad.application_id) === aid);
    return {
      id: aid,
      applicationNumber: a.application_number ? String(a.application_number) : null,
      applicantName: String(a.applicant_name),
      applicantEmail: String(a.applicant_email),
      phone: String(a.phone ?? ''),
      dateOfBirth: a.date_of_birth ? String(a.date_of_birth).slice(0, 10) : null,
      gender: String(a.gender ?? ''),
      nationality: String(a.nationality ?? ''),
      address: String(a.address ?? ''),
      city: String(a.city ?? ''),
      postalCode: String(a.postal_code ?? ''),
      guardianName: String(a.guardian_name ?? ''),
      guardianRelationship: String(a.guardian_relationship ?? ''),
      guardianPhone: String(a.guardian_phone ?? ''),
      guardianEmail: String(a.guardian_email ?? ''),
      previousQualification: String(a.previous_qualification ?? ''),
      previousInstitution: String(a.previous_institution ?? ''),
      graduationYear: String(a.graduation_year ?? ''),
      previousScore: String(a.previous_score ?? ''),
      targetCourseId: String(a.target_course_id),
      targetBatchId: a.target_batch_id ? String(a.target_batch_id) : null,
      allocatedBatchId: a.allocated_batch_id ? String(a.allocated_batch_id) : null,
      feePlanId: a.fee_plan_id ? String(a.fee_plan_id) : null,
      preferredCohort: String(a.preferred_cohort),
      status: String(a.status) as AdmissionStatus,
      notes: String(a.notes ?? ''),
      applicantRemarks: String(a.applicant_remarks ?? ''),
      reviewRemarks: String(a.review_remarks ?? ''),
      rejectionReason: String(a.rejection_reason ?? ''),
      reviewedByUserId: a.reviewed_by_user_id ? String(a.reviewed_by_user_id) : null,
      convertedUserId: a.converted_user_id ? String(a.converted_user_id) : null,
      portalActivated: sqlBool(a.portal_activated),
      portalActivatedAt: a.portal_activated_at ? String(a.portal_activated_at) : null,
      submittedAt: String(a.submitted_at),
      draftSavedAt: a.draft_saved_at ? String(a.draft_saved_at) : null,
      reviewedAt: a.reviewed_at ? String(a.reviewed_at) : null,
      approvedAt: a.approved_at ? String(a.approved_at) : null,
      updatedAt: a.updated_at ? String(a.updated_at) : null,
      documentsCount: appDocs.length,
      verifiedDocumentsCount: appDocs.filter((d) => String(d.verified_status) === 'Verified').length,
    };
  });

  const analytics = computeAcademyAnalytics({
    users: publicUsers,
    admissions: mappedAdmissions,
    enrollments: mappedEnrollments,
    invoices: mappedInvoices,
    certificates: mappedCerts,
    attendance: mappedAttendance,
  });

  const commonStructure = {
    academy: mappedAcademy,
    policies,
    departments: allDepartments.map((d) => ({
      id: String(d.id),
      code: String(d.code),
      name: String(d.name),
      headUserId: d.head_user_id ? String(d.head_user_id) : null,
      status: String(d.status),
    })),
    classrooms: allClassrooms.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      building: String(r.building),
      capacity: Number(r.capacity ?? 24),
      equipment: String(r.equipment ?? ''),
      isActive: sqlBool(r.is_active),
    })),
    academicYears: allYears.map((y) => ({
      id: String(y.id),
      code: String(y.code),
      name: String(y.name),
      startDate: String(y.start_date),
      endDate: String(y.end_date),
      isCurrent: sqlBool(y.is_current),
      status: String(y.status),
    })),
    academicTerms: allTerms.map((t) => ({
      id: String(t.id),
      academicYearId: String(t.academic_year_id),
      academicYearName: yearMap.get(String(t.academic_year_id)) ?? '',
      code: String(t.code),
      name: String(t.name),
      startDate: String(t.start_date),
      endDate: String(t.end_date),
      isCurrent: sqlBool(t.is_current),
      status: String(t.status),
    })),
  };

  if (isAdmin) {
    const feePlanMap = new Map(allFeePlans.map((fp) => [String(fp.id), fp]));
    const invoiceMap = new Map(allInvoices.map((i) => [String(i.id), i]));
    const paymentMap = new Map(allPayments.map((p) => [String(p.id), p]));

    return {
      user: publicUser,
      ...commonStructure,
      feePlans: allFeePlans.map((fp) => ({
        id: String(fp.id),
        code: String(fp.code),
        name: String(fp.name),
        description: String(fp.description ?? ''),
        installmentCount: Number(fp.installment_count ?? 1),
        currency: String(fp.currency || 'INR'),
        isActive: sqlBool(fp.is_active),
      })),
      feeStructures: allFeeStructures.map((fs) => {
        const c = courseMap.get(String(fs.course_id));
        const fp = fs.fee_plan_id ? feePlanMap.get(String(fs.fee_plan_id)) : undefined;
        const tStr = sqlFixed(fs.tuition_amount);
        const rStr = sqlFixed(fs.registration_fee);
        const lStr = sqlFixed(fs.lab_fee);
        return {
          id: String(fs.id),
          courseId: String(fs.course_id),
          courseCode: c?.code,
          courseTitle: c?.title,
          batchId: fs.batch_id ? String(fs.batch_id) : null,
          feePlanId: fs.fee_plan_id ? String(fs.fee_plan_id) : null,
          feePlanName: fp ? String(fp.name) : null,
          tuitionAmount: tStr,
          registrationFee: rStr,
          labFee: lStr,
          totalAmount: fromCents(toCents(tStr) + toCents(rStr) + toCents(lStr)),
          effectiveFrom: String(fs.effective_from),
          isActive: sqlBool(fs.is_active),
          createdAt: String(fs.created_at),
        };
      }),
      discounts: allDiscounts.map((d) => ({
        id: String(d.id),
        code: String(d.code),
        name: String(d.name),
        discountType: String(d.discount_type) as 'Percentage' | 'Fixed',
        value: sqlFixed(d.value),
        isActive: sqlBool(d.is_active),
        validFrom: d.valid_from ? String(d.valid_from) : null,
        validTo: d.valid_to ? String(d.valid_to) : null,
        createdAt: String(d.created_at),
      })),
      scholarships: allScholarships.map((s) => ({
        id: String(s.id),
        code: String(s.code),
        name: String(s.name),
        sponsorName: String(s.sponsor_name ?? ''),
        coverageType: String(s.coverage_type) as 'Percentage' | 'Fixed',
        coverageValue: sqlFixed(s.coverage_value),
        maxRecipients: Number(s.max_recipients ?? 10),
        academicYearId: s.academic_year_id ? String(s.academic_year_id) : null,
        isActive: sqlBool(s.is_active),
        createdAt: String(s.created_at),
      })),
      refunds: allRefunds.map((r) => ({
        id: String(r.id),
        refundNumber: String(r.refund_number),
        paymentId: String(r.payment_id),
        receiptNumber: paymentMap.get(String(r.payment_id))
          ? String(paymentMap.get(String(r.payment_id))!.receipt_number)
          : undefined,
        invoiceId: String(r.invoice_id),
        invoiceNumber: invoiceMap.get(String(r.invoice_id))
          ? String(invoiceMap.get(String(r.invoice_id))!.invoice_number)
          : undefined,
        studentId: String(r.student_id),
        studentName: userMap.get(String(r.student_id))?.name,
        amount: sqlFixed(r.amount),
        reason: String(r.reason),
        status: String(r.status) as 'Pending' | 'Processed' | 'Cancelled',
        processedByUserId: String(r.processed_by_user_id),
        processedByName: userMap.get(String(r.processed_by_user_id))?.name,
        processedAt: String(r.processed_at),
      })),
      courses: mappedCourses,
      cohorts: mappedCohorts,
      users: publicUsers,
      students: studentsList,
      admissions: mappedAdmissions,
      enrollments: mappedEnrollments,
      sessions: mappedSessions,
      attendance: mappedAttendance,
      assessments: mappedAssessments,
      assessmentGrades: mappedAssessmentGrades,
      grades: mappedGrades,
      remarks: mappedRemarks,
      invoices: mappedInvoices,
      payments: mappedPayments,
      documents: mappedDocs,
      certificates: mappedCerts,
      notifications: mappedNotifs,
      auditLogs: allAudits.map((a) => ({
        id: String(a.id),
        actorUserId: a.actor_user_id ? String(a.actor_user_id) : null,
        actorEmail: String(a.actor_email),
        actorRole: String(a.actor_role),
        action: String(a.action),
        entityType: String(a.entity_type),
        entityId: String(a.entity_id),
        summary: String(a.summary),
        metadata: sqlJson<Record<string, unknown>>(a.metadata, {}),
        createdAt: String(a.created_at),
      })),
      analytics,
      isDemoEnvironment: false,
    };
  }

  if (isInstructor && scope) {
    const scopedCourses = mappedCourses.filter((c) => scope.courseIds.has(c.id));
    const scopedCohorts = mappedCohorts.filter(
      (b) => scope.batchIds.has(b.id) || scope.courseIds.has(b.courseId)
    );
    const scopedEnrollments = mappedEnrollments.filter((e) => scope.courseIds.has(e.courseId));
    const enrolledStudentIds = new Set(scopedEnrollments.map((e) => e.studentId));
    const scopedStudents = studentsList.filter((s) => enrolledStudentIds.has(s.id));
    const scopedSessions = mappedSessions.filter(
      (s) => scope.courseIds.has(s.courseId) || s.instructorId === publicUser.id
    );
    const scopedAttendance = mappedAttendance.filter((a) => scope.courseIds.has(a.courseId));
    const scopedAssessments = mappedAssessments.filter((a) => scope.courseIds.has(a.courseId));
    const scopedAssessmentGrades = mappedAssessmentGrades.filter((g) => scope.courseIds.has(g.courseId));
    const scopedGrades = mappedGrades.filter((g) => scope.courseIds.has(g.courseId));
    const scopedRemarks = mappedRemarks.filter((r) => scope.courseIds.has(r.courseId));
    const scopedDocs = mappedDocs.filter(
      (d) =>
        d.category !== 'Receipt' &&
        (d.ownerUserId === publicUser.id ||
          d.uploadedByUserId === publicUser.id ||
          (d.courseId && scope.courseIds.has(d.courseId)) ||
          enrolledStudentIds.has(d.ownerUserId))
    );
    const scopedCerts = mappedCerts.filter((c) => scope.courseIds.has(c.courseId));
    const scopedAnalytics = computeAcademyAnalytics({
      users: scopedStudents,
      admissions: [],
      enrollments: scopedEnrollments,
      invoices: [],
      certificates: scopedCerts,
      attendance: scopedAttendance,
    });

    return {
      user: publicUser,
      ...commonStructure,
      courses: scopedCourses,
      cohorts: scopedCohorts,
      users: [publicUser, ...scopedStudents],
      students: scopedStudents,
      admissions: [],
      enrollments: scopedEnrollments,
      sessions: scopedSessions,
      attendance: scopedAttendance,
      assessments: scopedAssessments,
      assessmentGrades: scopedAssessmentGrades,
      grades: scopedGrades,
      remarks: scopedRemarks,
      invoices: [],
      payments: [],
      documents: scopedDocs,
      certificates: scopedCerts,
      notifications: mappedNotifs,
      auditLogs: [],
      analytics: scopedAnalytics,
      isDemoEnvironment: false,
    };
  }

  // Student view strictly isolated to own records
  const myEnrollments = mappedEnrollments.filter((e) => e.studentId === publicUser.id);
  const myCourseIds = new Set(
    myEnrollments.filter((e) => !isInactiveEnrollmentStatus(e.status)).map((e) => e.courseId)
  );
  const myCohorts = new Set(myEnrollments.map((e) => e.cohort));

  return {
    user: publicUser,
    ...commonStructure,
    courses: mappedCourses.filter((c) => myCourseIds.has(c.id)),
    cohorts: mappedCohorts.filter((c) => myCourseIds.has(c.courseId)),
    users: [publicUser],
    students: [publicUser],
    admissions: [],
    enrollments: myEnrollments,
    sessions: mappedSessions.filter(
      (s) => myCourseIds.has(s.courseId) && myCohorts.has(s.cohort)
    ),
    attendance: mappedAttendance.filter((a) => a.studentId === publicUser.id),
    assessments: mappedAssessments.filter((a) => myCourseIds.has(a.courseId)),
    assessmentGrades: mappedAssessmentGrades.filter((g) => g.studentId === publicUser.id),
    grades: mappedGrades.filter((g) => g.studentId === publicUser.id),
    remarks: mappedRemarks.filter((r) => r.studentId === publicUser.id),
    invoices: mappedInvoices.filter((i) => i.studentId === publicUser.id),
    payments: mappedPayments.filter((p) => p.studentId === publicUser.id),
    documents: mappedDocs.filter(
      (d) =>
        d.ownerUserId === publicUser.id ||
        (d.category === 'Syllabus' && d.courseId && myCourseIds.has(d.courseId))
    ),
    certificates: mappedCerts.filter((c) => c.studentId === publicUser.id),
    notifications: mappedNotifs,
    auditLogs: [],
    analytics,
    isDemoEnvironment: false,
  };
}

export async function buildAdmissionDetailPayloadD1(
  applicationId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<AdmissionDetailPayload | null> {
  const adm = await d1First<Record<string, unknown>>(
    'SELECT * FROM admissions WHERE id = ? LIMIT 1',
    [applicationId],
    db
  );
  if (!adm) return null;

  const [admDocs, histories, batches, feePlans, portalActivationPolicy, activeEnrollments, rooms, users] =
    await Promise.all([
      d1All<
        Record<string, unknown> & {
          fa_title: string;
          fa_file_name: string;
          fa_mime_type: string;
          fa_size_bytes: number;
        }
      >(
        `SELECT ad.*, d.title AS fa_title, d.file_name AS fa_file_name, d.mime_type AS fa_mime_type, d.size_bytes AS fa_size_bytes
         FROM admission_documents ad
         INNER JOIN documents d ON d.id = ad.file_asset_id
         WHERE ad.application_id = ?
         ORDER BY ad.created_at DESC`,
        [applicationId],
        db
      ),
      d1All<Record<string, unknown>>(
        'SELECT * FROM admission_status_histories WHERE application_id = ? ORDER BY changed_at DESC',
        [applicationId],
        db
      ),
      d1All<Record<string, unknown>>(
        "SELECT * FROM cohorts WHERE course_id = ? AND status IN ('Planned', 'Active') ORDER BY start_date ASC",
        [String(adm.target_course_id)],
        db
      ),
      d1All<Record<string, unknown>>(
        'SELECT * FROM fee_plans WHERE is_active = 1 ORDER BY installment_count ASC',
        [],
        db
      ),
      getPortalActivationPolicyD1(db),
      d1All<{ cohort_id: string | null; cohort: string }>(
        "SELECT cohort_id, cohort FROM enrollments WHERE course_id = ? AND status IN ('Active', 'Waitlisted')",
        [String(adm.target_course_id)],
        db
      ),
      d1All<{ id: string; name: string }>('SELECT id, name FROM classrooms', [], db),
      d1All<DbUserRow>('SELECT * FROM users', [], db),
    ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const roomMap = new Map(rooms.map((r) => [r.id, r.name]));
  const convertedUser = adm.converted_user_id ? userMap.get(String(adm.converted_user_id)) ?? null : null;

  const docs: AdmissionDocumentRecord[] = admDocs.map((ad) => ({
    id: String(ad.id),
    applicationId: String(ad.application_id),
    fileAssetId: String(ad.file_asset_id),
    documentType: String(ad.document_type),
    title: String(ad.fa_title),
    fileName: String(ad.fa_file_name),
    mimeType: String(ad.fa_mime_type),
    sizeBytes: Number(ad.fa_size_bytes),
    verifiedStatus: String(ad.verified_status) as AdmissionDocumentStatus,
    verificationRemarks: String(ad.verification_remarks ?? ''),
    verifiedByUserId: ad.verified_by_user_id ? String(ad.verified_by_user_id) : null,
    verifiedByName: ad.verified_by_name ? String(ad.verified_by_name) : null,
    verifiedAt: ad.verified_at ? String(ad.verified_at) : null,
    isLatest: sqlBool(ad.is_latest),
    createdAt: String(ad.created_at),
  }));

  const statusHistory: AdmissionStatusHistoryEntry[] = histories.map((h) => ({
    id: String(h.id),
    applicationId: String(h.application_id),
    previousStatus: h.previous_status ? String(h.previous_status) : null,
    newStatus: String(h.new_status),
    reason: String(h.reason ?? ''),
    actorUserId: h.actor_user_id ? String(h.actor_user_id) : null,
    actorName: String(h.actor_name ?? ''),
    actorRole: String(h.actor_role ?? 'system'),
    changedAt: String(h.changed_at),
  }));

  return {
    application: {
      id: String(adm.id),
      applicationNumber: adm.application_number ? String(adm.application_number) : null,
      applicantName: String(adm.applicant_name),
      applicantEmail: String(adm.applicant_email),
      phone: String(adm.phone ?? ''),
      dateOfBirth: adm.date_of_birth ? String(adm.date_of_birth).slice(0, 10) : null,
      gender: String(adm.gender ?? ''),
      nationality: String(adm.nationality ?? ''),
      address: String(adm.address ?? ''),
      city: String(adm.city ?? ''),
      postalCode: String(adm.postal_code ?? ''),
      guardianName: String(adm.guardian_name ?? ''),
      guardianRelationship: String(adm.guardian_relationship ?? ''),
      guardianPhone: String(adm.guardian_phone ?? ''),
      guardianEmail: String(adm.guardian_email ?? ''),
      previousQualification: String(adm.previous_qualification ?? ''),
      previousInstitution: String(adm.previous_institution ?? ''),
      graduationYear: String(adm.graduation_year ?? ''),
      previousScore: String(adm.previous_score ?? ''),
      targetCourseId: String(adm.target_course_id),
      targetBatchId: adm.target_batch_id ? String(adm.target_batch_id) : null,
      allocatedBatchId: adm.allocated_batch_id ? String(adm.allocated_batch_id) : null,
      feePlanId: adm.fee_plan_id ? String(adm.fee_plan_id) : null,
      preferredCohort: String(adm.preferred_cohort),
      status: String(adm.status) as AdmissionStatus,
      notes: String(adm.notes ?? ''),
      applicantRemarks: String(adm.applicant_remarks ?? ''),
      reviewRemarks: String(adm.review_remarks ?? ''),
      rejectionReason: String(adm.rejection_reason ?? ''),
      reviewedByUserId: adm.reviewed_by_user_id ? String(adm.reviewed_by_user_id) : null,
      convertedUserId: adm.converted_user_id ? String(adm.converted_user_id) : null,
      portalActivated: sqlBool(adm.portal_activated),
      portalActivatedAt: adm.portal_activated_at ? String(adm.portal_activated_at) : null,
      submittedAt: String(adm.submitted_at),
      draftSavedAt: adm.draft_saved_at ? String(adm.draft_saved_at) : null,
      reviewedAt: adm.reviewed_at ? String(adm.reviewed_at) : null,
      approvedAt: adm.approved_at ? String(adm.approved_at) : null,
      updatedAt: adm.updated_at ? String(adm.updated_at) : null,
      documentsCount: docs.length,
      verifiedDocumentsCount: docs.filter((d) => d.verifiedStatus === 'Verified').length,
      documents: docs,
      statusHistory,
    },
    documents: docs,
    statusHistory,
    eligibleBatches: batches.map((b) => {
      const enrolledCount = activeEnrollments.filter(
        (e) => e.cohort_id === String(b.id) || e.cohort === String(b.name)
      ).length;
      const cap = Number(b.capacity ?? 24);
      return {
        id: String(b.id),
        code: String(b.code),
        name: String(b.name),
        courseId: String(b.course_id),
        termId: b.term_id ? String(b.term_id) : null,
        instructorId: String(b.instructor_id),
        instructorName: userMap.get(String(b.instructor_id))?.name ?? 'Faculty',
        classroomId: b.classroom_id ? String(b.classroom_id) : null,
        classroomName: b.classroom_id ? roomMap.get(String(b.classroom_id)) ?? null : null,
        capacity: cap,
        startDate: String(b.start_date),
        endDate: String(b.end_date),
        status: String(b.status) as CohortStatus,
        enrolledCount,
        seatsRemaining: Math.max(0, cap - enrolledCount),
      };
    }),
    feePlans: feePlans.map((fp) => ({
      id: String(fp.id),
      code: String(fp.code),
      name: String(fp.name),
      description: String(fp.description ?? ''),
      installmentCount: Number(fp.installment_count ?? 1),
      currency: String(fp.currency || 'INR'),
      isActive: sqlBool(fp.is_active),
    })),
    linkedStudent: convertedUser ? toPublicUserD1(convertedUser) : null,
    portalActivationPolicy,
  };
}

export async function getInvoiceDetailForUserD1(
  invoiceId: string,
  actor: UserPublic,
  db: D1DatabaseLike = getActiveD1()
): Promise<InvoiceDetailPayload | null | 'FORBIDDEN'> {
  const invoice = await d1First<Record<string, unknown>>(
    'SELECT * FROM fee_invoices WHERE id = ? LIMIT 1',
    [invoiceId],
    db
  );
  if (!invoice) return null;
  if (actor.role === 'instructor') return 'FORBIDDEN';
  if (actor.role === 'student' && String(invoice.student_id) !== actor.id) return 'FORBIDDEN';

  const [student, course, academy, items, allocs, refunds] = await Promise.all([
    d1First<DbUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [String(invoice.student_id)], db),
    d1First<{ id: string; code: string; title: string }>(
      'SELECT id, code, title FROM courses WHERE id = ? LIMIT 1',
      [String(invoice.course_id)],
      db
    ),
    d1First<Record<string, unknown>>('SELECT * FROM academies ORDER BY created_at ASC LIMIT 1', [], db),
    d1All<Record<string, unknown>>(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at ASC',
      [invoiceId],
      db
    ),
    d1All<Record<string, unknown> & { receipt_number: string; method: string; reference_code: string }>(
      `SELECT pa.*, p.receipt_number, p.method, p.reference_code
       FROM payment_allocations pa
       INNER JOIN payments p ON p.id = pa.payment_id
       WHERE pa.invoice_id = ?
       ORDER BY pa.allocated_at ASC`,
      [invoiceId],
      db
    ),
    d1All<Record<string, unknown> & { receipt_number: string; processed_by_name: string }>(
      `SELECT r.*, p.receipt_number, u.name AS processed_by_name
       FROM refunds r
       INNER JOIN payments p ON p.id = r.payment_id
       INNER JOIN users u ON u.id = r.processed_by_user_id
       WHERE r.invoice_id = ?
       ORDER BY r.processed_at DESC`,
      [invoiceId],
      db
    ),
  ]);

  if (!student || !course) return null;

  return {
    invoice: {
      id: String(invoice.id),
      invoiceNumber: String(invoice.invoice_number),
      studentId: String(invoice.student_id),
      enrollmentId: invoice.enrollment_id ? String(invoice.enrollment_id) : null,
      courseId: String(invoice.course_id),
      feeStructureId: invoice.fee_structure_id ? String(invoice.fee_structure_id) : null,
      description: String(invoice.description),
      subtotal: sqlFixed(invoice.subtotal ?? invoice.amount_due),
      discountTotal: sqlFixed(invoice.discount_total),
      scholarshipTotal: sqlFixed(invoice.scholarship_total),
      amountDue: sqlFixed(invoice.amount_due),
      amountPaid: sqlFixed(invoice.amount_paid),
      currency: String(invoice.currency || 'INR'),
      status: String(invoice.status) as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
      dueDate: String(invoice.due_date),
      isArchived: sqlBool(invoice.is_archived),
      createdAt: String(invoice.created_at),
    },
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      studentCode: student.student_code,
      phone: student.phone,
    },
    course,
    academy: academy
      ? {
          name: String(academy.name),
          legalName: String(academy.legal_name ?? ''),
          email: String(academy.email ?? ''),
          phone: String(academy.phone ?? ''),
          website: String(academy.website ?? ''),
          address: String(academy.address ?? ''),
          logoDataUrl: String(academy.logo_data_url ?? ''),
          currency: String(academy.currency || 'INR'),
        }
      : {
          name: 'IGS — InfoCom Global Services',
          legalName: 'InfoCom Global Services — Computer Institute',
          email: '',
          phone: '',
          website: '',
          address:
            'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
          logoDataUrl: '',
          currency: 'INR',
        },
    items: items.map((item) => ({
      id: String(item.id),
      invoiceId: String(item.invoice_id),
      itemType: String(item.item_type) as InvoiceDetailPayload['items'][number]['itemType'],
      description: String(item.description),
      quantity: Number(item.quantity ?? 1),
      unitPrice: sqlFixed(item.unit_price),
      lineTotal: sqlFixed(item.line_total),
      createdAt: String(item.created_at),
    })),
    allocations: allocs.map((al) => ({
      id: String(al.id),
      paymentId: String(al.payment_id),
      receiptNumber: String(al.receipt_number),
      method: String(al.method) as PaymentMethod,
      referenceCode: String(al.reference_code ?? ''),
      allocatedAmount: sqlFixed(al.allocated_amount),
      allocatedAt: String(al.allocated_at),
    })),
    refunds: refunds.map((r) => ({
      id: String(r.id),
      refundNumber: String(r.refund_number),
      paymentId: String(r.payment_id),
      receiptNumber: String(r.receipt_number),
      invoiceId: String(r.invoice_id),
      invoiceNumber: String(invoice.invoice_number),
      studentId: String(r.student_id),
      studentName: student.name,
      amount: sqlFixed(r.amount),
      reason: String(r.reason),
      status: String(r.status) as 'Pending' | 'Processed' | 'Cancelled',
      processedByUserId: String(r.processed_by_user_id),
      processedByName: String(r.processed_by_name),
      processedAt: String(r.processed_at),
    })),
  };
}

export async function verifyCertificateByCodeD1(
  codeOrHash: string,
  db: D1DatabaseLike = getActiveD1()
) {
  const clean = codeOrHash.trim().toLowerCase();
  if (!clean) return null;

  const cert = await d1First<
    Record<string, unknown> & {
      student_name: string;
      student_code: string | null;
      course_code: string;
      course_title: string;
    }
  >(
    `SELECT c.*, u.name AS student_name, u.student_code AS student_code,
            crs.code AS course_code, crs.title AS course_title
     FROM certificates c
     INNER JOIN users u ON u.id = c.student_id
     INNER JOIN courses crs ON crs.id = c.course_id
     WHERE LOWER(c.certificate_code) = ? OR LOWER(c.verification_hash) = ?
     LIMIT 1`,
    [clean, clean],
    db
  );
  if (!cert) return null;

  return {
    certificateCode: String(cert.certificate_code),
    verificationHash: String(cert.verification_hash),
    studentName: String(cert.student_name),
    studentCode: cert.student_code,
    courseCode: String(cert.course_code),
    courseTitle: String(cert.course_title_snapshot || cert.course_title),
    finalScore: sqlFixed(cert.final_score),
    letterGrade: String(cert.letter_grade),
    attendanceRate: Number(cert.attendance_rate),
    issuedByName: String(cert.issued_by_name),
    status: String(cert.status),
    revokedReason: cert.revoked_reason ? String(cert.revoked_reason) : null,
    issuedAt: String(cert.issued_at),
  };
}

export async function getActiveDocumentContentD1(
  docId: string,
  requester: UserPublic,
  db: D1DatabaseLike = getActiveD1()
) {
  const doc = await d1First<Record<string, unknown>>(
    'SELECT * FROM documents WHERE id = ? AND is_archived = 0 LIMIT 1',
    [docId],
    db
  );
  if (!doc) return null;

  const ownerUserId = doc.owner_user_id ? String(doc.owner_user_id) : null;
  const courseId = doc.course_id ? String(doc.course_id) : null;
  const uploadedByUserId = doc.uploaded_by_user_id ? String(doc.uploaded_by_user_id) : null;
  const category = String(doc.category);

  if (requester.role === 'student') {
    const isOwner = ownerUserId === requester.id;
    let isSyllabus = false;
    if (category === 'Syllabus' && courseId) {
      const enr = await d1First<{ id: string }>(
        "SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND status IN ('Active', 'Completed') LIMIT 1",
        [requester.id, courseId],
        db
      );
      isSyllabus = Boolean(enr);
    }
    if (!isOwner && !isSyllabus) return 'FORBIDDEN' as const;
  } else if (requester.role === 'instructor') {
    if (category === 'Receipt') return 'FORBIDDEN' as const;
    const isOwnerOrUploader = ownerUserId === requester.id || uploadedByUserId === requester.id;
    const inCourse = courseId ? await canInstructorAccessCourseD1(requester.id, courseId, db) : false;
    const inStudent = ownerUserId ? await canInstructorAccessStudentD1(requester.id, ownerUserId, db) : false;
    if (!isOwnerOrUploader && !inCourse && !inStudent) return 'FORBIDDEN' as const;
  }

  const bytes = await readWorkerR2Document({
    storageProvider: String(doc.storage_provider),
    storageKey: doc.storage_key ? String(doc.storage_key) : null,
    contentBase64: doc.content_base64 ? String(doc.content_base64) : null,
  });

  return {
    id: String(doc.id),
    fileName: String(doc.file_name),
    mimeType: String(doc.mime_type),
    bytes,
  };
}

export async function computeAdminAnalyticsSummaryD1(
  params: { preset: AnalyticsPreset; from?: string; to?: string },
  db: D1DatabaseLike = getActiveD1()
): Promise<AdminAnalyticsDetail> {
  const window = resolveAnalyticsDateWindow(params.preset, params.from, params.to);
  const inWindow = (iso: string) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return false;
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
    policies,
  ] = await Promise.all([
    d1First<{ timezone: string }>('SELECT timezone FROM academies ORDER BY created_at ASC LIMIT 1', [], db),
    d1All<{ id: string; name: string; role: string; status: string }>('SELECT id, name, role, status FROM users', [], db),
    d1All<{ id: string; is_archived: number }>('SELECT id, is_archived FROM courses', [], db),
    d1All<{ id: string; status: string }>('SELECT id, status FROM cohorts', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM admissions ORDER BY submitted_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM enrollments ORDER BY enrolled_at DESC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM class_sessions ORDER BY start_at ASC', [], db),
    d1All<Record<string, unknown>>('SELECT * FROM attendance_records', [], db),
    d1All<Record<string, unknown>>("SELECT * FROM fee_invoices WHERE is_archived = 0 AND status != 'Voided' ORDER BY created_at DESC", [], db),
    d1All<Record<string, unknown> & { invoice_number: string | null; student_name: string | null }>(
      `SELECT p.*, i.invoice_number, u.name AS student_name
       FROM payments p
       LEFT JOIN fee_invoices i ON i.id = p.invoice_id
       LEFT JOIN users u ON u.id = p.student_id
       ORDER BY p.paid_at DESC`,
      [],
      db
    ),
    d1All<{ status: string; issued_at: string }>('SELECT status, issued_at FROM certificates', [], db),
    loadAcademyPoliciesSummaryD1(db),
  ]);

  const activeStudents = users.filter((u) => u.role === 'student' && u.status === 'active').length;
  const activeInstructors = users.filter((u) => u.role === 'instructor' && u.status === 'active').length;
  const admissionsPending = admissions.filter((a) => isPendingAdmissionStatus(String(a.status))).length;
  const activeCourses = courses.filter((c) => !sqlBool(c.is_archived)).length;
  const totalBatches = batches.filter((b) => b.status !== 'Archived').length;

  const tz = academy?.timezone || 'Asia/Kolkata';
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const todaysClasses = sessions
    .filter((s) => {
      if (String(s.status) === 'Cancelled') return false;
      const dt = new Date(String(s.start_at));
      if (Number.isNaN(dt.getTime())) return false;
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(dt) === todayKey;
    })
    .map((s) => ({
      id: String(s.id),
      courseId: String(s.course_id),
      cohortId: s.cohort_id ? String(s.cohort_id) : null,
      classroomId: s.classroom_id ? String(s.classroom_id) : null,
      cohort: String(s.cohort),
      title: String(s.title),
      topic: String(s.topic ?? ''),
      room: String(s.room),
      instructorId: s.instructor_id ? String(s.instructor_id) : null,
      instructorName: String(s.instructor_name),
      startIso: String(s.start_at),
      endIso: String(s.end_at),
      status: String(s.status) as 'Scheduled' | 'Completed' | 'Cancelled',
    }));

  const windowedAttendance = attendance
    .filter((a) => inWindow(String(a.updated_at)))
    .map((a) => ({
      id: String(a.id),
      sessionId: String(a.session_id),
      courseId: String(a.course_id),
      studentId: String(a.student_id),
      status: String(a.status) as AttendanceStatus,
      note: String(a.note ?? ''),
      updatedAt: String(a.updated_at),
      updatedBy: String(a.updated_by),
    }));
  const attendanceOverview = calculateAttendanceStats(windowedAttendance, {
    lateWeightPct: policies.lateWeightPct,
  });

  let outstandingFeesCents = 0;
  for (const inv of invoices) {
    outstandingFeesCents += Math.max(
      0,
      toCents(sqlFixed(inv.amount_due)) - toCents(sqlFixed(inv.amount_paid))
    );
  }

  const now = new Date();
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let monthlyRevenueCents = 0;
  let totalCollectedCents = 0;
  for (const pay of payments) {
    const cents = toCents(sqlFixed(pay.amount));
    const paidIso = String(pay.paid_at);
    if (inWindow(paidIso)) totalCollectedCents += cents;
    const ms = Date.parse(paidIso);
    if (!Number.isNaN(ms) && ms >= currentMonthStart) monthlyRevenueCents += cents;
  }

  const certificatesIssued = certificates.filter(
    (c) => c.status === 'Issued' && inWindow(c.issued_at)
  ).length;

  const mappedInvoices = invoices.map((inv) => ({
    id: String(inv.id),
    invoiceNumber: String(inv.invoice_number),
    studentId: String(inv.student_id),
    enrollmentId: inv.enrollment_id ? String(inv.enrollment_id) : null,
    courseId: String(inv.course_id),
    description: String(inv.description),
    amountDue: sqlFixed(inv.amount_due),
    amountPaid: sqlFixed(inv.amount_paid),
    currency: String(inv.currency || 'INR'),
    status: String(inv.status) as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
    dueDate: String(inv.due_date),
    isArchived: sqlBool(inv.is_archived),
    createdAt: String(inv.created_at),
  }));

  const mappedEnrollments = enrollments.map((e) => ({
    id: String(e.id),
    studentId: String(e.student_id),
    courseId: String(e.course_id),
    cohortId: e.cohort_id ? String(e.cohort_id) : null,
    cohort: String(e.cohort),
    status: String(e.status) as EnrollmentStatus,
    enrolledAt: String(e.enrolled_at),
    completedModuleIds: sqlJson<string[]>(e.completed_module_ids, []),
  }));

  const pendingActions: AdminAnalyticsDetail['pendingActions'] = [];
  for (const adm of admissions) {
    const st = String(adm.status);
    if (st === 'Submitted' || st === 'Under Review' || st === 'Accepted') {
      pendingActions.push({
        id: `act-adm-${adm.id}`,
        kind: 'admission',
        title: `Admission ${st}: ${adm.applicant_name}`,
        detail: `${adm.preferred_cohort} · Submitted ${new Date(String(adm.submitted_at)).toLocaleDateString('en-IN')}`,
        targetSection: 'admissions',
      });
    }
  }
  const userNameMap = new Map(users.map((u) => [u.id, u.name]));
  for (const inv of invoices) {
    const remaining = toCents(sqlFixed(inv.amount_due)) - toCents(sqlFixed(inv.amount_paid));
    if (remaining > 0 && Date.parse(String(inv.due_date)) < Date.now()) {
      pendingActions.push({
        id: `act-inv-${inv.id}`,
        kind: 'overdue_invoice',
        title: `Overdue Invoice ${inv.invoice_number}`,
        detail: `${userNameMap.get(String(inv.student_id)) ?? 'Student'} · Balance ${formatCents(remaining, String(inv.currency || 'INR'))}`,
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
    monthlyRevenueSeries: buildMonthlyRevenueSeries({
      invoices: mappedInvoices,
      payments: payments.map((p) => ({
        amount: sqlFixed(p.amount),
        paidAt: String(p.paid_at),
      })),
      monthsCount: 6,
    }),
    enrollmentTrendSeries: buildEnrollmentTrendSeries({
      enrollments: mappedEnrollments,
      monthsCount: 6,
    }),
    todaysClasses,
    recentTransactions: payments
      .filter((p) => inWindow(String(p.paid_at)))
      .slice(0, 8)
      .map((p) => ({
        id: String(p.id),
        receiptNumber: String(p.receipt_number),
        invoiceNumber: p.invoice_number ?? '—',
        studentName: p.student_name ?? 'Student',
        amount: sqlFixed(p.amount),
        method: String(p.method) as PaymentMethod,
        paidAt: String(p.paid_at),
      })),
    pendingActions: pendingActions.slice(0, 8),
  };
}

export async function getStudentDetailD1(
  studentId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<StudentDetailPayload | null> {
  const user = await d1First<DbUserRow>(
    "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
    [studentId],
    db
  );
  if (!user) return null;

  const [profile, enrollments, courses, modules, batches, assessments, grades, attendance, docs, certs, invoices, payments, departments] =
    await Promise.all([
      d1First<Record<string, unknown>>('SELECT * FROM student_profiles WHERE user_id = ? LIMIT 1', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM enrollments WHERE student_id = ? ORDER BY enrolled_at DESC', [studentId], db),
      d1All<{ id: string; code: string; title: string }>('SELECT id, code, title FROM courses', [], db),
      d1All<{ id: string; course_id: string }>('SELECT id, course_id FROM course_modules', [], db),
      d1All<{ id: string; code: string }>('SELECT id, code FROM cohorts', [], db),
      d1All<{ id: string; course_id: string; batch_id: string | null; max_score: number; weight: number }>('SELECT id, course_id, batch_id, max_score, weight FROM assessments', [], db),
      d1All<{ assessment_id: string; course_id: string; score: number }>('SELECT assessment_id, course_id, score FROM module_grades WHERE student_id = ?', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM attendance_records WHERE student_id = ?', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM documents WHERE owner_user_id = ? AND is_archived = 0 ORDER BY created_at DESC', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM certificates WHERE student_id = ? ORDER BY issued_at DESC', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM fee_invoices WHERE student_id = ? AND is_archived = 0 ORDER BY created_at DESC', [studentId], db),
      d1All<Record<string, unknown>>('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_at DESC', [studentId], db),
      d1All<{ id: string; name: string }>('SELECT id, name FROM departments', [], db),
    ]);

  const enrIds = enrollments.map((e) => String(e.id));
  const histories =
    enrIds.length > 0
      ? await d1All<Record<string, unknown>>(
          `SELECT * FROM enrollment_histories WHERE enrollment_id IN (${inPlaceholders(enrIds.length)}) ORDER BY changed_at DESC`,
          enrIds,
          db
        )
      : [];

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const batchMap = new Map(batches.map((b) => [b.id, b.code]));
  const allUsers = await d1All<{ id: string; name: string }>('SELECT id, name FROM users', [], db);
  const userNameMap = new Map(allUsers.map((u) => [u.id, u.name]));

  const mappedAttendance = attendance.map((a) => ({
    id: String(a.id),
    sessionId: String(a.session_id),
    courseId: String(a.course_id),
    studentId: String(a.student_id),
    status: String(a.status) as AttendanceStatus,
    note: String(a.note ?? ''),
    updatedAt: String(a.updated_at),
    updatedBy: String(a.updated_by),
  }));

  let totalBilledCents = 0;
  let totalPaidCents = 0;
  for (const inv of invoices) {
    if (String(inv.status) === 'Voided') continue;
    totalBilledCents += toCents(sqlFixed(inv.amount_due));
    totalPaidCents += toCents(sqlFixed(inv.amount_paid));
  }
  const outstandingCents = Math.max(0, totalBilledCents - totalPaidCents);
  const overallAtt = calculateAttendanceStats(mappedAttendance).rate;
  const deptName = profile?.department_id ? deptMap.get(String(profile.department_id)) ?? null : null;

  return {
    student: {
      user: {
        ...toPublicUserD1(user),
        role: 'student',
        department: deptName ?? user.department,
      },
      profile: profile
        ? {
            id: String(profile.id),
            departmentId: profile.department_id ? String(profile.department_id) : null,
            departmentName: deptName,
            dateOfBirth: profile.date_of_birth ? String(profile.date_of_birth) : null,
            address: String(profile.address ?? ''),
            emergencyContact: String(profile.emergency_contact ?? ''),
            academicStanding: String(profile.academic_standing ?? 'Good Standing'),
            enrollmentDate: String(profile.enrollment_date ?? user.created_at),
          }
        : null,
      activeEnrollmentsCount: enrollments.filter((e) => String(e.status) === 'Active').length,
      completedCoursesCount: enrollments.filter((e) => String(e.status) === 'Completed').length,
      outstandingCents,
      attendanceRate: overallAtt,
    },
    enrollments: enrollments.map((e) => {
      const courseId = String(e.course_id);
      const cohortId = e.cohort_id ? String(e.cohort_id) : null;
      const course = courseMap.get(courseId);
      const completedIds = sqlJson<string[]>(e.completed_module_ids, []);
      const modCount = modules.filter((m) => m.course_id === courseId).length;
      const completionPct = calculateCourseCompletion(completedIds, modCount);
      const pairs = assessments
        .filter((a) => a.course_id === courseId && (!a.batch_id || a.batch_id === cohortId))
        .map((a) => {
          const gr = grades.find((g) => g.assessment_id === a.id);
          if (!gr) return null;
          return {
            score: Math.round((gr.score / Math.max(1, a.max_score)) * 1000) / 10,
            weight: a.weight,
          };
        })
        .filter((x): x is { score: number; weight: number } => x !== null);
      const weightedScore = calculateWeightedAverage(pairs);
      const courseAtt = calculateAttendanceStats(
        mappedAttendance.filter((a) => a.courseId === courseId)
      ).rate;

      return {
        id: String(e.id),
        studentId: String(e.student_id),
        courseId,
        cohortId,
        cohort: String(e.cohort),
        status: String(e.status) as EnrollmentStatus,
        enrolledAt: String(e.enrolled_at),
        completedModuleIds: completedIds,
        courseCode: course?.code ?? '',
        courseTitle: course?.title ?? '',
        batchCode: cohortId ? batchMap.get(cohortId) ?? null : null,
        completionPct,
        weightedScore,
        letterGrade: calculateLetterGrade(weightedScore),
        attendanceRate: courseAtt,
      };
    }),
    enrollmentHistory: histories.map((h) => ({
      id: String(h.id),
      enrollmentId: String(h.enrollment_id),
      previousStatus: h.previous_status ? String(h.previous_status) : null,
      newStatus: String(h.new_status),
      previousBatchId: h.previous_batch_id ? String(h.previous_batch_id) : null,
      newBatchId: h.new_batch_id ? String(h.new_batch_id) : null,
      previousBatchName: h.previous_batch_id ? batchMap.get(String(h.previous_batch_id)) ?? null : null,
      newBatchName: h.new_batch_id ? batchMap.get(String(h.new_batch_id)) ?? null : null,
      reason: String(h.reason ?? ''),
      changedByUserId: h.changed_by_user_id ? String(h.changed_by_user_id) : null,
      changedByName: h.changed_by_user_id ? userNameMap.get(String(h.changed_by_user_id)) ?? null : null,
      changedAt: String(h.changed_at),
    })),
    documents: docs.map((d) => ({
      id: String(d.id),
      ownerUserId: d.owner_user_id ? String(d.owner_user_id) : '',
      courseId: d.course_id ? String(d.course_id) : null,
      title: String(d.title),
      category: String(d.category) as DocumentRecord['category'],
      fileName: String(d.file_name),
      mimeType: String(d.mime_type),
      sizeBytes: Number(d.size_bytes ?? 0),
      uploadedByUserId: d.uploaded_by_user_id ? String(d.uploaded_by_user_id) : '',
      isArchived: sqlBool(d.is_archived),
      createdAt: String(d.created_at),
    })),
    certificates: certs.map((c) => {
      const crs = courseMap.get(String(c.course_id));
      return {
        id: String(c.id),
        certificateCode: String(c.certificate_code),
        verificationHash: String(c.verification_hash),
        studentId: String(c.student_id),
        studentName: user.name,
        courseId: String(c.course_id),
        courseCode: crs?.code,
        courseTitle: String(c.course_title_snapshot || crs?.title || ''),
        enrollmentId: String(c.enrollment_id),
        finalScore: sqlFixed(c.final_score),
        letterGrade: String(c.letter_grade),
        attendanceRate: Number(c.attendance_rate),
        issuedByName: String(c.issued_by_name),
        status: String(c.status) as CertificateRecord['status'],
        revokedReason: c.revoked_reason ? String(c.revoked_reason) : null,
        issuedAt: String(c.issued_at),
      };
    }),
    feeStatement: {
      totalBilledCents,
      totalPaidCents,
      outstandingCents,
      invoices: invoices.map((inv) => ({
        id: String(inv.id),
        invoiceNumber: String(inv.invoice_number),
        studentId: String(inv.student_id),
        enrollmentId: inv.enrollment_id ? String(inv.enrollment_id) : null,
        courseId: String(inv.course_id),
        description: String(inv.description),
        amountDue: sqlFixed(inv.amount_due),
        amountPaid: sqlFixed(inv.amount_paid),
        currency: String(inv.currency || 'INR'),
        status: String(inv.status) as 'Unpaid' | 'Partial' | 'Paid' | 'Voided',
        dueDate: String(inv.due_date),
        isArchived: sqlBool(inv.is_archived),
        createdAt: String(inv.created_at),
      })),
      payments: payments.map((p) => ({
        id: String(p.id),
        receiptNumber: String(p.receipt_number),
        invoiceId: String(p.invoice_id),
        studentId: String(p.student_id),
        amount: sqlFixed(p.amount),
        method: String(p.method) as PaymentMethod,
        referenceCode: String(p.reference_code ?? ''),
        recordedByUserId: String(p.recorded_by_user_id),
        notes: String(p.notes ?? ''),
        paidAt: String(p.paid_at),
      })),
    },
  };
}

export async function listInstructorsWithMetricsD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<InstructorDirectoryRow[]> {
  const [instructors, profiles, departments, courses, batches, assignments, enrollments, sessions, attendance, grades] =
    await Promise.all([
      d1All<DbUserRow>("SELECT * FROM users WHERE role = 'instructor' ORDER BY created_at DESC", [], db),
      d1All<Record<string, unknown>>('SELECT * FROM instructor_profiles', [], db),
      d1All<{ id: string; name: string }>('SELECT id, name FROM departments', [], db),
      d1All<{ id: string; instructor_id: string }>('SELECT id, instructor_id FROM courses', [], db),
      d1All<{ id: string; course_id: string; instructor_id: string }>('SELECT id, course_id, instructor_id FROM cohorts', [], db),
      d1All<{ instructor_id: string; batch_id: string; course_id: string }>('SELECT instructor_id, batch_id, course_id FROM instructor_assignments WHERE is_active = 1', [], db),
      d1All<{ student_id: string; course_id: string; cohort_id: string | null }>("SELECT student_id, course_id, cohort_id FROM enrollments WHERE status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')", [], db),
      d1All<{ id: string; instructor_id: string | null; course_id: string; start_at: string; status: string }>('SELECT id, instructor_id, course_id, start_at, status FROM class_sessions', [], db),
      d1All<Record<string, unknown>>('SELECT * FROM attendance_records', [], db),
      d1All<{ graded_by_user_id: string | null; course_id: string; score: number }>('SELECT graded_by_user_id, course_id, score FROM module_grades', [], db),
    ]);

  const profileMap = new Map(profiles.map((p) => [String(p.user_id), p]));
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const validPermSet = new Set<string>(DEFAULT_INSTRUCTOR_PERMISSIONS);
  const nowMs = Date.now();

  return instructors.map((ins) => {
    const courseIds = new Set(courses.filter((c) => c.instructor_id === ins.id).map((c) => c.id));
    const batchIds = new Set<string>();
    for (const b of batches) {
      if (b.instructor_id === ins.id) {
        batchIds.add(b.id);
        courseIds.add(b.course_id);
      }
    }
    for (const a of assignments) {
      if (a.instructor_id === ins.id) {
        batchIds.add(a.batch_id);
        courseIds.add(a.course_id);
      }
    }

    const assignedStudents = new Set(
      enrollments
        .filter((e) => courseIds.has(e.course_id) || (e.cohort_id && batchIds.has(e.cohort_id)))
        .map((e) => e.student_id)
    );

    const insSessions = sessions.filter((s) => s.instructor_id === ins.id || courseIds.has(s.course_id));
    const sessionsTaughtCount = insSessions.filter((s) => s.status === 'Completed').length;
    const upcomingSessionsCount = insSessions.filter(
      (s) => s.status === 'Scheduled' && Date.parse(s.start_at) >= nowMs
    ).length;

    const relevantAtt = attendance
      .filter((a) => courseIds.has(String(a.course_id)))
      .map((a) => ({
        id: String(a.id),
        sessionId: String(a.session_id),
        courseId: String(a.course_id),
        studentId: String(a.student_id),
        status: String(a.status) as AttendanceStatus,
        note: String(a.note ?? ''),
        updatedAt: String(a.updated_at),
        updatedBy: String(a.updated_by),
      }));
    const meanAttendanceRate = calculateAttendanceStats(relevantAtt).rate;

    const relevantGrades = grades.filter((g) => g.graded_by_user_id === ins.id || courseIds.has(g.course_id));
    const meanGradedScore =
      relevantGrades.length > 0
        ? Math.round((relevantGrades.reduce((sum, g) => sum + g.score, 0) / relevantGrades.length) * 10) / 10
        : null;

    const profile = profileMap.get(ins.id);
    const configured = Boolean(profile && sqlBool(profile.permissions_configured));
    const rawPerms = profile ? sqlJson<unknown[]>(profile.permissions, []) : [];
    const permissions: InstructorPermissionKey[] = configured
      ? rawPerms.filter((p): p is InstructorPermissionKey => typeof p === 'string' && validPermSet.has(p))
      : [...DEFAULT_INSTRUCTOR_PERMISSIONS];

    return {
      user: toPublicUserD1(ins),
      profile: {
        id: profile ? String(profile.id) : `ip-${ins.id}`,
        staffCode: profile ? String(profile.staff_code) : ins.staff_code ?? '',
        departmentId: profile?.department_id ? String(profile.department_id) : null,
        departmentName: profile?.department_id
          ? deptMap.get(String(profile.department_id)) ?? ins.department ?? null
          : ins.department ?? null,
        specialization: profile ? String(profile.specialization ?? '') : '',
        qualification: profile ? String(profile.qualification ?? '') : '',
        bio: profile ? String(profile.bio ?? '') : '',
        hireDate: profile?.hire_date ? String(profile.hire_date) : null,
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

export async function getInstructorDetailD1(
  instructorId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<InstructorDetailPayload | null> {
  const list = await listInstructorsWithMetricsD1(db);
  const row = list.find((r) => r.user.id === instructorId);
  if (!row) return null;

  const scope = await getInstructorScopeD1(instructorId, db);
  const courseIds = Array.from(scope.courseIds);
  const batchIds = Array.from(scope.batchIds);

  const [courses, modules, batches, sessions, enrollments, departments, classrooms, users] =
    await Promise.all([
      courseIds.length > 0
        ? d1All<Record<string, unknown>>(
            `SELECT * FROM courses WHERE id IN (${inPlaceholders(courseIds.length)})`,
            courseIds,
            db
          )
        : Promise.resolve([]),
      courseIds.length > 0
        ? d1All<Record<string, unknown>>(
            `SELECT * FROM course_modules WHERE course_id IN (${inPlaceholders(courseIds.length)}) ORDER BY sort_order ASC`,
            courseIds,
            db
          )
        : Promise.resolve([]),
      batchIds.length > 0 || courseIds.length > 0
        ? (() => {
            const clauses: string[] = [];
            const params: unknown[] = [];
            if (batchIds.length > 0) {
              clauses.push(`id IN (${inPlaceholders(batchIds.length)})`);
              params.push(...batchIds);
            }
            if (courseIds.length > 0) {
              clauses.push(`course_id IN (${inPlaceholders(courseIds.length)})`);
              params.push(...courseIds);
            }
            return d1All<Record<string, unknown>>(
              `SELECT * FROM cohorts WHERE ${clauses.join(' OR ')}`,
              params,
              db
            );
          })()
        : Promise.resolve([]),
      (() => {
        const clauses = ['instructor_id = ?'];
        const params: unknown[] = [instructorId];
        if (courseIds.length > 0) {
          clauses.push(`course_id IN (${inPlaceholders(courseIds.length)})`);
          params.push(...courseIds);
        }
        return d1All<Record<string, unknown>>(
          `SELECT * FROM class_sessions WHERE ${clauses.join(' OR ')} ORDER BY start_at DESC LIMIT 40`,
          params,
          db
        );
      })(),
      d1All<{ course_id: string; cohort_id: string | null; cohort: string }>(
        "SELECT course_id, cohort_id, cohort FROM enrollments WHERE status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')",
        [],
        db
      ),
      d1All<{ id: string; name: string }>('SELECT id, name FROM departments', [], db),
      d1All<{ id: string; name: string }>('SELECT id, name FROM classrooms', [], db),
      d1All<{ id: string; name: string }>('SELECT id, name FROM users', [], db),
    ]);

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const roomMap = new Map(classrooms.map((r) => [r.id, r.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const courseCodeTitleMap = new Map(
    courses.map((c) => [String(c.id), { code: String(c.code), title: String(c.title) }])
  );

  return {
    instructor: row,
    assignedCourses: courses.map((c) => ({
      id: String(c.id),
      code: String(c.code),
      title: String(c.title),
      track: String(c.track),
      category: String(c.category ?? 'Technical Bootcamp'),
      departmentId: c.department_id ? String(c.department_id) : null,
      departmentName: c.department_id ? deptMap.get(String(c.department_id)) ?? null : null,
      description: String(c.description ?? ''),
      prerequisites: String(c.prerequisites ?? ''),
      learningObjectives: sqlJson<string[]>(c.learning_objectives, []),
      passingScore: Number(c.passing_score ?? 60),
      minAttendanceRate: Number(c.min_attendance_rate ?? 75),
      instructorId: String(c.instructor_id),
      instructorName: userMap.get(String(c.instructor_id)) ?? row.user.name,
      durationWeeks: Number(c.duration_weeks ?? 8),
      tuitionFee: sqlFixed(c.tuition_fee),
      isArchived: sqlBool(c.is_archived),
      modules: modules
        .filter((m) => String(m.course_id) === String(c.id))
        .map((m) => ({
          id: String(m.id),
          code: String(m.code),
          title: String(m.title),
          weight: Number(m.weight),
          labHours: Number(m.lab_hours),
          sortOrder: Number(m.sort_order),
        })),
    })),
    assignedBatches: batches.map((b) => {
      const crs = courseCodeTitleMap.get(String(b.course_id));
      return {
        id: String(b.id),
        code: String(b.code),
        name: String(b.name),
        courseId: String(b.course_id),
        termId: b.term_id ? String(b.term_id) : null,
        instructorId: String(b.instructor_id),
        instructorName: userMap.get(String(b.instructor_id)) ?? row.user.name,
        classroomId: b.classroom_id ? String(b.classroom_id) : null,
        classroomName: b.classroom_id ? roomMap.get(String(b.classroom_id)) ?? null : null,
        capacity: Number(b.capacity ?? 24),
        startDate: String(b.start_date),
        endDate: String(b.end_date),
        status: String(b.status) as CohortStatus,
        courseCode: crs?.code ?? '',
        courseTitle: crs?.title ?? '',
        enrolledCount: enrollments.filter(
          (e) =>
            e.course_id === String(b.course_id) &&
            (e.cohort_id === String(b.id) || e.cohort === String(b.name))
        ).length,
      };
    }),
    sessions: sessions.map((s) => ({
      id: String(s.id),
      courseId: String(s.course_id),
      cohortId: s.cohort_id ? String(s.cohort_id) : null,
      classroomId: s.classroom_id ? String(s.classroom_id) : null,
      cohort: String(s.cohort),
      title: String(s.title),
      topic: String(s.topic ?? ''),
      room: String(s.room),
      instructorId: s.instructor_id ? String(s.instructor_id) : null,
      instructorName: String(s.instructor_name),
      startIso: String(s.start_at),
      endIso: String(s.end_at),
      status: String(s.status) as 'Scheduled' | 'Completed' | 'Cancelled',
    })),
  };
}

export async function getAcademySettingsPayloadD1(
  db: D1DatabaseLike = getActiveD1()
): Promise<AcademySettingsPayload> {
  const [academy, settingsRows, certTemplate, years, terms, departments, classrooms, courses] =
    await Promise.all([
      d1First<Record<string, unknown>>('SELECT * FROM academies ORDER BY created_at ASC LIMIT 1', [], db),
      d1All<{ key: string; value: string }>('SELECT key, value FROM academy_settings', [], db),
      d1First<Record<string, unknown>>(
        'SELECT * FROM certificate_templates WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1',
        [],
        db
      ),
      d1All<Record<string, unknown>>('SELECT * FROM academic_years ORDER BY start_date DESC', [], db),
      d1All<Record<string, unknown>>('SELECT * FROM academic_terms ORDER BY start_date DESC', [], db),
      d1All<Record<string, unknown>>('SELECT * FROM departments ORDER BY name ASC', [], db),
      d1All<Record<string, unknown>>('SELECT * FROM classrooms ORDER BY code ASC', [], db),
      d1All<{ department_id: string | null }>('SELECT department_id FROM courses', [], db),
    ]);

  const map = new Map(settingsRows.map((s) => [s.key, s.value]));
  const num = (key: string, fallback: number) => {
    const val = Number(map.get(key));
    return Number.isFinite(val) ? val : fallback;
  };
  const yearMap = new Map(years.map((y) => [String(y.id), String(y.name)]));

  return {
    academy: academy
      ? {
          id: String(academy.id),
          code: String(academy.code),
          name: String(academy.name),
          legalName: String(academy.legal_name ?? ''),
          email: String(academy.email ?? ''),
          phone: String(academy.phone ?? ''),
          website: String(academy.website ?? ''),
          address: String(academy.address ?? ''),
          logoDataUrl: String(academy.logo_data_url ?? ''),
          timezone: String(academy.timezone || 'Asia/Kolkata'),
          currency: String(academy.currency || 'INR'),
        }
      : {
          id: 'acad-infocom',
          code: 'INFOCOM-MAIN',
          name: 'IGS — InfoCom Global Services',
          legalName: 'InfoCom Global Services — Computer Institute',
          email: '',
          phone: '',
          website: '',
          address:
            'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
          logoDataUrl: '',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
    policies: {
      studentIdPrefix: map.get('academy.student_id_prefix') || 'IGS',
      invoicePrefix: map.get('academy.invoice_prefix') || 'INV-2026',
      invoiceNextSeq: num('academy.invoice_next_seq', 1050),
      feeDueDays: num('academy.fee_due_days', 14),
      lateFeePct: num('academy.late_fee_pct', 5),
      passingScore: num('grading.passing_score', 60),
      distinctionScore: num('grading.distinction_score', 90),
      minAttendanceRatePct: num('attendance.min_rate_pct', 75),
      lateWeightPct: num('attendance.late_weight_pct', 75),
      reminderWindowHours: num('session.reminder_window_hours', 24),
      certificateCodePrefix: map.get('certificate.code_prefix') || 'IGS-CERT-2026',
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
          id: String(certTemplate.id),
          code: String(certTemplate.code),
          name: String(certTemplate.name),
          titleFormat: String(certTemplate.title_format),
          signatoryName: String(certTemplate.signatory_name),
          signatoryTitle: String(certTemplate.signatory_title),
          minCompletionPct: Number(certTemplate.min_completion_pct ?? 100),
          minScore: Number(certTemplate.min_score ?? 60),
          minAttendancePct: Number(certTemplate.min_attendance_pct ?? 75),
          isActive: sqlBool(certTemplate.is_active),
        }
      : null,
    academicYears: years.map((y) => ({
      id: String(y.id),
      code: String(y.code),
      name: String(y.name),
      startDate: String(y.start_date),
      endDate: String(y.end_date),
      isCurrent: sqlBool(y.is_current),
      status: String(y.status),
    })),
    academicTerms: terms.map((t) => ({
      id: String(t.id),
      academicYearId: String(t.academic_year_id),
      academicYearName: yearMap.get(String(t.academic_year_id)) ?? '',
      code: String(t.code),
      name: String(t.name),
      startDate: String(t.start_date),
      endDate: String(t.end_date),
      isCurrent: sqlBool(t.is_current),
      status: String(t.status),
    })),
    departments: departments.map((d) => ({
      id: String(d.id),
      code: String(d.code),
      name: String(d.name),
      headUserId: d.head_user_id ? String(d.head_user_id) : null,
      status: String(d.status),
      courseCount: courses.filter((c) => c.department_id === String(d.id)).length,
    })),
    classrooms: classrooms.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      building: String(r.building),
      capacity: Number(r.capacity ?? 24),
      equipment: String(r.equipment ?? ''),
      isActive: sqlBool(r.is_active),
    })),
  };
}
