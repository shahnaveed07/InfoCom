import type {
  AcademyPolicySummary,
  AdmissionApplication,
  AdmissionStatus,
  AssessmentGradeRecord,
  AssessmentRecord,
  AttendanceRecord,
  CertificateRecord,
  ClassSession,
  Course,
  Enrollment,
  EnrollmentStatus,
  FeeInvoice,
  InvoiceStatus,
  ModuleGrade,
  NotificationItem,
  PortalActivationPolicy,
  ProgressRemark,
  UserPublic,
  AcademyAnalytics,
} from './types';

export const INACTIVE_ENROLLMENT_STATUSES: ReadonlyArray<EnrollmentStatus> = [
  'Cancelled',
  'Withdrawn',
  'Dropped',
];

export const TERMINAL_ENROLLMENT_STATUSES: ReadonlyArray<EnrollmentStatus> = [
  'Completed',
  'Cancelled',
  'Withdrawn',
  'Dropped',
];

export const PENDING_ADMISSION_STATUSES: ReadonlyArray<AdmissionStatus> = [
  'Submitted',
  'Under Review',
  'Documents Required',
  'Accepted',
];

export function isInactiveEnrollmentStatus(status: string): boolean {
  return (
    status === 'Cancelled' ||
    status === 'Withdrawn' ||
    status === 'Dropped'
  );
}

export function isTerminalEnrollmentStatus(status: string): boolean {
  return status === 'Completed' || isInactiveEnrollmentStatus(status);
}

export function isSeatOccupyingEnrollmentStatus(status: string): boolean {
  return status === 'Active' || status === 'Waitlisted';
}

export function isPendingAdmissionStatus(status: string): boolean {
  return (
    status === 'Submitted' ||
    status === 'Under Review' ||
    status === 'Documents Required' ||
    status === 'Accepted'
  );
}

export const VALID_ENROLLMENT_TRANSITIONS: Record<
  EnrollmentStatus,
  ReadonlyArray<EnrollmentStatus>
> = {
  Waitlisted: ['Active', 'Cancelled', 'Withdrawn', 'Dropped'],
  Active: ['Completed', 'Waitlisted', 'Cancelled', 'Withdrawn', 'Dropped'],
  Completed: [],
  Cancelled: [],
  Withdrawn: [],
  Dropped: [],
};

export function getAllowedEnrollmentTransitions(
  status: EnrollmentStatus
): ReadonlyArray<EnrollmentStatus> {
  return VALID_ENROLLMENT_TRANSITIONS[status] ?? [];
}

export function isValidEnrollmentTransition(
  fromStatus: EnrollmentStatus,
  toStatus: EnrollmentStatus
): boolean {
  if (fromStatus === toStatus) return true;
  return getAllowedEnrollmentTransitions(fromStatus).includes(toStatus);
}

export const VALID_ADMISSION_TRANSITIONS: Record<
  AdmissionStatus,
  ReadonlyArray<AdmissionStatus>
> = {
  Draft: ['Submitted', 'Withdrawn'],
  Submitted: [
    'Under Review',
    'Documents Required',
    'Approved',
    'Accepted',
    'Rejected',
    'Withdrawn',
  ],
  'Under Review': [
    'Documents Required',
    'Approved',
    'Accepted',
    'Rejected',
    'Withdrawn',
  ],
  'Documents Required': [
    'Under Review',
    'Submitted',
    'Approved',
    'Accepted',
    'Rejected',
    'Withdrawn',
  ],
  Accepted: ['Approved', 'Enrolled', 'Rejected', 'Withdrawn'],
  Approved: [],
  Enrolled: [],
  Rejected: [],
  Withdrawn: [],
};

export function getAllowedAdmissionTransitions(
  status: AdmissionStatus
): ReadonlyArray<AdmissionStatus> {
  return VALID_ADMISSION_TRANSITIONS[status] ?? [];
}

export function isValidAdmissionTransition(
  fromStatus: AdmissionStatus,
  toStatus: AdmissionStatus
): boolean {
  if (fromStatus === toStatus) return true;
  return getAllowedAdmissionTransitions(fromStatus).includes(toStatus);
}

export function shouldActivatePortalOnApproval(policy: PortalActivationPolicy): boolean {
  return policy === 'immediate' || policy === 'on_approval';
}

export function shouldActivatePortalOnPayment(policy: PortalActivationPolicy): boolean {
  return policy === 'after_first_payment';
}

export interface AttendanceStats {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
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
  assessmentRows: Array<{
    assessmentId: string;
    title: string;
    assessmentType: AssessmentRecord['assessmentType'];
    weight: number;
    maxScore: number;
    score: number | null;
    percentage: number | null;
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

export function calculateAttendanceStats(
  records: AttendanceRecord[],
  options?: { lateWeightPct?: number }
): AttendanceStats {
  const total = records.length;
  if (total === 0) {
    return { total: 0, present: 0, late: 0, absent: 0, excused: 0, rate: 100 };
  }
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  for (const r of records) {
    if (r.status === 'Present') present += 1;
    else if (r.status === 'Late') late += 1;
    else if (r.status === 'Absent') absent += 1;
    else if (r.status === 'Excused') excused += 1;
  }
  const effectiveTotal = present + late + absent;
  if (effectiveTotal === 0) {
    return { total, present, late, absent, excused, rate: 100 };
  }
  const lateWeight = Math.max(0, Math.min(100, options?.lateWeightPct ?? 75)) / 100;
  const rate = Math.min(
    100,
    Math.round(((present + late * lateWeight) / effectiveTotal) * 100)
  );
  return { total, present, late, absent, excused, rate };
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
  overallAttendanceRate: number,
  policies?: Partial<Pick<AcademyPolicySummary, 'distinctionScore' | 'passingScore' | 'minAttendanceRatePct'>>
): StudentProgressReport['standing'] {
  if (overallAverage === null) return 'Pending Assessment';
  const distinction = policies?.distinctionScore ?? 90;
  const passing = policies?.passingScore ?? 75;
  const minAtt = policies?.minAttendanceRatePct ?? 75;
  if (overallAverage >= distinction && overallAttendanceRate >= distinction) return 'Distinction';
  if (overallAverage < passing || overallAttendanceRate < minAtt) return 'Needs Attention';
  return 'On Track';
}

export function computeStudentProgressReport(params: {
  student: UserPublic;
  courses: Course[];
  enrollments: Enrollment[];
  grades: ModuleGrade[];
  assessments?: AssessmentRecord[];
  assessmentGrades?: AssessmentGradeRecord[];
  attendance: AttendanceRecord[];
  remarks: ProgressRemark[];
  policies?: Partial<AcademyPolicySummary>;
  generatedAtIso: string;
}): StudentProgressReport {
  const studentEnrollments = params.enrollments.filter(
    (e) => e.studentId === params.student.id && !isInactiveEnrollmentStatus(e.status)
  );

  const courseReports: CourseProgressReportItem[] = [];
  const allAttendanceRecords: AttendanceRecord[] = [];
  const courseAverages: number[] = [];
  const courseCompletions: number[] = [];
  const lateWeightPct = params.policies?.lateWeightPct;

  for (const enrollment of studentEnrollments) {
    const course = params.courses.find((c) => c.id === enrollment.courseId);
    if (!course) continue;

    const courseGrades = params.grades.filter(
      (g) => g.studentId === params.student.id && g.courseId === course.id
    );
    const courseAssessments = (params.assessments ?? []).filter(
      (a) =>
        a.courseId === course.id &&
        (!a.batchId || a.batchId === enrollment.cohortId)
    );
    const courseAssessmentGrades = (params.assessmentGrades ?? []).filter(
      (ag) => ag.studentId === params.student.id && ag.courseId === course.id
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

    const assessmentRows = courseAssessments.map((asmt) => {
      const ag = courseAssessmentGrades.find((g) => g.assessmentId === asmt.id);
      const pct = ag
        ? Math.round((ag.score / Math.max(1, asmt.maxScore)) * 1000) / 10
        : null;
      return {
        assessmentId: asmt.id,
        title: asmt.title,
        assessmentType: asmt.assessmentType,
        weight: asmt.weight,
        maxScore: asmt.maxScore,
        score: ag ? ag.score : null,
        percentage: pct,
        letterGrade: calculateLetterGrade(pct),
        feedback: ag?.feedback ?? '',
      };
    });

    const gradedAssessmentPairs = assessmentRows
      .filter((r) => r.percentage !== null)
      .map((r) => ({ score: r.percentage as number, weight: r.weight }));

    const gradedModulePairs = moduleRows
      .filter((m) => m.score !== null)
      .map((m) => ({ score: m.score as number, weight: m.weight }));

    const weightedScore =
      gradedAssessmentPairs.length > 0
        ? calculateWeightedAverage(gradedAssessmentPairs)
        : calculateWeightedAverage(gradedModulePairs);

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
      attendance: calculateAttendanceStats(courseAttendance, { lateWeightPct }),
      moduleRows,
      assessmentRows,
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

  const overallAttendance = calculateAttendanceStats(allAttendanceRecords, { lateWeightPct });
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
    standing: determineAcademicStanding(overallAverage, overallAttendance.rate, params.policies),
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
        : params.status === 'Excused'
          ? 'marked Excused'
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
    const timeLabel = new Date(startMs).toLocaleString('en-IN', {
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
    'IGS — INFOCOM GLOBAL SERVICES · COMPUTER INSTITUTE — OFFICIAL STUDENT PROGRESS REPORT',
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India',
    `Generated: ${new Date(report.generatedAtIso).toLocaleString('en-IN')}`,
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
      `Completion: ${c.completionPct}% | Course Grade: ${c.weightedScore !== null ? `${c.weightedScore}% (${c.letterGrade})` : 'Pending'} | Attendance: ${c.attendance.rate}% (${c.attendance.present}P / ${c.attendance.late}L / ${c.attendance.absent}A${c.attendance.excused ? ` / ${c.attendance.excused}E` : ''})`
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
    const extraAssessments = c.assessmentRows.filter(
      (a) => a.assessmentType !== 'Module Assessment'
    );
    if (extraAssessments.length > 0) {
      lines.push('Assessments:');
      for (const a of extraAssessments) {
        const gradeStr =
          a.score !== null
            ? `${a.score}/${a.maxScore} (${a.percentage}% · ${a.letterGrade})`
            : 'Ungraded';
        lines.push(`  - [${a.assessmentType}] ${a.title} (${a.weight}%) — ${gradeStr}`);
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

export function formatCents(cents: number, currency = 'INR'): string {
  const locale = currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export function formatMoney(amount: string | number, currency = 'INR'): string {
  return formatCents(toCents(amount), currency);
}

export function computeInvoiceStatus(
  amountDue: string | number,
  amountPaid: string | number
): Exclude<InvoiceStatus, 'Voided'> {
  const due = toCents(amountDue);
  const paid = toCents(amountPaid);
  if (due <= 0) return 'Paid';
  if (paid <= 0) return 'Unpaid';
  if (paid >= due) return 'Paid';
  return 'Partial';
}

export function computeAdjustmentCents(params: {
  baseCents: number;
  type: 'Percentage' | 'Fixed';
  value: string | number;
  maxAllowedCents: number;
}): number {
  if (params.baseCents <= 0 || params.maxAllowedCents <= 0) return 0;
  let rawCents = 0;
  if (params.type === 'Percentage') {
    const pct = Number(params.value);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    const clampedPct = Math.min(100, pct);
    rawCents = Math.round((params.baseCents * clampedPct) / 100);
  } else {
    rawCents = toCents(params.value);
  }
  if (rawCents <= 0) return 0;
  return Math.min(rawCents, params.maxAllowedCents);
}

export function recalculateInvoiceTotals(params: {
  subtotalCents: number;
  discountTotalCents: number;
  scholarshipTotalCents: number;
  paidCents: number;
}): { netDueCents: number; status: Exclude<InvoiceStatus, 'Voided'> } {
  const netDueCents = Math.max(
    0,
    params.subtotalCents - params.discountTotalCents - params.scholarshipTotalCents
  );
  const status = computeInvoiceStatus(fromCents(netDueCents), fromCents(params.paidCents));
  return { netDueCents, status };
}

export function computeRefundableCents(
  paymentAmount: string | number,
  priorRefundAmounts: Array<string | number>
): number {
  const totalPayment = toCents(paymentAmount);
  const refundedSoFar = priorRefundAmounts.reduce<number>(
    (acc, val) => acc + Math.max(0, toCents(val)),
    0
  );
  return Math.max(0, totalPayment - refundedSoFar);
}

export function computeCertificateEligibility(params: {
  enrollmentStatus: Enrollment['status'];
  completionPct: number;
  weightedScore: number | null;
  attendanceRate: number;
  minCompletionPct?: number;
  minScore?: number;
  minAttendancePct?: number;
}): { eligible: boolean; reasons: string[] } {
  const minCompletion = params.minCompletionPct ?? 100;
  const minScore = params.minScore ?? 70;
  const minAtt = params.minAttendancePct ?? 75;
  const reasons: string[] = [];
  if (isInactiveEnrollmentStatus(params.enrollmentStatus) || params.enrollmentStatus === 'Waitlisted') {
    reasons.push(`Enrollment status is ${params.enrollmentStatus}.`);
  }
  if (params.completionPct < minCompletion && params.enrollmentStatus !== 'Completed') {
    reasons.push(`Module completion is ${params.completionPct}% (${minCompletion}% required).`);
  }
  if (params.weightedScore === null || params.weightedScore < minScore) {
    reasons.push(
      params.weightedScore === null
        ? 'Graded assessments are incomplete.'
        : `Weighted score is ${params.weightedScore}% (minimum ${minScore}% required).`
    );
  }
  if (params.attendanceRate < minAtt) {
    reasons.push(`Attendance rate is ${params.attendanceRate}% (minimum ${minAtt}% required).`);
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
  const pendingAdmissions = params.admissions.filter((a) =>
    isPendingAdmissionStatus(a.status)
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
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
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
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    buckets.set(key, { monthKey: key, label, enrollments: 0, completions: 0 });
  }

  for (const enr of params.enrollments) {
    if (isInactiveEnrollmentStatus(enr.status)) continue;
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
      !isInactiveEnrollmentStatus(e.status) &&
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

export function slugifyCourseTitle(input: string): string {
  const clean = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'course';
}
