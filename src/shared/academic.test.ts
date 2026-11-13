import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttendanceNotification,
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  computeStudentProgressReport,
  findUpcomingSessionsNeedingReminders,
  formatReportAsText,
} from './academic';
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
      startIso: '2026-11-13T18:00:00Z', // 8h ahead -> should trigger
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
      startIso: '2026-11-20T18:00:00Z', // 7 days ahead -> should NOT trigger
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
