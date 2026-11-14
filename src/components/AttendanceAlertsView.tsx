import React, { useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock,
  Send,
  XCircle,
} from 'lucide-react';
import { isInactiveEnrollmentStatus } from '../shared/academic';
import type { AttendanceStatus, DashboardPayload } from '../shared/types';

interface AttendanceAlertsViewProps {
  data: DashboardPayload;
  onMarkAttendance: (payload: {
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    note: string;
  }) => Promise<void>;
  onRunReminders: () => Promise<number>;
}

export function AttendanceAlertsView({
  data,
  onMarkAttendance,
  onRunReminders,
}: AttendanceAlertsViewProps) {
  const sortedSessions = [...data.sessions].sort(
    (a, b) => Date.parse(b.startIso) - Date.parse(a.startIso)
  );
  const [selectedSessionId, setSelectedSessionId] = useState(
    sortedSessions[0]?.id ?? ''
  );
  const [notesByStudent, setNotesByStudent] = useState<Record<string, string>>({});
  const [statusBanner, setStatusBanner] = useState('');
  const [runningSweep, setRunningSweep] = useState(false);

  const selectedSession =
    sortedSessions.find((s) => s.id === selectedSessionId) ?? sortedSessions[0];

  const course = selectedSession
    ? data.courses.find((c) => c.id === selectedSession.courseId)
    : undefined;

  const rosterEnrollments = selectedSession
    ? data.enrollments.filter(
        (e) =>
          e.courseId === selectedSession.courseId &&
          e.cohort === selectedSession.cohort &&
          !isInactiveEnrollmentStatus(e.status)
      )
    : [];

  async function handleStatusClick(studentId: string, status: AttendanceStatus) {
    if (!selectedSession) return;
    const student = data.students.find((s) => s.id === studentId);
    const note = notesByStudent[studentId] ?? '';
    await onMarkAttendance({
      sessionId: selectedSession.id,
      studentId,
      status,
      note,
    });
    setStatusBanner(
      `Attendance saved as ${status} for ${student?.name ?? 'student'} — automated notification dispatched.`
    );
  }

  async function handleRunReminderSweep() {
    setRunningSweep(true);
    try {
      const count = await onRunReminders();
      setStatusBanner(
        count > 0
          ? `Automated sweep complete: dispatched ${count} upcoming 24-hour session reminder${count === 1 ? '' : 's'}.`
          : 'Automated sweep checked all upcoming sessions within 24 hours — all enrolled students already notified.'
      );
    } finally {
      setRunningSweep(false);
    }
  }

  const recentAlerts = [...data.notifications]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Automated Reminder Sweep & Session Selector */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="flex-1 max-w-xl">
            <label
              htmlFor="attendance-session-select"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Select Training Session for Attendance Roll
            </label>
            <select
              id="attendance-session-select"
              value={selectedSession?.id ?? ''}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setStatusBanner('');
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {sortedSessions.map((s) => {
                const c = data.courses.find((cr) => cr.id === s.courseId);
                const dt = new Date(s.startIso).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                return (
                  <option key={s.id} value={s.id}>
                    {c?.code ?? ''} · {s.title} ({dt} · {s.room})
                  </option>
                );
              })}
            </select>
          </div>

          <button
            type="button"
            onClick={handleRunReminderSweep}
            disabled={runningSweep}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {runningSweep ? 'Running Sweep...' : 'Send Upcoming Session Reminders'}
            </span>
          </button>
        </div>

        {statusBanner && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{statusBanner}</span>
          </div>
        )}
      </section>

      {/* Attendance Roster Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {selectedSession ? selectedSession.title : 'Session Roster'}
            </h2>
            {selectedSession && (
              <p className="text-xs text-slate-500 mt-0.5">
                {course?.code} · {selectedSession.cohort} · {selectedSession.room} · Updating status automatically sends an alert to the student
              </p>
            )}
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {rosterEnrollments.length} enrolled students
          </span>
        </div>

        {rosterEnrollments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No students enrolled in this session&apos;s cohort.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Student</th>
                  <th className="py-2.5 px-4">Current Record</th>
                  <th className="py-2.5 px-4">Optional Note</th>
                  <th className="py-2.5 px-5 text-right">Mark Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {rosterEnrollments.map((enr) => {
                  const student = data.students.find((s) => s.id === enr.studentId);
                  if (!student) return null;

                  const record = data.attendance.find(
                    (a) =>
                      a.sessionId === selectedSession?.id &&
                      a.studentId === student.id
                  );

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">
                          {student.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">
                          {student.studentCode ?? student.email}
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {record ? (
                          record.status === 'Present' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Present
                            </span>
                          ) : record.status === 'Late' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                              <Clock className="w-3.5 h-3.5" />
                              Late
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                              <XCircle className="w-3.5 h-3.5" />
                              Absent
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">Unmarked</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <input
                          type="text"
                          aria-label={`Attendance note for ${student.name}`}
                          value={notesByStudent[student.id] ?? record?.note ?? ''}
                          onChange={(e) =>
                            setNotesByStudent((prev) => ({
                              ...prev,
                              [student.id]: e.target.value,
                            }))
                          }
                          placeholder="Add optional note..."
                          className="w-full min-w-[160px] px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                        />
                      </td>

                      <td className="py-3 px-5 text-right">
                        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                          {(['Present', 'Late', 'Absent'] as const).map((st) => {
                            const active = record?.status === st;
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() => handleStatusClick(student.id, st)}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                                  active
                                    ? st === 'Present'
                                      ? 'bg-emerald-700 text-white'
                                      : st === 'Late'
                                        ? 'bg-amber-600 text-white'
                                        : 'bg-red-700 text-white'
                                    : 'text-slate-700 hover:bg-white'
                                }`}
                              >
                                {st}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Automated Dispatch Feed */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <BellRing className="w-4 h-4 text-blue-700" />
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Recent Automated Student Notifications
          </h2>
        </div>

        <div className="divide-y divide-slate-200">
          {recentAlerts.map((n) => {
            const student = data.students.find((s) => s.id === n.userId);
            return (
              <div
                key={n.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-900">
                      {student?.name ?? 'Student'}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{n.title}</span>
                  </div>
                  <p className="text-sm text-slate-700 mt-0.5">{n.message}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                  {new Date(n.createdAt).toLocaleString('en-US', {
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
