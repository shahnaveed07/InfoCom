import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import type { PublicAcademyInfo, UserPublic } from '../shared/types';
import { api } from '../utils/api';
import { BrandCrest } from './public/BrandCrest';

interface AuthViewProps {
  academy?: PublicAcademyInfo | null;
  onAuthenticated: (user: UserPublic) => void;
}

const STUDIO_IMAGE_PATH = '/src/assets/images/academy_lab_studio_1794576422024.jpg';

export function AuthView({ academy, onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('setupToken') || params.get('resetToken');
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
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');

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
      const result = await api.login(email.trim(), password);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
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

  const instituteName = academy?.name || 'IGS — InfoCom Global Services';
  const campusAddress =
    academy?.address ||
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Brand & Editorial Lab Showcase */}
      <section className="lg:w-[48%] bg-slate-900 text-slate-100 flex flex-col justify-between p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-3 text-white">
              <BrandCrest
                logoDataUrl={academy?.logoDataUrl}
                name={instituteName}
                sizeClass="h-11 w-auto max-w-[140px]"
                darkSurface
              />
              <div className="min-w-0">
                <span className="font-display text-lg font-semibold tracking-tight block leading-tight">
                  {instituteName}
                </span>
                <span className="text-xs text-blue-300 font-medium block">
                  Computer Institute
                </span>
              </div>
            </Link>

            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Public Site</span>
            </Link>
          </div>

          <div className="mt-10 max-w-lg">
            <p className="text-xs font-medium text-blue-300 tracking-wide">
              {academy?.slogan || 'Learn Today, Build Tomorrow.'}
            </p>
            <h1 className="mt-2 font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white text-balance leading-tight">
              Academy Management &amp; Student Portal
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-md">
              Administrators coordinate admissions, cohorts, fees, and credentials. Instructors record attendance and evaluations. Enrolled students view schedules, progress reports, receipts, and certificates.
            </p>
            <p className="mt-4 inline-flex items-start gap-2 text-xs text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <span>{campusAddress}</span>
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
                <p className="text-sm font-medium text-slate-200">{instituteName}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Computer Institute · Sopore, Jammu &amp; Kashmir
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent p-4">
              <p className="text-xs text-slate-200 font-medium">
                {instituteName} · Sopore Campus Lab
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Admin-provisioned accounts
            </span>
            <span aria-hidden="true">·</span>
            <span>INR fee &amp; receipt ledger</span>
            <span aria-hidden="true">·</span>
            <span>QR verified certificates</span>
          </div>
        </div>
      </section>

      {/* Right Authentication Card */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'login' ? 'Sign In to Portal' : 'Set or Reset Password'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login'
                  ? 'Access admin, instructor, or student workspace'
                  : 'Complete account onboarding or request a password reset'}
              </p>
            </div>
            <Lock className="w-5 h-5 text-slate-400 shrink-0" />
          </div>

          {/* 2-Tab Mode Bar (No Public Registration) */}
          <div
            className="mt-5 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
            role="tablist"
            aria-label="Portal authentication mode"
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
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
              aria-selected={mode === 'forgot'}
              onClick={() => {
                setMode('forgot');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'forgot'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reset / Setup Password
            </button>
          </div>

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

          {mode === 'forgot' ? (
            <div className="mt-5 space-y-5">
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
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
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
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
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
                          Setup / Reset Token
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
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        <span>{resetSaving ? 'Updating Password...' : 'Apply New Password'}</span>
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
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
                </div>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-3 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>{submitting ? 'Verifying...' : 'Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-slate-200 space-y-2.5 text-xs text-slate-600 leading-relaxed">
            <p>
              Student, instructor, and administrator accounts are provisioned exclusively by{' '}
              <strong className="font-semibold text-slate-800">{instituteName}</strong>{' '}
              Administration.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <Link to="/admissions" className="font-medium text-blue-700 hover:text-blue-900">
                Apply for Admission &rarr;
              </Link>
              <Link to="/verify-certificate" className="font-medium text-slate-700 hover:text-slate-900">
                Verify Certificate
              </Link>
              <Link to="/" className="font-medium text-slate-700 hover:text-slate-900">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
