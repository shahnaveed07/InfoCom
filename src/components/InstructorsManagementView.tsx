import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Edit3,
  Layers,
  Shield,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  DashboardPayload,
  InstructorDetailPayload,
  InstructorDirectoryRow,
  InstructorPermissionKey,
  UserAccountStatus,
} from '../shared/types';
import { api } from '../utils/api';
import { ConfirmDialog } from './ConfirmDialog';

interface InstructorsManagementViewProps {
  data: DashboardPayload;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

const PERMISSION_LABELS: Array<{
  key: InstructorPermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'enrollments:manage',
    label: 'Manage Enrollments',
    description: 'Create enrollments and update student enrollment statuses in assigned courses.',
  },
  {
    key: 'progress:manage',
    label: 'Manage Course Progress & Remarks',
    description: 'Mark module completions and write instructor progress remarks.',
  },
  {
    key: 'grades:manage',
    label: 'Grade Module Assessments',
    description: 'Enter and update numeric scores and assessment feedback.',
  },
  {
    key: 'sessions:manage',
    label: 'Schedule & Manage Class Sessions',
    description: 'Create class sessions and update session completion or cancellation.',
  },
  {
    key: 'attendance:manage',
    label: 'Mark Attendance & Trigger Reminders',
    description: 'Record student attendance and trigger automated session reminders.',
  },
  {
    key: 'documents:upload',
    label: 'Upload Course & Student Documents',
    description: 'Upload syllabi, assignments, and student academic documents.',
  },
  {
    key: 'certificates:issue',
    label: 'Issue Completion Certificates',
    description: 'Issue verifiable course completion credentials for eligible students.',
  },
];

const DEFAULT_PERM_KEYS: InstructorPermissionKey[] = PERMISSION_LABELS.map((p) => p.key);

export function InstructorsManagementView({
  data,
  onDashboardUpdate,
}: InstructorsManagementViewProps) {
  const departments = data.departments ?? [];
  const [items, setItems] = useState<InstructorDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Detail profile view
  const [selectedDetail, setSelectedDetail] = useState<InstructorDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create instructor modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cDeptId, setCDeptId] = useState('');
  const [cSpec, setCSpec] = useState('');
  const [cQual, setCQual] = useState('');
  const [cHireDate, setCHireDate] = useState('');
  const [cBio, setCBio] = useState('');
  const [cCourseIds, setCCourseIds] = useState<string[]>([]);
  const [cBatchIds, setCBatchIds] = useState<string[]>([]);
  const [cPerms, setCPerms] = useState<InstructorPermissionKey[]>(DEFAULT_PERM_KEYS);
  const [cError, setCError] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // Edit instructor modal
  const [editTarget, setEditTarget] = useState<InstructorDirectoryRow | null>(null);
  const [eName, setEName] = useState('');
  const [eEmail, setEEmail] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eDeptId, setEDeptId] = useState('');
  const [eSpec, setESpec] = useState('');
  const [eQual, setEQual] = useState('');
  const [eBio, setEBio] = useState('');
  const [eError, setEError] = useState('');
  const [eSaving, setESaving] = useState(false);

  // Assign Courses & Batches modal
  const [assignTarget, setAssignTarget] = useState<InstructorDirectoryRow | null>(null);
  const [aCourseIds, setACourseIds] = useState<string[]>([]);
  const [aBatchIds, setABatchIds] = useState<string[]>([]);
  const [aSaving, setASaving] = useState(false);

  // Permissions modal
  const [permTarget, setPermTarget] = useState<InstructorDirectoryRow | null>(null);
  const [pPerms, setPPerms] = useState<InstructorPermissionKey[]>([]);
  const [pSaving, setPSaving] = useState(false);

  // Suspend / Activate dialog
  const [confirmRow, setConfirmRow] = useState<InstructorDirectoryRow | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadInstructors = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listInstructors();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load instructors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstructors();
  }, [loadInstructors]);

  async function openDetail(instructorId: string) {
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api.getInstructorDetail(instructorId);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load instructor profile.');
    } finally {
      setDetailLoading(false);
    }
  }

  function openEdit(row: InstructorDirectoryRow) {
    setEditTarget(row);
    setEName(row.user.name);
    setEEmail(row.user.email);
    setEPhone(row.user.phone ?? '');
    setEDeptId(row.profile.departmentId ?? '');
    setESpec(row.profile.specialization);
    setEQual(row.profile.qualification);
    setEBio(row.profile.bio);
    setEError('');
  }

  function openAssignModal(row: InstructorDirectoryRow) {
    setAssignTarget(row);
    setACourseIds(
      data.courses
        .filter((c) => c.instructorId === row.user.id)
        .map((c) => c.id)
    );
    setABatchIds(
      data.cohorts
        .filter((coh) => coh.instructorId === row.user.id)
        .map((coh) => coh.id)
    );
  }

  function openPermModal(row: InstructorDirectoryRow) {
    setPermTarget(row);
    setPPerms(row.profile.permissions);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCError('');
    setCSaving(true);
    try {
      const res = await api.createInstructor({
        name: cName.trim(),
        email: cEmail.trim(),
        phone: cPhone.trim(),
        password: cPassword,
        departmentId: cDeptId || null,
        specialization: cSpec.trim(),
        qualification: cQual.trim(),
        hireDate: cHireDate || null,
        bio: cBio.trim(),
        courseIds: cCourseIds,
        batchIds: cBatchIds,
        permissions: cPerms,
      });
      setItems(res.items);
      onDashboardUpdate(res.dashboard);
      setCreateOpen(false);
      setCName('');
      setCEmail('');
      setCPhone('');
      setCPassword('');
      setCSpec('');
      setCQual('');
      setCBio('');
      setCCourseIds([]);
      setCBatchIds([]);
      setNotice(`Instructor account created for ${res.instructor.name} (${res.instructor.staffCode}).`);
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Unable to create instructor.');
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
      const res = await api.updateInstructor(editTarget.user.id, {
        name: eName.trim(),
        email: eEmail.trim(),
        phone: ePhone.trim(),
        departmentId: eDeptId || null,
        specialization: eSpec.trim(),
        qualification: eQual.trim(),
        bio: eBio.trim(),
      });
      setItems(res.items);
      onDashboardUpdate(res.dashboard);
      if (selectedDetail?.instructor.user.id === editTarget.user.id) {
        setSelectedDetail(res.detail);
      }
      setEditTarget(null);
      setNotice(`Updated faculty profile for ${eName.trim()}.`);
    } catch (err) {
      setEError(err instanceof Error ? err.message : 'Unable to update instructor.');
    } finally {
      setESaving(false);
    }
  }

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTarget) return;
    setASaving(true);
    try {
      const res = await api.assignInstructorCourses(assignTarget.user.id, {
        courseIds: aCourseIds,
        batchIds: aBatchIds,
      });
      setItems(res.items);
      onDashboardUpdate(res.dashboard);
      if (selectedDetail?.instructor.user.id === assignTarget.user.id) {
        setSelectedDetail(res.detail);
      }
      setAssignTarget(null);
      setNotice(`Updated course and batch assignments for ${assignTarget.user.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update assignments.');
    } finally {
      setASaving(false);
    }
  }

  async function handlePermsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!permTarget) return;
    setPSaving(true);
    try {
      const res = await api.updateInstructorPermissions(permTarget.user.id, pPerms);
      setItems(res.items);
      if (selectedDetail?.instructor.user.id === permTarget.user.id) {
        setSelectedDetail(res.detail);
      }
      setPermTarget(null);
      setNotice(`Saved granular permissions for ${permTarget.user.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update permissions.');
    } finally {
      setPSaving(false);
    }
  }

  async function handleConfirmStatusToggle() {
    if (!confirmRow) return;
    setConfirmBusy(true);
    const nextStatus: UserAccountStatus =
      confirmRow.user.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await api.updateInstructor(confirmRow.user.id, { status: nextStatus });
      setItems(res.items);
      onDashboardUpdate(res.dashboard);
      if (selectedDetail?.instructor.user.id === confirmRow.user.id) {
        setSelectedDetail(res.detail);
      }
      setNotice(`${confirmRow.user.name} account is now ${nextStatus}.`);
      setConfirmRow(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update account status.');
    } finally {
      setConfirmBusy(false);
    }
  }

  function renderSubModals() {
    return (
      <>
        {editTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-instructor-title"
          >
            <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3
                  id="edit-instructor-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Edit Instructor · {editTarget.profile.staffCode}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  aria-label="Close edit instructor modal"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {eError && (
                <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {eError}
                </div>
              )}
              <form onSubmit={handleEditSubmit} className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-ins-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      id="edit-ins-name"
                      type="text"
                      required
                      value={eName}
                      onChange={(e) => setEName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-ins-email" className="block text-xs font-medium text-slate-700 mb-1">
                      Email
                    </label>
                    <input
                      id="edit-ins-email"
                      type="email"
                      required
                      value={eEmail}
                      onChange={(e) => setEEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-ins-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Phone
                    </label>
                    <input
                      id="edit-ins-phone"
                      type="text"
                      value={ePhone}
                      onChange={(e) => setEPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-ins-dept" className="block text-xs font-medium text-slate-700 mb-1">
                      Department
                    </label>
                    <select
                      id="edit-ins-dept"
                      value={eDeptId}
                      onChange={(e) => setEDeptId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    >
                      <option value="">Academic Faculty</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-ins-spec" className="block text-xs font-medium text-slate-700 mb-1">
                      Specialization
                    </label>
                    <input
                      id="edit-ins-spec"
                      type="text"
                      value={eSpec}
                      onChange={(e) => setESpec(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-ins-qual" className="block text-xs font-medium text-slate-700 mb-1">
                      Qualification
                    </label>
                    <input
                      id="edit-ins-qual"
                      type="text"
                      value={eQual}
                      onChange={(e) => setEQual(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="edit-ins-bio" className="block text-xs font-medium text-slate-700 mb-1">
                    Faculty Bio
                  </label>
                  <textarea
                    id="edit-ins-bio"
                    rows={2}
                    value={eBio}
                    onChange={(e) => setEBio(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="pt-2 flex justify-end gap-2.5">
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
                    {eSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {assignTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-instructor-title"
          >
            <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3
                  id="assign-instructor-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Assign Courses & Batches · {assignTarget.user.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setAssignTarget(null)}
                  aria-label="Close assignments modal"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleAssignSubmit} className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-slate-800 mb-2">
                    Lead Courses
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {data.courses.map((c) => {
                      const checked = aCourseIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setACourseIds((prev) =>
                                prev.includes(c.id)
                                  ? prev.filter((id) => id !== c.id)
                                  : [...prev, c.id]
                              )
                            }
                          />
                          <span className="font-mono text-blue-700">{c.code}</span>
                          <span className="text-slate-900">{c.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-800 mb-2">
                    Assigned Cohort Batches
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {data.cohorts.map((coh) => {
                      const checked = aBatchIds.includes(coh.id);
                      return (
                        <label
                          key={coh.id}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setABatchIds((prev) =>
                                prev.includes(coh.id)
                                  ? prev.filter((id) => id !== coh.id)
                                  : [...prev, coh.id]
                              )
                            }
                          />
                          <span className="font-mono text-slate-600">{coh.code}</span>
                          <span className="text-slate-900">{coh.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAssignTarget(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={aSaving}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    {aSaving ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {permTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="perms-instructor-title"
          >
            <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-700" />
                  <h3
                    id="perms-instructor-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Manage Permissions · {permTarget.user.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPermTarget(null)}
                  aria-label="Close permissions modal"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handlePermsSubmit} className="mt-4 space-y-2.5">
                {PERMISSION_LABELS.map((perm) => {
                  const enabled = pPerms.includes(perm.key);
                  return (
                    <label
                      key={perm.key}
                      className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={enabled}
                        onChange={() =>
                          setPPerms((prev) =>
                            prev.includes(perm.key)
                              ? prev.filter((k) => k !== perm.key)
                              : [...prev, perm.key]
                          )
                        }
                      />
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          {perm.label}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {perm.description}
                        </div>
                      </div>
                    </label>
                  );
                })}
                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPermTarget(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pSaving}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    {pSaving ? 'Saving...' : 'Save Permissions'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={Boolean(confirmRow)}
          title={
            confirmRow?.user.status === 'active'
              ? 'Suspend Instructor Account'
              : 'Activate Instructor Account'
          }
          description={
            confirmRow?.user.status === 'active'
              ? `Suspending ${confirmRow?.user.name} immediately revokes active portal sessions and blocks sign-in until reactivated.`
              : `Activating ${confirmRow?.user.name} restores full portal access for assigned courses and batches.`
          }
          confirmLabel={
            confirmRow?.user.status === 'active' ? 'Suspend Account' : 'Activate Account'
          }
          tone={confirmRow?.user.status === 'active' ? 'danger' : 'primary'}
          busy={confirmBusy}
          onConfirm={handleConfirmStatusToggle}
          onCancel={() => setConfirmRow(null)}
        />
      </>
    );
  }

  if (selectedDetail) {
    const { instructor, assignedCourses, assignedBatches, sessions } = selectedDetail;
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
                  {instructor.user.name}
                </h2>
                <span className="font-mono text-xs text-blue-700 font-semibold">
                  {instructor.profile.staffCode}
                </span>
                <span
                  className={`text-xs font-semibold capitalize ${
                    instructor.user.status === 'active'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {instructor.user.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {instructor.user.email}
                {instructor.profile.departmentName
                  ? ` · ${instructor.profile.departmentName}`
                  : ''}
                {instructor.profile.specialization
                  ? ` · ${instructor.profile.specialization}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openEdit(instructor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile</span>
            </button>
            <button
              type="button"
              onClick={() => openAssignModal(instructor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Assign Courses & Batches</span>
            </button>
            <button
              type="button"
              onClick={() => openPermModal(instructor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Permissions ({instructor.profile.permissions.length})</span>
            </button>
          </div>
        </div>

        {/* Performance Overview */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Assigned Courses</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {instructor.assignedCoursesCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Assigned Batches</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {instructor.assignedBatchesCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Assigned Students</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {instructor.assignedStudentsCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Mean Class Attendance</div>
            <div className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums">
              {instructor.meanAttendanceRate}%
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Mean Graded Score</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {instructor.meanGradedScore !== null ? `${instructor.meanGradedScore}%` : '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Assigned Courses & Cohort Batches
              </h3>
            </div>
            <div className="p-4 space-y-4">
              {assignedCourses.length === 0 ? (
                <div className="text-xs text-slate-500">No courses assigned yet.</div>
              ) : (
                <div className="space-y-2">
                  {assignedCourses.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono font-semibold text-blue-700 mr-2">
                          {c.code}
                        </span>
                        <span className="font-medium text-slate-900">{c.title}</span>
                      </div>
                      <span className="font-mono text-slate-500">
                        {c.durationWeeks} wks
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {assignedBatches.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] font-medium text-slate-500">
                    Active Cohort Batches
                  </div>
                  {assignedBatches.map((b) => (
                    <div
                      key={b.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-medium text-slate-900">{b.name}</div>
                        <div className="text-slate-500">{b.courseCode} · {b.courseTitle}</div>
                      </div>
                      <span className="font-mono text-slate-700 tabular-nums">
                        {b.enrolledCount}/{b.capacity} seats
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Instructor Teaching Schedule
              </h3>
              <CalendarClock className="w-4 h-4 text-blue-700" />
            </div>
            <div className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No class sessions scheduled for this instructor.
                </div>
              ) : (
                sessions.map((ses) => (
                  <div key={ses.id} className="px-5 py-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-900">{ses.title}</span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {new Date(ses.startIso).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {ses.cohort} · {ses.room} · {ses.status ?? 'Scheduled'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {renderSubModals()}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <UserCheck className="w-4 h-4 text-blue-700" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Instructor & Faculty Management
            </h2>
            <p className="text-xs text-slate-500">
              Create faculty accounts, assign courses & batches, manage permissions, and review teaching performance
            </p>
          </div>
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
          <span>New Instructor</span>
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

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Loading faculty directory...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No instructors configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Instructor</th>
                  <th className="py-2.5 px-4">Staff ID</th>
                  <th className="py-2.5 px-4 text-right">Courses</th>
                  <th className="py-2.5 px-4 text-right">Batches</th>
                  <th className="py-2.5 px-4 text-right">Students</th>
                  <th className="py-2.5 px-4 text-right">Attendance</th>
                  <th className="py-2.5 px-4 text-right">Avg Score</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {items.map((row) => (
                  <tr key={row.user.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-900">{row.user.name}</div>
                      <div className="text-slate-500 mt-0.5">
                        {row.profile.specialization || row.user.email}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-blue-700 font-medium whitespace-nowrap">
                      {row.profile.staffCode}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.assignedCoursesCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.assignedBatchesCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.assignedStudentsCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.meanAttendanceRate}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.meanGradedScore !== null ? `${row.meanGradedScore}%` : '—'}
                    </td>
                    <td
                      className={`py-3 px-4 font-medium capitalize ${
                        row.user.status === 'active'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {row.user.status}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={detailLoading}
                          onClick={() => openDetail(row.user.id)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          onClick={() => openAssignModal(row)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          onClick={() => openPermModal(row)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          Permissions
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRow(row)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                            row.user.status === 'active'
                              ? 'text-red-700 hover:bg-red-50'
                              : 'text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {row.user.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Instructor Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-instructor-title"
        >
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="create-instructor-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Instructor Account
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close new instructor modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {cError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-ins-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    id="new-ins-name"
                    type="text"
                    required
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-ins-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    id="new-ins-email"
                    type="email"
                    required
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="new-ins-password" className="block text-xs font-medium text-slate-700 mb-1">
                    Password (min 8)
                  </label>
                  <input
                    id="new-ins-password"
                    type="password"
                    required
                    minLength={8}
                    value={cPassword}
                    onChange={(e) => setCPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-ins-phone" className="block text-xs font-medium text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    id="new-ins-phone"
                    type="text"
                    value={cPhone}
                    onChange={(e) => setCPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-ins-dept" className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    id="new-ins-dept"
                    value={cDeptId}
                    onChange={(e) => setCDeptId(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">Academic Faculty</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="new-ins-spec" className="block text-xs font-medium text-slate-700 mb-1">
                    Specialization
                  </label>
                  <input
                    id="new-ins-spec"
                    type="text"
                    value={cSpec}
                    onChange={(e) => setCSpec(e.target.value)}
                    placeholder="e.g. Cloud & DevOps"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-ins-qual" className="block text-xs font-medium text-slate-700 mb-1">
                    Qualification
                  </label>
                  <input
                    id="new-ins-qual"
                    type="text"
                    value={cQual}
                    onChange={(e) => setCQual(e.target.value)}
                    placeholder="e.g. M.S. CS"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="new-ins-hire" className="block text-xs font-medium text-slate-700 mb-1">
                    Hire Date
                  </label>
                  <input
                    id="new-ins-hire"
                    type="date"
                    value={cHireDate}
                    onChange={(e) => setCHireDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-ins-bio" className="block text-xs font-medium text-slate-700 mb-1">
                  Bio
                </label>
                <textarea
                  id="new-ins-bio"
                  rows={2}
                  value={cBio}
                  onChange={(e) => setCBio(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1">
                    Initial Courses
                  </div>
                  <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {data.courses.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cCourseIds.includes(c.id)}
                          onChange={() =>
                            setCCourseIds((prev) =>
                              prev.includes(c.id)
                                ? prev.filter((id) => id !== c.id)
                                : [...prev, c.id]
                            )
                          }
                        />
                        <span>{c.code} — {c.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-700 mb-1">
                    Permissions
                  </div>
                  <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {PERMISSION_LABELS.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cPerms.includes(p.key)}
                          onChange={() =>
                            setCPerms((prev) =>
                              prev.includes(p.key)
                                ? prev.filter((k) => k !== p.key)
                                : [...prev, p.key]
                            )
                          }
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
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
                  {cSaving ? 'Creating...' : 'Create Instructor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renderSubModals()}
    </div>
  );
}
