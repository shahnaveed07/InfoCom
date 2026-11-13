import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  GraduationCap,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import type { UserPublic, UserRole } from '../shared/types';
import { api } from '../utils/api';

interface AuthViewProps {
  onAuthenticated: (user: UserPublic) => void;
}

const STUDIO_IMAGE_PATH = '/src/assets/images/academy_lab_studio_1794576422024.jpg';

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

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
          : await api.register({ name: name.trim(), email: email.trim(), password, role });
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemoAccount(targetRole: UserRole) {
    setMode('login');
    setError('');
    if (targetRole === 'instructor') {
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
              Northbridge Tech Academy
            </span>
          </div>

          <div className="mt-10 max-w-lg">
            <p className="text-xs font-medium text-blue-300 tracking-wide">
              Computer Training Centre Portal
            </p>
            <h1 className="mt-2 font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white text-balance leading-tight">
              Structured technical training, live cohort tracking, and verified progress records.
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-md">
              Instructors manage enrollments, module assessments, attendance logs, and official progress reports. Students review grades, upcoming lab schedules, and automated session reminders.
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
                  Northbridge Training Labs
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Software Engineering · Cloud · Data Analytics · Cybersecurity
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent p-4">
              <p className="text-xs text-slate-200 font-medium">
                Lab Wing B · Autumn Cohort 2026
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Role-scoped session access
            </span>
            <span aria-hidden="true">·</span>
            <span>Automated 24h lab reminders</span>
            <span aria-hidden="true">·</span>
            <span>Printable transcripts</span>
          </div>
        </div>
      </section>

      {/* Right Authentication Form */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'login' ? 'Sign in to your portal' : 'Create training account'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login'
                  ? 'Access instructor management or student dashboard'
                  : 'Register as a student or centre instructor'}
              </p>
            </div>
            <Lock className="w-5 h-5 text-slate-400 shrink-0" />
          </div>

          {/* Mode Tabs */}
          <div
            className="mt-5 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
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
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register Account
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
                    htmlFor="auth-role"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Account Role
                  </label>
                  <select
                    id="auth-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  >
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                  </select>
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
                placeholder="name@northbridge.edu"
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
                    : 'Create Account'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Demo Account Quick Fill */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-2.5">
              Quick-fill seeded portal credentials
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => fillDemoAccount('instructor')}
                className="text-left px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
              >
                <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                  Instructor Demo
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Dr. Elena Vance
                </div>
              </button>
              <button
                type="button"
                onClick={() => fillDemoAccount('student')}
                className="text-left px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
              >
                <div className="text-xs font-semibold text-slate-900 whitespace-nowrap">
                  Student Demo
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Marcus Chen
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
