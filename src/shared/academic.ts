import type {
  AdmissionApplication,
  AttendanceRecord,
  CertificateRecord,
  ClassSession,
  Course,
  Enrollment,
  FeeInvoice,
  InvoiceStatus,
  ModuleGrade,
  NotificationItem,
  ProgressRemark,
  UserPublic,
  AcademyAnalytics,
} from './types';

export interface AttendanceStats {
  total: number;
  present: number;
  late: number;
  absent: number;
  rate: number;
}

export interface CourseProgressReportItem {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  cohort: string;
  status: Enrollment['status'];
  completionPct: number;
  weightedScore: number | null;
  letterGrade: string;
  attendance: AttendanceStats;
  moduleRows: Array<{
    moduleId: string;
    moduleCode: string;
    moduleTitle: string;
    weight: number;
    completed: boolean;
    score: number | null;
    letterGrade: string;
    feedback: string;
  }>;
  instructorRemark: string;
}

export interface StudentProgressReport {
  student: UserPublic;
  generatedAtIso: string;
  overallAverage: number | null;
  overallLetterGrade: string;
  overallAttendanceRate: number;
  overallCompletionPct: number;
  standing: 'Distinction' | 'On Track' | 'Needs Attention' | 'Pending Assessment';
  courses: CourseProgressReportItem[];
}

export function calculateLetterGrade(score: number | null): string {
  if (score === null || Number.isNaN(score)) return 'N/A';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

export function calculateWeightedAverage(
  items: Array<{ score: number; weight: number }>
): number | null {
  if (items.length === 0) return null;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const item of items) {
    if (item.weight > 0) {
      weightedSum += item.score * item.weight;
      totalWeight += item.weight;
    }
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

export function calculateAttendanceStats(records: AttendanceRecord[]): AttendanceStats {
  const total = records.length;
  if (total === 0) {
    return { total: 0, present: 0, late: 0, absent: 0, rate: 100 };
  }
  let present = 0;
  let late = 0;
  let absent = 0;
  for (const r of records) {
    if (r.status === 'Present') present += 1;
    else if (r.status === 'Late') late += 1;
    else if (r.status === 'Absent') absent += 1;
  }
  const rate = Math.round(((present + late * 0.75) / total) * 100);
  return { total, present, late, absent, rate };
}

export function calculateCourseCompletion(
  completedModuleIds: string[],
  totalModules: number
): number {
  if (totalModules <= 0) return 0;
  const uniqueCompleted = new Set(completedModuleIds).size;
  return Math.min(100, Math.round((uniqueCompleted / totalModules) * 100));
}

export function determineAcademicStanding(
  overallAverage: number | null,
  overallAttendanceRate: number
): StudentProgressReport['standing'] {
  if (overallAverage === null) return 'Pending Assessment';
  if (overallAverage >= 90 && overallAttendanceRate >= 90) return 'Distinction';
  if (overallAverage < 75 || overallAttendanceRate < 75) return 'Needs Attention';
  return 'On Track';
}

export function computeStudentProgressReport(params: {
  student: UserPublic;
  courses: Course[];
  enrollments: Enrollment[];
  grades: ModuleGrade[];
  attendance: AttendanceRecord[];
  remarks: ProgressRemark[];
  generatedAtIso: string;
}): StudentProgressReport {
  const studentEnrollments = params.enrollments.filter(
    (e) => e.studentId === params.student.id && e.status !== 'Dropped'
  );

  const courseReports: CourseProgressReportItem[] = [];
  const allAttendanceRecords: AttendanceRecord[] = [];
  const courseAverages: number[] = [];
  const courseCompletions: number[] = [];

  for (const enrollment of studentEnrollments) {
    const course = params.courses.find((c) => c.id === enrollment.courseId);
    if (!course) continue;

    const courseGrades = params.grades.filter(
      (g) => g.studentId === params.student.id && g.courseId === course.id
    );
    const courseAttendance = params.attendance.filter(
      (a) => a.studentId === params.student.id && a.courseId === course.id
    );
    allAttendanceRecords.push(...courseAttendance);

    const moduleRows = course.modules.map((mod) => {
      const grade = courseGrades.find((g) => g.moduleId === mod.id);
      const completed = enrollment.completedModuleIds.includes(mod.id);
      const score = grade ? grade.score : null;
      return {
        moduleId: mod.id,
        moduleCode: mod.code,
        moduleTitle: mod.title,
        weight: mod.weight,
        completed,
        score,
        letterGrade: calculateLetterGrade(score),
        feedback: grade?.feedback ?? '',
      };
    });

    const gradedPairs = moduleRows
      .filter((m) => m.score !== null)
      .map((m) => ({ score: m.score as number, weight: m.weight }));

    const weightedScore = calculateWeightedAverage(gradedPairs);
    if (weightedScore !== null) {
      courseAverages.push(weightedScore);
    }

    const completionPct = calculateCourseCompletion(
      enrollment.completedModuleIds,
      course.modules.length
    );
    courseCompletions.push(completionPct);

    const remarkObj = params.remarks.find(
      (r) => r.studentId === params.student.id && r.courseId === course.id
    );

    courseReports.push({
      courseId: course.id,
      courseCode: course.code,
      courseTitle: course.title,
      cohort: enrollment.cohort,
      status: enrollment.status,
      completionPct,
      weightedScore,
      letterGrade: calculateLetterGrade(weightedScore),
      attendance: calculateAttendanceStats(courseAttendance),
      moduleRows,
      instructorRemark:
        remarkObj?.summary ||
        'Progressing steadily through scheduled lab exercises and module assessments.',
    });
  }

  const overallAverage =
    courseAverages.length > 0
      ? Math.round(
          (courseAverages.reduce((acc, v) => acc + v, 0) / courseAverages.length) * 10
        ) / 10
      : null;

  const overallAttendance = calculateAttendanceStats(allAttendanceRecords);
  const overallCompletionPct =
    courseCompletions.length > 0
      ? Math.round(
          courseCompletions.reduce((acc, v) => acc + v, 0) / courseCompletions.length
        )
      : 0;

  return {
    student: params.student,
    generatedAtIso: params.generatedAtIso,
    overallAverage,
    overallLetterGrade: calculateLetterGrade(overallAverage),
    overallAttendanceRate: overallAttendance.rate,
    overallCompletionPct,
    standing: determineAcademicStanding(overallAverage, overallAttendance.rate),
    courses: courseReports,
  };
}

export function buildAttendanceNotification(params: {
  id: string;
  studentId: string;
  course: Course;
  session: ClassSession;
  status: AttendanceRecord['status'];
  note?: string;
  createdAt: string;
}): NotificationItem {
  const statusDetail =
    params.status === 'Present'
      ? 'marked Present'
      : params.status === 'Late'
        ? 'marked Late'
        : 'marked Absent';

  const noteSuffix = params.note?.trim() ? ` Note: ${params.note.trim()}` : '';

  return {
    id: params.id,
    userId: params.studentId,
    kind: 'attendance',
    title: `Attendance Update · ${params.course.code}`,
    message: `You were ${statusDetail} for "${params.session.title}" in ${params.session.room}.${noteSuffix}`,
    relatedCourseId: params.course.id,
    relatedSessionId: params.session.id,
    read: false,
    createdAt: params.createdAt,
  };
}

export function findUpcomingSessionsNeedingReminders(params: {
  sessions: ClassSession[];
  courses: Course[];
  enrollments: Enrollment[];
  existingNotifications: NotificationItem[];
  nowMs: number;
  windowHours?: number;
}): Array<Omit<NotificationItem, 'id'>> {
  const windowMs = (params.windowHours ?? 24) * 60 * 60 * 1000;
  const existingKeys = new Set(
    params.existingNotifications
      .map((n) => n.dedupeKey)
      .filter((k): k is string => Boolean(k))
  );

  const generated: Array<Omit<NotificationItem, 'id'>> = [];

  for (const session of params.sessions) {
    if (session.status === 'Cancelled') continue;
    const startMs = Date.parse(session.startIso);
    if (Number.isNaN(startMs)) continue;
    const diffMs = startMs - params.nowMs;
    if (diffMs <= 0 || diffMs > windowMs) continue;

    const course = params.courses.find((c) => c.id === session.courseId);
    if (!course) continue;

    const enrolledStudents = params.enrollments.filter(
      (e) =>
        e.courseId === session.courseId &&
        e.cohort === session.cohort &&
        e.status === 'Active'
    );

    const hoursRemaining = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
    const timeLabel = new Date(startMs).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    for (const enrollment of enrolledStudents) {
      const dedupeKey = `reminder:${session.id}:${enrollment.studentId}`;
      if (existingKeys.has(dedupeKey)) continue;

      existingKeys.add(dedupeKey);
      generated.push({
        userId: enrollment.studentId,
        kind: 'reminder',
        title: `Session Reminder · ${course.code}`,
        message: `"${session.title}" starts in ~${hoursRemaining}h (${timeLabel}) in ${session.room} with ${session.instructorName}.`,
        relatedCourseId: course.id,
        relatedSessionId: session.id,
        dedupeKey,
        read: false,
        createdAt: new Date(params.nowMs).toISOString(),
      });
    }
  }

  return generated;
}

export function formatReportAsText(report: StudentProgressReport): string {
  const lines: string[] = [
    'INFOCOM ACADEMY MANAGEMENT SYSTEM — OFFICIAL STUDENT PROGRESS REPORT',
    `Generated: ${new Date(report.generatedAtIso).toLocaleString('en-US')}`,
    '====================================================================',
    `Student Name:       ${report.student.name}`,
    `Student ID:         ${report.student.studentCode ?? report.student.id}`,
    `Email:              ${report.student.email}`,
    `Academic Standing:  ${report.standing}`,
    `Overall Average:    ${report.overallAverage !== null ? `${report.overallAverage}% (${report.overallLetterGrade})` : 'Pending'}`,
    `Attendance Rate:    ${report.overallAttendanceRate}%`,
    `Course Completion:  ${report.overallCompletionPct}%`,
    '',
  ];

  for (const c of report.courses) {
    lines.push(`--------------------------------------------------------------------`);
    lines.push(`${c.courseCode} — ${c.courseTitle} (${c.cohort} · ${c.status})`);
    lines.push(
      `Completion: ${c.completionPct}% | Course Grade: ${c.weightedScore !== null ? `${c.weightedScore}% (${c.letterGrade})` : 'Pending'} | Attendance: ${c.attendance.rate}% (${c.attendance.present}P / ${c.attendance.late}L / ${c.attendance.absent}A)`
    );
    lines.push('Modules:');
    for (const m of c.moduleRows) {
      const status = m.completed ? 'Completed' : 'In Progress';
      const gradeStr = m.score !== null ? `${m.score}% (${m.letterGrade})` : 'Ungraded';
      lines.push(`  - [${m.moduleCode}] ${m.moduleTitle} (${m.weight}%) — ${status} · ${gradeStr}`);
      if (m.feedback) {
        lines.push(`      Feedback: ${m.feedback}`);
      }
    }
    lines.push(`Instructor Remark: ${c.instructorRemark}`);
    lines.push('');
  }

  return lines.join('\n');
}

// --- Decimal-safe financial arithmetic (integer cents) ---

export function toCents(amount: string | number): number {
  const str = typeof amount === 'number' ? amount.toFixed(2) : String(amount).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const cents = Number(wholePart) * 100 + Number(fracPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export function formatMoney(amount: string | number, currency = 'USD'): string {
  return formatCents(toCents(amount), currency);
}

export function computeInvoiceStatus(
  amountDue: string | number,
  amountPaid: string | number
): Exclude<InvoiceStatus, 'Voided'> {
  const due = toCents(amountDue);
  const paid = toCents(amountPaid);
  if (paid <= 0) return 'Unpaid';
  if (paid >= due) return 'Paid';
  return 'Partial';
}

export function computeCertificateEligibility(params: {
  enrollmentStatus: Enrollment['status'];
  completionPct: number;
  weightedScore: number | null;
  attendanceRate: number;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (params.enrollmentStatus === 'Dropped' || params.enrollmentStatus === 'Waitlisted') {
    reasons.push(`Enrollment status is ${params.enrollmentStatus}.`);
  }
  if (params.completionPct < 100 && params.enrollmentStatus !== 'Completed') {
    reasons.push(`Module completion is ${params.completionPct}% (100% required).`);
  }
  if (params.weightedScore === null || params.weightedScore < 70) {
    reasons.push(
      params.weightedScore === null
        ? 'Graded assessments are incomplete.'
        : `Weighted score is ${params.weightedScore}% (minimum 70% required).`
    );
  }
  if (params.attendanceRate < 75) {
    reasons.push(`Attendance rate is ${params.attendanceRate}% (minimum 75% required).`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function computeAcademyAnalytics(params: {
  users: UserPublic[];
  admissions: AdmissionApplication[];
  enrollments: Enrollment[];
  invoices: FeeInvoice[];
  certificates: CertificateRecord[];
  attendance: AttendanceRecord[];
}): AcademyAnalytics {
  const activeUsers = params.users.filter((u) => u.status !== 'archived');
  const totalStudents = activeUsers.filter((u) => u.role === 'student').length;
  const totalInstructors = activeUsers.filter((u) => u.role === 'instructor').length;
  const activeEnrollments = params.enrollments.filter((e) => e.status === 'Active').length;
  const completedEnrollments = params.enrollments.filter((e) => e.status === 'Completed').length;
  const pendingAdmissions = params.admissions.filter(
    (a) => a.status === 'Submitted' || a.status === 'Under Review'
  ).length;

  let totalBilledCents = 0;
  let totalCollectedCents = 0;
  for (const inv of params.invoices) {
    if (inv.status === 'Voided' || inv.isArchived) continue;
    totalBilledCents += toCents(inv.amountDue);
    totalCollectedCents += Math.min(toCents(inv.amountDue), toCents(inv.amountPaid));
  }
  const outstandingCents = Math.max(0, totalBilledCents - totalCollectedCents);
  const collectionRatePct =
    totalBilledCents > 0
      ? Math.round((totalCollectedCents / totalBilledCents) * 100)
      : 100;

  const certificatesIssued = params.certificates.filter(
    (c) => c.status === 'Issued'
  ).length;
  const meanAttendanceRate = calculateAttendanceStats(params.attendance).rate;

  return {
    totalStudents,
    totalInstructors,
    activeEnrollments,
    completedEnrollments,
    pendingAdmissions,
    totalBilledCents,
    totalCollectedCents,
    outstandingCents,
    collectionRatePct,
    certificatesIssued,
    meanAttendanceRate,
  };
}

// --- Phase 4 Analytics & Batch Helpers ---

export function resolveAnalyticsDateWindow(
  preset: '7d' | '30d' | '90d' | 'all' | 'custom',
  fromIso?: string | null,
  toIso?: string | null,
  nowMs = Date.now()
): { fromMs: number | null; toMs: number | null; fromIso: string | null; toIso: string | null } {
  if (preset === 'all') {
    return { fromMs: null, toMs: null, fromIso: null, toIso: null };
  }
  if (preset === 'custom') {
    const parsedFrom = fromIso ? Date.parse(fromIso) : NaN;
    const parsedTo = toIso ? Date.parse(toIso) : NaN;
    const fMs = Number.isNaN(parsedFrom) ? null : parsedFrom;
    const tMs = Number.isNaN(parsedTo) ? null : parsedTo + (24 * 60 * 60 * 1000 - 1);
    return {
      fromMs: fMs,
      toMs: tMs,
      fromIso: fMs !== null ? new Date(fMs).toISOString() : null,
      toIso: tMs !== null ? new Date(tMs).toISOString() : null,
    };
  }
  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
  const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
  return {
    fromMs,
    toMs: nowMs,
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(nowMs).toISOString(),
  };
}

export function buildMonthlyRevenueSeries(params: {
  invoices: FeeInvoice[];
  payments: Array<{ amount: string; paidAt: string }>;
  monthsCount?: number;
  nowMs?: number;
}): Array<{ monthKey: string; label: string; collectedCents: number; billedCents: number }> {
  const count = Math.max(1, Math.min(12, params.monthsCount ?? 6));
  const now = new Date(params.nowMs ?? Date.now());
  const buckets = new Map<string, { monthKey: string; label: string; collectedCents: number; billedCents: number }>();

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    buckets.set(key, { monthKey: key, label, collectedCents: 0, billedCents: 0 });
  }

  for (const inv of params.invoices) {
    if (inv.status === 'Voided' || inv.isArchived) continue;
    const d = new Date(inv.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const b = buckets.get(key);
    if (b) {
      b.billedCents += toCents(inv.amountDue);
    }
  }

  for (const pay of params.payments) {
    const d = new Date(pay.paidAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const b = buckets.get(key);
    if (b) {
      b.collectedCents += toCents(pay.amount);
    }
  }

  return Array.from(buckets.values());
}

export function buildEnrollmentTrendSeries(params: {
  enrollments: Enrollment[];
  monthsCount?: number;
  nowMs?: number;
}): Array<{ monthKey: string; label: string; enrollments: number; completions: number }> {
  const count = Math.max(1, Math.min(12, params.monthsCount ?? 6));
  const now = new Date(params.nowMs ?? Date.now());
  const buckets = new Map<string, { monthKey: string; label: string; enrollments: number; completions: number }>();

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    buckets.set(key, { monthKey: key, label, enrollments: 0, completions: 0 });
  }

  for (const enr of params.enrollments) {
    if (enr.status === 'Dropped') continue;
    const d = new Date(enr.enrolledAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const b = buckets.get(key);
    if (b) {
      b.enrollments += 1;
      if (enr.status === 'Completed') {
        b.completions += 1;
      }
    }
  }

  return Array.from(buckets.values());
}

export function computeBatchMetrics(params: {
  batchId: string;
  batchName: string;
  courseId: string;
  capacity: number;
  enrollments: Enrollment[];
  attendance: AttendanceRecord[];
  grades: ModuleGrade[];
}) {
  const batchEnrollments = params.enrollments.filter(
    (e) =>
      e.status !== 'Dropped' &&
      e.courseId === params.courseId &&
      (e.cohortId === params.batchId || e.cohort === params.batchName)
  );
  const studentIds = new Set(batchEnrollments.map((e) => e.studentId));
  const batchAttendance = params.attendance.filter(
    (a) => a.courseId === params.courseId && studentIds.has(a.studentId)
  );
  const batchGrades = params.grades.filter(
    (g) => g.courseId === params.courseId && studentIds.has(g.studentId)
  );
  const attendanceStats = calculateAttendanceStats(batchAttendance);
  const meanScore =
    batchGrades.length > 0
      ? Math.round(
          (batchGrades.reduce((sum, g) => sum + g.score, 0) / batchGrades.length) * 10
        ) / 10
      : null;

  return {
    enrolledCount: batchEnrollments.length,
    capacity: params.capacity,
    utilizationPct:
      params.capacity > 0
        ? Math.min(100, Math.round((batchEnrollments.length / params.capacity) * 100))
        : 0,
    attendanceRate: attendanceStats.rate,
    meanScore,
  };
}

export function formatInvoiceNumber(prefix: string, seq: number): string {
  const cleanPrefix = prefix.trim().replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'INV-2026';
  return `${cleanPrefix}-${String(seq).padStart(4, '0')}`;
}

