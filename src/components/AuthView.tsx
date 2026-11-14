import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Lock,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { firebaseAuth, googleAuthProvider } from '../lib/firebase';
import type { UserPublic, UserRole } from '../shared/types';
import { api, type VerifiedCertificateInfo } from '../utils/api';

interface AuthViewProps {
  onAuthenticated: (user: UserPublic) => void;
}

const STUDIO_IMAGE_PATH = '/src/assets/images/academy_lab_studio_1794576422024.jpg';

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // Public Certificate Verification state
  const [certQuery, setCertQuery] = useState('INF-CERT-2026-DA215-042');
  const [certResult, setCertResult] = useState<VerifiedCertificateInfo | null>(null);
  const [certError, setCertError] = useState('');
  const [verifyingCert, setVerifyingCert] = useState(false);

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

  async function handleGoogleSignIn() {
    setError('');
    setGoogleLoading(true);
    try {
      const cred = await signInWithPopup(firebaseAuth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await api.loginWithFirebase(idToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In could not be completed.'
      );
    } finally {
      setGoogleLoading(false);
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

  function fillDemoAccount(targetRole: UserRole) {
    setMode('login');
    setError('');
    if (targetRole === 'admin') {
      setEmail('admin@infocom.edu');
      setPassword('Admin!2026');
    } else if (targetRole === 'instructor') {
      setEmail('elena.vance@northbridge.edu');
      setPassword('Instructor!2026');
    } else {
      setEmail('marcus.chen@student.northbridge.edu');
      setPassword('Student!2026');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Editorial Lab Showcase */}
      <section className="lg:w-[48%] bg-slate-900 text-slate-100 flex flex-col justify-between p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 text-white">
            <GraduationCap className="w-6 h-6 text-blue-400 shrink-0" />
            <span className="font-display text-lg font-semibold tracking-tight whitespace-nowrap">
              InfoCom AMS · Northbridge Academy
            </span>
          </div>

          <div className="mt-10 max-w-lg">
            <p className="text-xs font-medium text-blue-300 tracking-wide">
              Academy Management System
            </p>
            <h1 className="mt-2 font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white text-balance leading-tight">
              Structured technical training, academy operations, and verified credentials.
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-md">
              Administrators oversee admissions, tuition billing, staff, and audit trails. Instructors track cohorts, grades, and attendance. Students review progress reports, schedules, receipts, and certificates.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-700/80 bg-slate-800">
            {!imageFailed ? (
              <img
                src={STUDIO_IMAGE_PATH}
                alt="Northbridge Tech Academy computer training studio with instructor guiding students at workstations"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-center">
                <BookOpen className="w-10 h-10 text-blue-400 mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  InfoCom Academy Labs
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Software Engineering · Cloud · Data Analytics · Cybersecurity
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent p-4">
              <p className="text-xs text-slate-200 font-medium">
                Lab Wing B · Autumn & Winter Cohorts 2026
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Server-enforced RBAC
            </span>
            <span aria-hidden="true">·</span>
            <span>Tuition & fee ledger</span>
            <span aria-hidden="true">·</span>
            <span>Verified certificates</span>
          </div>
        </div>
      </section>

      {/* Right Authentication & Public Verification Card */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'login'
                  ? 'Sign in to InfoCom AMS'
                  : mode === 'register'
                    ? 'Student Account Registration'
                    : 'Verify Official Certificate'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login'
                  ? 'Access admin, instructor, or student workspace'
                  : mode === 'register'
                    ? 'Create a student training portal account'
                    : 'Validate credential authenticity by code or hash'}
              </p>
            </div>
            {mode === 'verify' ? (
              <Award className="w-5 h-5 text-blue-700 shrink-0" />
            ) : (
              <Lock className="w-5 h-5 text-slate-400 shrink-0" />
            )}
          </div>

          {/* Mode Tabs */}
          <div
            className="mt-5 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg"
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
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
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
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
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
              aria-selected={mode === 'verify'}
              onClick={() => {
                setMode('verify');
                setError('');
              }}
              className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'verify'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Verify Cert
            </button>
          </div>

          {mode === 'verify' ? (
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
                        placeholder="+1-555-0199"
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
                    Academy Email
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@infocom.edu"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Password
                  </label>
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

              <div className="mt-4">
                <div className="relative flex items-center justify-center my-3">
                  <div className="border-t border-slate-200 w-full" />
                  <span className="bg-white px-2.5 text-[11px] text-slate-400 whitespace-nowrap">
                    or continue with SSO
                  </span>
                  <div className="border-t border-slate-200 w-full" />
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-4 h-4 text-blue-700" />
                  <span>
                    {googleLoading ? 'Connecting Google...' : 'Continue with Google'}
                  </span>
                </button>
              </div>

              {/* Demo Account Quick Fill */}
              <div className="mt-6 pt-5 border-t border-slate-200">
                <p className="text-xs font-medium text-slate-600 mb-2.5">
                  Quick-fill seeded portal credentials
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => fillDemoAccount('admin')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                      Admin Demo
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      Director
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemoAccount('instructor')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                      Instructor
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      Dr. E. Vance
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemoAccount('student')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                      Student
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      Marcus Chen
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
