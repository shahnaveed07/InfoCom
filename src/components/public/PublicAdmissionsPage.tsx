import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, FilePlus2, Upload } from 'lucide-react';
import { formatMoney } from '../../shared/academic';
import type { PublicAcademyInfo } from '../../shared/types';
import { api, type PublicAdmissionCatalog } from '../../utils/api';

interface PublicAdmissionsPageProps {
  academy: PublicAcademyInfo | null;
}

export function PublicAdmissionsPage({ academy }: PublicAdmissionsPageProps) {
  const [searchParams] = useSearchParams();
  const initialCourseParam = searchParams.get('course') ?? '';

  const [catalog, setCatalog] = useState<PublicAdmissionCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [appName, setAppName] = useState('');
  const [appEmail, setAppEmail] = useState('');
  const [appPhone, setAppPhone] = useState('');
  const [appDob, setAppDob] = useState('');
  const [appCity, setAppCity] = useState('Sopore');
  const [appAddress, setAppAddress] = useState('');
  const [appGuardianName, setAppGuardianName] = useState('');
  const [appGuardianRel, setAppGuardianRel] = useState('Father');
  const [appGuardianPhone, setAppGuardianPhone] = useState('');
  const [appPrevQual, setAppPrevQual] = useState('');
  const [appPrevInst, setAppPrevInst] = useState('');
  const [appPrevScore, setAppPrevScore] = useState('');
  const [appCourseId, setAppCourseId] = useState('');
  const [appBatchId, setAppBatchId] = useState('');
  const [appFeePlanId, setAppFeePlanId] = useState('');
  const [appRemarks, setAppRemarks] = useState('');
  const [appDocType, setAppDocType] = useState('ID Verification');
  const [appDocFileName, setAppDocFileName] = useState('');
  const [appDocMime, setAppDocMime] = useState('');
  const [appDocBase64, setAppDocBase64] = useState('');
  const [appSubmitting, setAppSubmitting] = useState(false);
  const [appError, setAppError] = useState('');
  const [appReceipt, setAppReceipt] = useState<{
    applicationNumber: string;
    status: string;
    courseTitle: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    api
      .fetchPublicAdmissionCatalog()
      .then((data) => {
        if (!active) return;
        setCatalog(data);
        const preferredCourse =
          data.courses.find((c) => c.id === initialCourseParam) ?? data.courses[0];
        if (preferredCourse) {
          setAppCourseId(preferredCourse.id);
          const matchingBatch = data.batches.find(
            (b) => b.courseId === preferredCourse.id
          );
          setAppBatchId(matchingBatch?.id ?? '');
        }
        if (data.feePlans[0]) {
          setAppFeePlanId(data.feePlans[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setAppError(
          err instanceof Error
            ? err.message
            : 'Unable to load published programs for admission.'
        );
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialCourseParam]);

  function handleCourseSelect(nextCourseId: string) {
    setAppCourseId(nextCourseId);
    const matchingBatch = catalog?.batches.find((b) => b.courseId === nextCourseId);
    setAppBatchId(matchingBatch?.id ?? '');
  }

  function handleAppFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setAppDocFileName('');
      setAppDocMime('');
      setAppDocBase64('');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAppError('Attached document must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      const base64 = commaIdx >= 0 ? res.slice(commaIdx + 1) : res;
      if (!base64) {
        setAppError('Unable to read selected document file.');
        return;
      }
      setAppDocFileName(file.name);
      setAppDocMime(file.type || 'application/octet-stream');
      setAppDocBase64(base64);
      setAppError('');
    };
    reader.readAsDataURL(file);
  }

  async function submitPublicApplication(targetStatus: 'Submitted' | 'Draft') {
    setAppError('');
    setAppReceipt(null);
    if (!appCourseId) {
      setAppError('Select a target program before saving or submitting.');
      return;
    }
    if (targetStatus === 'Draft' && appName.trim().length < 2 && !appEmail.trim()) {
      setAppError('Enter at least your full name or email address to save a draft.');
      return;
    }
    if (targetStatus === 'Submitted') {
      if (appName.trim().length < 2) {
        setAppError('Applicant full name is required.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appEmail.trim())) {
        setAppError('A valid email address is required.');
        return;
      }
    }

    const selectedCourse = catalog?.courses.find((c) => c.id === appCourseId);
    const selectedBatch = catalog?.batches.find((b) => b.id === appBatchId);

    setAppSubmitting(true);
    try {
      const res = await api.submitPublicAdmission({
        applicantName: appName.trim(),
        applicantEmail: appEmail.trim(),
        phone: appPhone.trim(),
        dateOfBirth: appDob || null,
        city: appCity.trim(),
        address: appAddress.trim(),
        guardianName: appGuardianName.trim(),
        guardianRelationship: appGuardianRel.trim(),
        guardianPhone: appGuardianPhone.trim(),
        previousQualification: appPrevQual.trim(),
        previousInstitution: appPrevInst.trim(),
        previousScore: appPrevScore.trim(),
        targetCourseId: appCourseId,
        targetBatchId: appBatchId || null,
        feePlanId: appFeePlanId || null,
        preferredCohort: selectedBatch?.name || 'Upcoming Intake',
        status: targetStatus,
        applicantRemarks: appRemarks.trim(),
        ...(appDocBase64 && appDocFileName
          ? {
              documents: [
                {
                  documentType: appDocType,
                  title: `${appDocType} — ${appName.trim() || 'Applicant'}`,
                  category:
                    appDocType === 'Academic Transcript' ? 'Transcript' : 'ID Verification',
                  fileName: appDocFileName,
                  mimeType: appDocMime || 'application/octet-stream',
                  contentBase64: appDocBase64,
                },
              ],
            }
          : {}),
      });
      setAppReceipt({
        applicationNumber: res.applicationNumber,
        status: res.status,
        courseTitle: selectedCourse
          ? `${selectedCourse.code} — ${selectedCourse.title}`
          : 'Selected Program',
      });
      setAppDocFileName('');
      setAppDocMime('');
      setAppDocBase64('');
    } catch (err) {
      setAppError(
        err instanceof Error ? err.message : 'Unable to submit admission application.'
      );
    } finally {
      setAppSubmitting(false);
    }
  }

  const instituteName = academy?.name || 'IGS — InfoCom Global Services';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-blue-800">{instituteName}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
            Online Admission Application
          </h1>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            Submitting an application enters the institute admissions review queue. Student portal login credentials are created and activated only by Administration after approval.
          </p>
        </div>
        <FilePlus2 className="w-7 h-7 text-blue-800 shrink-0 hidden sm:block" />
      </div>

      {appError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{appError}</span>
        </div>
      )}

      {appReceipt && (
        <div
          role="status"
          className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-2"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              {appReceipt.status === 'Draft'
                ? 'Admission Draft Saved'
                : 'Admission Application Submitted'}
            </span>
          </div>
          <p>
            Application Reference:{' '}
            <strong className="font-mono text-slate-900">{appReceipt.applicationNumber}</strong>
          </p>
          <p>
            Program: <strong>{appReceipt.courseTitle}</strong> · Status:{' '}
            <strong>{appReceipt.status}</strong>. Once verified and approved by {instituteName} Administration, your student ID and password setup instructions will be issued.
          </p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        {catalogLoading ? (
          <div className="py-12 text-center text-sm text-slate-500">
            Loading published programs and open batches...
          </div>
        ) : (catalog?.courses ?? []).length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-800">
              No programs are currently open for online admission applications.
            </p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800"
            >
              <span>Contact Sopore Campus</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitPublicApplication('Submitted');
            }}
            className="space-y-6"
            noValidate
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pub-app-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Applicant Full Name *
                </label>
                <input
                  id="pub-app-name"
                  type="text"
                  required
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="e.g. Aamir Lone"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label htmlFor="pub-app-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Email Address *
                </label>
                <input
                  id="pub-app-email"
                  type="email"
                  required
                  value={appEmail}
                  onChange={(e) => setAppEmail(e.target.value)}
                  placeholder="applicant@example.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label htmlFor="pub-app-phone" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Mobile Phone
                </label>
                <input
                  id="pub-app-phone"
                  type="tel"
                  value={appPhone}
                  onChange={(e) => setAppPhone(e.target.value)}
                  placeholder="+91 98XXXXXXXX"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label htmlFor="pub-app-dob" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Date of Birth
                </label>
                <input
                  id="pub-app-dob"
                  type="date"
                  value={appDob}
                  onChange={(e) => setAppDob(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
              <div>
                <label htmlFor="pub-app-course" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Target Program *
                </label>
                <select
                  id="pub-app-course"
                  value={appCourseId}
                  onChange={(e) => handleCourseSelect(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  {(catalog?.courses ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                      {c.tuitionFee ? ` (${formatMoney(c.tuitionFee, catalog?.currency || 'INR')})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pub-app-batch" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Preferred Batch
                </label>
                <select
                  id="pub-app-batch"
                  value={appBatchId}
                  onChange={(e) => setAppBatchId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="">Upcoming Intake (Admin Allocation)</option>
                  {(catalog?.batches ?? [])
                    .filter((b) => b.courseId === appCourseId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code} · {b.status})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="pub-app-feeplan" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Preferred Fee Plan
                </label>
                <select
                  id="pub-app-feeplan"
                  value={appFeePlanId}
                  onChange={(e) => setAppFeePlanId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="">Standard Institute Fee Plan</option>
                  {(catalog?.feePlans ?? []).map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.name} ({fp.installmentCount} installment{fp.installmentCount > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pub-app-city" className="block text-xs font-medium text-slate-700 mb-1.5">
                  City / Town
                </label>
                <input
                  id="pub-app-city"
                  type="text"
                  value={appCity}
                  onChange={(e) => setAppCity(e.target.value)}
                  placeholder="e.g. Sopore"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="pub-app-address" className="block text-xs font-medium text-slate-700 mb-1.5">
                Residential Address
              </label>
              <input
                id="pub-app-address"
                type="text"
                value={appAddress}
                onChange={(e) => setAppAddress(e.target.value)}
                placeholder="Locality, Tehsil, District"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200">
              <div>
                <label htmlFor="pub-app-gname" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Guardian Name
                </label>
                <input
                  id="pub-app-gname"
                  type="text"
                  value={appGuardianName}
                  onChange={(e) => setAppGuardianName(e.target.value)}
                  placeholder="Parent / Guardian"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="pub-app-grel" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Relationship
                </label>
                <input
                  id="pub-app-grel"
                  type="text"
                  value={appGuardianRel}
                  onChange={(e) => setAppGuardianRel(e.target.value)}
                  placeholder="Father / Mother"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="pub-app-gphone" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Guardian Phone
                </label>
                <input
                  id="pub-app-gphone"
                  type="tel"
                  value={appGuardianPhone}
                  onChange={(e) => setAppGuardianPhone(e.target.value)}
                  placeholder="+91 ..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="pub-app-qual" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Highest Qualification
                </label>
                <input
                  id="pub-app-qual"
                  type="text"
                  value={appPrevQual}
                  onChange={(e) => setAppPrevQual(e.target.value)}
                  placeholder="e.g. 12th / BCA"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="pub-app-inst" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Previous School / College
                </label>
                <input
                  id="pub-app-inst"
                  type="text"
                  value={appPrevInst}
                  onChange={(e) => setAppPrevInst(e.target.value)}
                  placeholder="Institution name"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="pub-app-score" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Marks / Grade
                </label>
                <input
                  id="pub-app-score"
                  type="text"
                  value={appPrevScore}
                  onChange={(e) => setAppPrevScore(e.target.value)}
                  placeholder="e.g. 84%"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
              <div>
                <label htmlFor="pub-app-doctype" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Supporting Document (Optional · PDF/PNG/JPG, Max 2 MB)
                </label>
                <select
                  id="pub-app-doctype"
                  value={appDocType}
                  onChange={(e) => setAppDocType(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="ID Verification">ID Proof (Aadhaar / ID)</option>
                  <option value="Academic Transcript">Marksheet / Transcript</option>
                </select>
              </div>
              <div className="flex items-end">
                <label
                  htmlFor="pub-app-docfile"
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer truncate"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {appDocFileName ? appDocFileName : 'Attach ID or Marksheet'}
                  </span>
                  <input
                    id="pub-app-docfile"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                    onChange={handleAppFileChange}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="pub-app-remarks" className="block text-xs font-medium text-slate-700 mb-1.5">
                Applicant Remarks (Optional)
              </label>
              <input
                id="pub-app-remarks"
                type="text"
                value={appRemarks}
                onChange={(e) => setAppRemarks(e.target.value)}
                placeholder="Preferred session timing or prior computing experience"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={appSubmitting}
                onClick={() => void submitPublicApplication('Draft')}
                className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
              >
                Save as Draft
              </button>
              <button
                type="submit"
                disabled={appSubmitting}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
              >
                <span>{appSubmitting ? 'Submitting...' : 'Submit Admission Application'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
