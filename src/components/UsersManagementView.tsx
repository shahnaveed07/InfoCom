import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Fingerprint,
  KeyRound,
  Plus,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AuthMode,
  DashboardPayload,
  UserAccountStatus,
  UserRole,
  WebAuthnCredentialMetadata,
} from '../shared/types';
import { api } from '../utils/api';

interface OnboardingLinkInfo {
  userId?: string;
  userName: string;
  email: string;
  url: string;
  expiresAt?: string;
}

interface UsersManagementViewProps {
  data: DashboardPayload;
  authMode?: AuthMode;
  onCreateUser: (payload: {
    name: string;
    email: string;
    role: UserRole;
    department?: string;
    phone?: string;
    password?: string;
    requirePasswordChange?: boolean;
  }) => Promise<{ onboardingPath?: string; onboardingExpiresAt?: string }>;
  onIssueResetToken: (userId: string) => Promise<{
    onboardingPath: string;
    onboardingExpiresAt: string;
    userName: string;
  }>;
  onRevokeResetTokens: (userId: string) => Promise<{
    revokedCount: number;
    userName: string;
  }>;
  onUpdateUser: (
    userId: string,
    payload: {
      role?: UserRole;
      status?: UserAccountStatus;
    }
  ) => Promise<void>;
}

export function UsersManagementView({
  data,
  authMode = 'password',
  onCreateUser,
  onIssueResetToken,
  onRevokeResetTokens,
  onUpdateUser,
}: UsersManagementViewProps) {
  const isPasskeyMode = authMode === 'webauthn';
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [modalOpen, setModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [passwordMode, setPasswordMode] = useState<'invite' | 'password'>('invite');
  const [password, setPassword] = useState('');
  const [requirePasswordChange, setRequirePasswordChange] = useState(true);
  const [formError, setFormError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [onboardingLink, setOnboardingLink] = useState<OnboardingLinkInfo | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [issuingResetFor, setIssuingResetFor] = useState<string | null>(null);
  const [revokingResetFor, setRevokingResetFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Admin passkey inspection & revocation modal
  const [passkeyTarget, setPasskeyTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [passkeyList, setPasskeyList] = useState<WebAuthnCredentialMetadata[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const [revokingCredId, setRevokingCredId] = useState<string | null>(null);

  async function openUserPasskeysModal(u: { id: string; name: string; email: string }) {
    setPasskeyTarget(u);
    setPasskeyLoading(true);
    setPasskeyError('');
    try {
      const res = await api.listUserPasskeys(u.id);
      setPasskeyList(res.credentials);
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Unable to load user passkeys.');
      setPasskeyList([]);
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleAdminRevokePasskey(credId: string, label: string) {
    if (!passkeyTarget) return;
    setRevokingCredId(credId);
    setPasskeyError('');
    try {
      await api.revokeUserPasskey(passkeyTarget.id, credId);
      const res = await api.listUserPasskeys(passkeyTarget.id);
      setPasskeyList(res.credentials);
      setStatusNotice(
        `Revoked passkey "${label}" and active sessions for ${passkeyTarget.name}.`
      );
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Unable to revoke passkey.');
    } finally {
      setRevokingCredId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return `${u.name} ${u.email} ${u.studentCode ?? ''} ${u.staffCode ?? ''} ${u.department ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [data.users, search, roleFilter]);

  async function handleCopyOnboardingUrl() {
    if (!onboardingLink) return;
    try {
      await navigator.clipboard.writeText(onboardingLink.url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setOnboardingLink(null);
    if (name.trim().length < 2 || !email.trim()) {
      setFormError('Valid name and email address are required.');
      return;
    }
    if (!isPasskeyMode && passwordMode === 'password' && password.length < 8) {
      setFormError('Temporary password must be at least 8 characters long.');
      return;
    }
    setSubmitting(true);
    try {
      const createdName = name.trim();
      const createdEmail = email.trim();
      const res = await onCreateUser({
        name: createdName,
        email: createdEmail,
        role,
        department: department.trim(),
        phone: phone.trim(),
        ...(!isPasskeyMode && passwordMode === 'password'
          ? { password, requirePasswordChange }
          : { requirePasswordChange: !isPasskeyMode }),
      });
      setModalOpen(false);
      setName('');
      setEmail('');
      setDepartment('');
      setPhone('');
      setPassword('');
      if (res.onboardingPath) {
        setOnboardingLink({
          userName: createdName,
          email: createdEmail,
          url: `${window.location.origin}${res.onboardingPath}`,
          expiresAt: res.onboardingExpiresAt,
        });
        setStatusNotice(
          `Created ${role} account for ${createdName} and issued a single-use 72-hour setup link.`
        );
      } else {
        setStatusNotice(`Created ${role} account for ${createdName}.`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIssueResetToken(userId: string, userName: string, userEmail: string) {
    setStatusNotice('');
    setOnboardingLink(null);
    setIssuingResetFor(userId);
    try {
      const res = await onIssueResetToken(userId);
      setOnboardingLink({
        userId,
        userName: res.userName || userName,
        email: userEmail,
        url: `${window.location.origin}${res.onboardingPath}`,
        expiresAt: res.onboardingExpiresAt,
      });
      setStatusNotice(
        isPasskeyMode
          ? `Issued single-use 72-hour passkey enrollment/recovery link for ${userName}.`
          : `Issued single-use 72-hour password setup link for ${userName}.`
      );
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Unable to issue password setup link.'
      );
    } finally {
      setIssuingResetFor(null);
    }
  }

  async function handleRevokeResetTokens(userId: string, userName: string) {
    setStatusNotice('');
    setRevokingResetFor(userId);
    try {
      const res = await onRevokeResetTokens(userId);
      if (onboardingLink?.userId === userId || onboardingLink?.userName === userName) {
        setOnboardingLink(null);
      }
      setStatusNotice(
        res.revokedCount > 0
          ? `Revoked ${res.revokedCount} active onboarding/reset token(s) for ${res.userName || userName}.`
          : `No active unused onboarding/reset tokens were pending for ${res.userName || userName}.`
      );
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Unable to revoke onboarding tokens.'
      );
    } finally {
      setRevokingResetFor(null);
    }
  }

  async function handleRoleOrStatusChange(
    userId: string,
    payload: { role?: UserRole; status?: UserAccountStatus }
  ) {
    setStatusNotice('');
    try {
      await onUpdateUser(userId, payload);
      setStatusNotice('User account record updated and logged.');
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Failed to update account.'
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, or code..."
              aria-label="Search students and staff"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(['all', 'student', 'instructor', 'admin'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRoleFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer whitespace-nowrap shrink-0 ${
                  roleFilter === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'all' ? 'All Accounts' : `${tab}s`}
              </button>
            ))}
          </div>
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
          <span>Add Account</span>
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

      {onboardingLink && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-900">
              <KeyRound className="w-4 h-4 text-blue-700 shrink-0" />
              <span>
                Single-Use Onboarding Setup Link · {onboardingLink.userName} ({onboardingLink.email})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOnboardingLink(null)}
              aria-label="Dismiss onboarding link"
              className="text-blue-700 hover:text-blue-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              readOnly
              value={onboardingLink.url}
              aria-label="Onboarding setup URL"
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-blue-200 rounded-lg text-slate-900"
            />
            <button
              type="button"
              onClick={handleCopyOnboardingUrl}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
            </button>
          </div>
          <p className="text-[11px] text-blue-800">
            {isPasskeyMode
              ? 'Share this single-use link securely with the user to register a passkey on their device (expires in 72 hours).'
              : 'Share this link securely with the user to set their own password (expires in 72 hours).'}
          </p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Academy Students, Instructors & Administrators
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filtered.length} of {data.users.length} accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-5">User & Email</th>
                <th className="py-2.5 px-4">Academy Code</th>
                <th className="py-2.5 px-4">Department</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-5 text-right">Account Status &amp; Reset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((u) => {
                const isSelf = u.id === data.user.id;
                const canIssueReset = u.status !== 'suspended' && u.status !== 'archived';
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-900">
                        {u.name}
                        {isSelf && (
                          <span className="ml-2 text-[11px] text-blue-700 font-normal">
                            (You)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">
                      {u.studentCode || u.staffCode || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {u.department || (u.role === 'student' ? 'Enrolled Learner' : '—')}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        disabled={isSelf}
                        onChange={(e) =>
                          handleRoleOrStatusChange(u.id, {
                            role: e.target.value as UserRole,
                          })
                        }
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 disabled:opacity-60 cursor-pointer"
                      >
                        <option value="student">Student</option>
                        <option value="instructor">Instructor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!canIssueReset || issuingResetFor === u.id || revokingResetFor === u.id}
                          onClick={() => handleIssueResetToken(u.id, u.name, u.email)}
                          aria-label={
                            isPasskeyMode
                              ? `Issue passkey enrollment link for ${u.name}`
                              : `Issue reset link for ${u.name}`
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-md cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>
                            {issuingResetFor === u.id
                              ? 'Issuing...'
                              : isPasskeyMode
                                ? 'Enroll Link'
                                : 'Reset Link'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={issuingResetFor === u.id || revokingResetFor === u.id}
                          onClick={() => handleRevokeResetTokens(u.id, u.name)}
                          aria-label={`Revoke reset links for ${u.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 rounded-md cursor-pointer"
                        >
                          <Ban className="w-3 h-3" />
                          <span>
                            {revokingResetFor === u.id ? 'Revoking...' : 'Revoke Link'}
                          </span>
                        </button>
                        {isPasskeyMode && (
                          <button
                            type="button"
                            onClick={() =>
                              openUserPasskeysModal({ id: u.id, name: u.name, email: u.email })
                            }
                            aria-label={`Manage passkeys for ${u.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                          >
                            <Fingerprint className="w-3 h-3" />
                            <span>Passkeys</span>
                          </button>
                        )}
                        <select
                          aria-label={`Status for ${u.name}`}
                          value={u.status}
                          disabled={isSelf}
                          onChange={(e) =>
                            handleRoleOrStatusChange(u.id, {
                              status: e.target.value as UserAccountStatus,
                            })
                          }
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 disabled:opacity-60 cursor-pointer"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="inactive">Inactive</option>
                          <option value="archived">Archived</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-user-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-700" />
                <h3
                  id="add-user-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Create Academy Account
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close create user modal"
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

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. Cloud Engineering"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
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

              <div className="border-t border-slate-200 pt-3 space-y-2.5">
                {isPasskeyMode ? (
                  <>
                    <div className="text-xs font-medium text-slate-700">
                      Passkey Account Onboarding
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Generates a single-use 72-hour passkey enrollment link so the user registers their own device biometric or security key with zero shared passwords.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-medium text-slate-700">
                      Account Password Onboarding
                    </div>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setPasswordMode('invite')}
                        className={`py-1.5 px-2 text-xs font-medium rounded-md cursor-pointer ${
                          passwordMode === 'invite'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Setup Link (Recommended)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPasswordMode('password')}
                        className={`py-1.5 px-2 text-xs font-medium rounded-md cursor-pointer ${
                          passwordMode === 'password'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Temporary Password
                      </button>
                    </div>

                    {passwordMode === 'invite' ? (
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Generates a single-use 72-hour onboarding URL so the user sets their own private password without sharing credentials.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Temporary Password (min 8 chars)
                          </label>
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={requirePasswordChange}
                            onChange={(e) => setRequirePasswordChange(e.target.checked)}
                          />
                          <span>Require password change on first login</span>
                        </label>
                      </div>
                    )}
                  </>
                )}
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
                  {submitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {passkeyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-passkeys-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-blue-700" />
                <div>
                  <h3
                    id="admin-passkeys-modal-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Registered Passkeys · {passkeyTarget.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">{passkeyTarget.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasskeyTarget(null)}
                aria-label="Close user passkeys modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passkeyError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{passkeyError}</span>
              </div>
            )}

            <div className="mt-4">
              {passkeyLoading ? (
                <p className="text-xs text-slate-500 py-4">Loading registered passkeys...</p>
              ) : passkeyList.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  No passkeys registered for this account. Use &ldquo;Enroll Link&rdquo; to issue a single-use enrollment link.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                  {passkeyList.map((cred) => {
                    const isRevoked = Boolean(cred.revokedAt);
                    return (
                      <li
                        key={cred.id}
                        className="p-3 flex items-center justify-between gap-3 bg-white"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {cred.deviceLabel}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              {cred.coseAlgorithm === -7 ? 'ES256' : 'RS256'}
                            </span>
                            {isRevoked && (
                              <span className="text-[10px] text-red-700 font-medium">
                                Revoked
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Added {new Date(cred.createdAt).toLocaleDateString()}
                            {' · '}
                            {cred.lastUsedAt
                              ? `Last used ${new Date(cred.lastUsedAt).toLocaleString()}`
                              : 'Never used'}
                          </div>
                        </div>
                        {!isRevoked && (
                          <button
                            type="button"
                            disabled={revokingCredId === cred.id}
                            onClick={() => handleAdminRevokePasskey(cred.id, cred.deviceLabel)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer shrink-0"
                          >
                            <Ban className="w-3 h-3" />
                            <span>{revokingCredId === cred.id ? 'Revoking...' : 'Revoke'}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setPasskeyTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
