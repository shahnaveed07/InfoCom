import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Layers,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { formatMoney } from '../shared/academic';
import type { CohortStatus, DashboardPayload } from '../shared/types';

interface CoursesCohortsViewProps {
  data: DashboardPayload;
  onCreateCourse: (payload: {
    code: string;
    title: string;
    track: string;
    description: string;
    instructorId: string;
    durationWeeks: number;
    tuitionFee: string;
    modules: Array<{
      code: string;
      title: string;
      weight: number;
      labHours: number;
    }>;
  }) => Promise<void>;
  onCreateCohort: (payload: {
    code: string;
    name: string;
    courseId: string;
    instructorId: string;
    capacity: number;
    startDate: string;
    endDate: string;
    status: CohortStatus;
  }) => Promise<void>;
}

export function CoursesCohortsView({
  data,
  onCreateCourse,
  onCreateCohort,
}: CoursesCohortsViewProps) {
  const instructors = data.users.filter(
    (u) => u.role === 'instructor' || u.role === 'admin'
  );

  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [cohortModalOpen, setCohortModalOpen] = useState(false);
  const [notice, setNotice] = useState('');

  // Course form state
  const [cCode, setCCode] = useState('');
  const [cTitle, setCTitle] = useState('');
  const [cTrack, setCTrack] = useState('Software & Cloud');
  const [cDesc, setCDesc] = useState('');
  const [cInstructorId, setCInstructorId] = useState(instructors[0]?.id ?? '');
  const [cWeeks, setCWeeks] = useState('8');
  const [cTuition, setCTuition] = useState('1450.00');
  const [cModules, setCModules] = useState([
    { code: 'MOD-1', title: 'Core Foundations', weight: 50, labHours: 16 },
    { code: 'MOD-2', title: 'Applied Capstone Lab', weight: 50, labHours: 18 },
  ]);
  const [cError, setCError] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // Cohort form state
  const [cohCode, setCohCode] = useState('');
  const [cohName, setCohName] = useState('Cohort D · Spring');
  const [cohCourseId, setCohCourseId] = useState(data.courses[0]?.id ?? '');
  const [cohInstructorId, setCohInstructorId] = useState(instructors[0]?.id ?? '');
  const [cohCapacity, setCohCapacity] = useState('24');
  const [cohStart, setCohStart] = useState('2026-09-01');
  const [cohEnd, setCohEnd] = useState('2026-11-20');
  const [cohStatus, setCohStatus] = useState<CohortStatus>('Active');
  const [cohError, setCohError] = useState('');
  const [cohSaving, setCohSaving] = useState(false);

  async function handleCourseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCError('');
    const totalWeight = cModules.reduce((acc, m) => acc + Number(m.weight), 0);
    if (totalWeight !== 100) {
      setCError(`Module weights must equal 100% (currently ${totalWeight}%).`);
      return;
    }
    setCSaving(true);
    try {
      await onCreateCourse({
        code: cCode.trim().toUpperCase(),
        title: cTitle.trim(),
        track: cTrack.trim(),
        description: cDesc.trim(),
        instructorId: cInstructorId,
        durationWeeks: Number(cWeeks) || 8,
        tuitionFee: cTuition.trim(),
        modules: cModules.map((m) => ({
          code: m.code.trim().toUpperCase(),
          title: m.title.trim(),
          weight: Number(m.weight),
          labHours: Number(m.labHours),
        })),
      });
      setCourseModalOpen(false);
      setCCode('');
      setCTitle('');
      setCDesc('');
      setNotice(`Course ${cCode.trim().toUpperCase()} added to catalog.`);
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Unable to create course.');
    } finally {
      setCSaving(false);
    }
  }

  async function handleCohortSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCohError('');
    setCohSaving(true);
    try {
      await onCreateCohort({
        code: cohCode.trim().toUpperCase(),
        name: cohName.trim(),
        courseId: cohCourseId,
        instructorId: cohInstructorId,
        capacity: Number(cohCapacity) || 24,
        startDate: new Date(cohStart).toISOString(),
        endDate: new Date(cohEnd).toISOString(),
        status: cohStatus,
      });
      setCohortModalOpen(false);
      setCohCode('');
      setNotice(`Cohort ${cohName.trim()} created.`);
    } catch (err) {
      setCohError(err instanceof Error ? err.message : 'Unable to create cohort.');
    } finally {
      setCohSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Layers className="w-4 h-4 text-blue-700" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Curriculum Catalog & Cohort Batches
            </h2>
            <p className="text-xs text-slate-500">
              Configure weighted course modules, tuition fees, and active training cohorts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setCohError('');
              setCohortModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Cohort</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCError('');
              setCourseModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Course</span>
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

      {/* Courses Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Training Programs
          </h3>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {data.courses.length} courses
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-5">Course</th>
                <th className="py-2.5 px-4">Track</th>
                <th className="py-2.5 px-4">Lead Instructor</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
                <th className="py-2.5 px-4 text-right">Modules</th>
                <th className="py-2.5 px-5 text-right">Tuition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {data.courses.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5">
                    <div className="font-medium text-slate-900">{c.title}</div>
                    <div className="font-mono text-xs text-blue-700 mt-0.5">{c.code}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">{c.track}</td>
                  <td className="py-3 px-4 text-xs text-slate-700">{c.instructorName}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                    {c.durationWeeks} wks
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                    {c.modules.length}
                  </td>
                  <td className="py-3 px-5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {formatMoney(c.tuitionFee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cohorts Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Active & Planned Cohorts
          </h3>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {data.cohorts.length} batches
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-5">Cohort Batch</th>
                <th className="py-2.5 px-4">Course</th>
                <th className="py-2.5 px-4">Lead Instructor</th>
                <th className="py-2.5 px-4 text-right">Seat Utilization</th>
                <th className="py-2.5 px-4">Schedule Window</th>
                <th className="py-2.5 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {data.cohorts.map((coh) => {
                const course = data.courses.find((c) => c.id === coh.courseId);
                const filled = data.enrollments.filter(
                  (e) =>
                    e.courseId === coh.courseId &&
                    (e.cohortId === coh.id || e.cohort === coh.name) &&
                    e.status !== 'Dropped'
                ).length;
                return (
                  <tr key={coh.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-900">{coh.name}</div>
                      <div className="font-mono text-xs text-slate-500 mt-0.5">
                        {coh.code}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {course?.code} — {course?.title}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {coh.instructorName}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                      {filled} / {coh.capacity}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(coh.startDate).toLocaleDateString('en-US')} –{' '}
                      {new Date(coh.endDate).toLocaleDateString('en-US')}
                    </td>
                    <td className="py-3 px-5 text-right text-xs font-medium text-emerald-700">
                      {coh.status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* New Course Modal */}
      {courseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Create Training Course
              </h3>
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{cError}</span>
              </div>
            )}

            <form onSubmit={handleCourseSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Course Code
                  </label>
                  <input
                    type="text"
                    required
                    value={cCode}
                    onChange={(e) => setCCode(e.target.value)}
                    placeholder="e.g. AI-210"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Track
                  </label>
                  <input
                    type="text"
                    required
                    value={cTrack}
                    onChange={(e) => setCTrack(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Course Title
                </label>
                <input
                  type="text"
                  required
                  value={cTitle}
                  onChange={(e) => setCTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Lead Instructor
                  </label>
                  <select
                    value={cInstructorId}
                    onChange={(e) => setCInstructorId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {instructors.map((ins) => (
                      <option key={ins.id} value={ins.id}>
                        {ins.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Weeks
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={cWeeks}
                    onChange={(e) => setCWeeks(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tuition ($)
                  </label>
                  <input
                    type="text"
                    required
                    value={cTuition}
                    onChange={(e) => setCTuition(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-700">
                    Weighted Modules (Total must equal 100%)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCModules((prev) => [
                        ...prev,
                        {
                          code: `MOD-${prev.length + 1}`,
                          title: 'New Module',
                          weight: 0,
                          labHours: 10,
                        },
                      ])
                    }
                    className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                  >
                    + Add Module
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {cModules.map((m, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="text"
                        value={m.code}
                        onChange={(e) =>
                          setCModules((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, code: e.target.value } : item
                            )
                          )
                        }
                        className="col-span-3 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded"
                        placeholder="Code"
                      />
                      <input
                        type="text"
                        value={m.title}
                        onChange={(e) =>
                          setCModules((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, title: e.target.value } : item
                            )
                          )
                        }
                        className="col-span-5 px-2 py-1.5 text-xs border border-slate-300 rounded"
                        placeholder="Module title"
                      />
                      <input
                        type="number"
                        value={m.weight}
                        onChange={(e) =>
                          setCModules((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, weight: Number(e.target.value) }
                                : item
                            )
                          )
                        }
                        className="col-span-2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded"
                        placeholder="%"
                      />
                      <div className="col-span-2 flex justify-end">
                        {cModules.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setCModules((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCourseModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {cSaving ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Cohort Modal */}
      {cohortModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Create Cohort Batch
              </h3>
              <button
                type="button"
                onClick={() => setCohortModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cohError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{cohError}</span>
              </div>
            )}

            <form onSubmit={handleCohortSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Code
                  </label>
                  <input
                    type="text"
                    required
                    value={cohCode}
                    onChange={(e) => setCohCode(e.target.value)}
                    placeholder="e.g. COH-2026-SPR"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Name
                  </label>
                  <input
                    type="text"
                    required
                    value={cohName}
                    onChange={(e) => setCohName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Course
                </label>
                <select
                  value={cohCourseId}
                  onChange={(e) => setCohCourseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Instructor
                  </label>
                  <select
                    value={cohInstructorId}
                    onChange={(e) => setCohInstructorId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {instructors.map((ins) => (
                      <option key={ins.id} value={ins.id}>
                        {ins.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Capacity
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={cohCapacity}
                    onChange={(e) => setCohCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={cohStart}
                    onChange={(e) => setCohStart(e.target.value)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={cohEnd}
                    onChange={(e) => setCohEnd(e.target.value)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    value={cohStatus}
                    onChange={(e) => setCohStatus(e.target.value as CohortStatus)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="Planned">Planned</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCohortModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cohSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {cohSaving ? 'Saving...' : 'Create Cohort'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
