import React, { useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  Edit3,
  Square,
  X,
} from 'lucide-react';
import {
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  isInactiveEnrollmentStatus,
} from '../shared/academic';
import type { CourseModule, DashboardPayload } from '../shared/types';

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
}

export function CourseTrackingView({
  data,
  onToggleModule,
  onSaveGrade,
}: CourseTrackingViewProps) {
  const [selectedCourseId, setSelectedCourseId] = useState(
    data.courses[0]?.id ?? ''
  );

  const [gradeTarget, setGradeTarget] = useState<{
    studentId: string;
    studentName: string;
    module: CourseModule;
  } | null>(null);
  const [scoreInput, setScoreInput] = useState('88');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  const course =
    data.courses.find((c) => c.id === selectedCourseId) ?? data.courses[0];

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
                  onClick={() => setSelectedCourseId(c.id)}
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
        </div>
      </div>

      {/* Student Module Completion & Grade Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Module Completion & Grading Matrix
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

                  const weightedAvg = calculateWeightedAverage(
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

      {/* Grade Editor Modal */}
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
    </div>
  );
}
