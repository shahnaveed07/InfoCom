import React, { useMemo, useState } from 'react';
import {
  Award,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  MapPin,
} from 'lucide-react';
import {
  calculateLetterGrade,
  computeStudentProgressReport,
  formatCents,
  isInactiveEnrollmentStatus,
  toCents,
} from '../shared/academic';
import type { DashboardPayload } from '../shared/types';
import type { NavSection } from './Sidebar';

interface StudentDashboardProps {
  data: DashboardPayload;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigate: (section: NavSection) => void;
}

export function StudentDashboard({
  data,
  onMarkNotificationRead,
  onMarkAllRead,
  onNavigate,
}: StudentDashboardProps) {
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('all');

  const report = useMemo(
    () =>
      computeStudentProgressReport({
        student: data.user,
        courses: data.courses,
        enrollments: data.enrollments,
        grades: data.grades,
        assessments: data.assessments,
        assessmentGrades: data.assessmentGrades,
        attendance: data.attendance,
        remarks: data.remarks,
        policies: data.policies,
        generatedAtIso: new Date().toISOString(),
      }),
    [data]
  );

  const nowMs = Date.now();
  const upcomingSessions = data.sessions
    .filter((s) => {
      const activeCohort = data.enrollments.some(
        (e) =>
          e.courseId === s.courseId &&
          e.cohort === s.cohort &&
          !isInactiveEnrollmentStatus(e.status)
      );
      return activeCohort && Date.parse(s.startIso) >= nowMs;
    })
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));

  const sortedNotifications = [...data.notifications]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((n) => (notifFilter === 'unread' ? !n.read : true));

  const unreadCount = data.notifications.filter((n) => !n.read).length;
  const outstandingCents = data.invoices
    .filter((i) => i.status !== 'Voided' && !i.isArchived)
    .reduce((sum, i) => sum + Math.max(0, toCents(i.amountDue) - toCents(i.amountPaid)), 0);
  const activeCertCount = data.certificates.filter((c) => c.status === 'Issued').length;

  return (
    <div className="space-y-6">
      {/* 4-Column Academic Summary */}
      <section aria-label="Student academic summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Current GPA / Average</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {report.overallAverage !== null ? `${report.overallAverage}%` : 'Pending'}
            </span>
            <span className="font-mono text-xs font-semibold text-blue-700">
              Grade {report.overallLetterGrade}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Attendance Rate</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {report.overallAttendanceRate}%
            </span>
            <span className="text-xs text-slate-500">{report.standing}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Curriculum Progress</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {report.overallCompletionPct}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {report.courses.length} active courses
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Unread Alerts</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {unreadCount}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {upcomingSessions.length} upcoming labs
            </span>
          </div>
        </div>
      </section>

      {/* Quick Portal Strip: Tuition Balance & Verified Certificates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CreditCard className="w-5 h-5 text-blue-700 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">Outstanding Tuition Balance</div>
              <div className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                {formatCents(outstandingCents)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('finance')}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            Fees & Receipts
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Award className="w-5 h-5 text-emerald-700 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">Issued Certificates</div>
              <div className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                {activeCertCount} verified credential{activeCertCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('certificates')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            View Credentials
          </button>
        </div>
      </div>

      {/* Main Split: Grades & Course Progress + Upcoming Schedules & Automated Notifications */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left 2 Columns: Enrolled Courses & Grades */}
        <div className="xl:col-span-2 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  My Courses & Grades
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Weighted module scores, completion status, and instructor feedback
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('student-report')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Full Progress Report</span>
              </button>
            </div>

            {report.courses.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                You are not enrolled in any courses yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {report.courses.map((course) => (
                  <div key={course.courseId} className="p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono text-blue-700 font-medium">
                            {course.courseCode}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{course.cohort}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{course.status}</span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                          {course.courseTitle}
                        </h3>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                        <span className="text-slate-600">
                          Progress: {course.completionPct}%
                        </span>
                        <span className="font-semibold text-slate-900">
                          Grade:{' '}
                          {course.weightedScore !== null
                            ? `${course.weightedScore}% (${course.letterGrade})`
                            : 'Pending'}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-700 rounded-full transition-all"
                        style={{ width: `${course.completionPct}%` }}
                      />
                    </div>

                    {/* Module Grades Table */}
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                            <th className="py-2 px-3.5">Module</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 px-3 text-right">Score</th>
                            <th className="py-2 px-3.5">Feedback</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {course.moduleRows.map((m) => (
                            <tr key={m.moduleId}>
                              <td className="py-2.5 px-3.5 font-medium text-slate-900">
                                <span className="font-mono text-slate-500 mr-1.5">
                                  {m.moduleCode}
                                </span>
                                {m.moduleTitle}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                {m.completed ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Completed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-slate-500">
                                    <Clock className="w-3.5 h-3.5" />
                                    In Progress
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {m.score !== null
                                  ? `${m.score}% (${calculateLetterGrade(m.score)})`
                                  : 'Ungraded'}
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-600">
                                {m.feedback || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {course.assessmentRows.filter(
                      (a) => a.assessmentType !== 'Module Assessment'
                    ).length > 0 && (
                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                              <th className="py-2 px-3.5">Assessment</th>
                              <th className="py-2 px-3">Type</th>
                              <th className="py-2 px-3 text-right">Score</th>
                              <th className="py-2 px-3.5">Feedback</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-xs">
                            {course.assessmentRows
                              .filter((a) => a.assessmentType !== 'Module Assessment')
                              .map((asmt) => (
                                <tr key={asmt.assessmentId}>
                                  <td className="py-2 px-3.5 font-medium text-slate-900">
                                    {asmt.title}{' '}
                                    <span className="font-mono text-[11px] text-slate-400">
                                      ({asmt.weight}%)
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">
                                    {asmt.assessmentType}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                    {asmt.score !== null
                                      ? `${asmt.score}/${asmt.maxScore} (${asmt.percentage}% · ${asmt.letterGrade})`
                                      : 'Pending'}
                                  </td>
                                  <td className="py-2 px-3.5 text-slate-600">
                                    {asmt.feedback || '—'}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Upcoming Class Schedules */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Upcoming Class Schedules
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Your confirmed lab and lecture sessions
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('schedules')}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap"
              >
                View Full Timetable
              </button>
            </div>

            {upcomingSessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No upcoming sessions scheduled for your enrolled cohorts.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {upcomingSessions.map((ses) => {
                  const course = data.courses.find((c) => c.id === ses.courseId);
                  const start = new Date(ses.startIso);
                  const end = new Date(ses.endIso);
                  return (
                    <div
                      key={ses.id}
                      className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono font-medium text-blue-700">
                            {course?.code}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{ses.instructorName}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 mt-0.5">
                          {ses.title}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 shrink-0">
                        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                          <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                          {start.toLocaleDateString('en-IN', {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          ·{' '}
                          {start.toLocaleTimeString('en-IN', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                          –
                          {end.toLocaleTimeString('en-IN', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {ses.room}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Automated Notification Center */}
        <section
          id="student-notifications-panel"
          aria-label="Automated notifications"
          className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-fit"
        >
          <div className="px-5 py-4 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Notification Center
                </h2>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>

            <div
              className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
              role="group"
              aria-label="Filter notifications"
            >
              <button
                type="button"
                onClick={() => setNotifFilter('all')}
                className={`py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  notifFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({data.notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setNotifFilter('unread')}
                className={`py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  notifFilter === 'unread'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200 max-h-[620px] overflow-y-auto">
            {sortedNotifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {notifFilter === 'unread'
                  ? 'All caught up — no unread notifications.'
                  : 'No notifications yet.'}
              </div>
            ) : (
              sortedNotifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 transition-colors ${
                    n.read ? 'bg-white' : 'bg-blue-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400 mt-1.5 tabular-nums">
                        {new Date(n.createdAt).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => onMarkNotificationRead(n.id)}
                        aria-label={`Mark notification "${n.title}" as read`}
                        className="p-1.5 rounded-md text-blue-700 hover:bg-blue-100 shrink-0 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
