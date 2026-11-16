import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock,
  Download,
  History,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { isInactiveEnrollmentStatus } from '../shared/academic';
import type {
  AttendanceAuditEntry,
  AttendanceStatus,
  DashboardPayload,
} from '../shared/types';
import { api } from '../utils/api';

interface AttendanceAlertsViewProps {
  data: DashboardPayload;
  onMarkAttendance: (payload: {
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    note: string;
  }) => Promise<void>;
  onBulkMarkAttendance: (payload: {
    sessionId: string;
    entries: Array<{ studentId: string; status: AttendanceStatus; note: string }>;
  }) => Promise<number>;
  onRunReminders: () => Promise<number>;
}

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'Present',
  'Late',
  'Absent',
  'Excused',
];

export function AttendanceAlertsView({
  data,
  onMarkAttendance,
  onBulkMarkAttendance,
  onRunReminders,
}: AttendanceAlertsViewProps) {
  const sortedSessions = [...data.sessions].sort(
    (a, b) => Date.parse(b.startIso) - Date.parse(a.startIso)
  );
  const [selectedSessionId, setSelectedSessionId] = useState(
    sortedSessions[0]?.id ?? ''
  );
  const [notesByStudent, setNotesByStudent] = useState<Record<string, string>>({});
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkDraftStatus, setBulkDraftStatus] = useState<
    Record<string, AttendanceStatus>
  >({});
  const [savingBulk, setSavingBulk] = useState(false);
  const [statusBanner, setStatusBanner] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  const [runningSweep, setRunningSweep] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'pdf' | null>(null);

  const [historyEntries, setHistoryEntries] = useState<AttendanceAuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const loadHistory = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setHistoryEntries([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await api.getAttendanceHistory(sessionId);
      setHistoryEntries(res.entries);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSession?.id) {
      loadHistory(selectedSession.id);
    }
  }, [selectedSession?.id, loadHistory]);

  async function handleStatusClick(studentId: string, status: AttendanceStatus) {
    if (!selectedSession) return;
    if (bulkMode) {
      setBulkDraftStatus((prev) => ({ ...prev, [studentId]: status }));
      return;
    }
    setErrorBanner('');
    const student = data.students.find((s) => s.id === studentId);
    const note = notesByStudent[studentId] ?? '';
    try {
      await onMarkAttendance({
        sessionId: selectedSession.id,
        studentId,
        status,
        note,
      });
      setStatusBanner(
        `Attendance saved as ${status} for ${student?.name ?? 'student'} — automated notification dispatched.`
      );
      await loadHistory(selectedSession.id);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to save attendance.'
      );
    }
  }

  async function handleMarkAllUnmarkedPresent() {
    if (!selectedSession) return;
    setErrorBanner('');
    setStatusBanner('');
    const unmarkedEntries = rosterEnrollments
      .filter(
        (enr) =>
          !data.attendance.some(
            (a) =>
              a.sessionId === selectedSession.id &&
              a.studentId === enr.studentId
          )
      )
      .map((enr) => ({
        studentId: enr.studentId,
        status: 'Present' as AttendanceStatus,
        note: notesByStudent[enr.studentId] ?? '',
      }));

    if (unmarkedEntries.length === 0) {
      setStatusBanner('All students in this session already have recorded attendance.');
      return;
    }

    setSavingBulk(true);
    try {
      const count = await onBulkMarkAttendance({
        sessionId: selectedSession.id,
        entries: unmarkedEntries,
      });
      setStatusBanner(
        `Bulk roll saved: marked ${count} unmarked student${count === 1 ? '' : 's'} Present and dispatched notifications.`
      );
      await loadHistory(selectedSession.id);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to save bulk attendance.'
      );
    } finally {
      setSavingBulk(false);
    }
  }

  async function handleSaveBulkDraft() {
    if (!selectedSession) return;
    setErrorBanner('');
    setStatusBanner('');

    const entries: Array<{
      studentId: string;
      status: AttendanceStatus;
      note: string;
    }> = [];

    for (const enr of rosterEnrollments) {
      const existing = data.attendance.find(
        (a) =>
          a.sessionId === selectedSession.id && a.studentId === enr.studentId
      );
      const nextStatus = bulkDraftStatus[enr.studentId] ?? existing?.status;
      if (!nextStatus) continue;
      const nextNote = notesByStudent[enr.studentId] ?? existing?.note ?? '';
      if (!existing || existing.status !== nextStatus || existing.note !== nextNote) {
        entries.push({
          studentId: enr.studentId,
          status: nextStatus,
          note: nextNote,
        });
      }
    }

    if (entries.length === 0) {
      setStatusBanner('No attendance changes detected in draft.');
      setBulkMode(false);
      return;
    }

    setSavingBulk(true);
    try {
      const count = await onBulkMarkAttendance({
        sessionId: selectedSession.id,
        entries,
      });
      setStatusBanner(
        `Bulk attendance saved for ${count} student${count === 1 ? '' : 's'} with audit trail & alerts.`
      );
      setBulkDraftStatus({});
      setBulkMode(false);
      await loadHistory(selectedSession.id);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to save bulk attendance.'
      );
    } finally {
      setSavingBulk(false);
    }
  }

  async function handleRunReminderSweep() {
    setRunningSweep(true);
    setErrorBanner('');
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
                setBulkDraftStatus({});
                setBulkMode(false);
                setStatusBanner('');
                setErrorBanner('');
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {sortedSessions.map((s) => {
                const c = data.courses.find((cr) => cr.id === s.courseId);
                const dt = new Date(s.startIso).toLocaleString('en-IN', {
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={async () => {
                setErrorBanner('');
                setExportingFormat('csv');
                try {
                  await api.downloadReport('attendance-summary', 'csv');
                } catch (err) {
                  setErrorBanner(
                    err instanceof Error ? err.message : 'Unable to export attendance CSV.'
                  );
                } finally {
                  setExportingFormat(null);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exportingFormat === 'csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={async () => {
                setErrorBanner('');
                setExportingFormat('pdf');
                try {
                  await api.downloadReport('attendance-summary', 'pdf');
                } catch (err) {
                  setErrorBanner(
                    err instanceof Error ? err.message : 'Unable to export attendance PDF.'
                  );
                } finally {
                  setExportingFormat(null);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exportingFormat === 'pdf' ? 'Generating...' : 'Export PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handleRunReminderSweep}
              disabled={runningSweep}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {runningSweep ? 'Running Sweep...' : 'Send Upcoming Session Reminders'}
              </span>
            </button>
          </div>
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

        {errorBanner && (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}
      </section>

      {/* Attendance Roster Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {selectedSession ? selectedSession.title : 'Session Roster'}
            </h2>
            {selectedSession && (
              <p className="text-xs text-slate-500 mt-0.5">
                {course?.code} · {selectedSession.cohort} · {selectedSession.room} ·{' '}
                {rosterEnrollments.length} enrolled · Excused absences do not penalize attendance rate
              </p>
            )}
          </div>

          {rosterEnrollments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingBulk}
                onClick={handleMarkAllUnmarkedPresent}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Mark All Unmarked Present</span>
              </button>

              {!bulkMode ? (
                <button
                  type="button"
                  onClick={() => {
                    const init: Record<string, AttendanceStatus> = {};
                    for (const enr of rosterEnrollments) {
                      const existing = data.attendance.find(
                        (a) =>
                          a.sessionId === selectedSession?.id &&
                          a.studentId === enr.studentId
                      );
                      if (existing) init[enr.studentId] = existing.status;
                    }
                    setBulkDraftStatus(init);
                    setBulkMode(true);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Bulk Edit Draft
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={savingBulk}
                    onClick={handleSaveBulkDraft}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    {savingBulk ? 'Saving Bulk...' : 'Save Bulk Attendance'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMode(false);
                      setBulkDraftStatus({});
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Cancel Draft
                  </button>
                </>
              )}
            </div>
          )}
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
                  <th className="py-2.5 px-5 text-right">
                    {bulkMode ? 'Draft Status' : 'Mark Attendance'}
                  </th>
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
                  const activeStatus = bulkMode
                    ? bulkDraftStatus[student.id] ?? record?.status
                    : record?.status;

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
                          ) : record.status === 'Excused' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Excused
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
                          {ATTENDANCE_STATUSES.map((st) => {
                            const active = activeStatus === st;
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
                                        : st === 'Excused'
                                          ? 'bg-blue-700 text-white'
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

      {/* Session Attendance Audit History */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Session Attendance Audit History
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {historyLoading ? 'Loading...' : `${historyEntries.length} events`}
          </span>
        </div>

        {historyEntries.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No attendance change logs recorded yet for this session.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 max-h-72 overflow-y-auto">
            {historyEntries.map((entry) => (
              <div
                key={entry.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs text-slate-700 font-medium">
                    {entry.studentName}{' '}
                    <span className="font-mono text-slate-500 ml-1">
                      ({entry.previousStatus ?? 'Unmarked'} → {entry.newStatus})
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Updated by {entry.actorEmail} ({entry.actorRole})
                    {entry.newNote ? ` · Note: ${entry.newNote}` : ''}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                  {new Date(entry.createdAt).toLocaleString('en-IN', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
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
                  {new Date(n.createdAt).toLocaleString('en-IN', {
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
