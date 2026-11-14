import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttendanceNotification,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeAcademyAnalytics,
  computeCertificateEligibility,
  computeInvoiceStatus,
  computeStudentProgressReport,
  findUpcomingSessionsNeedingReminders,
  formatCents,
  formatMoney,
  formatReportAsText,
  fromCents,
  toCents,
} from './academic';
import {
  createInvoiceSchema,
  issueCertificateSchema,
  recordPaymentSchema,
} from './validation';
import type {
  AttendanceRecord,
  ClassSession,
  Course,
  Enrollment,
  ModuleGrade,
  NotificationItem,
  UserPublic,
} from './types';

const sampleStudent: UserPublic = {
  id: 'stu-1',
  name: 'Marcus Chen',
  email: 'marcus.chen@student.northbridge.edu',
  role: 'student',
  status: 'active',
  studentCode: 'NTA-2026-041',
};

const sampleCourse: Course = {
  id: 'crs-ts',
  code: 'CS-204',
  title: 'Full-Stack TypeScript Engineering',
  track: 'Software Engineering',
  instructorId: 'inst-1',
  instructorName: 'Dr. Elena Vance',
  durationWeeks: 12,
  tuitionFee: '1450.00',
  modules: [
    { id: 'm1', code: 'M1', title: 'TypeScript Type Systems', weight: 25, labHours: 12 },
    { id: 'm2', code: 'M2', title: 'React Architecture & State', weight: 25, labHours: 14 },
    { id: 'm3', code: 'M3', title: 'REST & Auth Systems', weight: 25, labHours: 16 },
    { id: 'm4', code: 'M4', title: 'Testing & Production Ops', weight: 25, labHours: 14 },
  ],
};

test('calculateLetterGrade maps boundary scores accurately', () => {
  assert.equal(calculateLetterGrade(95), 'A');
  assert.equal(calculateLetterGrade(90), 'A-');
  assert.equal(calculateLetterGrade(84), 'B');
  assert.equal(calculateLetterGrade(72), 'C-');
  assert.equal(calculateLetterGrade(55), 'F');
  assert.equal(calculateLetterGrade(null), 'N/A');
});

test('calculateWeightedAverage computes weighted grade accurately', () => {
  const avg = calculateWeightedAverage([
    { score: 92, weight: 25 },
    { score: 84, weight: 25 },
  ]);
  assert.equal(avg, 88);
  assert.equal(calculateWeightedAverage([]), null);
});

test('calculateAttendanceStats weights Present 100% and Late 75%', () => {
  const records: AttendanceRecord[] = [
    {
      id: 'a1',
      sessionId: 's1',
      courseId: 'crs-ts',
      studentId: 'stu-1',
      status: 'Present',
      note: '',
      updatedAt: '2026-11-10T10:00:00Z',
      updatedBy: 'Dr. Elena Vance',
    },
    {
      id: 'a2',
      sessionId: 's2',
      courseId: 'crs-ts',
      studentId: 'stu-1',
      status: 'Late',
      note: '',
      updatedAt: '2026-11-11T10:00:00Z',
      updatedBy: 'Dr. Elena Vance',
    },
  ];
  const stats = calculateAttendanceStats(records);
  assert.equal(stats.total, 2);
  assert.equal(stats.present, 1);
  assert.equal(stats.late, 1);
  assert.equal(stats.absent, 0);
  assert.equal(stats.rate, 88);
});

test('calculateCourseCompletion deduplicates completed module IDs', () => {
  assert.equal(calculateCourseCompletion(['m1', 'm1', 'm2'], 4), 50);
  assert.equal(calculateCourseCompletion([], 4), 0);
});

test('computeStudentProgressReport aggregates grades, completion, attendance, and standing', () => {
  const enrollments: Enrollment[] = [
    {
      id: 'enr-1',
      studentId: 'stu-1',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: '2026-09-01T09:00:00Z',
      completedModuleIds: ['m1', 'm2', 'm3'],
    },
  ];
  const grades: ModuleGrade[] = [
    {
      id: 'g1',
      studentId: 'stu-1',
      courseId: 'crs-ts',
      moduleId: 'm1',
      score: 94,
      feedback: 'Strong generic type inference.',
      gradedAt: '2026-09-20T12:00:00Z',
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'g2',
      studentId: 'stu-1',
      courseId: 'crs-ts',
      moduleId: 'm2',
      score: 90,
      feedback: 'Clean hook isolation.',
      gradedAt: '2026-10-10T12:00:00Z',
      gradedBy: 'Dr. Elena Vance',
    },
  ];
  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      sessionId: 'ses-1',
      courseId: 'crs-ts',
      studentId: 'stu-1',
      status: 'Present',
      note: '',
      updatedAt: '2026-11-01T10:00:00Z',
      updatedBy: 'Dr. Elena Vance',
    },
  ];

  const report = computeStudentProgressReport({
    student: sampleStudent,
    courses: [sampleCourse],
    enrollments,
    grades,
    attendance,
    remarks: [],
    generatedAtIso: '2026-11-13T12:00:00Z',
  });

  assert.equal(report.overallAverage, 92);
  assert.equal(report.overallLetterGrade, 'A-');
  assert.equal(report.overallAttendanceRate, 100);
  assert.equal(report.overallCompletionPct, 75);
  assert.equal(report.standing, 'Distinction');

  const text = formatReportAsText(report);
  assert.match(text, /Marcus Chen/);
  assert.match(text, /CS-204/);
  assert.match(text, /Distinction/);
});

test('findUpcomingSessionsNeedingReminders creates deduplicated 24h reminders only for active cohort enrollees', () => {
  const nowMs = Date.parse('2026-11-13T10:00:00Z');
  const sessions: ClassSession[] = [
    {
      id: 'ses-soon',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      title: 'Auth & Middleware Lab',
      topic: 'Session cookies and RBAC',
      room: 'Lab 204',
      instructorName: 'Dr. Elena Vance',
      startIso: '2026-11-13T18:00:00Z',
      endIso: '2026-11-13T20:00:00Z',
    },
    {
      id: 'ses-far',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      title: 'Deployment Workshop',
      topic: 'CI/CD',
      room: 'Lab 204',
      instructorName: 'Dr. Elena Vance',
      startIso: '2026-11-20T18:00:00Z',
      endIso: '2026-11-20T20:00:00Z',
    },
  ];

  const enrollments: Enrollment[] = [
    {
      id: 'e1',
      studentId: 'stu-1',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: '2026-09-01T00:00:00Z',
      completedModuleIds: [],
    },
    {
      id: 'e2',
      studentId: 'stu-2',
      courseId: 'crs-ts',
      cohort: 'Cohort B · Winter',
      status: 'Active',
      enrolledAt: '2026-09-01T00:00:00Z',
      completedModuleIds: [],
    },
  ];

  const firstRun = findUpcomingSessionsNeedingReminders({
    sessions,
    courses: [sampleCourse],
    enrollments,
    existingNotifications: [],
    nowMs,
  });

  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].userId, 'stu-1');
  assert.equal(firstRun[0].kind, 'reminder');
  assert.equal(firstRun[0].dedupeKey, 'reminder:ses-soon:stu-1');

  const existingNotifications: NotificationItem[] = firstRun.map((n, idx) => ({
    ...n,
    id: `n-${idx}`,
  }));

  const secondRun = findUpcomingSessionsNeedingReminders({
    sessions,
    courses: [sampleCourse],
    enrollments,
    existingNotifications,
    nowMs,
  });

  assert.equal(secondRun.length, 0);
});

test('buildAttendanceNotification formats clear status message', () => {
  const notif = buildAttendanceNotification({
    id: 'n-100',
    studentId: 'stu-1',
    course: sampleCourse,
    session: {
      id: 'ses-1',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      title: 'React Hooks Workshop',
      topic: 'Custom hooks',
      room: 'Lab 101',
      instructorName: 'Dr. Elena Vance',
      startIso: '2026-11-12T10:00:00Z',
      endIso: '2026-11-12T12:00:00Z',
    },
    status: 'Late',
    note: 'Arrived 15 mins after lab start.',
    createdAt: '2026-11-12T10:20:00Z',
  });

  assert.equal(notif.kind, 'attendance');
  assert.match(notif.title, /CS-204/);
  assert.match(notif.message, /marked Late/);
  assert.match(notif.message, /Arrived 15 mins/);
});

test('decimal-safe financial helpers avoid float drift and compute invoice statuses', () => {
  assert.equal(toCents('1450.50'), 145050);
  assert.equal(toCents('0.10') + toCents('0.20'), 30);
  assert.equal(fromCents(toCents('0.10') + toCents('0.20')), '0.30');
  assert.equal(formatCents(145000), '$1,450.00');
  assert.equal(formatMoney('1450.00'), '$1,450.00');

  assert.equal(computeInvoiceStatus('1450.00', '0.00'), 'Unpaid');
  assert.equal(computeInvoiceStatus('1450.00', '500.00'), 'Partial');
  assert.equal(computeInvoiceStatus('1450.00', '1450.00'), 'Paid');
});

test('computeCertificateEligibility enforces completion, passing score, and attendance rules', () => {
  const ineligible = computeCertificateEligibility({
    enrollmentStatus: 'Active',
    completionPct: 75,
    weightedScore: 68,
    attendanceRate: 70,
  });
  assert.equal(ineligible.eligible, false);
  assert.equal(ineligible.reasons.length, 3);

  const eligible = computeCertificateEligibility({
    enrollmentStatus: 'Completed',
    completionPct: 100,
    weightedScore: 94,
    attendanceRate: 100,
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reasons.length, 0);
});

test('computeAcademyAnalytics excludes archived/voided invoices and aggregates metrics', () => {
  const analytics = computeAcademyAnalytics({
    users: [
      sampleStudent,
      {
        id: 'inst-1',
        name: 'Dr. Elena Vance',
        email: 'elena.vance@northbridge.edu',
        role: 'instructor',
        status: 'active',
      },
    ],
    admissions: [
      {
        id: 'adm-1',
        applicantName: 'Jane Doe',
        applicantEmail: 'jane@example.com',
        phone: '',
        targetCourseId: 'crs-ts',
        preferredCohort: 'Cohort A',
        status: 'Submitted',
        notes: '',
        submittedAt: '2026-11-12T10:00:00Z',
      },
    ],
    enrollments: [
      {
        id: 'e1',
        studentId: 'stu-1',
        courseId: 'crs-ts',
        cohort: 'Cohort A',
        status: 'Active',
        enrolledAt: '2026-11-01T00:00:00Z',
        completedModuleIds: [],
      },
    ],
    invoices: [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-001',
        studentId: 'stu-1',
        courseId: 'crs-ts',
        description: 'Tuition',
        amountDue: '1000.00',
        amountPaid: '400.00',
        currency: 'USD',
        status: 'Partial',
        dueDate: '2026-12-01T00:00:00Z',
        isArchived: false,
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'inv-void',
        invoiceNumber: 'INV-002',
        studentId: 'stu-1',
        courseId: 'crs-ts',
        description: 'Voided',
        amountDue: '500.00',
        amountPaid: '0.00',
        currency: 'USD',
        status: 'Voided',
        dueDate: '2026-12-01T00:00:00Z',
        isArchived: false,
        createdAt: '2026-11-01T00:00:00Z',
      },
    ],
    certificates: [],
    attendance: [],
  });

  assert.equal(analytics.totalStudents, 1);
  assert.equal(analytics.totalInstructors, 1);
  assert.equal(analytics.pendingAdmissions, 1);
  assert.equal(analytics.totalBilledCents, 100000);
  assert.equal(analytics.totalCollectedCents, 40000);
  assert.equal(analytics.outstandingCents, 60000);
  assert.equal(analytics.collectionRatePct, 40);
});

test('Zod validation schemas reject negative payments and invalid payloads', () => {
  assert.equal(recordPaymentSchema.safeParse({ amount: '-50.00', method: 'Card' }).success, false);
  assert.equal(recordPaymentSchema.safeParse({ amount: '250.00', method: 'Card' }).success, true);
  assert.equal(
    createInvoiceSchema.safeParse({
      studentId: 'stu-1',
      courseId: 'crs-ts',
      description: 'Tuition',
      amountDue: '0.00',
      dueDate: '2026-12-01T00:00:00Z',
    }).success,
    false
  );
  assert.equal(
    issueCertificateSchema.safeParse({ studentId: 'stu-1', courseId: '' }).success,
    false
  );
});
