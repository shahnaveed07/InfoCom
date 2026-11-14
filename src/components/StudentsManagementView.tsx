import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  CheckCircle2,
  CreditCard,
  Edit3,
  FileText,
  FolderOpen,
  GraduationCap,
  Plus,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { formatCents, formatMoney } from '../shared/academic';
import type {
  DashboardPayload,
  PaginatedStudentsResult,
  StudentDetailPayload,
  StudentDirectoryRow,
  UserAccountStatus,
} from '../shared/types';
import { api } from '../utils/api';
import { ConfirmDialog } from './ConfirmDialog';

interface StudentsManagementViewProps {
  data: DashboardPayload;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

const STATUS_TEXT_COLOR: Record<UserAccountStatus, string> = {
  active: 'text-emerald-700',
  inactive: 'text-slate-600',
  suspended: 'text-amber-700',
  archived: 'text-red-700',
};

export function StudentsManagementView({
  data,
  onDashboardUpdate,
}: StudentsManagementViewProps) {
  const currency = data.academy?.currency || 'USD';
  const departments = data.departments ?? [];

  // Directory query state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'name' | 'studentCode'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [directory, setDirectory] = useState<PaginatedStudentsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Profile detail state
  const [selectedDetail, setSelectedDetail] = useState<StudentDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'academics' | 'documents' | 'fees'>('academics');

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cDeptId, setCDeptId] = useState('');
  const [cDob, setCDob] = useState('');
  const [cEmergency, setCEmergency] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cStanding, setCStanding] = useState('Good Standing');
  const [cCourseId, setCCourseId] = useState('');
  const [cCohortId, setCCohortId] = useState('');
  const [cError, setCError] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<StudentDirectoryRow | null>(null);
  const [eName, setEName] = useState('');
  const [eEmail, setEEmail] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eStatus, setEStatus] = useState<UserAccountStatus>('active');
  const [eDeptId, setEDeptId] = useState('');
  const [eDob, setEDob] = useState('');
  const [eEmergency, setEEmergency] = useState('');
  const [eAddress, setEAddress] = useState('');
  const [eStanding, setEStanding] = useState('Good Standing');
  const [eError, setEError] = useState('');
  const [eSaving, setESaving] = useState(false);

  // Archive / Restore dialog
  const [confirmRow, setConfirmRow] = useState<StudentDirectoryRow | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listStudents({
        page,
        pageSize: 10,
        search: search.trim() || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        courseId: courseFilter !== 'all' ? courseFilter : undefined,
        sortBy,
        sortDir,
      });
      setDirectory(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load students.');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, courseFilter, sortBy, sortDir]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  async function openStudentDetail(studentId: string) {
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api.getStudentDetail(studentId);
      setSelectedDetail(detail);
      setDetailTab('academics');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load student profile.');
    } finally {
      setDetailLoading(false);
    }
  }

  function openEditModal(row: StudentDirectoryRow) {
    setEditTarget(row);
    setEName(row.user.name);
    setEEmail(row.user.email);
    setEPhone(row.user.phone ?? '');
    setEStatus(row.user.status);
    setEDeptId(row.profile?.departmentId ?? '');
    setEDob(row.profile?.dateOfBirth ? row.profile.dateOfBirth.slice(0, 10) : '');
    setEEmergency(row.profile?.emergencyContact ?? '');
    setEAddress(row.profile?.address ?? '');
    setEStanding(row.profile?.academicStanding ?? 'Good Standing');
    setEError('');
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCError('');
    setCSaving(true);
    try {
      const res = await api.createStudent({
        name: cName.trim(),
        email: cEmail.trim(),
        phone: cPhone.trim(),
        password: cPassword,
        departmentId: cDeptId || null,
        dateOfBirth: cDob || null,
        address: cAddress.trim(),
        emergencyContact: cEmergency.trim(),
        academicStanding: cStanding.trim() || 'Good Standing',
        initialCourseId: cCourseId || undefined,
        initialCohortId: cCohortId || undefined,
      });
      onDashboardUpdate(res.dashboard);
      setCreateOpen(false);
      setCName('');
      setCEmail('');
      setCPhone('');
      setCPassword('');
      setCDob('');
      setCEmergency('');
      setCAddress('');
      setCCourseId('');
      setCCohortId('');
      setNotice(`Student ${res.student.name} (${res.student.studentCode}) created.`);
      await loadDirectory();
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Unable to create student.');
    } finally {
      setCSaving(false);
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEError('');
    setESaving(true);
    try {
      const res = await api.updateStudent(editTarget.user.id, {
        name: eName.trim(),
        email: eEmail.trim(),
        phone: ePhone.trim(),
        status: eStatus,
        departmentId: eDeptId || null,
        dateOfBirth: eDob || null,
        address: eAddress.trim(),
        emergencyContact: eEmergency.trim(),
        academicStanding: eStanding.trim(),
      });
      onDashboardUpdate(res.dashboard);
      if (selectedDetail?.student.user.id === editTarget.user.id) {
        setSelectedDetail(res.detail);
      }
      setEditTarget(null);
      setNotice(`Updated student profile for ${eName.trim()}.`);
      await loadDirectory();
    } catch (err) {
      setEError(err instanceof Error ? err.message : 'Unable to update student.');
    } finally {
      setESaving(false);
    }
  }

  async function handleConfirmStatusToggle() {
    if (!confirmRow) return;
    setConfirmBusy(true);
    const nextStatus: UserAccountStatus =
      confirmRow.user.status === 'archived' ? 'active' : 'archived';
    try {
      const res = await api.updateStudent(confirmRow.user.id, { status: nextStatus });
      onDashboardUpdate(res.dashboard);
      if (selectedDetail?.student.user.id === confirmRow.user.id) {
        setSelectedDetail(res.detail);
      }
      setNotice(
        `${confirmRow.user.name} is now ${nextStatus}.`
      );
      setConfirmRow(null);
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change student status.');
    } finally {
      setConfirmBusy(false);
    }
  }

  const courseCohorts = data.cohorts.filter(
    (coh) => !cCourseId || coh.courseId === cCourseId
  );

  // Profile Detail View
  if (selectedDetail) {
    const { student, enrollments, enrollmentHistory, documents, feeStatement } =
      selectedDetail;
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setSelectedDetail(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Directory</span>
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {student.user.name}
                </h2>
                <span className="font-mono text-xs text-blue-700 font-semibold">
                  {student.user.studentCode}
                </span>
                <span
                  className={`text-xs font-semibold capitalize ${STATUS_TEXT_COLOR[student.user.status]}`}
                >
                  {student.user.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {student.user.email}
                {student.user.phone ? ` · ${student.user.phone}` : ''}
                {student.profile?.departmentName
                  ? ` · ${student.profile.departmentName}`
                  : ''}
                {student.profile?.academicStanding
                  ? ` · Standing: ${student.profile.academicStanding}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openEditModal(student)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmRow(student)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap ${
                student.user.status === 'archived'
                  ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                  : 'text-red-700 bg-red-50 border border-red-200 hover:bg-red-100'
              }`}
            >
              {student.user.status === 'archived' ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Student</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive Student</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Active Enrollments</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {student.activeEnrollmentsCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Attendance Rate</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {student.attendanceRate}%
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Tuition Billed / Paid</div>
            <div className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">
              {formatCents(feeStatement.totalPaidCents, currency)} /{' '}
              {formatCents(feeStatement.totalBilledCents, currency)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Outstanding Fees</div>
            <div className="mt-1 font-mono text-xl font-semibold text-amber-700 tabular-nums">
              {formatCents(feeStatement.outstandingCents, currency)}
            </div>
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div
            role="tablist"
            aria-label="Student profile sections"
            className="border-b border-slate-200 px-4 flex flex-wrap gap-2 bg-slate-50/70"
          >
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'academics'}
              onClick={() => setDetailTab('academics')}
              className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                detailTab === 'academics'
                  ? 'border-blue-700 text-blue-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Academic & Enrollment History ({enrollments.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'documents'}
              onClick={() => setDetailTab('documents')}
              className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                detailTab === 'documents'
                  ? 'border-blue-700 text-blue-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Documents ({documents.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'fees'}
              onClick={() => setDetailTab('fees')}
              className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                detailTab === 'fees'
                  ? 'border-blue-700 text-blue-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Fee Statement ({feeStatement.invoices.length})</span>
            </button>
          </div>

          {detailTab === 'academics' && (
            <div className="p-5 space-y-6">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Course Enrollments & Academic Performance
                </h3>
                {enrollments.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No enrollments recorded for this student yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4">Course</th>
                          <th className="py-2.5 px-4">Batch</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Completion</th>
                          <th className="py-2.5 px-4 text-right">Score</th>
                          <th className="py-2.5 px-4 text-right">Attendance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {enrollments.map((enr) => (
                          <tr key={enr.id}>
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900">
                                {enr.courseTitle}
                              </div>
                              <div className="font-mono text-[11px] text-blue-700">
                                {enr.courseCode}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              {enr.cohort}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-800">
                              {enr.status}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {enr.completionPct}%
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {enr.weightedScore !== null
                                ? `${enr.weightedScore}% (${enr.letterGrade})`
                                : 'Ungraded'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {enr.attendanceRate}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Enrollment & Batch Transfer History
                </h3>
                {enrollmentHistory.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No status transitions or batch transfers recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {enrollmentHistory.map((h) => (
                      <div
                        key={h.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <span className="font-medium text-slate-900">
                            {h.previousStatus ?? 'New'} → {h.newStatus}
                          </span>
                          <p className="text-slate-600 mt-0.5">{h.reason}</p>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                          {new Date(h.changedAt).toLocaleString('en-US')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Emergency Contact</span>
                  <span className="font-medium text-slate-900">
                    {student.profile?.emergencyContact || 'Not provided'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Mailing Address</span>
                  <span className="font-medium text-slate-900">
                    {student.profile?.address || 'Not provided'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {detailTab === 'documents' && (
            <div className="p-5">
              {documents.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No documents uploaded for this student.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-blue-700 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {doc.title}
                          </div>
                          <div className="text-slate-500 truncate">
                            {doc.category} · {doc.fileName} ·{' '}
                            {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                        {new Date(doc.createdAt).toLocaleDateString('en-US')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {detailTab === 'fees' && (
            <div className="p-5 space-y-5">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Invoices
                </h3>
                {feeStatement.invoices.length === 0 ? (
                  <div className="p-5 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No tuition invoices issued for this student.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4">Invoice</th>
                          <th className="py-2.5 px-4">Description</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Due</th>
                          <th className="py-2.5 px-4 text-right">Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {feeStatement.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                              {inv.invoiceNumber}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">
                              {inv.description}
                            </td>
                            <td className="py-2.5 px-4 font-medium text-slate-800">
                              {inv.status}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                              {formatMoney(inv.amountDue, inv.currency)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-emerald-700 font-semibold tabular-nums">
                              {formatMoney(inv.amountPaid, inv.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Payment Receipts
                </h3>
                {feeStatement.payments.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No payment receipts recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
                    {feeStatement.payments.map((pay) => (
                      <div
                        key={pay.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div>
                          <span className="font-mono font-medium text-slate-900">
                            {pay.receiptNumber}
                          </span>
                          <span className="mx-2 text-slate-300">·</span>
                          <span className="text-slate-600">{pay.method}</span>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <span className="font-semibold text-emerald-700">
                            {formatMoney(pay.amount, currency)}
                          </span>
                          <span className="ml-3 text-[11px] text-slate-400">
                            {new Date(pay.paidAt).toLocaleDateString('en-US')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modals rendered even inside detail view */}
        {renderEditModal()}
        <ConfirmDialog
          open={Boolean(confirmRow)}
          title={
            confirmRow?.user.status === 'archived'
              ? 'Restore Student Account'
              : 'Archive Student Account'
          }
          description={
            confirmRow?.user.status === 'archived'
              ? `Restoring ${confirmRow?.user.name} will re-enable portal sign-in and active roster status.`
              : `Archiving ${confirmRow?.user.name} revokes all active login sessions and removes them from active rosters without deleting academic records.`
          }
          confirmLabel={
            confirmRow?.user.status === 'archived' ? 'Restore Student' : 'Archive Student'
          }
          tone={confirmRow?.user.status === 'archived' ? 'primary' : 'danger'}
          busy={confirmBusy}
          onConfirm={handleConfirmStatusToggle}
          onCancel={() => setConfirmRow(null)}
        />
      </div>
    );
  }

  function renderEditModal() {
    if (!editTarget) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-student-modal-title"
      >
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3
              id="edit-student-modal-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              Edit Student · {editTarget.user.studentCode}
            </h3>
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              aria-label="Close edit student modal"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {eError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{eError}</span>
            </div>
          )}

          <form onSubmit={handleEditSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="edit-stu-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Full Name
                </label>
                <input
                  id="edit-stu-name"
                  type="text"
                  required
                  value={eName}
                  onChange={(e) => setEName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-stu-email"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Email Address
                </label>
                <input
                  id="edit-stu-email"
                  type="email"
                  required
                  value={eEmail}
                  onChange={(e) => setEEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="edit-stu-phone"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Phone
                </label>
                <input
                  id="edit-stu-phone"
                  type="text"
                  value={ePhone}
                  onChange={(e) => setEPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-stu-status"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Account Status
                </label>
                <select
                  id="edit-stu-status"
                  value={eStatus}
                  onChange={(e) => setEStatus(e.target.value as UserAccountStatus)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="edit-stu-standing"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Academic Standing
                </label>
                <select
                  id="edit-stu-standing"
                  value={eStanding}
                  onChange={(e) => setEStanding(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="Distinction">Distinction</option>
                  <option value="Good Standing">Good Standing</option>
                  <option value="Academic Watch">Academic Watch</option>
                  <option value="Probation">Probation</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="edit-stu-dept"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Department
                </label>
                <select
                  id="edit-stu-dept"
                  value={eDeptId}
                  onChange={(e) => setEDeptId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="">General Studies</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="edit-stu-dob"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Date of Birth
                </label>
                <input
                  id="edit-stu-dob"
                  type="date"
                  value={eDob}
                  onChange={(e) => setEDob(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="edit-stu-emergency"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Emergency Contact
              </label>
              <input
                id="edit-stu-emergency"
                type="text"
                value={eEmergency}
                onChange={(e) => setEEmergency(e.target.value)}
                placeholder="Name & phone number"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="edit-stu-address"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Residential Address
              </label>
              <input
                id="edit-stu-address"
                type="text"
                value={eAddress}
                onChange={(e) => setEAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={eSaving}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {eSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header & Create Action */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Student Information Directory
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Search, filter, enroll, edit, and inspect complete student academic & fee records
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCError('');
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>New Student</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search, Filters & Sort Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2 relative">
          <label htmlFor="student-search-input" className="sr-only">
            Search students by name, email, or student ID
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="student-search-input"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, or student ID..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          />
        </div>

        <div>
          <label htmlFor="student-status-filter" className="sr-only">
            Filter by account status
          </label>
          <select
            id="student-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div>
          <label htmlFor="student-course-filter" className="sr-only">
            Filter by course
          </label>
          <select
            id="student-course-filter"
            value={courseFilter}
            onChange={(e) => {
              setCourseFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">All Courses</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="student-sort-select" className="sr-only">
            Sort students by
          </label>
          <select
            id="student-sort-select"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'createdAt' | 'name' | 'studentCode')
            }
            className="flex-1 px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="createdAt">Newest First</option>
            <option value="name">Name</option>
            <option value="studentCode">Student ID</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Directory Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && !directory ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Loading student records...
          </div>
        ) : !directory || directory.items.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No students match the current search and filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-5">Student</th>
                    <th className="py-2.5 px-4">Student ID</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Courses</th>
                    <th className="py-2.5 px-4 text-right">Attendance</th>
                    <th className="py-2.5 px-4 text-right">Outstanding</th>
                    <th className="py-2.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {directory.items.map((row) => (
                    <tr key={row.user.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">
                          {row.user.name}
                        </div>
                        <div className="text-slate-500 mt-0.5">{row.user.email}</div>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-blue-700">
                        {row.user.studentCode ?? '—'}
                      </td>
                      <td
                        className={`py-3 px-4 font-medium capitalize ${STATUS_TEXT_COLOR[row.user.status]}`}
                      >
                        {row.user.status}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {row.activeEnrollmentsCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {row.attendanceRate}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium tabular-nums">
                        {formatCents(row.outstandingCents, currency)}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={detailLoading}
                            onClick={() => openStudentDetail(row.user.id)}
                            className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                          >
                            Profile
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRow(row)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                              row.user.status === 'archived'
                                ? 'text-emerald-700 hover:bg-emerald-50'
                                : 'text-red-700 hover:bg-red-50'
                            }`}
                          >
                            {row.user.status === 'archived' ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-600 tabular-nums">
                Showing page <strong className="font-mono">{directory.page}</strong> of{' '}
                <strong className="font-mono">{directory.totalPages}</strong> (
                <span className="font-mono">{directory.total}</span> total students)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={directory.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-100 cursor-pointer"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={directory.page >= directory.totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(directory.totalPages, p + 1))
                  }
                  className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-100 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Create Student Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-student-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-700" />
                <h3
                  id="create-student-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Register New Student
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close new student modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{cError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-stu-name"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Full Name
                  </label>
                  <input
                    id="new-stu-name"
                    type="text"
                    required
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-stu-email"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Email Address
                  </label>
                  <input
                    id="new-stu-email"
                    type="email"
                    required
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-stu-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Initial Password (min 8 chars)
                  </label>
                  <input
                    id="new-stu-password"
                    type="password"
                    required
                    minLength={8}
                    value={cPassword}
                    onChange={(e) => setCPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-stu-phone"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Phone
                  </label>
                  <input
                    id="new-stu-phone"
                    type="text"
                    value={cPhone}
                    onChange={(e) => setCPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="new-stu-dept"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Department
                  </label>
                  <select
                    id="new-stu-dept"
                    value={cDeptId}
                    onChange={(e) => setCDeptId(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">General Studies</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-stu-dob"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Date of Birth
                  </label>
                  <input
                    id="new-stu-dob"
                    type="date"
                    value={cDob}
                    onChange={(e) => setCDob(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-stu-standing"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Standing
                  </label>
                  <input
                    id="new-stu-standing"
                    type="text"
                    value={cStanding}
                    onChange={(e) => setCStanding(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-stu-emergency"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Emergency Contact
                  </label>
                  <input
                    id="new-stu-emergency"
                    type="text"
                    value={cEmergency}
                    onChange={(e) => setCEmergency(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-stu-address"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Address
                  </label>
                  <input
                    id="new-stu-address"
                    type="text"
                    value={cAddress}
                    onChange={(e) => setCAddress(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-stu-course"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Initial Course Enrollment (Optional)
                  </label>
                  <select
                    id="new-stu-course"
                    value={cCourseId}
                    onChange={(e) => {
                      setCCourseId(e.target.value);
                      setCCohortId('');
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">None (Enroll later)</option>
                    {data.courses
                      .filter((c) => !c.isArchived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-stu-batch"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Initial Cohort Batch
                  </label>
                  <select
                    id="new-stu-batch"
                    disabled={!cCourseId}
                    value={cCohortId}
                    onChange={(e) => setCCohortId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg disabled:bg-slate-50"
                  >
                    <option value="">Auto-select Active Batch</option>
                    {courseCohorts.map((coh) => (
                      <option key={coh.id} value={coh.id}>
                        {coh.name} ({coh.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                A unique student ID (e.g. INF-2026-XXXX) will be securely generated on the server.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {cSaving ? 'Registering...' : 'Create Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renderEditModal()}

      <ConfirmDialog
        open={Boolean(confirmRow)}
        title={
          confirmRow?.user.status === 'archived'
            ? 'Restore Student Account'
            : 'Archive Student Account'
        }
        description={
          confirmRow?.user.status === 'archived'
            ? `Restoring ${confirmRow?.user.name} will re-enable portal sign-in and active roster status.`
            : `Archiving ${confirmRow?.user.name} revokes all active login sessions and removes them from active rosters without deleting academic records.`
        }
        confirmLabel={
          confirmRow?.user.status === 'archived' ? 'Restore Student' : 'Archive Student'
        }
        tone={confirmRow?.user.status === 'archived' ? 'primary' : 'danger'}
        busy={confirmBusy}
        onConfirm={handleConfirmStatusToggle}
        onCancel={() => setConfirmRow(null)}
      />
    </div>
  );
}
