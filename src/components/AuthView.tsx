import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  FilePlus2,
  GraduationCap,
  Lock,
  MapPin,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { formatMoney } from '../shared/academic';
import type { UserPublic } from '../shared/types';
import {
  api,
  type PublicAdmissionCatalog,
  type VerifiedCertificateInfo,
} from '../utils/api';

interface AuthViewProps {
  onAuthenticated: (user: UserPublic) => void;
}

const STUDIO_IMAGE_PATH = '/src/assets/images/academy_lab_studio_1794576422024.jpg';

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'apply' | 'verify' | 'forgot'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // Forgot & Reset Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [forgotSaving, setForgotSaving] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);

  // Public Certificate Verification state
  const [certQuery, setCertQuery] = useState('INF-CERT-2026-DA215-042');
  const [certResult, setCertResult] = useState<VerifiedCertificateInfo | null>(null);
  const [certError, setCertError] = useState('');
  const [verifyingCert, setVerifyingCert] = useState(false);

  // Public Online Admission Application state
  const [catalog, setCatalog] = useState<PublicAdmissionCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [appName, setAppName] = useState('');
  const [appEmail, setAppEmail] = useState('');
  const [appPhone, setAppPhone] = useState('');
  const [appDob, setAppDob] = useState('');
  const [appCity, setAppCity] = useState('');
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
    const params = new URLSearchParams(window.location.search);
    const token = params.get('setupToken') || params.get('resetToken');
    const verifyCertCode = params.get('verifyCert');
    const applyFlag = params.get('apply');

    if (token && token.trim().length >= 16) {
      setMode('forgot');
      setResetToken(token.trim());
      setNotice(
        'Welcome to IGS — InfoCom Global Services. Set your account password below to activate portal sign-in.'
      );
      params.delete('setupToken');
      params.delete('resetToken');
      const remaining = params.toString();
      const nextUrl = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    } else if (verifyCertCode && verifyCertCode.trim().length > 0) {
      const code = verifyCertCode.trim();
      setMode('verify');
      setCertQuery(code);
      setVerifyingCert(true);
      api
        .verifyCertificate(code)
        .then((res) => setCertResult(res.certificate))
        .catch((err) =>
          setCertError(err instanceof Error ? err.message : 'Certificate verification failed.')
        )
        .finally(() => setVerifyingCert(false));
    } else if (applyFlag === '1' || applyFlag === 'true') {
      setMode('apply');
    }
  }, []);

  useEffect(() => {
    if (mode !== 'apply' || catalog) return;
    let active = true;
    setCatalogLoading(true);
    setAppError('');
    api
      .fetchPublicAdmissionCatalog()
      .then((data) => {
        if (!active) return;
        setCatalog(data);
        if (data.courses[0]) {
          const firstCourse = data.courses[0];
          setAppCourseId(firstCourse.id);
          const matchingBatch = data.batches.find((b) => b.courseId === firstCourse.id);
          setAppBatchId(matchingBatch?.id ?? '');
        }
        if (data.feePlans[0]) {
          setAppFeePlanId(data.feePlans[0].id);
        }
      })
      .catch((err) => {
        if (active) {
          setAppError(
            err instanceof Error ? err.message : 'Unable to load available courses and batches.'
          );
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, catalog]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'register' && name.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.register({
              name: name.trim(),
              email: email.trim(),
              password,
              phone: phone.trim(),
            });
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCertificate(e: React.FormEvent) {
    e.preventDefault();
    setCertError('');
    setCertResult(null);
    if (!certQuery.trim()) {
      setCertError('Enter a certificate code or SHA-256 verification hash.');
      return;
    }
    setVerifyingCert(true);
    try {
      const res = await api.verifyCertificate(certQuery.trim());
      setCertResult(res.certificate);
    } catch (err) {
      setCertError(
        err instanceof Error ? err.message : 'Certificate verification failed.'
      );
    } finally {
      setVerifyingCert(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!resetEmail.trim()) {
      setError('Please enter your academy email address.');
      return;
    }
    setForgotSaving(true);
    try {
      const res = await api.forgotPassword(resetEmail.trim());
      setNotice(res.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to request password reset.'
      );
    } finally {
      setForgotSaving(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (resetToken.trim().length < 16) {
      setError('Please paste the full password reset token issued to you.');
      return;
    }
    if (resetNewPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setResetSaving(true);
    try {
      const res = await api.resetPassword({
        token: resetToken.trim(),
        newPassword: resetNewPassword,
      });
      setResetToken('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setMode('login');
      setNotice(res.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to complete password reset.'
      );
    } finally {
      setResetSaving(false);
    }
  }

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
        courseTitle: selectedCourse ? `${selectedCourse.code} — ${selectedCourse.title}` : 'Selected Program',
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Editorial Lab Showcase */}
      <section className="lg:w-[48%] bg-slate-900 text-slate-100 flex flex-col justify-between p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          <div className="flex items-center gap-3 text-white">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-blue-300" />
            </div>
            <div className="min-w-0">
              <span className="font-display text-lg font-semibold tracking-tight block leading-tight">
                IGS — InfoCom Global Services
              </span>
              <span className="text-xs text-blue-300 font-medium block">
                Computer Institute
              </span>
            </div>
          </div>

          <div className="mt-10 max-w-lg">
            <p className="text-xs font-medium text-blue-300 tracking-wide">
              Learn Today, Build Tomorrow.
            </p>
            <h1 className="mt-2 font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white text-balance leading-tight">
              Structured technical education, admissions, and verified credentials.
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-md">
              Administrators manage admissions, batches, fees, and audit trails. Instructors guide cohorts, assessments, and attendance. Students track progress reports, class schedules, receipts, and certificates.
            </p>
            <p className="mt-4 inline-flex items-start gap-2 text-xs text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <span>
                Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.
              </span>
            </p>
          </div>
        </div>

        <div className="mt-8">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-700/80 bg-slate-800">
            {!imageFailed ? (
              <img
                src={STUDIO_IMAGE_PATH}
                alt="IGS — InfoCom Global Services computer institute training lab with instructor guiding students at workstations"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-center">
                <BookOpen className="w-10 h-10 text-blue-400 mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  IGS — InfoCom Global Services
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Computer Institute · Sopore, Jammu &amp; Kashmir
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent p-4">
              <p className="text-xs text-slate-200 font-medium">
                InfoCom Global Services · Academic &amp; Lab Portal
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Server-enforced RBAC
            </span>
            <span aria-hidden="true">·</span>
            <span>INR fee &amp; receipt ledger</span>
            <span aria-hidden="true">·</span>
            <span>Verified certificates</span>
          </div>
        </div>
      </section>

      {/* Right Authentication, Admission & Public Verification Card */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div
          className={`w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 transition-all ${
            mode === 'apply' ? 'max-w-xl' : 'max-w-md'
          }`}
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'login'
                  ? 'Sign in to IGS InfoCom AMS'
                  : mode === 'register'
                    ? 'Student Account Registration'
                    : mode === 'apply'
                      ? 'Online Admission Application'
                      : mode === 'forgot'
                        ? 'Reset Account Password'
                        : 'Verify Official Certificate'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login'
                  ? 'Access admin, instructor, or student workspace'
                  : mode === 'register'
                    ? 'Create a student training portal account'
                    : mode === 'apply'
                      ? 'Apply for admission to IGS — InfoCom Global Services, Sopore'
                      : mode === 'forgot'
                        ? 'Request a reset link or apply a reset token'
                        : 'Validate credential authenticity by code or hash'}
              </p>
            </div>
            {mode === 'verify' ? (
              <Award className="w-5 h-5 text-blue-700 shrink-0" />
            ) : mode === 'apply' ? (
              <FilePlus2 className="w-5 h-5 text-blue-700 shrink-0" />
            ) : (
              <Lock className="w-5 h-5 text-slate-400 shrink-0" />
            )}
          </div>

          {/* Mode Tabs */}
          <div
            className="mt-5 grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => {
                setMode('register');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'apply'}
              onClick={() => {
                setMode('apply');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'apply'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Apply
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'verify'}
              onClick={() => {
                setMode('verify');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'verify'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Verify Cert
            </button>
          </div>

          {mode === 'apply' ? (
            <div className="mt-5 space-y-4">
              {appError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{appError}</span>
                </div>
              )}

              {appReceipt && (
                <div
                  role="status"
                  className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1.5"
                >
                  <div className="flex items-center gap-2 font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      {appReceipt.status === 'Draft'
                        ? 'Admission Draft Saved'
                        : 'Admission Application Submitted'}
                    </span>
                  </div>
                  <p>
                    Application Reference:{' '}
                    <strong className="font-mono text-slate-900">
                      {appReceipt.applicationNumber}
                    </strong>
                  </p>
                  <p className="text-emerald-800">
                    Program: {appReceipt.courseTitle} · Status: {appReceipt.status}. Keep your reference number for registrar follow-up at IGS Sopore.
                  </p>
                </div>
              )}

              {catalogLoading ? (
                <div className="p-6 text-center text-xs text-slate-500 border border-slate-200 rounded-lg">
                  Loading available programs and batches...
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitPublicApplication('Submitted');
                  }}
                  className="space-y-4"
                  noValidate
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="pub-app-name" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Applicant Full Name *
                      </label>
                      <input
                        id="pub-app-name"
                        type="text"
                        required
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        placeholder="e.g. Aamir Lone"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-email" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Email Address *
                      </label>
                      <input
                        id="pub-app-email"
                        type="email"
                        required
                        value={appEmail}
                        onChange={(e) => setAppEmail(e.target.value)}
                        placeholder="applicant@example.com"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-phone" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Mobile Phone
                      </label>
                      <input
                        id="pub-app-phone"
                        type="tel"
                        value={appPhone}
                        onChange={(e) => setAppPhone(e.target.value)}
                        placeholder="+91 98XXXXXXXX"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-dob" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Date of Birth
                      </label>
                      <input
                        id="pub-app-dob"
                        type="date"
                        value={appDob}
                        onChange={(e) => setAppDob(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label htmlFor="pub-app-course" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Target Course *
                      </label>
                      <select
                        id="pub-app-course"
                        value={appCourseId}
                        onChange={(e) => handleCourseSelect(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      >
                        {(catalog?.courses ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.title} ({formatMoney(c.tuitionFee, catalog?.currency || 'INR')})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pub-app-batch" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Preferred Batch
                      </label>
                      <select
                        id="pub-app-batch"
                        value={appBatchId}
                        onChange={(e) => setAppBatchId(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      >
                        <option value="">Upcoming Intake (Registrar Allocation)</option>
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
                      <label htmlFor="pub-app-feeplan" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Preferred Fee Plan
                      </label>
                      <select
                        id="pub-app-feeplan"
                        value={appFeePlanId}
                        onChange={(e) => setAppFeePlanId(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
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
                      <label htmlFor="pub-app-city" className="block text-[11px] font-medium text-slate-700 mb-1">
                        City / Town
                      </label>
                      <input
                        id="pub-app-city"
                        type="text"
                        value={appCity}
                        onChange={(e) => setAppCity(e.target.value)}
                        placeholder="e.g. Sopore"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="pub-app-address" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Residential Address
                    </label>
                    <input
                      id="pub-app-address"
                      type="text"
                      value={appAddress}
                      onChange={(e) => setAppAddress(e.target.value)}
                      placeholder="Locality, Tehsil, District"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label htmlFor="pub-app-gname" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Guardian Name
                      </label>
                      <input
                        id="pub-app-gname"
                        type="text"
                        value={appGuardianName}
                        onChange={(e) => setAppGuardianName(e.target.value)}
                        placeholder="Parent / Guardian"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-grel" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Relationship
                      </label>
                      <input
                        id="pub-app-grel"
                        type="text"
                        value={appGuardianRel}
                        onChange={(e) => setAppGuardianRel(e.target.value)}
                        placeholder="Father / Mother"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-gphone" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Guardian Phone
                      </label>
                      <input
                        id="pub-app-gphone"
                        type="tel"
                        value={appGuardianPhone}
                        onChange={(e) => setAppGuardianPhone(e.target.value)}
                        placeholder="+91 ..."
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="pub-app-qual" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Highest Qualification
                      </label>
                      <input
                        id="pub-app-qual"
                        type="text"
                        value={appPrevQual}
                        onChange={(e) => setAppPrevQual(e.target.value)}
                        placeholder="e.g. 12th / BCA"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-inst" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Previous School / College
                      </label>
                      <input
                        id="pub-app-inst"
                        type="text"
                        value={appPrevInst}
                        onChange={(e) => setAppPrevInst(e.target.value)}
                        placeholder="Institution name"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="pub-app-score" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Marks / Grade
                      </label>
                      <input
                        id="pub-app-score"
                        type="text"
                        value={appPrevScore}
                        onChange={(e) => setAppPrevScore(e.target.value)}
                        placeholder="e.g. 84%"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label htmlFor="pub-app-doctype" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Supporting Document (Optional, Max 2 MB)
                      </label>
                      <select
                        id="pub-app-doctype"
                        value={appDocType}
                        onChange={(e) => setAppDocType(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                      >
                        <option value="ID Verification">ID Proof (Aadhaar / ID)</option>
                        <option value="Academic Transcript">Marksheet / Transcript</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label
                        htmlFor="pub-app-docfile"
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer truncate"
                      >
                        <Upload className="w-3.5 h-3.5 shrink-0" />
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
                    <label htmlFor="pub-app-remarks" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Applicant Remarks (Optional)
                    </label>
                    <input
                      id="pub-app-remarks"
                      type="text"
                      value={appRemarks}
                      onChange={(e) => setAppRemarks(e.target.value)}
                      placeholder="Preferred session timing or prior computing experience"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      disabled={appSubmitting}
                      onClick={() => submitPublicApplication('Draft')}
                      className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="submit"
                      disabled={appSubmitting}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>{appSubmitting ? 'Submitting...' : 'Submit Application'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : mode === 'forgot' ? (
            <div className="mt-5 space-y-5">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{notice}</span>
                </div>
              )}

              {resetToken.trim().length > 0 ? (
                <>
                  <form onSubmit={handleResetPassword} className="space-y-3" noValidate>
                    <p className="text-xs font-medium text-slate-700">
                      Set Your Account Password with Setup / Reset Token
                    </p>
                    <div>
                      <label
                        htmlFor="reset-token"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Reset / Setup Token
                      </label>
                      <input
                        id="reset-token"
                        type="text"
                        required
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        placeholder="Paste single-use setup or reset token"
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor="reset-new-password"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          New Password
                        </label>
                        <input
                          id="reset-new-password"
                          type="password"
                          required
                          minLength={8}
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          placeholder="Min 8 characters"
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="reset-confirm-password"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Confirm Password
                        </label>
                        <input
                          id="reset-confirm-password"
                          type="password"
                          required
                          minLength={8}
                          value={resetConfirmPassword}
                          onChange={(e) => setResetConfirmPassword(e.target.value)}
                          placeholder="Repeat password"
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={resetSaving}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <span>{resetSaving ? 'Updating Password...' : 'Apply New Password'}</span>
                    </button>
                  </form>

                  <details className="border-t border-slate-200 pt-3">
                    <summary className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer">
                      Need a fresh password reset token?
                    </summary>
                    <form onSubmit={handleForgotPassword} className="mt-3 space-y-3" noValidate>
                      <div>
                        <label
                          htmlFor="forgot-email"
                          className="block text-xs font-medium text-slate-700 mb-1.5"
                        >
                          Academy Email Address
                        </label>
                        <input
                          id="forgot-email"
                          type="email"
                          required
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={forgotSaving}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        <span>{forgotSaving ? 'Submitting...' : 'Request Password Reset'}</span>
                      </button>
                    </form>
                  </details>
                </>
              ) : (
                <>
                  <form onSubmit={handleForgotPassword} className="space-y-3" noValidate>
                    <div>
                      <label
                        htmlFor="forgot-email"
                        className="block text-xs font-medium text-slate-700 mb-1.5"
                      >
                        1. Request Reset Instructions (Academy Email)
                      </label>
                      <input
                        id="forgot-email"
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={forgotSaving}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <span>{forgotSaving ? 'Submitting...' : 'Request Password Reset'}</span>
                    </button>
                  </form>

                  <div className="border-t border-slate-200 pt-4">
                    <form onSubmit={handleResetPassword} className="space-y-3" noValidate>
                      <p className="text-xs font-medium text-slate-700">
                        2. Complete Password Reset with Token
                      </p>
                      <div>
                        <label
                          htmlFor="reset-token"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Reset Token
                        </label>
                        <input
                          id="reset-token"
                          type="text"
                          required
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          placeholder="Paste single-use reset token"
                          className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor="reset-new-password"
                            className="block text-[11px] font-medium text-slate-600 mb-1"
                          >
                            New Password
                          </label>
                          <input
                            id="reset-new-password"
                            type="password"
                            required
                            minLength={8}
                            value={resetNewPassword}
                            onChange={(e) => setResetNewPassword(e.target.value)}
                            placeholder="Min 8 characters"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="reset-confirm-password"
                            className="block text-[11px] font-medium text-slate-600 mb-1"
                          >
                            Confirm Password
                          </label>
                          <input
                            id="reset-confirm-password"
                            type="password"
                            required
                            minLength={8}
                            value={resetConfirmPassword}
                            onChange={(e) => setResetConfirmPassword(e.target.value)}
                            placeholder="Repeat password"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={resetSaving}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        <span>{resetSaving ? 'Updating Password...' : 'Apply New Password'}</span>
                      </button>
                    </form>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setNotice('');
                }}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
              >
                &larr; Back to Sign In
              </button>
            </div>
          ) : mode === 'verify' ? (
            <div className="mt-5 space-y-4">
              <form onSubmit={handleVerifyCertificate} className="space-y-3">
                <div>
                  <label
                    htmlFor="verify-cert-code"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Certificate Code or Verification Hash
                  </label>
                  <input
                    id="verify-cert-code"
                    type="text"
                    value={certQuery}
                    onChange={(e) => setCertQuery(e.target.value)}
                    placeholder="e.g. INF-CERT-2026-FSE101-104"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={verifyingCert}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <Search className="w-4 h-4" />
                  <span>{verifyingCert ? 'Checking Registry...' : 'Verify Credential'}</span>
                </button>
              </form>

              {certError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{certError}</span>
                </div>
              )}

              {certResult && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-slate-900">
                      {certResult.certificateCode}
                    </span>
                    {certResult.status === 'Issued' ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                        <XCircle className="w-3.5 h-3.5" />
                        Revoked
                      </span>
                    )}
                  </div>
                  <div className="text-slate-700">
                    Recipient: <strong className="text-slate-900">{certResult.studentName}</strong>{' '}
                    ({certResult.studentCode})
                  </div>
                  <div className="text-slate-700">
                    Program: <strong className="text-slate-900">{certResult.courseCode}</strong> —{' '}
                    {certResult.courseTitle}
                  </div>
                  <div className="text-slate-600 font-mono tabular-nums">
                    Score: {certResult.finalScore}% ({certResult.letterGrade}) · Attendance:{' '}
                    {certResult.attendanceRate}%
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono break-all">
                    SHA-256 Hash: {certResult.verificationHash}
                  </div>
                  {certResult.revokedReason && (
                    <div className="text-red-700 font-medium">
                      Revocation Reason: {certResult.revokedReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{notice}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
                {mode === 'register' && (
                  <>
                    <div>
                      <label
                        htmlFor="auth-name"
                        className="block text-xs font-medium text-slate-700 mb-1.5"
                      >
                        Full Name
                      </label>
                      <input
                        id="auth-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Jordan Taylor"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="auth-phone"
                        className="block text-xs font-medium text-slate-700 mb-1.5"
                      >
                        Phone Number (Optional)
                      </label>
                      <input
                        id="auth-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91-00000-00000"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setResetEmail(email);
                          setError('');
                          setNotice('');
                        }}
                        className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>
                    {submitting
                      ? 'Verifying...'
                      : mode === 'login'
                        ? 'Sign In'
                        : 'Create Student Account'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <p className="mt-5 pt-4 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
                IGS — InfoCom Global Services · Computer Institute. Contact the institute registrar in Sopore for staff or faculty onboarding credentials.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
