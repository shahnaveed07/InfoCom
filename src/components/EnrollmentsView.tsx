import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
} from '../shared/academic';
import type { DashboardPayload, EnrollmentStatus } from '../shared/types';

interface EnrollmentsViewProps {
  data: DashboardPayload;
  onCreateEnrollment: (payload: {
    studentId: string;
    courseId: string;
    cohort: string;
    status: 'Active' | 'Waitlisted';
    issueTuitionInvoice?: boolean;
  }) => Promise<void>;
  onUpdateStatus: (enrollmentId: string, status: EnrollmentStatus) => Promise<void>;
}

export function EnrollmentsView({
  data,
  onCreateEnrollment,
  onUpdateStatus,
}: EnrollmentsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | EnrollmentStatus>('All');
  const [modalOpen, setModalOpen] = useState(false);

  const [studentId, setStudentId] = useState(data.students[0]?.id ?? '');
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const [cohort, setCohort] = useState(
    data.cohorts[0]?.name ?? 'Cohort A · Autumn'
  );
  const isAdmin = data.user.role === 'admin';
  const [newStatus, setNewStatus] = useState<'Active' | 'Waitlisted'>('Active');
  const [issueTuitionInvoice, setIssueTuitionInvoice] = useState(isAdmin);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.enrollments.filter((enr) => {
      if (statusFilter !== 'All' && enr.status !== statusFilter) return false;
      if (!q) return true;
      const student = data.students.find((s) => s.id === enr.studentId);
      const course = data.courses.find((c) => c.id === enr.courseId);
      const text = `${student?.name ?? ''} ${student?.studentCode ?? ''} ${course?.code ?? ''} ${course?.title ?? ''} ${enr.cohort}`.toLowerCase();
      return text.includes(q);
    });
  }, [data.enrollments, data.students, data.courses, search, statusFilter]);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!studentId || !courseId || !cohort.trim()) {
      setFormError('Please select a student, course, and cohort.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateEnrollment({
        studentId,
        courseId,
        cohort: cohort.trim(),
        status: newStatus,
        issueTuitionInvoice: isAdmin ? issueTuitionInvoice : false,
      });
      setModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not create enrollment.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function renderStatusLabel(status: EnrollmentStatus) {
    if (status === 'Active') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Active
        </span>
      );
    }
    if (status === 'Completed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Completed
        </span>
      );
    }
    if (status === 'Waitlisted') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <Clock className="w-3.5 h-3.5" />
          Waitlisted
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
        <XCircle className="w-3.5 h-3.5" />
        Dropped
      </span>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="enrollment-search" className="sr-only">
              Search enrollments
            </label>
            <input
              id="enrollment-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student, ID, or course..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
            role="group"
            aria-label="Filter enrollments by status"
          >
            {(['All', 'Active', 'Completed', 'Waitlisted', 'Dropped'] as const).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    statusFilter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              )
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Enroll Student</span>
        </button>
      </div>

      {/* Enrollments Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Student Roster & Course Enrollments
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filtered.length} of {data.enrollments.length} records
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              No enrollments match the current filter.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Clear your search query or switch the status filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('All');
              }}
              className="mt-4 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Student</th>
                  <th className="py-2.5 px-4">Course & Cohort</th>
                  <th className="py-2.5 px-4 text-right">Completion</th>
                  <th className="py-2.5 px-4 text-right">Attendance</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Update Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((enr) => {
                  const student = data.students.find((s) => s.id === enr.studentId);
                  const course = data.courses.find((c) => c.id === enr.courseId);
                  const completion = calculateCourseCompletion(
                    enr.completedModuleIds,
                    course?.modules.length ?? 0
                  );
                  const attRecords = data.attendance.filter(
                    (a) => a.studentId === enr.studentId && a.courseId === enr.courseId
                  );
                  const attStats = calculateAttendanceStats(attRecords);

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">
                          {student?.name ?? 'Unknown Student'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">
                            {student?.studentCode ?? enr.studentId}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{student?.email}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">
                          {course?.title ?? enr.courseId}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">{course?.code}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{enr.cohort}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {completion}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {attStats.rate}%
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {renderStatusLabel(enr.status)}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <select
                          aria-label={`Change enrollment status for ${student?.name ?? 'student'} in ${course?.code ?? 'course'}`}
                          value={enr.status}
                          onChange={(e) =>
                            onUpdateStatus(enr.id, e.target.value as EnrollmentStatus)
                          }
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                        >
                          <option value="Active">Active</option>
                          <option value="Completed">Completed</option>
                          <option value="Waitlisted">Waitlisted</option>
                          <option value="Dropped">Dropped</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Enroll Student Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="enroll-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-700" />
                <h3
                  id="enroll-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Enroll Student in Course
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close enroll modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="enroll-student"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Student
                </label>
                <select
                  id="enroll-student"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.studentCode ?? s.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="enroll-course"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Training Course
                </label>
                <select
                  id="enroll-course"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="enroll-cohort"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Cohort
                  </label>
                  <select
                    id="enroll-cohort"
                    value={cohort}
                    onChange={(e) => setCohort(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="Cohort A · Autumn">Cohort A · Autumn</option>
                    <option value="Cohort B · Autumn">Cohort B · Autumn</option>
                    <option value="Cohort C · Winter">Cohort C · Winter</option>
                    {data.cohorts
                      .filter(
                        (c) =>
                          ![
                            'Cohort A · Autumn',
                            'Cohort B · Autumn',
                            'Cohort C · Winter',
                          ].includes(c.name)
                      )
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="enroll-status"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Initial Status
                  </label>
                  <select
                    id="enroll-status"
                    value={newStatus}
                    onChange={(e) =>
                      setNewStatus(e.target.value as 'Active' | 'Waitlisted')
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="Active">Active</option>
                    <option value="Waitlisted">Waitlisted</option>
                  </select>
                </div>
              </div>

              {isAdmin && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={issueTuitionInvoice}
                    onChange={(e) => setIssueTuitionInvoice(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>Automatically issue course tuition fee invoice</span>
                </label>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {submitting ? 'Saving...' : 'Confirm Enrollment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
