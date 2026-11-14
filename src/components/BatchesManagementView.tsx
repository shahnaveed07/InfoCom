import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Building,
  CheckCircle2,
  Edit3,
  Layers,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import { computeBatchMetrics } from '../shared/academic';
import type {
  Classroom,
  Cohort,
  CohortStatus,
  DashboardPayload,
} from '../shared/types';
import { api } from '../utils/api';

interface BatchesManagementViewProps {
  data: DashboardPayload;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

export function BatchesManagementView({
  data,
  onDashboardUpdate,
}: BatchesManagementViewProps) {
  const instructors = data.users.filter(
    (u) => u.role === 'instructor' || u.role === 'admin'
  );
  const classrooms = data.classrooms ?? [];
  const terms = data.academicTerms ?? [];

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Create / Edit Batch modal
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Cohort | null>(null);
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bCourseId, setBCourseId] = useState(data.courses[0]?.id ?? '');
  const [bTermId, setBTermId] = useState('');
  const [bInstructorId, setBInstructorId] = useState(instructors[0]?.id ?? '');
  const [bClassroomId, setBClassroomId] = useState('');
  const [bCapacity, setBCapacity] = useState('24');
  const [bStart, setBStart] = useState('2026-09-01');
  const [bEnd, setBEnd] = useState('2026-11-30');
  const [bStatus, setBStatus] = useState<CohortStatus>('Active');
  const [bError, setBError] = useState('');
  const [bSaving, setBSaving] = useState(false);

  // Assign student modal
  const [assignBatch, setAssignBatch] = useState<Cohort | null>(null);
  const [assignStudentId, setAssignStudentId] = useState(data.students[0]?.id ?? '');
  const [assignStatus, setAssignStatus] = useState<'Active' | 'Waitlisted'>('Active');
  const [assignInvoice, setAssignInvoice] = useState(true);
  const [assignError, setAssignError] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

  // Batch Transfer modal
  const [transferBatch, setTransferBatch] = useState<Cohort | null>(null);
  const [transferEnrollmentId, setTransferEnrollmentId] = useState('');
  const [transferTargetBatchId, setTransferTargetBatchId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

  // Classroom modal
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
  const [rCode, setRCode] = useState('');
  const [rName, setRName] = useState('');
  const [rBuilding, setRBuilding] = useState('Main Campus');
  const [rCapacity, setRCapacity] = useState('24');
  const [rEquipment, setREquipment] = useState('');
  const [rActive, setRActive] = useState(true);
  const [rError, setRError] = useState('');
  const [rSaving, setRSaving] = useState(false);

  function openCreateBatchModal() {
    setEditingBatch(null);
    setBCode('');
    setBName('');
    setBCourseId(data.courses[0]?.id ?? '');
    setBTermId(terms[0]?.id ?? '');
    setBInstructorId(instructors[0]?.id ?? '');
    setBClassroomId(classrooms[0]?.id ?? '');
    setBCapacity('24');
    setBStart('2026-09-01');
    setBEnd('2026-11-30');
    setBStatus('Active');
    setBError('');
    setBatchModalOpen(true);
  }

  function openEditBatchModal(batch: Cohort) {
    setEditingBatch(batch);
    setBCode(batch.code);
    setBName(batch.name);
    setBCourseId(batch.courseId);
    setBTermId(batch.termId ?? '');
    setBInstructorId(batch.instructorId);
    setBClassroomId(batch.classroomId ?? '');
    setBCapacity(String(batch.capacity));
    setBStart(batch.startDate.slice(0, 10));
    setBEnd(batch.endDate.slice(0, 10));
    setBStatus(batch.status);
    setBError('');
    setBatchModalOpen(true);
  }

  function openAssignModal(batch: Cohort) {
    setAssignBatch(batch);
    setAssignStudentId(data.students[0]?.id ?? '');
    setAssignStatus('Active');
    setAssignInvoice(true);
    setAssignError('');
  }

  function openTransferModal(batch: Cohort) {
    setTransferBatch(batch);
    const batchEnrollments = data.enrollments.filter(
      (e) =>
        e.courseId === batch.courseId &&
        (e.cohortId === batch.id || e.cohort === batch.name) &&
        e.status !== 'Dropped'
    );
    const otherBatches = data.cohorts.filter(
      (c) => c.courseId === batch.courseId && c.id !== batch.id
    );
    setTransferEnrollmentId(batchEnrollments[0]?.id ?? '');
    setTransferTargetBatchId(otherBatches[0]?.id ?? '');
    setTransferReason('');
    setTransferError('');
  }

  function openRoomModal(room?: Classroom) {
    setEditingRoom(room ?? null);
    setRCode(room?.code ?? '');
    setRName(room?.name ?? '');
    setRBuilding(room?.building ?? 'Main Campus');
    setRCapacity(String(room?.capacity ?? 24));
    setREquipment(room?.equipment ?? '');
    setRActive(room?.isActive ?? true);
    setRError('');
    setRoomModalOpen(true);
  }

  async function handleBatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBError('');
    setBSaving(true);
    try {
      if (editingBatch) {
        const res = await api.updateCohort(editingBatch.id, {
          name: bName.trim(),
          termId: bTermId || null,
          instructorId: bInstructorId,
          classroomId: bClassroomId || null,
          capacity: Number(bCapacity) || 24,
          startDate: new Date(bStart).toISOString(),
          endDate: new Date(bEnd).toISOString(),
          status: bStatus,
        });
        onDashboardUpdate(res.dashboard);
        setNotice(`Batch ${bName.trim()} updated.`);
      } else {
        const res = await api.createCohort({
          code: bCode.trim().toUpperCase(),
          name: bName.trim(),
          courseId: bCourseId,
          termId: bTermId || null,
          instructorId: bInstructorId,
          classroomId: bClassroomId || null,
          capacity: Number(bCapacity) || 24,
          startDate: new Date(bStart).toISOString(),
          endDate: new Date(bEnd).toISOString(),
          status: bStatus,
        });
        onDashboardUpdate(res.dashboard);
        setNotice(`Batch ${bName.trim()} created.`);
      }
      setBatchModalOpen(false);
    } catch (err) {
      setBError(err instanceof Error ? err.message : 'Unable to save batch.');
    } finally {
      setBSaving(false);
    }
  }

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assignBatch) return;
    setAssignError('');
    setAssignSaving(true);
    try {
      const res = await api.assignStudentToCohort(assignBatch.id, {
        studentId: assignStudentId,
        status: assignStatus,
        issueTuitionInvoice: assignInvoice,
      });
      onDashboardUpdate(res.dashboard);
      setAssignBatch(null);
      setNotice(`Assigned student to ${assignBatch.name}.`);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Unable to assign student.');
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transferEnrollmentId || !transferTargetBatchId) return;
    setTransferError('');
    setTransferSaving(true);
    try {
      const res = await api.transferEnrollment(transferEnrollmentId, {
        toBatchId: transferTargetBatchId,
        reason: transferReason.trim(),
      });
      onDashboardUpdate(res.dashboard);
      setTransferBatch(null);
      setNotice('Student batch transfer recorded.');
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Unable to transfer batch.');
    } finally {
      setTransferSaving(false);
    }
  }

  async function handleRoomSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRError('');
    setRSaving(true);
    try {
      if (editingRoom) {
        const res = await api.updateClassroom(editingRoom.id, {
          code: rCode.trim().toUpperCase(),
          name: rName.trim(),
          building: rBuilding.trim(),
          capacity: Number(rCapacity) || 24,
          equipment: rEquipment.trim(),
          isActive: rActive,
        });
        onDashboardUpdate(res.dashboard);
        setNotice(`Classroom ${rName.trim()} updated.`);
      } else {
        const res = await api.createClassroom({
          code: rCode.trim().toUpperCase(),
          name: rName.trim(),
          building: rBuilding.trim(),
          capacity: Number(rCapacity) || 24,
          equipment: rEquipment.trim(),
          isActive: rActive,
        });
        onDashboardUpdate(res.dashboard);
        setNotice(`Classroom ${rName.trim()} added.`);
      }
      setRoomModalOpen(false);
    } catch (err) {
      setRError(err instanceof Error ? err.message : 'Unable to save classroom.');
    } finally {
      setRSaving(false);
    }
  }

  const transferEnrollments = transferBatch
    ? data.enrollments.filter(
        (e) =>
          e.courseId === transferBatch.courseId &&
          (e.cohortId === transferBatch.id || e.cohort === transferBatch.name) &&
          e.status !== 'Dropped'
      )
    : [];

  const transferDestinations = transferBatch
    ? data.cohorts.filter(
        (c) => c.courseId === transferBatch.courseId && c.id !== transferBatch.id
      )
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Layers className="w-4 h-4 text-blue-700" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Batch Cohorts & Campus Classrooms
            </h2>
            <p className="text-xs text-slate-500">
              Configure cohort capacity, assign classrooms and students, process batch transfers, and monitor attendance & performance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openRoomModal()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Building className="w-3.5 h-3.5" />
            <span>New Classroom</span>
          </button>
          <button
            type="button"
            onClick={openCreateBatchModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Batch</span>
          </button>
        </div>
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

      {/* Batches Overview Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Cohort Batches & Performance Overview
          </h3>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {data.cohorts.length} batches
          </span>
        </div>

        {data.cohorts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No batches configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Batch</th>
                  <th className="py-2.5 px-4">Course & Classroom</th>
                  <th className="py-2.5 px-4">Instructor</th>
                  <th className="py-2.5 px-4 text-right">Seats</th>
                  <th className="py-2.5 px-4 text-right">Attendance</th>
                  <th className="py-2.5 px-4 text-right">Mean Score</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {data.cohorts.map((batch) => {
                  const course = data.courses.find((c) => c.id === batch.courseId);
                  const metrics = computeBatchMetrics({
                    batchId: batch.id,
                    batchName: batch.name,
                    courseId: batch.courseId,
                    capacity: batch.capacity,
                    enrollments: data.enrollments,
                    attendance: data.attendance,
                    grades: data.grades,
                  });
                  return (
                    <tr key={batch.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900 text-sm">
                          {batch.name}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                          {batch.code} ·{' '}
                          {new Date(batch.startDate).toLocaleDateString('en-US')} –{' '}
                          {new Date(batch.endDate).toLocaleDateString('en-US')}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">
                          {course?.code ?? batch.courseId}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {batch.classroomName ?? 'Room unassigned'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {batch.instructorName}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-medium text-slate-900 tabular-nums">
                          {metrics.enrolledCount} / {metrics.capacity}
                        </div>
                        <div className="w-16 ml-auto mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${metrics.utilizationPct}%` }}
                            className="h-full bg-blue-700"
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {metrics.attendanceRate}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {metrics.meanScore !== null ? `${metrics.meanScore}%` : '—'}
                      </td>
                      <td className="py-3 px-4 font-medium text-emerald-700">
                        {batch.status}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditBatchModal(batch)}
                            className="inline-flex items-center gap-1 px-2 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openAssignModal(batch)}
                            className="inline-flex items-center gap-1 px-2 py-1 font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>Assign</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openTransferModal(batch)}
                            className="inline-flex items-center gap-1 px-2 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                            <span>Transfer</span>
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
      </section>

      {/* Classrooms Directory */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Campus Classrooms & Labs
          </h3>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {classrooms.length} rooms
          </span>
        </div>
        {classrooms.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No classrooms registered yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Room</th>
                  <th className="py-2.5 px-4">Building</th>
                  <th className="py-2.5 px-4">Equipment</th>
                  <th className="py-2.5 px-4 text-right">Capacity</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {classrooms.map((rm) => (
                  <tr key={rm.id}>
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-900">{rm.name}</div>
                      <div className="font-mono text-[11px] text-blue-700">{rm.code}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{rm.building}</td>
                    <td className="py-3 px-4 text-slate-600">{rm.equipment || 'Standard'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {rm.capacity}
                    </td>
                    <td
                      className={`py-3 px-4 font-medium ${
                        rm.isActive ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {rm.isActive ? 'Active' : 'Inactive'}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => openRoomModal(rm)}
                        className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create/Edit Batch Modal */}
      {batchModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="batch-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingBatch ? `Edit Batch · ${editingBatch.code}` : 'Create Cohort Batch'}
              </h3>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                aria-label="Close batch modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {bError}
              </div>
            )}

            <form onSubmit={handleBatchSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="batch-code-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Code
                  </label>
                  <input
                    id="batch-code-in"
                    type="text"
                    required
                    disabled={Boolean(editingBatch)}
                    value={bCode}
                    onChange={(e) => setBCode(e.target.value)}
                    placeholder="e.g. COH-2026-WIN"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label htmlFor="batch-name-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Name
                  </label>
                  <input
                    id="batch-name-in"
                    type="text"
                    required
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="batch-course-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Course Program
                  </label>
                  <select
                    id="batch-course-in"
                    disabled={Boolean(editingBatch)}
                    value={bCourseId}
                    onChange={(e) => setBCourseId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg disabled:bg-slate-50"
                  >
                    {data.courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="batch-term-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Academic Term
                  </label>
                  <select
                    id="batch-term-in"
                    value={bTermId}
                    onChange={(e) => setBTermId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">Unlinked</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="batch-ins-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Instructor
                  </label>
                  <select
                    id="batch-ins-in"
                    value={bInstructorId}
                    onChange={(e) => setBInstructorId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    {instructors.map((ins) => (
                      <option key={ins.id} value={ins.id}>
                        {ins.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="batch-room-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Classroom
                  </label>
                  <select
                    id="batch-room-in"
                    value={bClassroomId}
                    onChange={(e) => setBClassroomId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="">Unassigned</option>
                    {classrooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.name} ({rm.capacity} seats)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label htmlFor="batch-cap-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Capacity
                  </label>
                  <input
                    id="batch-cap-in"
                    type="number"
                    min={1}
                    max={500}
                    value={bCapacity}
                    onChange={(e) => setBCapacity(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="batch-start-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="batch-start-in"
                    type="date"
                    required
                    value={bStart}
                    onChange={(e) => setBStart(e.target.value)}
                    className="w-full px-2 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="batch-end-in" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="batch-end-in"
                    type="date"
                    required
                    value={bEnd}
                    onChange={(e) => setBEnd(e.target.value)}
                    className="w-full px-2 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="batch-status-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    id="batch-status-in"
                    value={bStatus}
                    onChange={(e) => setBStatus(e.target.value as CohortStatus)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="Planned">Planned</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {bSaving ? 'Saving...' : editingBatch ? 'Save Batch' : 'Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Student to Batch Modal */}
      {assignBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-student-batch-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="assign-student-batch-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Assign Student · {assignBatch.name}
              </h3>
              <button
                type="button"
                onClick={() => setAssignBatch(null)}
                aria-label="Close assign student modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {assignError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {assignError}
              </div>
            )}
            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-3">
              <div>
                <label htmlFor="assign-stu-select" className="block text-xs font-medium text-slate-700 mb-1">
                  Student
                </label>
                <select
                  id="assign-stu-select"
                  value={assignStudentId}
                  onChange={(e) => setAssignStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.studentCode ?? s.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="assign-status-select" className="block text-xs font-medium text-slate-700 mb-1">
                  Enrollment Status
                </label>
                <select
                  id="assign-status-select"
                  value={assignStatus}
                  onChange={(e) =>
                    setAssignStatus(e.target.value as 'Active' | 'Waitlisted')
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="Active">Active Seat</option>
                  <option value="Waitlisted">Waitlisted</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignInvoice}
                  onChange={(e) => setAssignInvoice(e.target.checked)}
                />
                <span>Issue tuition invoice automatically</span>
              </label>
              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setAssignBatch(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {assignSaving ? 'Assigning...' : 'Assign to Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Student Batch Modal */}
      {transferBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-batch-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="transfer-batch-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Transfer Student from {transferBatch.name}
              </h3>
              <button
                type="button"
                onClick={() => setTransferBatch(null)}
                aria-label="Close transfer modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {transferError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {transferError}
              </div>
            )}
            {transferEnrollments.length === 0 || transferDestinations.length === 0 ? (
              <div className="mt-4 space-y-4">
                <p className="text-xs text-slate-600">
                  {transferEnrollments.length === 0
                    ? 'There are no active or waitlisted students in this batch to transfer.'
                    : 'Create another cohort batch for the same course before transferring students.'}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setTransferBatch(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleTransferSubmit} className="mt-4 space-y-3">
                <div>
                  <label htmlFor="transfer-enr-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Student Enrollment
                  </label>
                  <select
                    id="transfer-enr-select"
                    value={transferEnrollmentId}
                    onChange={(e) => setTransferEnrollmentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {transferEnrollments.map((enr) => {
                      const stu = data.students.find((s) => s.id === enr.studentId);
                      return (
                        <option key={enr.id} value={enr.id}>
                          {stu?.name ?? enr.studentId} ({enr.status})
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label htmlFor="transfer-dest-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Destination Batch (Same Course)
                  </label>
                  <select
                    id="transfer-dest-select"
                    value={transferTargetBatchId}
                    onChange={(e) => setTransferTargetBatchId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {transferDestinations.map((dest) => (
                      <option key={dest.id} value={dest.id}>
                        {dest.name} ({dest.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="transfer-reason-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Reason for Transfer
                  </label>
                  <input
                    id="transfer-reason-input"
                    type="text"
                    required
                    minLength={3}
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    placeholder="e.g. Evening schedule accommodation"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTransferBatch(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transferSaving}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    {transferSaving ? 'Transferring...' : 'Confirm Transfer'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Classroom Modal */}
      {roomModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="classroom-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="classroom-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingRoom ? `Edit Classroom · ${editingRoom.code}` : 'Register Classroom'}
              </h3>
              <button
                type="button"
                onClick={() => setRoomModalOpen(false)}
                aria-label="Close classroom modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {rError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {rError}
              </div>
            )}
            <form onSubmit={handleRoomSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="room-code-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Room Code
                  </label>
                  <input
                    id="room-code-in"
                    type="text"
                    required
                    value={rCode}
                    onChange={(e) => setRCode(e.target.value)}
                    placeholder="e.g. LAB-302"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="room-cap-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Capacity
                  </label>
                  <input
                    id="room-cap-in"
                    type="number"
                    min={1}
                    max={500}
                    value={rCapacity}
                    onChange={(e) => setRCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="room-name-in" className="block text-xs font-medium text-slate-700 mb-1">
                  Room Name
                </label>
                <input
                  id="room-name-in"
                  type="text"
                  required
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="room-building-in" className="block text-xs font-medium text-slate-700 mb-1">
                  Building
                </label>
                <input
                  id="room-building-in"
                  type="text"
                  required
                  value={rBuilding}
                  onChange={(e) => setRBuilding(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="room-equip-in" className="block text-xs font-medium text-slate-700 mb-1">
                  Equipment
                </label>
                <input
                  id="room-equip-in"
                  type="text"
                  value={rEquipment}
                  onChange={(e) => setREquipment(e.target.value)}
                  placeholder="e.g. 24 Workstations, Dual Projectors"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rActive}
                  onChange={(e) => setRActive(e.target.checked)}
                />
                <span>Active for scheduling</span>
              </label>
              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRoomModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {rSaving ? 'Saving...' : 'Save Classroom'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
