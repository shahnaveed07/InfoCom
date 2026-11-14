import React, { useState } from 'react';
import {
  AlertCircle,
  Archive,
  Building2,
  CheckCircle2,
  Edit3,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { formatMoney, isInactiveEnrollmentStatus } from '../shared/academic';
import type { CohortStatus, Course, DashboardPayload, Department } from '../shared/types';
import { api } from '../utils/api';
import { ConfirmDialog } from './ConfirmDialog';

interface CoursesCohortsViewProps {
  data: DashboardPayload;
  onCreateCourse: (payload: {
    code: string;
    title: string;
    track: string;
    category?: string;
    departmentId?: string | null;
    description: string;
    prerequisites?: string;
    learningObjectives?: string[];
    passingScore?: number;
    minAttendanceRate?: number;
    gradingConfig?: {
      scaleName?: string;
      passingGrade?: string;
      rubricNotes?: string;
    };
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
  onDashboardUpdate?: (dashboard: DashboardPayload) => void;
}

export function CoursesCohortsView({
  data,
  onCreateCourse,
  onCreateCohort,
  onDashboardUpdate,
}: CoursesCohortsViewProps) {
  const isAdmin = data.user.role === 'admin';
  const currency = data.academy?.currency || 'USD';
  const departments = data.departments ?? [];
  const instructors = data.users.filter(
    (u) => u.role === 'instructor' || u.role === 'admin'
  );

  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [cohortModalOpen, setCohortModalOpen] = useState(false);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Course form state (shared by Create & Edit)
  const [cCode, setCCode] = useState('');
  const [cTitle, setCTitle] = useState('');
  const [cTrack, setCTrack] = useState('Software & Cloud');
  const [cCategory, setCCategory] = useState('Technical Bootcamp');
  const [cDeptId, setCDeptId] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cPrereqs, setCPrereqs] = useState('');
  const [cObjectivesText, setCObjectivesText] = useState('');
  const [cPassingScore, setCPassingScore] = useState('70');
  const [cMinAttendance, setCMinAttendance] = useState('75');
  const [cScaleName, setCScaleName] = useState('Standard Percentage');
  const [cRubricNotes, setCRubricNotes] = useState('');
  const [cInstructorId, setCInstructorId] = useState(instructors[0]?.id ?? '');
  const [cWeeks, setCWeeks] = useState('8');
  const [cTuition, setCTuition] = useState('1450.00');
  const [cModules, setCModules] = useState<
    Array<{ id?: string; code: string; title: string; weight: number; labHours: number }>
  >([
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

  // Department form state
  const [dCode, setDCode] = useState('');
  const [dName, setDName] = useState('');
  const [dHeadId, setDHeadId] = useState('');
  const [dStatus, setDStatus] = useState<'active' | 'inactive' | 'archived'>('active');
  const [dError, setDError] = useState('');
  const [dSaving, setDSaving] = useState(false);

  function openCreateCourseModal() {
    setEditingCourse(null);
    setCCode('');
    setCTitle('');
    setCTrack('Software Engineering');
    setCCategory('Technical Bootcamp');
    setCDeptId(departments[0]?.id ?? '');
    setCDesc('');
    setCPrereqs('');
    setCObjectivesText('');
    setCPassingScore('70');
    setCMinAttendance('75');
    setCScaleName('Standard Percentage');
    setCRubricNotes('');
    setCInstructorId(instructors[0]?.id ?? '');
    setCWeeks('8');
    setCTuition('1450.00');
    setCModules([
      { code: 'MOD-1', title: 'Core Foundations', weight: 50, labHours: 16 },
      { code: 'MOD-2', title: 'Applied Capstone Lab', weight: 50, labHours: 18 },
    ]);
    setCError('');
    setCourseModalOpen(true);
  }

  function openEditCourseModal(course: Course) {
    setEditingCourse(course);
    setCCode(course.code);
    setCTitle(course.title);
    setCTrack(course.track);
    setCCategory(course.category ?? 'Technical Bootcamp');
    setCDeptId(course.departmentId ?? '');
    setCDesc(course.description ?? '');
    setCPrereqs(course.prerequisites ?? '');
    setCObjectivesText((course.learningObjectives ?? []).join('\n'));
    setCPassingScore(String(course.passingScore ?? 70));
    setCMinAttendance(String(course.minAttendanceRate ?? 75));
    setCScaleName(course.gradingConfig?.scaleName ?? 'Standard Percentage');
    setCRubricNotes(course.gradingConfig?.rubricNotes ?? '');
    setCInstructorId(course.instructorId);
    setCWeeks(String(course.durationWeeks));
    setCTuition(course.tuitionFee);
    setCModules(
      course.modules.map((m) => ({
        id: m.id,
        code: m.code,
        title: m.title,
        weight: m.weight,
        labHours: m.labHours,
      }))
    );
    setCError('');
    setCourseModalOpen(true);
  }

  function openDeptModal(dept?: Department) {
    setEditingDept(dept ?? null);
    setDCode(dept?.code ?? '');
    setDName(dept?.name ?? '');
    setDHeadId(dept?.headUserId ?? '');
    setDStatus((dept?.status as 'active' | 'inactive' | 'archived') ?? 'active');
    setDError('');
    setDeptModalOpen(true);
  }

  async function handleCourseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCError('');
    const totalWeight = cModules.reduce((acc, m) => acc + Number(m.weight), 0);
    if (totalWeight !== 100) {
      setCError(`Module weights must equal 100% (currently ${totalWeight}%).`);
      return;
    }

    const learningObjectives = cObjectivesText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 2);

    setCSaving(true);
    try {
      if (editingCourse) {
        const res = await api.updateCourse(editingCourse.id, {
          title: cTitle.trim(),
          track: cTrack.trim(),
          category: cCategory.trim(),
          departmentId: cDeptId || null,
          description: cDesc.trim(),
          prerequisites: cPrereqs.trim(),
          learningObjectives,
          passingScore: Number(cPassingScore) || 70,
          minAttendanceRate: Number(cMinAttendance) || 75,
          gradingConfig: {
            scaleName: cScaleName.trim(),
            rubricNotes: cRubricNotes.trim(),
          },
          instructorId: cInstructorId,
          durationWeeks: Number(cWeeks) || 8,
          tuitionFee: cTuition.trim(),
          modules: cModules.map((m) => ({
            ...(m.id ? { id: m.id } : {}),
            code: m.code.trim().toUpperCase(),
            title: m.title.trim(),
            weight: Number(m.weight),
            labHours: Number(m.labHours) || 10,
          })),
        });
        onDashboardUpdate?.(res.dashboard);
        setNotice(`Updated course master data for ${editingCourse.code}.`);
      } else {
        await onCreateCourse({
          code: cCode.trim().toUpperCase(),
          title: cTitle.trim(),
          track: cTrack.trim(),
          category: cCategory.trim(),
          departmentId: cDeptId || null,
          description: cDesc.trim(),
          prerequisites: cPrereqs.trim(),
          learningObjectives,
          passingScore: Number(cPassingScore) || 70,
          minAttendanceRate: Number(cMinAttendance) || 75,
          gradingConfig: {
            scaleName: cScaleName.trim(),
            rubricNotes: cRubricNotes.trim(),
          },
          instructorId: cInstructorId,
          durationWeeks: Number(cWeeks) || 8,
          tuitionFee: cTuition.trim(),
          modules: cModules.map((m) => ({
            code: m.code.trim().toUpperCase(),
            title: m.title.trim(),
            weight: Number(m.weight),
            labHours: Number(m.labHours) || 10,
          })),
        });
        setNotice(`Course ${cCode.trim().toUpperCase()} added to catalog.`);
      }
      setCourseModalOpen(false);
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Unable to save course.');
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

  async function handleDeptSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDError('');
    setDSaving(true);
    try {
      if (editingDept) {
        const res = await api.updateDepartment(editingDept.id, {
          code: dCode.trim().toUpperCase(),
          name: dName.trim(),
          headUserId: dHeadId || null,
          status: dStatus,
        });
        onDashboardUpdate?.(res.dashboard);
        setNotice(`Department ${dName.trim()} updated.`);
      } else {
        const res = await api.createDepartment({
          code: dCode.trim().toUpperCase(),
          name: dName.trim(),
          headUserId: dHeadId || null,
          status: dStatus,
        });
        onDashboardUpdate?.(res.dashboard);
        setNotice(`Department ${dName.trim()} created.`);
      }
      setDeptModalOpen(false);
    } catch (err) {
      setDError(err instanceof Error ? err.message : 'Unable to save department.');
    } finally {
      setDSaving(false);
    }
  }

  async function handleToggleArchiveCourse() {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    setError('');
    const nextArchived = !Boolean(archiveTarget.isArchived);
    try {
      const res = await api.updateCourse(archiveTarget.id, {
        isArchived: nextArchived,
      });
      onDashboardUpdate?.(res.dashboard);
      setNotice(
        `${archiveTarget.code} is now ${nextArchived ? 'archived' : 'active'}.`
      );
      setArchiveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update course status.');
    } finally {
      setArchiveBusy(false);
    }
  }

  const visibleCourses = showArchived
    ? data.courses
    : data.courses.filter((c) => !c.isArchived);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Layers className="w-4 h-4 text-blue-700" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Course Master Data, Departments & Cohorts
            </h2>
            <p className="text-xs text-slate-500">
              Manage academic departments, weighted modules, prerequisites, grading thresholds, and course lifecycle
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openDeptModal()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>New Department</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCohError('');
                setCohortModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Cohort</span>
            </button>
            <button
              type="button"
              onClick={openCreateCourseModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Course</span>
            </button>
          </div>
        )}
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

      {/* Departments Strip (Admin) */}
      {isAdmin && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Academic Departments
            </h3>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {departments.length} departments
            </span>
          </div>
          {departments.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No departments configured yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {departments.map((dept) => {
                const head = instructors.find((i) => i.id === dept.headUserId);
                return (
                  <div
                    key={dept.id}
                    className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold text-blue-700 mr-2">
                        {dept.code}
                      </span>
                      <span className="font-medium text-slate-900">{dept.name}</span>
                      {head && (
                        <span className="text-slate-500 ml-2">
                          · Head: {head.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-500 tabular-nums">
                        {dept.courseCount ?? 0} courses
                      </span>
                      <span
                        className={`font-medium capitalize ${
                          dept.status === 'active'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {dept.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => openDeptModal(dept)}
                        className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Courses Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Training Programs Master Catalog
          </h3>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span>Show Archived</span>
            </label>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {visibleCourses.length} courses
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-5">Course</th>
                <th className="py-2.5 px-4">Category & Dept</th>
                <th className="py-2.5 px-4">Lead Instructor</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
                <th className="py-2.5 px-4 text-right">Pass / Att</th>
                <th className="py-2.5 px-4 text-right">Tuition</th>
                <th className="py-2.5 px-4">Status</th>
                {isAdmin && <th className="py-2.5 px-5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {visibleCourses.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5">
                    <div className="font-medium text-slate-900 text-sm">{c.title}</div>
                    <div className="font-mono text-xs text-blue-700 mt-0.5">
                      {c.code} · {c.modules.length} modules
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    <div>{c.category ?? c.track}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.departmentName ?? c.track}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{c.instructorName}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                    {c.durationWeeks} wks
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                    {c.passingScore ?? 70}% / {c.minAttendanceRate ?? 75}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatMoney(c.tuitionFee, currency)}
                  </td>
                  <td
                    className={`py-3 px-4 font-medium ${
                      c.isArchived ? 'text-slate-500' : 'text-emerald-700'
                    }`}
                  >
                    {c.isArchived ? 'Archived' : 'Active'}
                  </td>
                  {isAdmin && (
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditCourseModal(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchiveTarget(c)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 font-medium rounded cursor-pointer ${
                            c.isArchived
                              ? 'text-emerald-700 hover:bg-emerald-50'
                              : 'text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {c.isArchived ? (
                            <>
                              <RotateCcw className="w-3 h-3" />
                              <span>Activate</span>
                            </>
                          ) : (
                            <>
                              <Archive className="w-3 h-3" />
                              <span>Archive</span>
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cohorts Summary Table */}
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
                    !isInactiveEnrollmentStatus(e.status)
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

      {/* Create / Edit Course Modal */}
      {isAdmin && courseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-master-modal-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="course-master-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingCourse
                  ? `Edit Course · ${editingCourse.code}`
                  : 'Create Training Course'}
              </h3>
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                aria-label="Close course modal"
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

            <form onSubmit={handleCourseSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="course-code-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Course Code
                  </label>
                  <input
                    id="course-code-input"
                    type="text"
                    required
                    disabled={Boolean(editingCourse)}
                    value={cCode}
                    onChange={(e) => setCCode(e.target.value)}
                    placeholder="e.g. AI-210"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label htmlFor="course-category-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    id="course-category-input"
                    type="text"
                    value={cCategory}
                    onChange={(e) => setCCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-dept-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    id="course-dept-select"
                    value={cDeptId}
                    onChange={(e) => setCDeptId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">General Catalog</option>
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
                  <label htmlFor="course-title-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Course Title
                  </label>
                  <input
                    id="course-title-input"
                    type="text"
                    required
                    value={cTitle}
                    onChange={(e) => setCTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-track-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Track
                  </label>
                  <input
                    id="course-track-input"
                    type="text"
                    required
                    value={cTrack}
                    onChange={(e) => setCTrack(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label htmlFor="course-instructor-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Lead Instructor
                  </label>
                  <select
                    id="course-instructor-select"
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
                  <label htmlFor="course-weeks-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Duration (Wks)
                  </label>
                  <input
                    id="course-weeks-input"
                    type="number"
                    min={1}
                    max={104}
                    value={cWeeks}
                    onChange={(e) => setCWeeks(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-tuition-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Tuition ({currency})
                  </label>
                  <input
                    id="course-tuition-input"
                    type="text"
                    required
                    value={cTuition}
                    onChange={(e) => setCTuition(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="course-pass-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Passing Score (%)
                  </label>
                  <input
                    id="course-pass-input"
                    type="number"
                    min={1}
                    max={100}
                    value={cPassingScore}
                    onChange={(e) => setCPassingScore(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-att-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Min Attendance (%)
                  </label>
                  <input
                    id="course-att-input"
                    type="number"
                    min={1}
                    max={100}
                    value={cMinAttendance}
                    onChange={(e) => setCMinAttendance(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-scale-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Grading Scale
                  </label>
                  <input
                    id="course-scale-input"
                    type="text"
                    value={cScaleName}
                    onChange={(e) => setCScaleName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="course-prereq-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Prerequisites
                </label>
                <input
                  id="course-prereq-input"
                  type="text"
                  value={cPrereqs}
                  onChange={(e) => setCPrereqs(e.target.value)}
                  placeholder="e.g. Basic JavaScript & Git workflow familiarity"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="course-objectives-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Learning Objectives (one per line)
                  </label>
                  <textarea
                    id="course-objectives-input"
                    rows={3}
                    value={cObjectivesText}
                    onChange={(e) => setCObjectivesText(e.target.value)}
                    placeholder="Design normalized PostgreSQL schemas&#10;Build typed REST APIs with Zod"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="course-rubric-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Description & Grading Rubric Notes
                  </label>
                  <textarea
                    id="course-rubric-input"
                    rows={3}
                    value={cDesc}
                    onChange={(e) => setCDesc(e.target.value)}
                    placeholder="Course overview and assessment breakdown..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
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
                        aria-label={`Module ${idx + 1} code`}
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
                        aria-label={`Module ${idx + 1} title`}
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
                        aria-label={`Module ${idx + 1} weight`}
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
                            aria-label={`Remove module ${idx + 1}`}
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
                  {cSaving
                    ? 'Saving...'
                    : editingCourse
                      ? 'Save Course Changes'
                      : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Modal */}
      {isAdmin && deptModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="department-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="department-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingDept ? `Edit Department · ${editingDept.code}` : 'New Academic Department'}
              </h3>
              <button
                type="button"
                onClick={() => setDeptModalOpen(false)}
                aria-label="Close department modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {dError && (
              <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {dError}
              </div>
            )}
            <form onSubmit={handleDeptSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dept-code-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Department Code
                  </label>
                  <input
                    id="dept-code-input"
                    type="text"
                    required
                    value={dCode}
                    onChange={(e) => setDCode(e.target.value)}
                    placeholder="e.g. CLOUD-ENG"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="dept-status-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    id="dept-status-select"
                    value={dStatus}
                    onChange={(e) =>
                      setDStatus(e.target.value as 'active' | 'inactive' | 'archived')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="dept-name-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Department Name
                </label>
                <input
                  id="dept-name-input"
                  type="text"
                  required
                  value={dName}
                  onChange={(e) => setDName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="dept-head-select" className="block text-xs font-medium text-slate-700 mb-1">
                  Department Head (Optional)
                </label>
                <select
                  id="dept-head-select"
                  value={dHeadId}
                  onChange={(e) => setDHeadId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="">Unassigned</option>
                  {instructors.map((ins) => (
                    <option key={ins.id} value={ins.id}>
                      {ins.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeptModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {dSaving ? 'Saving...' : 'Save Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Cohort Modal */}
      {isAdmin && cohortModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-cohort-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="create-cohort-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Cohort Batch
              </h3>
              <button
                type="button"
                onClick={() => setCohortModalOpen(false)}
                aria-label="Close cohort modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cohError && (
              <div role="alert" className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{cohError}</span>
              </div>
            )}

            <form onSubmit={handleCohortSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="coh-code-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Code
                  </label>
                  <input
                    id="coh-code-in"
                    type="text"
                    required
                    value={cohCode}
                    onChange={(e) => setCohCode(e.target.value)}
                    placeholder="e.g. COH-2026-SPR"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="coh-name-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Name
                  </label>
                  <input
                    id="coh-name-in"
                    type="text"
                    required
                    value={cohName}
                    onChange={(e) => setCohName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="coh-course-in" className="block text-xs font-medium text-slate-700 mb-1">
                  Course
                </label>
                <select
                  id="coh-course-in"
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
                  <label htmlFor="coh-ins-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Instructor
                  </label>
                  <select
                    id="coh-ins-in"
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
                  <label htmlFor="coh-cap-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Capacity
                  </label>
                  <input
                    id="coh-cap-in"
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
                  <label htmlFor="coh-start-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="coh-start-in"
                    type="date"
                    required
                    value={cohStart}
                    onChange={(e) => setCohStart(e.target.value)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="coh-end-in" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="coh-end-in"
                    type="date"
                    required
                    value={cohEnd}
                    onChange={(e) => setCohEnd(e.target.value)}
                    className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="coh-status-in" className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    id="coh-status-in"
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

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={
          archiveTarget?.isArchived
            ? `Activate Course ${archiveTarget.code}`
            : `Archive Course ${archiveTarget?.code}`
        }
        description={
          archiveTarget?.isArchived
            ? `Activating ${archiveTarget.title} makes it visible for new student registrations and cohorts.`
            : `Archiving ${archiveTarget?.title} hides it from new admissions while preserving all historical enrollments, grades, and certificates.`
        }
        confirmLabel={archiveTarget?.isArchived ? 'Activate Course' : 'Archive Course'}
        tone={archiveTarget?.isArchived ? 'primary' : 'danger'}
        busy={archiveBusy}
        onConfirm={handleToggleArchiveCourse}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
