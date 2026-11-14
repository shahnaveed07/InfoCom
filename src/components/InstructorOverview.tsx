import React from 'react';
import {
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  Users,
} from 'lucide-react';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  isInactiveEnrollmentStatus,
} from '../shared/academic';
import type { DashboardPayload } from '../shared/types';
import type { NavSection } from './Sidebar';

interface InstructorOverviewProps {
  data: DashboardPayload;
  onNavigate: (section: NavSection) => void;
}

export function InstructorOverview({ data, onNavigate }: InstructorOverviewProps) {
  const activeEnrollments = data.enrollments.filter((e) => e.status === 'Active');
  const attendanceStats = calculateAttendanceStats(data.attendance);

  const avgCompletion =
    activeEnrollments.length > 0
      ? Math.round(
          activeEnrollments.reduce((acc, enr) => {
            const course = data.courses.find((c) => c.id === enr.courseId);
            return (
              acc +
              calculateCourseCompletion(
                enr.completedModuleIds,
                course?.modules.length ?? 0
              )
            );
          }, 0) / activeEnrollments.length
        )
      : 0;

  const nowMs = Date.now();
  const upcomingSessions = data.sessions
    .filter((s) => Date.parse(s.startIso) >= nowMs)
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
    .slice(0, 4);

  const recentNotifications = [...data.notifications]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <section aria-label="Training centre metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Active Enrollments</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {activeEnrollments.length}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {data.students.length} students
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Mean Course Completion</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {avgCompletion}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {data.courses.length} active courses
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Centre Attendance Rate</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {attendanceStats.rate}%
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Nominal
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Upcoming Sessions</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {upcomingSessions.length}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {data.notifications.length} alerts sent
            </span>
          </div>
        </div>
      </section>

      {/* Course Cohort Summary + Upcoming Sessions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Course Progress Summary
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Active cohorts, module completion, and assigned leads
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('courses')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Manage Tracking</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Course</th>
                  <th className="py-2.5 px-4">Track</th>
                  <th className="py-2.5 px-4 text-right">Enrolled</th>
                  <th className="py-2.5 px-4 text-right">Modules</th>
                  <th className="py-2.5 px-5 text-right">Avg Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {data.courses.map((course) => {
                  const courseEnr = data.enrollments.filter(
                    (e) => e.courseId === course.id && !isInactiveEnrollmentStatus(e.status)
                  );
                  const courseCompletion =
                    courseEnr.length > 0
                      ? Math.round(
                          courseEnr.reduce(
                            (acc, e) =>
                              acc +
                              calculateCourseCompletion(
                                e.completedModuleIds,
                                course.modules.length
                              ),
                            0
                          ) / courseEnr.length
                        )
                      : 0;
                  return (
                    <tr key={course.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{course.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">{course.code}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{course.instructorName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {course.track}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {courseEnr.length}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {course.modules.length}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                          {courseCompletion}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Upcoming Training Labs */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Upcoming Class Sessions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Next scheduled lab sessions
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('schedules')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>All Sessions</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 flex-1">
            {upcomingSessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No upcoming sessions scheduled.
              </div>
            ) : (
              upcomingSessions.map((session) => {
                const course = data.courses.find((c) => c.id === session.courseId);
                const start = new Date(session.startIso);
                return (
                  <div key={session.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {session.title}
                      </p>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                        {course?.code}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="tabular-nums">
                          {start.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          ·{' '}
                          {start.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{session.room}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Recent Automated Notifications Log + Quick Actions */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BellRing className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Automated Notification Dispatch Log
              </h2>
              <p className="text-xs text-slate-500">
                Recent attendance alerts, 24-hour session reminders, and grade notices
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('enrollments')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Enrollments</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Mark Attendance</span>
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {recentNotifications.map((notif) => {
            const recipient = data.students.find((s) => s.id === notif.userId);
            return (
              <div
                key={notif.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-800">
                      {recipient?.name ?? 'Student'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{notif.title}</span>
                  </div>
                  <p className="text-sm text-slate-700 mt-0.5">{notif.message}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                  {new Date(notif.createdAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
