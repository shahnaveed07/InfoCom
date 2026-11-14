import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import type { AdmissionStatus, DashboardPayload } from '../shared/types';

interface AdmissionsViewProps {
  data: DashboardPayload;
  onCreateAdmission: (payload: {
    applicantName: string;
    applicantEmail: string;
    phone?: string;
    targetCourseId: string;
    preferredCohort: string;
    notes?: string;
  }) => Promise<void>;
  onUpdateAdmission: (
    id: string,
    payload: {
      status: AdmissionStatus;
      notes?: string;
      convertToEnrollment?: boolean;
    }
  ) => Promise<void>;
}

export function AdmissionsView({
  data,
  onCreateAdmission,
  onUpdateAdmission,
}: AdmissionsViewProps) {
  const [filter, setFilter] = useState<'All' | AdmissionStatus>('All');
  const [modalOpen, setModalOpen] = useState(false);

  const [applicantName, setApplicantName] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [targetCourseId, setTargetCourseId] = useState(data.courses[0]?.id ?? '');
  const [preferredCohort, setPreferredCohort] = useState('Cohort B · Winter');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return data.admissions.filter((a) =>
      filter === 'All' ? true : a.status === filter
    );
  }, [data.admissions, filter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (applicantName.trim().length < 2 || !applicantEmail.trim() || !targetCourseId) {
      setFormError('Applicant name, email, and target course are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateAdmission({
        applicantName: applicantName.trim(),
        applicantEmail: applicantEmail.trim(),
        phone: phone.trim(),
        targetCourseId,
        preferredCohort: preferredCohort.trim(),
        notes: notes.trim(),
      });
      setModalOpen(false);
      setApplicantName('');
      setApplicantEmail('');
      setPhone('');
      setNotes('');
      setStatusNotice('Admission application recorded in pipeline.');
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to log admission application.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(
    id: string,
    status: AdmissionStatus,
    convertToEnrollment = false
  ) {
    setBusyId(id);
    setStatusNotice('');
    try {
      await onUpdateAdmission(id, { status, convertToEnrollment });
      setStatusNotice(
        convertToEnrollment
          ? 'Applicant accepted, enrolled in cohort, and tuition invoice issued.'
          : `Application status updated to ${status}.`
      );
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Unable to update application.'
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(['All', 'Submitted', 'Under Review', 'Accepted', 'Enrolled', 'Rejected'] as const).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                  filter === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Admission Application</span>
        </button>
      </div>

      {statusNotice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Prospective Student Admissions
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filtered.length} applications
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No applications match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Applicant</th>
                  <th className="py-2.5 px-4">Target Program & Cohort</th>
                  <th className="py-2.5 px-4">Notes</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Workflow Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((adm) => {
                  const course = data.courses.find((c) => c.id === adm.targetCourseId);
                  const isEnrolled = adm.status === 'Enrolled';
                  return (
                    <tr key={adm.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{adm.applicantName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {adm.applicantEmail}
                          {adm.phone ? ` · ${adm.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">
                          {course?.code ?? adm.targetCourseId} — {course?.title ?? ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {adm.preferredCohort}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                        {adm.notes || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-medium">
                        <span
                          className={
                            adm.status === 'Enrolled'
                              ? 'text-emerald-700'
                              : adm.status === 'Rejected'
                                ? 'text-red-700'
                                : 'text-blue-700'
                          }
                        >
                          {adm.status}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        {isEnrolled ? (
                          <span className="text-xs text-slate-400">Converted to Student</span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            {adm.status === 'Submitted' && (
                              <button
                                type="button"
                                disabled={busyId === adm.id}
                                onClick={() => handleAction(adm.id, 'Under Review')}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                              >
                                Review
                              </button>
                            )}
                            {adm.status !== 'Rejected' && (
                              <button
                                type="button"
                                disabled={busyId === adm.id}
                                onClick={() => handleAction(adm.id, 'Enrolled', true)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Accept & Enroll</span>
                              </button>
                            )}
                            {adm.status !== 'Rejected' && (
                              <button
                                type="button"
                                disabled={busyId === adm.id}
                                onClick={() => handleAction(adm.id, 'Rejected')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admission-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="admission-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                New Admission Application
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close admission modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
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

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Applicant Full Name
                </label>
                <input
                  type="text"
                  required
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={applicantEmail}
                    onChange={(e) => setApplicantEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Target Program
                </label>
                <select
                  value={targetCourseId}
                  onChange={(e) => setTargetCourseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred Cohort
                </label>
                <input
                  type="text"
                  required
                  value={preferredCohort}
                  onChange={(e) => setPreferredCohort(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Admissions Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {submitting ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
