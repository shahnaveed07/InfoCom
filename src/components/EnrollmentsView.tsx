import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  History,
  Plus,
  Search,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  getAllowedEnrollmentTransitions,
  isInactiveEnrollmentStatus,
  isTerminalEnrollmentStatus,
} from '../shared/academic';
import type {
  DashboardPayload,
  Enrollment,
  EnrollmentHistoryEntry,
  EnrollmentStatus,
} from '../shared/types';
import { api } from '../utils/api';

interface EnrollmentsViewProps {
  data: DashboardPayload;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

const ENROLLMENT_TABS: ReadonlyArray<'All' | EnrollmentStatus> = [
  'All',
  'Active',
  'Waitlisted',
  'Completed',
  'Cancelled',
  'Withdrawn',
  'Dropped',
];

export function EnrollmentsView({ data, onDashboardUpdate }: EnrollmentsViewProps) {
  const isAdmin = data.user.role === 'admin';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | EnrollmentStatus>('All');
  const [banner, setBanner] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  // Create Enrollment modal
  const [modalOpen, setModalOpen] = useState(false);
  const [studentId, setStudentId] = useState(data.students[0]?.id ?? '');
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const [cohortId, setCohortId] = useState('');
  const [cohortName, setCohortName] = useState('');
  const [newStatus, setNewStatus] = useState<'Active' | 'Waitlisted'>('Active');
  const [issueTuitionInvoice, setIssueTuitionInvoice] = useState(isAdmin);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Status Transition modal
  const [statusModal, setStatusModal] = useState<{
    enrollment: Enrollment;
    studentName: string;
    courseCode: string;
    nextStatus: EnrollmentStatus;
  } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);

  // Batch Transfer modal
  const [batchTransferTarget, setBatchTransferTarget] = useState<Enrollment | null>(null);
  const [toBatchId, setToBatchId] = useState('');
  const [batchTransferReason, setBatchTransferReason] = useState('');
  const [batchTransferError, setBatchTransferError] = useState('');
  const [batchTransferBusy, setBatchTransferBusy] = useState(false);

  // Course Transfer modal
  const [courseTransferTarget, setCourseTransferTarget] = useState<Enrollment | null>(null);
  const [toCourseId, setToCourseId] = useState('');
  const [toCourseBatchId, setToCourseBatchId] = useState('');
  const [toCourseStatus, setToCourseStatus] = useState<'Active' | 'Waitlisted'>('Active');
  const [toCourseInvoice, setToCourseInvoice] = useState(false);
  const [courseTransferReason, setCourseTransferReason] = useState('');
  const [courseTransferError, setCourseTransferError] = useState('');
  const [courseTransferBusy, setCourseTransferBusy] = useState(false);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyHeader, setHistoryHeader] = useState<{
    studentName: string;
    studentCode: string | null;
    courseCode: string;
    courseTitle: string;
    cohort: string;
    status: EnrollmentStatus;
  } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<EnrollmentHistoryEntry[]>([]);

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

  const batchesForNewCourse = useMemo(
    () =>
      data.cohorts.filter(
        (b) => b.courseId === courseId && b.status !== 'Archived' && b.status !== 'Completed'
      ),
    [data.cohorts, courseId]
  );

  const sameCourseTransferBatches = useMemo(() => {
    if (!batchTransferTarget) return [];
    return data.cohorts.filter(
      (b) =>
        b.courseId === batchTransferTarget.courseId &&
        b.id !== batchTransferTarget.cohortId &&
        b.status !== 'Archived' &&
        b.status !== 'Completed'
    );
  }, [data.cohorts, batchTransferTarget]);

  const targetCourseBatches = useMemo(
    () =>
      data.cohorts.filter(
        (b) => b.courseId === toCourseId && b.status !== 'Archived' && b.status !== 'Completed'
      ),
    [data.cohorts, toCourseId]
  );

  function countSeats(batchId: string, courseIdParam: string, batchName: string): number {
    return data.enrollments.filter(
      (e) =>
        e.courseId === courseIdParam &&
        (e.cohortId === batchId || e.cohort === batchName) &&
        !isInactiveEnrollmentStatus(e.status)
    ).length;
  }

  function openNewModal() {
    const defaultCourseId = data.courses[0]?.id ?? '';
    const defaultBatch = data.cohorts.find(
      (b) => b.courseId === defaultCourseId && b.status !== 'Archived' && b.status !== 'Completed'
    );
    setStudentId(data.students[0]?.id ?? '');
    setCourseId(defaultCourseId);
    setCohortId(defaultBatch?.id ?? '');
    setCohortName(defaultBatch?.name ?? 'Cohort A · Autumn');
    setNewStatus('Active');
    setIssueTuitionInvoice(isAdmin);
    setFormError('');
    setModalOpen(true);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const matchedBatch = data.cohorts.find((b) => b.id === cohortId);
    const resolvedCohort = matchedBatch?.name ?? cohortName.trim();
    if (!studentId || !courseId || !resolvedCohort) {
      setFormError('Please select a student, course, and batch/cohort.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createEnrollment({
        studentId,
        courseId,
        cohort: resolvedCohort,
        cohortId: matchedBatch?.id,
        status: newStatus,
        issueTuitionInvoice: isAdmin ? issueTuitionInvoice : false,
      });
      onDashboardUpdate(res.dashboard);
      setModalOpen(false);
      setBanner('Enrollment recorded.');
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not create enrollment.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmStatusChange(e: React.FormEvent) {
    e.preventDefault();
    if (!statusModal) return;
    setStatusBusy(true);
    setErrorBanner('');
    setBanner('');
    try {
      const res = await api.updateEnrollmentStatus(
        statusModal.enrollment.id,
        statusModal.nextStatus,
        statusReason.trim() || undefined
      );
      onDashboardUpdate(res.dashboard);
      setBanner(
        `Updated ${statusModal.studentName} (${statusModal.courseCode}) to ${statusModal.nextStatus}.`
      );
      setStatusModal(null);
      setStatusReason('');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not update enrollment status.'
      );
    } finally {
      setStatusBusy(false);
    }
  }

  function openBatchTransfer(enr: Enrollment) {
    const candidates = data.cohorts.filter(
      (b) =>
        b.courseId === enr.courseId &&
        b.id !== enr.cohortId &&
        b.status !== 'Archived' &&
        b.status !== 'Completed'
    );
    setBatchTransferTarget(enr);
    setToBatchId(candidates[0]?.id ?? '');
    setBatchTransferReason('');
    setBatchTransferError('');
  }

  async function handleBatchTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchTransferTarget || !toBatchId) return;
    setBatchTransferBusy(true);
    setBatchTransferError('');
    try {
      const res = await api.transferEnrollment(batchTransferTarget.id, {
        toBatchId,
        reason: batchTransferReason.trim(),
      });
      onDashboardUpdate(res.dashboard);
      setBatchTransferTarget(null);
      setBanner('Batch transfer completed and recorded in enrollment history.');
    } catch (err) {
      setBatchTransferError(
        err instanceof Error ? err.message : 'Failed to transfer batch.'
      );
    } finally {
      setBatchTransferBusy(false);
    }
  }

  function openCourseTransfer(enr: Enrollment) {
    const otherCourses = data.courses.filter((c) => c.id !== enr.courseId && !c.isArchived);
    const defaultCourse = otherCourses[0]?.id ?? '';
    const defaultBatch = data.cohorts.find(
      (b) => b.courseId === defaultCourse && b.status !== 'Archived' && b.status !== 'Completed'
    );
    setCourseTransferTarget(enr);
    setToCourseId(defaultCourse);
    setToCourseBatchId(defaultBatch?.id ?? '');
    setToCourseStatus('Active');
    setToCourseInvoice(false);
    setCourseTransferReason('');
    setCourseTransferError('');
  }

  async function handleCourseTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!courseTransferTarget || !toCourseId || !toCourseBatchId) {
      setCourseTransferError('Select both destination course and batch.');
      return;
    }
    setCourseTransferBusy(true);
    setCourseTransferError('');
    try {
      const res = await api.transferEnrollmentCourse(courseTransferTarget.id, {
        toCourseId,
        toBatchId: toCourseBatchId,
        reason: courseTransferReason.trim(),
        status: toCourseStatus,
        issueTuitionInvoice: isAdmin ? toCourseInvoice : false,
      });
      onDashboardUpdate(res.dashboard);
      setCourseTransferTarget(null);
      setBanner('Course transfer processed and audited in enrollment history.');
    } catch (err) {
      setCourseTransferError(
        err instanceof Error ? err.message : 'Failed to transfer course.'
      );
    } finally {
      setCourseTransferBusy(false);
    }
  }

  async function openHistoryModal(enr: Enrollment) {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryHeader(null);
    setHistoryEntries([]);
    try {
      const res = await api.fetchEnrollmentHistory(enr.id);
      setHistoryHeader({
        studentName: res.enrollment.studentName,
        studentCode: res.enrollment.studentCode,
        courseCode: res.enrollment.courseCode,
        courseTitle: res.enrollment.courseTitle,
        cohort: res.enrollment.cohort,
        status: res.enrollment.status,
      });
      setHistoryEntries(res.history);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : 'Failed to load enrollment history.'
      );
    } finally {
      setHistoryLoading(false);
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
        {status}
      </span>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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
              placeholder="Search student, ID, course, or batch..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Enroll Student</span>
          </button>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full"
          role="group"
          aria-label="Filter enrollments by status"
        >
          {ENROLLMENT_TABS.map((tab) => (
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
          ))}
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{banner}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner('')}
            aria-label="Dismiss status notice"
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner('')}
            aria-label="Dismiss error"
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Enrollments Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Student Roster, Transfers & Enrollment Lifecycle
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
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Course & Batch</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Completion</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Attendance</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Lifecycle & History</th>
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
                  const allowedNext = getAllowedEnrollmentTransitions(enr.status);
                  const terminal = isTerminalEnrollmentStatus(enr.status);

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 min-w-[200px]">
                        <div className="font-medium text-slate-900">
                          {student?.name ?? 'Unknown Student'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                          <span className="font-mono whitespace-nowrap">
                            {student?.studentCode ?? enr.studentId}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-[180px]">{student?.email}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 min-w-[190px]">
                        <div className="font-medium text-slate-800">
                          {course?.title ?? enr.courseId}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                          <span className="font-mono whitespace-nowrap">{course?.code}</span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">{enr.cohort}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-slate-900 tabular-nums whitespace-nowrap">
                        {completion}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {attStats.rate}%
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {renderStatusLabel(enr.status)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {!terminal && allowedNext.length > 0 && (
                            <select
                              aria-label={`Change enrollment status for ${student?.name ?? 'student'} in ${course?.code ?? 'course'}`}
                              value=""
                              onChange={(e) => {
                                const next = e.target.value as EnrollmentStatus;
                                if (!next) return;
                                setStatusReason('');
                                setStatusModal({
                                  enrollment: enr,
                                  studentName: student?.name ?? enr.studentId,
                                  courseCode: course?.code ?? enr.courseId,
                                  nextStatus: next,
                                });
                              }}
                              className="max-w-[136px] px-2 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                            >
                              <option value="">Change status...</option>
                              {allowedNext.map((s) => (
                                <option key={s} value={s}>
                                  Mark {s}
                                </option>
                              ))}
                            </select>
                          )}

                          {!terminal && isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openBatchTransfer(enr)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
                              >
                                <ArrowRightLeft className="w-3 h-3" />
                                <span>Batch</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openCourseTransfer(enr)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer whitespace-nowrap"
                              >
                                <ArrowLeftRight className="w-3 h-3" />
                                <span>Course</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => void openHistoryModal(enr)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <History className="w-3 h-3" />
                            <span>History</span>
                          </button>
                        </div>
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
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
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
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
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
                  onChange={(e) => {
                    const nextC = e.target.value;
                    setCourseId(nextC);
                    const b = data.cohorts.find(
                      (c) => c.courseId === nextC && c.status !== 'Archived' && c.status !== 'Completed'
                    );
                    setCohortId(b?.id ?? '');
                    setCohortName(b?.name ?? 'Cohort A · Autumn');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
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
                    Batch / Cohort
                  </label>
                  <select
                    id="enroll-cohort"
                    value={cohortId || cohortName}
                    onChange={(e) => {
                      const val = e.target.value;
                      const b = batchesForNewCourse.find((c) => c.id === val);
                      if (b) {
                        setCohortId(b.id);
                        setCohortName(b.name);
                      } else {
                        setCohortId('');
                        setCohortName(val);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    {batchesForNewCourse.map((b) => {
                      const used = countSeats(b.id, b.courseId, b.name);
                      return (
                        <option key={b.id} value={b.id}>
                          {b.name} ({used}/{b.capacity})
                        </option>
                      );
                    })}
                    {batchesForNewCourse.length === 0 && (
                      <option value="Cohort A · Autumn">Cohort A · Autumn</option>
                    )}
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
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
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

      {/* Status Transition Reason Modal */}
      {statusModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="enr-status-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 id="enr-status-modal-title" className="font-display text-base font-semibold text-slate-900">
                Transition Enrollment to {statusModal.nextStatus}
              </h3>
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                aria-label="Close status transition modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmStatusChange} className="mt-4 space-y-4">
              <p className="text-xs text-slate-600">
                Student <strong className="text-slate-900">{statusModal.studentName}</strong> in{' '}
                <strong className="text-slate-900">{statusModal.courseCode}</strong> will transition from{' '}
                <span className="font-semibold">{statusModal.enrollment.status}</span> to{' '}
                <span className="font-semibold">{statusModal.nextStatus}</span>.
                {isTerminalEnrollmentStatus(statusModal.nextStatus) &&
                  ' This is a terminal status and frees the batch seat.'}
              </p>
              <div>
                <label htmlFor="enr-status-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Reason / Audit Note
                </label>
                <textarea
                  id="enr-status-reason"
                  rows={2}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="Optional note recorded in enrollment history..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStatusModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusBusy}
                  className={`px-4 py-2 text-xs font-medium text-white rounded-lg cursor-pointer ${
                    isInactiveEnrollmentStatus(statusModal.nextStatus)
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-blue-700 hover:bg-blue-800'
                  }`}
                >
                  {statusBusy ? 'Saving...' : `Confirm ${statusModal.nextStatus}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Transfer Modal */}
      {batchTransferTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-transfer-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-blue-700" />
                <h3 id="batch-transfer-title" className="font-display text-base font-semibold text-slate-900">
                  Transfer Student to Another Batch
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBatchTransferTarget(null)}
                aria-label="Close batch transfer modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {batchTransferError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{batchTransferError}</span>
              </div>
            )}

            <form onSubmit={handleBatchTransferSubmit} className="mt-4 space-y-4">
              <div className="text-xs text-slate-600">
                Current Batch: <strong className="text-slate-900">{batchTransferTarget.cohort}</strong>
              </div>

              {sameCourseTransferBatches.length === 0 ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  No other active batches exist for this course. Create another batch in Batch Cohorts first or use Course Transfer.
                </p>
              ) : (
                <>
                  <div>
                    <label htmlFor="bt-target" className="block text-xs font-medium text-slate-700 mb-1">
                      Destination Batch
                    </label>
                    <select
                      id="bt-target"
                      value={toBatchId}
                      onChange={(e) => setToBatchId(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      {sameCourseTransferBatches.map((b) => {
                        const used = countSeats(b.id, b.courseId, b.name);
                        return (
                          <option key={b.id} value={b.id}>
                            {b.code} — {b.name} ({used}/{b.capacity} seats)
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bt-reason" className="block text-xs font-medium text-slate-700 mb-1">
                      Transfer Reason
                    </label>
                    <input
                      id="bt-reason"
                      type="text"
                      required
                      minLength={3}
                      value={batchTransferReason}
                      onChange={(e) => setBatchTransferReason(e.target.value)}
                      placeholder="Schedule conflict / cohort rebalancing"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBatchTransferTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                {sameCourseTransferBatches.length > 0 && (
                  <button
                    type="submit"
                    disabled={batchTransferBusy}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                  >
                    {batchTransferBusy ? 'Transferring...' : 'Confirm Batch Transfer'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Course Transfer Modal */}
      {courseTransferTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-transfer-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-blue-700" />
                <h3 id="course-transfer-title" className="font-display text-base font-semibold text-slate-900">
                  Transfer Enrollment to Another Course
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCourseTransferTarget(null)}
                aria-label="Close course transfer modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {courseTransferError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{courseTransferError}</span>
              </div>
            )}

            <form onSubmit={handleCourseTransferSubmit} className="mt-4 space-y-4">
              <p className="text-xs text-slate-600">
                Marks the current enrollment as <strong className="text-slate-900">Withdrawn</strong> and creates a new enrollment in the destination course and batch, preserving full audit history.
              </p>

              <div>
                <label htmlFor="ct-course" className="block text-xs font-medium text-slate-700 mb-1">
                  Destination Course
                </label>
                <select
                  id="ct-course"
                  value={toCourseId}
                  onChange={(e) => {
                    const nextC = e.target.value;
                    setToCourseId(nextC);
                    const b = data.cohorts.find(
                      (c) => c.courseId === nextC && c.status !== 'Archived' && c.status !== 'Completed'
                    );
                    setToCourseBatchId(b?.id ?? '');
                  }}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {data.courses
                    .filter((c) => c.id !== courseTransferTarget.courseId && !c.isArchived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ct-batch" className="block text-xs font-medium text-slate-700 mb-1">
                    Destination Batch
                  </label>
                  <select
                    id="ct-batch"
                    value={toCourseBatchId}
                    onChange={(e) => setToCourseBatchId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Select batch...</option>
                    {targetCourseBatches.map((b) => {
                      const used = countSeats(b.id, b.courseId, b.name);
                      return (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name} ({used}/{b.capacity})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label htmlFor="ct-status" className="block text-xs font-medium text-slate-700 mb-1">
                    New Enrollment Status
                  </label>
                  <select
                    id="ct-status"
                    value={toCourseStatus}
                    onChange={(e) =>
                      setToCourseStatus(e.target.value as 'Active' | 'Waitlisted')
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Active">Active</option>
                    <option value="Waitlisted">Waitlisted</option>
                  </select>
                </div>
              </div>

              {isAdmin && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={toCourseInvoice}
                    onChange={(e) => setToCourseInvoice(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Issue new tuition invoice for destination course</span>
                </label>
              )}

              <div>
                <label htmlFor="ct-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Transfer Reason (Required)
                </label>
                <textarea
                  id="ct-reason"
                  rows={2}
                  required
                  minLength={3}
                  value={courseTransferReason}
                  onChange={(e) => setCourseTransferReason(e.target.value)}
                  placeholder="Student requested program switch / prerequisite adjustment..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCourseTransferTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={courseTransferBusy || !toCourseBatchId}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {courseTransferBusy ? 'Transferring...' : 'Confirm Course Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enrollment History Drawer / Modal */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="enr-history-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-700" />
                <h3 id="enr-history-title" className="font-display text-base font-semibold text-slate-900">
                  Enrollment Audit History
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close enrollment history"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {historyError && (
              <div
                role="alert"
                className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                {historyError}
              </div>
            )}

            {historyLoading ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Loading enrollment history...
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {historyHeader && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs">
                    <div className="font-semibold text-slate-900">
                      {historyHeader.studentName}{' '}
                      <span className="font-mono text-slate-500">
                        ({historyHeader.studentCode || 'Student'})
                      </span>
                    </div>
                    <div className="text-slate-600 mt-1">
                      {historyHeader.courseCode} — {historyHeader.courseTitle} · {historyHeader.cohort} · Current Status:{' '}
                      <span className="font-semibold text-slate-900">{historyHeader.status}</span>
                    </div>
                  </div>
                )}

                {historyEntries.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No status or batch transfer events recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {historyEntries.map((entry) => (
                      <div key={entry.id} className="p-3.5 text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {entry.previousStatus
                              ? `${entry.previousStatus} -> ${entry.newStatus}`
                              : `Created (${entry.newStatus})`}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(entry.changedAt).toLocaleString('en-IN')}
                          </span>
                        </div>
                        {(entry.previousBatchName || entry.newBatchName) && (
                          <div className="text-slate-600">
                            Batch:{' '}
                            {entry.previousBatchName && entry.previousBatchName !== entry.newBatchName
                              ? `${entry.previousBatchName} -> ${entry.newBatchName ?? 'N/A'}`
                              : entry.newBatchName ?? entry.previousBatchName}
                          </div>
                        )}
                        {entry.reason && <div className="text-slate-700">{entry.reason}</div>}
                        <div className="text-[11px] text-slate-500">
                          Actor: {entry.changedByName || 'System'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
