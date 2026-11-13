import type {
  AttendanceRecord,
  ClassSession,
  Course,
  Enrollment,
  ModuleGrade,
  NotificationItem,
  ProgressRemark,
  UserPublic,
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
  // Present counts 100%, Late counts 75% toward attendance rate
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
    'NORTHBRIDGE TECH ACADEMY — OFFICIAL STUDENT PROGRESS REPORT',
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
