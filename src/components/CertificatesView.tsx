import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Printer,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateWeightedAverage,
  computeCertificateEligibility,
  isInactiveEnrollmentStatus,
} from '../shared/academic';
import type { CertificateRecord, DashboardPayload } from '../shared/types';
import type { VerifiedCertificateInfo } from '../utils/api';

interface CertificatesViewProps {
  data: DashboardPayload;
  onIssueCertificate?: (payload: {
    studentId: string;
    courseId: string;
  }) => Promise<string>;
  onRevokeCertificate?: (certId: string, reason: string) => Promise<void>;
  onVerifyCertificate: (codeOrHash: string) => Promise<VerifiedCertificateInfo>;
}

export function CertificatesView({
  data,
  onIssueCertificate,
  onRevokeCertificate,
  onVerifyCertificate,
}: CertificatesViewProps) {
  const isStaff = data.user.role === 'admin' || data.user.role === 'instructor';
  const isAdmin = data.user.role === 'admin';

  const [verifyQuery, setVerifyQuery] = useState(
    data.certificates[0]?.certificateCode ?? ''
  );
  const [verifiedInfo, setVerifiedInfo] = useState<VerifiedCertificateInfo | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [previewCert, setPreviewCert] = useState<CertificateRecord | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CertificateRecord | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const candidateRows = useMemo(() => {
    if (!isStaff) return [];
    return data.enrollments
      .filter((e) => !isInactiveEnrollmentStatus(e.status))
      .map((enr) => {
        const student = data.students.find((s) => s.id === enr.studentId);
        const course = data.courses.find((c) => c.id === enr.courseId);
        if (!student || !course) return null;

        const existingCert = data.certificates.find(
          (c) => c.studentId === student.id && c.courseId === course.id && c.status === 'Issued'
        );

        const completionPct = calculateCourseCompletion(
          enr.completedModuleIds,
          course.modules.length
        );
        const studentGrades = data.grades.filter(
          (g) => g.studentId === student.id && g.courseId === course.id
        );
        const weightedScore = calculateWeightedAverage(
          course.modules
            .map((m) => {
              const g = studentGrades.find((gr) => gr.moduleId === m.id);
              return g ? { score: g.score, weight: m.weight } : null;
            })
            .filter((x): x is { score: number; weight: number } => x !== null)
        );
        const attStats = calculateAttendanceStats(
          data.attendance.filter(
            (a) => a.studentId === student.id && a.courseId === course.id
          )
        );
        const eligibility = computeCertificateEligibility({
          enrollmentStatus: enr.status,
          completionPct,
          weightedScore,
          attendanceRate: attStats.rate,
        });

        return {
          enrollmentId: enr.id,
          student,
          course,
          completionPct,
          weightedScore,
          attendanceRate: attStats.rate,
          eligibility,
          existingCert,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [isStaff, data]);

  async function handleIssue(studentId: string, courseId: string) {
    if (!onIssueCertificate) return;
    const key = `${studentId}:${courseId}`;
    setBusyKey(key);
    setNotice('');
    try {
      const code = await onIssueCertificate({ studentId, courseId });
      setNotice(`Issued verified certificate ${code}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to issue certificate.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError('');
    setVerifiedInfo(null);
    if (!verifyQuery.trim()) return;
    setVerifying(true);
    try {
      const res = await onVerifyCertificate(verifyQuery.trim());
      setVerifiedInfo(res);
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : 'Certificate verification failed.'
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleRevokeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onRevokeCertificate || !revokeTarget || revokeReason.trim().length < 4) return;
    await onRevokeCertificate(revokeTarget.id, revokeReason.trim());
    setNotice(`Certificate ${revokeTarget.certificateCode} revoked.`);
    setRevokeTarget(null);
    setRevokeReason('');
  }

  return (
    <div className="space-y-6">
      {/* Live Verification Checker */}
      <section className="no-print bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Certificate Authenticity Verification
          </h2>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={verifyQuery}
            onChange={(e) => setVerifyQuery(e.target.value)}
            placeholder="Enter certificate code (INF-CERT-...) or SHA-256 hash"
            className="flex-1 px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          />
          <button
            type="submit"
            disabled={verifying}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{verifying ? 'Verifying...' : 'Verify Certificate'}</span>
          </button>
        </form>

        {verifyError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{verifyError}</span>
          </div>
        )}

        {verifiedInfo && (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-slate-900">
                {verifiedInfo.certificateCode}
              </span>
              <span
                className={
                  verifiedInfo.status === 'Issued'
                    ? 'font-semibold text-emerald-700'
                    : 'font-semibold text-red-700'
                }
              >
                {verifiedInfo.status === 'Issued' ? 'Verified Valid' : 'Revoked'}
              </span>
            </div>
            <p className="text-slate-700">
              {verifiedInfo.studentName} ({verifiedInfo.studentCode}) ·{' '}
              {verifiedInfo.courseCode} {verifiedInfo.courseTitle} · Final Score:{' '}
              {verifiedInfo.finalScore}% ({verifiedInfo.letterGrade})
            </p>
            <p className="font-mono text-[11px] text-slate-500">
              Hash: {verifiedInfo.verificationHash}
            </p>
          </div>
        )}
      </section>

      {notice && (
        <div
          role="status"
          className="no-print flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Issued Certificates Registry */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Issued Credentials
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {data.certificates.length} records
          </span>
        </div>

        {data.certificates.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No certificates have been issued yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Certificate Code</th>
                  <th className="py-2.5 px-4">Student & Program</th>
                  <th className="py-2.5 px-4 text-right">Grade</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {data.certificates.map((cert) => (
                  <tr key={cert.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <div className="font-mono text-xs font-semibold text-blue-700">
                        {cert.certificateCode}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                        {cert.verificationHash}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">
                        {cert.studentName ?? cert.studentId}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {cert.courseCode} — {cert.courseTitle}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                      {cert.finalScore}% ({cert.letterGrade})
                    </td>
                    <td className="py-3 px-4 text-xs font-medium">
                      {cert.status === 'Issued' ? (
                        <span className="text-emerald-700">Issued</span>
                      ) : (
                        <span className="text-red-700">Revoked</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewCert(cert)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                        {isAdmin && cert.status === 'Issued' && (
                          <button
                            type="button"
                            onClick={() => {
                              setRevokeTarget(cert);
                              setRevokeReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Staff Eligibility & Issuance Table */}
      {isStaff && (
        <section className="no-print bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Graduation & Certificate Eligibility Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Requires 100% module completion, weighted grade 70%+, and attendance 75%+
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Student & Course</th>
                  <th className="py-2.5 px-4 text-right">Modules</th>
                  <th className="py-2.5 px-4 text-right">Grade</th>
                  <th className="py-2.5 px-4 text-right">Attendance</th>
                  <th className="py-2.5 px-4">Eligibility</th>
                  <th className="py-2.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {candidateRows.map((row) => {
                  const key = `${row.student.id}:${row.course.id}`;
                  return (
                    <tr key={row.enrollmentId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{row.student.name}</div>
                        <div className="text-xs text-slate-500">
                          {row.course.code} — {row.course.title}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                        {row.completionPct}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                        {row.weightedScore !== null ? `${row.weightedScore}%` : 'Pending'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                        {row.attendanceRate}%
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {row.existingCert ? (
                          <span className="font-medium text-blue-700">
                            Issued ({row.existingCert.certificateCode})
                          </span>
                        ) : row.eligibility.eligible ? (
                          <span className="font-medium text-emerald-700">Eligible</span>
                        ) : (
                          <span className="text-slate-500">
                            {row.eligibility.reasons[0]}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right">
                        {!row.existingCert && row.eligibility.eligible && (
                          <button
                            type="button"
                            disabled={busyKey === key}
                            onClick={() => handleIssue(row.student.id, row.course.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                          >
                            <Award className="w-3.5 h-3.5" />
                            <span>Issue Certificate</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Printable Certificate Preview Modal */}
      {previewCert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="print-surface w-full max-w-xl bg-white border border-slate-300 rounded-xl p-8 shadow-lg space-y-6 text-center">
            <div className="flex justify-end no-print">
              <button
                type="button"
                onClick={() => setPreviewCert(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-blue-700">
                InfoCom Academy Management System · Northbridge Tech Academy
              </p>
              <h3 className="font-display text-2xl font-semibold text-slate-900 mt-2">
                Certificate of Technical Completion
              </h3>
            </div>
            <div className="py-4 border-y border-slate-200 space-y-2">
              <p className="text-xs text-slate-500">This certifies that</p>
              <p className="font-display text-2xl font-semibold text-slate-900">
                {previewCert.studentName}
              </p>
              <p className="text-xs text-slate-600">
                has successfully fulfilled all module assessments and attendance requirements for
              </p>
              <p className="font-display text-lg font-semibold text-blue-800">
                {previewCert.courseCode} — {previewCert.courseTitle}
              </p>
              <p className="font-mono text-xs text-slate-700 pt-1 tabular-nums">
                Final Score: {previewCert.finalScore}% ({previewCert.letterGrade}) · Attendance:{' '}
                {previewCert.attendanceRate}%
              </p>
            </div>
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500">
              <div className="text-left">
                <div>Issued By: {previewCert.issuedByName}</div>
                <div>Date: {new Date(previewCert.issuedAt).toLocaleDateString('en-US')}</div>
              </div>
              <div className="text-right font-mono">
                <div className="font-semibold text-slate-800">
                  {previewCert.certificateCode}
                </div>
                <div className="text-[11px]">Hash: {previewCert.verificationHash}</div>
              </div>
            </div>
            <div className="no-print pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Official Certificate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Certificate Modal */}
      {revokeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Revoke Certificate {revokeTarget.certificateCode}
            </h3>
            <form onSubmit={handleRevokeSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mandatory Revocation Reason
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={4}
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRevokeTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-lg cursor-pointer"
                >
                  Confirm Revocation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
