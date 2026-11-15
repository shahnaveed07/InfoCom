import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Edit3,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  isInactiveEnrollmentStatus,
} from '../shared/academic';
import type {
  AssessmentRecord,
  AssessmentType,
  CourseModule,
  DashboardPayload,
} from '../shared/types';
import { api } from '../utils/api';

const ASSESSMENT_TYPES: AssessmentType[] = [
  'Assignment',
  'Quiz',
  'Lab',
  'Midterm',
  'Final',
];

interface CourseTrackingViewProps {
  data: DashboardPayload;
  onToggleModule: (payload: {
    enrollmentId: string;
    moduleId: string;
    completed: boolean;
  }) => Promise<void>;
  onSaveGrade: (payload: {
    studentId: string;
    courseId: string;
    moduleId: string;
    score: number;
    feedback: string;
  }) => Promise<void>;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

export function CourseTrackingView({
  data,
  onToggleModule,
  onSaveGrade,
  onDashboardUpdate,
}: CourseTrackingViewProps) {
  const [selectedCourseId, setSelectedCourseId] = useState(
    data.courses[0]?.id ?? ''
  );

  // Legacy module grade modal
  const [gradeTarget, setGradeTarget] = useState<{
    studentId: string;
    studentName: string;
    module: CourseModule;
  } | null>(null);
  const [scoreInput, setScoreInput] = useState('88');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  // Create / Edit Assessment Modal
  const [assessmentModalOpen, setAssessmentModalOpen] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<AssessmentRecord | null>(null);
  const [asmtTitle, setAsmtTitle] = useState('');
  const [asmtType, setAsmtType] = useState<AssessmentType>('Assignment');
  const [asmtModuleId, setAsmtModuleId] = useState('');
  const [asmtBatchId, setAsmtBatchId] = useState('');
  const [asmtMaxScore, setAsmtMaxScore] = useState('100');
  const [asmtWeight, setAsmtWeight] = useState('15');
  const [asmtDueDate, setAsmtDueDate] = useState('');
  const [asmtError, setAsmtError] = useState('');
  const [savingAsmt, setSavingAsmt] = useState(false);

  // Grade Roster Modal for any Assessment
  const [rosterAssessmentId, setRosterAssessmentId] = useState<string | null>(null);
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [draftFeedbacks, setDraftFeedbacks] = useState<Record<string, string>>({});
  const [rosterNotice, setRosterNotice] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [savingRosterStudentId, setSavingRosterStudentId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const course =
    data.courses.find((c) => c.id === selectedCourseId) ?? data.courses[0];

  const courseCohorts = useMemo(
    () => (course ? data.cohorts.filter((b) => b.courseId === course.id) : []),
    [course, data.cohorts]
  );

  const courseAssessments = useMemo(
    () =>
      course
        ? (data.assessments ?? []).filter((a) => a.courseId === course.id)
        : [],
    [course, data.assessments]
  );

  const rosterAssessment = useMemo(
    () =>
      rosterAssessmentId
        ? courseAssessments.find((a) => a.id === rosterAssessmentId) ?? null
        : null,
    [rosterAssessmentId, courseAssessments]
  );

  if (!course) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        No courses configured.
      </div>
    );
  }

  const courseEnrollments = data.enrollments.filter(
    (e) => e.courseId === course.id && !isInactiveEnrollmentStatus(e.status)
  );

  function openGradeEditor(
    studentId: string,
    studentName: string,
    mod: CourseModule
  ) {
    const existing = data.grades.find(
      (g) =>
        g.studentId === studentId &&
        g.courseId === course.id &&
        g.moduleId === mod.id
    );
    setGradeTarget({ studentId, studentName, module: mod });
    setScoreInput(existing ? String(existing.score) : '85');
    setFeedbackInput(existing?.feedback ?? '');
    setGradeError('');
  }

  async function handleGradeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gradeTarget) return;
    const parsed = Number(scoreInput);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      setGradeError('Score must be a valid number from 0 to 100.');
      return;
    }
    setSavingGrade(true);
    try {
      await onSaveGrade({
        studentId: gradeTarget.studentId,
        courseId: course.id,
        moduleId: gradeTarget.module.id,
        score: parsed,
        feedback: feedbackInput.trim(),
      });
      setGradeTarget(null);
    } catch (err) {
      setGradeError(
        err instanceof Error ? err.message : 'Unable to save grade.'
      );
    } finally {
      setSavingGrade(false);
    }
  }

  function openCreateAssessmentModal() {
    setEditingAssessment(null);
    setAsmtTitle('');
    setAsmtType('Assignment');
    setAsmtModuleId('');
    setAsmtBatchId('');
    setAsmtMaxScore('100');
    setAsmtWeight('15');
    setAsmtDueDate('');
    setAsmtError('');
    setAssessmentModalOpen(true);
  }

  function openEditAssessmentModal(asmt: AssessmentRecord) {
    setEditingAssessment(asmt);
    setAsmtTitle(asmt.title);
    setAsmtType(asmt.assessmentType);
    setAsmtModuleId(asmt.moduleId ?? '');
    setAsmtBatchId(asmt.batchId ?? '');
    setAsmtMaxScore(String(asmt.maxScore));
    setAsmtWeight(String(asmt.weight));
    setAsmtDueDate(asmt.dueDate ? asmt.dueDate.slice(0, 10) : '');
    setAsmtError('');
    setAssessmentModalOpen(true);
  }

  async function handleAssessmentSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAsmtError('');
    setActionError('');
    setActionNotice('');
    setSavingAsmt(true);
    try {
      const payload = {
        courseId: course.id,
        moduleId: asmtModuleId || null,
        batchId: asmtBatchId || null,
        title: asmtTitle.trim(),
        assessmentType: asmtType,
        maxScore: Number(asmtMaxScore),
        weight: Number(asmtWeight),
        dueDate: asmtDueDate ? new Date(`${asmtDueDate}T23:59:00Z`).toISOString() : null,
      };
      if (editingAssessment) {
        const res = await api.updateAssessment(editingAssessment.id, {
          title: payload.title,
          assessmentType: payload.assessmentType,
          moduleId: payload.moduleId,
          batchId: payload.batchId,
          maxScore: payload.maxScore,
          weight: payload.weight,
          dueDate: payload.dueDate,
        });
        onDashboardUpdate(res.dashboard);
        setActionNotice(`Updated assessment "${payload.title}".`);
      } else {
        const res = await api.createAssessment(payload);
        onDashboardUpdate(res.dashboard);
        setActionNotice(`Created ${payload.assessmentType} "${payload.title}".`);
      }
      setAssessmentModalOpen(false);
    } catch (err) {
      setAsmtError(err instanceof Error ? err.message : 'Unable to save assessment.');
    } finally {
      setSavingAsmt(false);
    }
  }

  async function handleDeleteAssessment(asmt: AssessmentRecord) {
    setActionError('');
    setActionNotice('');
    try {
      const res = await api.deleteAssessment(asmt.id);
      onDashboardUpdate(res.dashboard);
      setActionNotice(`Deleted assessment "${asmt.title}".`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to delete assessment.');
    }
  }

  function openGradeRosterModal(asmt: AssessmentRecord) {
    setRosterAssessmentId(asmt.id);
    setRosterNotice('');
    setRosterError('');
    const existingGrades = (data.assessmentGrades ?? []).filter(
      (g) => g.assessmentId === asmt.id
    );
    const scoreMap: Record<string, string> = {};
    const fbMap: Record<string, string> = {};
    for (const g of existingGrades) {
      scoreMap[g.studentId] = String(g.score);
      fbMap[g.studentId] = g.feedback;
    }
    setDraftScores(scoreMap);
    setDraftFeedbacks(fbMap);
  }

  async function handleSaveRosterStudentGrade(studentId: string, studentName: string) {
    if (!rosterAssessment) return;
    setRosterError('');
    setRosterNotice('');
    const rawScore = draftScores[studentId];
    const parsedScore = Number(rawScore);
    if (rawScore === undefined || rawScore === '' || Number.isNaN(parsedScore)) {
      setRosterError(`Enter a numeric score for ${studentName}.`);
      return;
    }
    if (parsedScore < 0 || parsedScore > rosterAssessment.maxScore) {
      setRosterError(
        `Score for ${studentName} must be between 0 and ${rosterAssessment.maxScore}.`
      );
      return;
    }

    setSavingRosterStudentId(studentId);
    try {
      const res = await api.saveAssessmentGrade(rosterAssessment.id, {
        studentId,
        score: parsedScore,
        feedback: (draftFeedbacks[studentId] ?? '').trim(),
      });
      onDashboardUpdate(res.dashboard);
      setRosterNotice(
        `Saved ${Math.round(parsedScore)}/${rosterAssessment.maxScore} for ${studentName}.`
      );
    } catch (err) {
      setRosterError(
        err instanceof Error ? err.message : 'Unable to save assessment score.'
      );
    } finally {
      setSavingRosterStudentId(null);
    }
  }

  const rosterEnrollments = rosterAssessment
    ? courseEnrollments.filter(
        (e) => !rosterAssessment.batchId || e.cohortId === rosterAssessment.batchId
      )
    : [];

  return (
    <div className="space-y-6">
      {/* Course Selector Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Select course to track"
          >
            {data.courses.map((c) => {
              const active = c.id === course.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedCourseId(c.id);
                    setActionNotice('');
                    setActionError('');
                  }}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span className="font-mono mr-1.5">{c.code}</span>
                  <span>{c.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>
            Instructor: <strong className="text-slate-900">{course.instructorName}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>Track: {course.track}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{course.durationWeeks} weeks</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{courseEnrollments.length} enrolled students</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{courseAssessments.length} assessments</span>
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Student Module Completion & Grade Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Module Completion &amp; Grading Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Toggle module completion checkboxes or click any score cell to enter or update grades
            </p>
          </div>
        </div>

        {courseEnrollments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No students are currently enrolled in {course.code}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-3 px-5">Student</th>
                  {course.modules.map((mod) => (
                    <th key={mod.id} className="py-3 px-3 min-w-[155px]">
                      <div className="font-mono text-slate-700">
                        {mod.code} ({mod.weight}%)
                      </div>
                      <div className="font-normal text-slate-500 truncate max-w-[160px]">
                        {mod.title}
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right">Completion</th>
                  <th className="py-3 px-5 text-right">Weighted Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {courseEnrollments.map((enr) => {
                  const student = data.students.find((s) => s.id === enr.studentId);
                  if (!student) return null;

                  const completionPct = calculateCourseCompletion(
                    enr.completedModuleIds,
                    course.modules.length
                  );

                  const studentGrades = data.grades.filter(
                    (g) => g.studentId === student.id && g.courseId === course.id
                  );

                  const eligibleAssessments = courseAssessments.filter(
                    (a) => !a.batchId || a.batchId === enr.cohortId
                  );
                  const studentAsmtGrades = (data.assessmentGrades ?? []).filter(
                    (g) => g.studentId === student.id && g.courseId === course.id
                  );
                  const asmtPairs = eligibleAssessments
                    .map((a) => {
                      const gr = studentAsmtGrades.find((g) => g.assessmentId === a.id);
                      return gr ? { score: gr.percentage, weight: a.weight } : null;
                    })
                    .filter((x): x is { score: number; weight: number } => x !== null);

                  const weightedAvg =
                    asmtPairs.length > 0
                      ? calculateWeightedAverage(asmtPairs)
                      : calculateWeightedAverage(
                          course.modules
                            .map((m) => {
                              const g = studentGrades.find((gr) => gr.moduleId === m.id);
                              return g ? { score: g.score, weight: m.weight } : null;
                            })
                            .filter((x): x is { score: number; weight: number } => x !== null)
                        );

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-5">
                        <div className="font-medium text-slate-900">
                          {student.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">{student.studentCode}</span>
                          <span className="mx-1" aria-hidden="true">·</span>
                          <span>{enr.cohort}</span>
                        </div>
                      </td>

                      {course.modules.map((mod) => {
                        const isDone = enr.completedModuleIds.includes(mod.id);
                        const grade = studentGrades.find((g) => g.moduleId === mod.id);

                        return (
                          <td key={mod.id} className="py-3.5 px-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  onToggleModule({
                                    enrollmentId: enr.id,
                                    moduleId: mod.id,
                                    completed: !isDone,
                                  })
                                }
                                aria-label={`Mark ${mod.code} ${isDone ? 'incomplete' : 'complete'} for ${student.name}`}
                                className="p-1 rounded hover:bg-slate-200/70 text-slate-600 cursor-pointer"
                              >
                                {isDone ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-700" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  openGradeEditor(student.id, student.name, mod)
                                }
                                aria-label={`Edit grade for ${student.name} on ${mod.code}`}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono tabular-nums rounded border border-slate-200 bg-white hover:border-blue-400 hover:text-blue-700 transition-colors cursor-pointer"
                              >
                                <span>
                                  {grade ? `${grade.score}%` : 'Grade'}
                                </span>
                                <Edit3 className="w-3 h-3 text-slate-400" />
                              </button>
                            </div>
                          </td>
                        );
                      })}

                      <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {completionPct}%
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {weightedAvg !== null
                          ? `${weightedAvg}% (${calculateLetterGrade(weightedAvg)})`
                          : 'Pending'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Multi-Type Assessments Manager */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Course Assessments &amp; Evaluations
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage Assignments, Quizzes, Labs, Midterms, Finals, and primary Module Assessments for {course.code}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateAssessmentModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Assessment</span>
          </button>
        </div>

        {courseAssessments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No assessments configured for {course.code}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Assessment</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Scope</th>
                  <th className="py-2.5 px-4 text-right">Max Score</th>
                  <th className="py-2.5 px-4 text-right">Weight</th>
                  <th className="py-2.5 px-4 text-right">Graded</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {courseAssessments.map((asmt) => {
                  const mod = asmt.moduleId
                    ? course.modules.find((m) => m.id === asmt.moduleId)
                    : undefined;
                  const batch = asmt.batchId
                    ? courseCohorts.find((b) => b.id === asmt.batchId)
                    : undefined;
                  const gradedCount = (data.assessmentGrades ?? []).filter(
                    (g) => g.assessmentId === asmt.id
                  ).length;

                  return (
                    <tr key={asmt.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{asmt.title}</div>
                        {asmt.dueDate && (
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                            Due {new Date(asmt.dueDate).toLocaleDateString('en-IN')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded">
                          {asmt.assessmentType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div>{mod ? `${mod.code} · ${mod.title}` : 'Course-wide'}</div>
                        <div className="text-[11px] text-slate-400">
                          {batch ? batch.name : 'All batches'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {asmt.maxScore}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {asmt.weight}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {gradedCount}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openGradeRosterModal(asmt)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Grade Roster</span>
                          </button>
                          {asmt.assessmentType !== 'Module Assessment' && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditAssessmentModal(asmt)}
                                aria-label={`Edit ${asmt.title}`}
                                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                              >
                                Edit
                              </button>
                              {gradedCount === 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAssessment(asmt)}
                                  aria-label={`Delete ${asmt.title}`}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
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

      {/* Legacy Module Grade Editor Modal */}
      {gradeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="grade-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="grade-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Record Module Grade
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {gradeTarget.studentName} · {course.code} {gradeTarget.module.code}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGradeTarget(null)}
                aria-label="Close grade modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {gradeError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{gradeError}</span>
              </div>
            )}

            <form onSubmit={handleGradeSubmit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="grade-score"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Assessment Score (0–100%)
                </label>
                <input
                  id="grade-score"
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={scoreInput}
                  onChange={(e) => setScoreInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="grade-feedback"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Instructor Evaluation Feedback
                </label>
                <textarea
                  id="grade-feedback"
                  rows={3}
                  value={feedbackInput}
                  onChange={(e) => setFeedbackInput(e.target.value)}
                  placeholder="Provide specific assessment notes for the student transcript..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setGradeTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingGrade}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {savingGrade ? 'Saving...' : 'Save Grade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Assessment Modal */}
      {assessmentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assessment-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="assessment-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  {editingAssessment ? 'Edit Assessment' : `Create Assessment · ${course.code}`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure assessment weight, maximum score, and optional module or batch scope
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssessmentModalOpen(false)}
                aria-label="Close assessment modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {asmtError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{asmtError}</span>
              </div>
            )}

            <form onSubmit={handleAssessmentSubmit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="asmt-title"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Assessment Title
                </label>
                <input
                  id="asmt-title"
                  type="text"
                  required
                  value={asmtTitle}
                  onChange={(e) => setAsmtTitle(e.target.value)}
                  placeholder="e.g. Lab 2: REST API Security Audit"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="asmt-type"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Type
                  </label>
                  <select
                    id="asmt-type"
                    value={asmtType}
                    onChange={(e) => setAsmtType(e.target.value as AssessmentType)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    {ASSESSMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="asmt-max-score"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Max Score
                  </label>
                  <input
                    id="asmt-max-score"
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={asmtMaxScore}
                    onChange={(e) => setAsmtMaxScore(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label
                    htmlFor="asmt-weight"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Weight (%)
                  </label>
                  <input
                    id="asmt-weight"
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={asmtWeight}
                    onChange={(e) => setAsmtWeight(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="asmt-module"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Linked Module (Optional)
                  </label>
                  <select
                    id="asmt-module"
                    value={asmtModuleId}
                    onChange={(e) => setAsmtModuleId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    <option value="">Course-wide (No specific module)</option>
                    {course.modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="asmt-batch"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Target Batch (Optional)
                  </label>
                  <select
                    id="asmt-batch"
                    value={asmtBatchId}
                    onChange={(e) => setAsmtBatchId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    <option value="">All batches in {course.code}</option>
                    {courseCohorts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="asmt-due-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Due Date (Optional)
                </label>
                <input
                  id="asmt-due-date"
                  type="date"
                  value={asmtDueDate}
                  onChange={(e) => setAsmtDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setAssessmentModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAsmt}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {savingAsmt
                    ? 'Saving...'
                    : editingAssessment
                      ? 'Save Changes'
                      : 'Create Assessment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assessment Grade Roster Modal */}
      {rosterAssessment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="roster-modal-title"
        >
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
              <div>
                <h3
                  id="roster-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Grade Roster · {rosterAssessment.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rosterAssessment.assessmentType} · Max {rosterAssessment.maxScore} pts · Weight{' '}
                  {rosterAssessment.weight}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterAssessmentId(null)}
                aria-label="Close grade roster modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rosterNotice && (
              <div
                role="status"
                className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 shrink-0"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{rosterNotice}</span>
              </div>
            )}

            {rosterError && (
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 shrink-0"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{rosterError}</span>
              </div>
            )}

            <div className="mt-4 overflow-y-auto flex-1 border border-slate-200 rounded-lg">
              {rosterEnrollments.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No eligible students enrolled for this assessment.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-3">Score (0–{rosterAssessment.maxScore})</th>
                      <th className="py-2.5 px-3">Feedback</th>
                      <th className="py-2.5 px-4 text-right">Save</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {rosterEnrollments.map((enr) => {
                      const student = data.students.find((s) => s.id === enr.studentId);
                      if (!student) return null;
                      const existingGrade = (data.assessmentGrades ?? []).find(
                        (g) =>
                          g.assessmentId === rosterAssessment.id &&
                          g.studentId === student.id
                      );
                      const scoreVal =
                        draftScores[student.id] ??
                        (existingGrade ? String(existingGrade.score) : '');
                      const feedbackVal =
                        draftFeedbacks[student.id] ?? existingGrade?.feedback ?? '';

                      return (
                        <tr key={enr.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900">{student.name}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {student.studentCode ?? student.email}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                max={rosterAssessment.maxScore}
                                aria-label={`Score for ${student.name}`}
                                value={scoreVal}
                                onChange={(e) =>
                                  setDraftScores((prev) => ({
                                    ...prev,
                                    [student.id]: e.target.value,
                                  }))
                                }
                                placeholder="0"
                                className="w-20 px-2.5 py-1.5 font-mono text-xs bg-white border border-slate-300 rounded-md"
                              />
                              {existingGrade && (
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  ({existingGrade.percentage}%)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              aria-label={`Feedback for ${student.name}`}
                              value={feedbackVal}
                              onChange={(e) =>
                                setDraftFeedbacks((prev) => ({
                                  ...prev,
                                  [student.id]: e.target.value,
                                }))
                              }
                              placeholder="Optional evaluation note..."
                              className="w-full min-w-[160px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              disabled={savingRosterStudentId === student.id}
                              onClick={() =>
                                handleSaveRosterStudentGrade(student.id, student.name)
                              }
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              {savingRosterStudentId === student.id ? 'Saving...' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setRosterAssessmentId(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
