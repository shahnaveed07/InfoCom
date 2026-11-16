import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  Download,
  Printer,
  Save,
} from 'lucide-react';
import {
  computeStudentProgressReport,
  formatReportAsText,
  type StudentProgressReport,
} from '../shared/academic';
import type { DashboardPayload } from '../shared/types';
import { api } from '../utils/api';

interface ProgressReportViewProps {
  data: DashboardPayload;
  isInstructor: boolean;
  onSaveRemark?: (payload: {
    studentId: string;
    courseId: string;
    summary: string;
  }) => Promise<void>;
}

export function ProgressReportView({
  data,
  isInstructor,
  onSaveRemark,
}: ProgressReportViewProps) {
  const [selectedStudentId, setSelectedStudentId] = useState(
    isInstructor ? data.students[0]?.id ?? '' : data.user.id
  );
  const [draftRemarks, setDraftRemarks] = useState<Record<string, string>>({});
  const [savedNotice, setSavedNotice] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'pdf' | null>(null);

  const targetStudent = isInstructor
    ? data.students.find((s) => s.id === selectedStudentId) ?? data.students[0]
    : data.user;

  const report = useMemo(() => {
    if (!targetStudent) return null;
    return computeStudentProgressReport({
      student: targetStudent,
      courses: data.courses,
      enrollments: data.enrollments,
      grades: data.grades,
      assessments: data.assessments,
      assessmentGrades: data.assessmentGrades,
      attendance: data.attendance,
      remarks: data.remarks,
      policies: data.policies,
      generatedAtIso: new Date().toISOString(),
    });
  }, [
    targetStudent,
    data.courses,
    data.enrollments,
    data.grades,
    data.assessments,
    data.assessmentGrades,
    data.attendance,
    data.remarks,
    data.policies,
  ]);

  if (!report) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        No student record available for progress report generation.
      </div>
    );
  }

  function handleDownloadText() {
    if (!report) return;
    const text = formatReportAsText(report);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.student.name.toLowerCase().replace(/\s+/g, '-')}-progress-report.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSaveCourseRemark(courseId: string, fallbackText: string) {
    if (!onSaveRemark || !report) return;
    const key = `${report.student.id}:${courseId}`;
    const summary = (draftRemarks[key] ?? fallbackText).trim();
    if (summary.length < 4) return;
    await onSaveRemark({
      studentId: report.student.id,
      courseId,
      summary,
    });
    setSavedNotice('Instructor evaluation remark saved to report.');
  }

  async function handleExportAcademicReport(format: 'csv' | 'pdf') {
    setExportError('');
    setExportingFormat(format);
    try {
      await api.downloadReport('academic-progress', format);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : `Unable to export ${format.toUpperCase()} report.`
      );
    } finally {
      setExportingFormat(null);
    }
  }

  function renderStanding(standing: StudentProgressReport['standing']) {
    if (standing === 'Distinction') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
          <Award className="w-4 h-4" />
          Distinction
        </span>
      );
    }
    if (standing === 'On Track') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          On Track
        </span>
      );
    }
    if (standing === 'Needs Attention') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="w-4 h-4" />
          Needs Attention
        </span>
      );
    }
    return (
      <span className="text-xs font-medium text-slate-500">
        Pending Assessment
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Report Controls Bar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {isInstructor ? (
          <div className="flex-1 max-w-sm">
            <label
              htmlFor="report-student-select"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Select Student for Progress Report
            </label>
            <select
              id="report-student-select"
              value={report.student.id}
              onChange={(e) => {
                setSelectedStudentId(e.target.value);
                setSavedNotice('');
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {data.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.studentCode ?? s.email})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-slate-900">
              Official Academic Progress Report
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Generated live from verified module grades and attendance records
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isInstructor && (
            <>
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExportAcademicReport('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportingFormat === 'csv' ? 'Exporting...' : 'Cohort CSV'}</span>
              </button>
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExportAcademicReport('pdf')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportingFormat === 'pdf' ? 'Generating...' : 'Cohort PDF'}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleDownloadText}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Report</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {savedNotice && (
        <div
          role="status"
          className="no-print flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          <span>{savedNotice}</span>
        </div>
      )}

      {exportError && (
        <div
          role="alert"
          className="no-print flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Printable Progress Report Sheet */}
      <article className="print-surface bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8">
        {/* Report Header */}
        <header className="border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-blue-700">
              {data.academy?.name ?? 'IGS — InfoCom Global Services'} · Official Progress Transcript
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {data.academy?.address || 'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.'}
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 mt-1.5">
              {report.student.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              <span className="font-mono">
                {report.student.studentCode ?? report.student.id}
              </span>
              <span aria-hidden="true">·</span>
              <span>{report.student.email}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Issued {new Date(report.generatedAtIso).toLocaleDateString('en-IN')}
              </span>
            </div>
          </div>

          <div className="sm:text-right">
            <div className="text-xs text-slate-500">Academic Standing</div>
            <div className="mt-1">{renderStanding(report.standing)}</div>
          </div>
        </header>

        {/* Summary Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="text-xs text-slate-500">Overall Average</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {report.overallAverage !== null
                ? `${report.overallAverage}% (${report.overallLetterGrade})`
                : 'Pending'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Attendance Rate</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {report.overallAttendanceRate}%
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Module Completion</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {report.overallCompletionPct}%
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Enrolled Courses</div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {report.courses.length}
            </div>
          </div>
        </div>

        {/* Per-Course Breakdown */}
        {report.courses.length === 0 ? (
          <p className="text-sm text-slate-500">
            This student has no active or completed course enrollments yet.
          </p>
        ) : (
          <div className="space-y-8">
            {report.courses.map((c) => {
              const remarkKey = `${report.student.id}:${c.courseId}`;
              const remarkValue = draftRemarks[remarkKey] ?? c.instructorRemark;

              return (
                <section key={c.courseId} className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        <span className="font-mono text-blue-700 mr-2">
                          {c.courseCode}
                        </span>
                        {c.courseTitle}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {c.cohort} · Enrollment: {c.status} · Attendance:{' '}
                        <span className="font-mono tabular-nums">
                          {c.attendance.rate}% ({c.attendance.present}P /{' '}
                          {c.attendance.late}L / {c.attendance.absent}A
                          {c.attendance.excused > 0 ? ` / ${c.attendance.excused}E` : ''})
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-700 shrink-0">
                      <span>Completion: {c.completionPct}%</span>
                      <span className="font-semibold text-slate-900">
                        Grade:{' '}
                        {c.weightedScore !== null
                          ? `${c.weightedScore}% (${c.letterGrade})`
                          : 'Pending'}
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                          <th className="py-2 px-4">Module</th>
                          <th className="py-2 px-3 text-right">Weight</th>
                          <th className="py-2 px-3">Progress</th>
                          <th className="py-2 px-3 text-right">Score</th>
                          <th className="py-2 px-4">Instructor Feedback</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {c.moduleRows.map((m) => (
                          <tr key={m.moduleId}>
                            <td className="py-2.5 px-4 font-medium text-slate-900">
                              <span className="font-mono text-slate-500 mr-1.5">
                                {m.moduleCode}
                              </span>
                              {m.moduleTitle}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums">
                              {m.weight}%
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">
                              {m.completed ? 'Completed' : 'In Progress'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums">
                              {m.score !== null
                                ? `${m.score}% (${m.letterGrade})`
                                : 'Ungraded'}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {m.feedback || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {c.assessmentRows.filter(
                    (a) => a.assessmentType !== 'Module Assessment'
                  ).length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                            <th className="py-2 px-4">Additional Assessment</th>
                            <th className="py-2 px-3">Type</th>
                            <th className="py-2 px-3 text-right">Weight</th>
                            <th className="py-2 px-3 text-right">Score</th>
                            <th className="py-2 px-4">Instructor Feedback</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {c.assessmentRows
                            .filter((a) => a.assessmentType !== 'Module Assessment')
                            .map((asmt) => (
                              <tr key={asmt.assessmentId}>
                                <td className="py-2.5 px-4 font-medium text-slate-900">
                                  {asmt.title}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600">
                                  {asmt.assessmentType}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums">
                                  {asmt.weight}%
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums">
                                  {asmt.score !== null
                                    ? `${asmt.score}/${asmt.maxScore} (${asmt.percentage}% · ${asmt.letterGrade})`
                                    : 'Ungraded'}
                                </td>
                                <td className="py-2.5 px-4 text-slate-600">
                                  {asmt.feedback || '—'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Instructor Remark */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor={`remark-${c.courseId}`}
                        className="text-xs font-medium text-slate-700"
                      >
                        Instructor Evaluation Summary
                      </label>
                      {isInstructor && onSaveRemark && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSaveCourseRemark(c.courseId, c.instructorRemark)
                          }
                          className="no-print inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded-md hover:bg-blue-50 cursor-pointer whitespace-nowrap"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save Remark</span>
                        </button>
                      )}
                    </div>
                    {isInstructor ? (
                      <textarea
                        id={`remark-${c.courseId}`}
                        rows={2}
                        value={remarkValue}
                        onChange={(e) =>
                          setDraftRemarks((prev) => ({
                            ...prev,
                            [remarkKey]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {c.instructorRemark}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
}
