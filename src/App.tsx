import React, { useCallback, useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, KeyRound, X } from 'lucide-react';
import { AcademySettingsView } from './components/AcademySettingsView';
import { AdminOverview } from './components/AdminOverview';
import { AdmissionsView } from './components/AdmissionsView';
import { AttendanceAlertsView } from './components/AttendanceAlertsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AuthView } from './components/AuthView';
import { BatchesManagementView } from './components/BatchesManagementView';
import { CertificatesView } from './components/CertificatesView';
import { CoursesCohortsView } from './components/CoursesCohortsView';
import { CourseTrackingView } from './components/CourseTrackingView';
import { DocumentsView } from './components/DocumentsView';
import { EnrollmentsView } from './components/EnrollmentsView';
import { FinanceView } from './components/FinanceView';
import { InstructorOverview } from './components/InstructorOverview';
import { InstructorsManagementView } from './components/InstructorsManagementView';
import { ProgressReportView } from './components/ProgressReportView';
import { SchedulesView } from './components/SchedulesView';
import { Sidebar, type NavSection } from './components/Sidebar';
import { StudentDashboard } from './components/StudentDashboard';
import { StudentsManagementView } from './components/StudentsManagementView';
import { TopBar } from './components/TopBar';
import { UsersManagementView } from './components/UsersManagementView';
import { PublicAboutPage } from './components/public/PublicAboutPage';
import { PublicAdmissionsPage } from './components/public/PublicAdmissionsPage';
import { PublicContactPage } from './components/public/PublicContactPage';
import { PublicCourseDetailPage } from './components/public/PublicCourseDetailPage';
import { PublicCoursesPage } from './components/public/PublicCoursesPage';
import { PublicHomePage } from './components/public/PublicHomePage';
import { PublicLayout } from './components/public/PublicLayout';
import { PublicVerifyCertificatePage } from './components/public/PublicVerifyCertificatePage';
import type { DashboardPayload, PublicAcademyInfo, UserPublic } from './shared/types';
import { api } from './utils/api';

function HomeOrLegacyRedirect({ academy }: { academy: PublicAcademyInfo | null }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const setupOrReset = params.get('setupToken') || params.get('resetToken');
  if (setupOrReset) {
    return <Navigate to={`/login${location.search}`} replace />;
  }
  const verifyCert = params.get('verifyCert');
  if (verifyCert) {
    return <Navigate to={`/verify-certificate?verifyCert=${encodeURIComponent(verifyCert)}`} replace />;
  }
  return <PublicHomePage academy={academy} />;
}

export default function App() {
  const navigate = useNavigate();
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [publicAcademy, setPublicAcademy] = useState<PublicAcademyInfo | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const loadWorkspace = useCallback(async (loggedInUser: UserPublic) => {
    setLoadError('');
    try {
      const data = await api.getDashboard();
      setDashboard(data);
      setActiveSection((prev) => {
        if (loggedInUser.role === 'student') {
          return prev === 'student-home' ||
            prev === 'student-report' ||
            prev === 'schedules' ||
            prev === 'finance' ||
            prev === 'certificates' ||
            prev === 'documents'
            ? prev
            : 'student-home';
        }
        return prev === 'student-home' || prev === 'student-report'
          ? 'overview'
          : prev;
      });
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load portal data.'
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [meRes, academyRes] = await Promise.all([
          api.getMe().catch(() => ({ user: null })),
          api.getPublicAcademy().catch(() => null),
        ]);
        if (!active) return;
        if (academyRes) {
          setPublicAcademy(academyRes);
        }
        if (meRes.user) {
          setUser(meRes.user);
          if (!meRes.user.mustChangePassword) {
            await loadWorkspace(meRes.user);
          }
        } else {
          setUser(null);
          setDashboard(null);
        }
      } catch {
        if (active) {
          setUser(null);
          setDashboard(null);
        }
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadWorkspace]);

  async function handleAuthenticated(loggedInUser: UserPublic) {
    setActiveSection(loggedInUser.role === 'student' ? 'student-home' : 'overview');
    setUser(loggedInUser);
    if (!loggedInUser.mustChangePassword) {
      await loadWorkspace(loggedInUser);
      navigate('/portal');
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setDashboard(null);
    setActiveSection('overview');
    navigate('/login');
  }

  function openChangePasswordModal() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setPasswordNotice('');
    setPasswordModalOpen(true);
  }

  async function handleChangePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordNotice('');
    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    setPasswordSaving(true);
    try {
      const wasMandatory = Boolean(user?.mustChangePassword);
      const res = await api.changePassword({ currentPassword, newPassword });
      setPasswordNotice(res.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setUser(res.user);
      if (wasMandatory) {
        await loadWorkspace(res.user);
        navigate('/portal');
      }
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'Unable to change password.'
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  function renderMustChangePasswordGate(currentUser: UserPublic) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <h1 className="font-display text-lg font-semibold text-slate-900">
                  Set Your New Account Password
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  IGS — InfoCom Global Services · Required before portal access
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-600 leading-relaxed">
            Signed in as <strong className="text-slate-900">{currentUser.email}</strong>. Your account was provisioned with a temporary password and must be updated before viewing academic, admissions, or financial records.
          </p>

          {passwordError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{passwordError}</span>
            </div>
          )}

          {passwordNotice && (
            <div
              role="status"
              className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{passwordNotice}</span>
            </div>
          )}

          <form onSubmit={handleChangePasswordSubmit} className="mt-4 space-y-3.5">
            <div>
              <label
                htmlFor="gate-current-password"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Temporary / Current Password
              </label>
              <input
                id="gate-current-password"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label
                htmlFor="gate-new-password"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                New Password (minimum 8 characters)
              </label>
              <input
                id="gate-new-password"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label
                htmlFor="gate-confirm-password"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Confirm New Password
              </label>
              <input
                id="gate-confirm-password"
                type="password"
                required
                minLength={8}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Sign Out
              </button>
              <button
                type="submit"
                disabled={passwordSaving}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {passwordSaving ? 'Updating...' : 'Set Password & Enter Portal'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderPortal() {
    if (authChecking) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="h-5 w-48 bg-slate-200 rounded" />
            <div className="h-4 w-full bg-slate-100 rounded" />
            <div className="h-10 w-full bg-slate-100 rounded" />
          </div>
        </div>
      );
    }

    if (!user) {
      return <Navigate to="/login" replace />;
    }

    if (user.mustChangePassword) {
      return renderMustChangePasswordGate(user);
    }

    const unreadCount = dashboard
      ? dashboard.notifications.filter((n) => !n.read).length
      : 0;

    const isAdmin = user.role === 'admin';
    const isStaff = user.role === 'admin' || user.role === 'instructor';

    const topPrimaryAction = isAdmin
      ? activeSection === 'overview'
        ? { label: 'Admissions Queue', onClick: () => setActiveSection('admissions') }
        : activeSection === 'finance'
          ? undefined
          : { label: 'Fees & Receipts', onClick: () => setActiveSection('finance') }
      : isStaff
        ? activeSection === 'overview'
          ? { label: 'Manage Enrollments', onClick: () => setActiveSection('enrollments') }
          : activeSection === 'enrollments' || activeSection === 'reports'
            ? undefined
            : { label: 'Progress Reports', onClick: () => setActiveSection('reports') }
        : activeSection === 'student-home'
          ? { label: 'View Progress Report', onClick: () => setActiveSection('student-report') }
          : activeSection === 'student-report'
            ? undefined
            : { label: 'Back to Dashboard', onClick: () => setActiveSection('student-home') };

    return (
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar
          user={user}
          academy={dashboard?.academy}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          unreadCount={unreadCount}
          onOpenChangePassword={openChangePasswordModal}
          onLogout={handleLogout}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar
            user={user}
            activeSection={activeSection}
            unreadCount={unreadCount}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onJumpToNotifications={() => {
              if (isStaff) {
                setActiveSection('attendance');
              } else {
                setActiveSection('student-home');
                setTimeout(() => {
                  document
                    .getElementById('student-notifications-panel')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }
            }}
            primaryAction={topPrimaryAction}
          />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {dashboard?.isDemoEnvironment && (
              <div
                role="status"
                className="no-print mb-5 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
              >
                <Info className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong className="font-semibold">Development Demo Environment</strong> — Seeded sample institute dataset is active for local review and testing.
                </span>
              </div>
            )}

            {loadError ? (
              <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-800">
                <p className="font-medium">{loadError}</p>
                <button
                  type="button"
                  onClick={() => loadWorkspace(user)}
                  className="mt-3 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg cursor-pointer"
                >
                  Retry Loading
                </button>
              </div>
            ) : !dashboard ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-24 bg-white border border-slate-200 rounded-xl"
                    />
                  ))}
                </div>
                <div className="h-64 bg-white border border-slate-200 rounded-xl" />
              </div>
            ) : (
              <>
                {activeSection === 'overview' && isAdmin && (
                  <AdminOverview data={dashboard} onNavigate={setActiveSection} />
                )}

                {activeSection === 'overview' && !isAdmin && isStaff && (
                  <InstructorOverview data={dashboard} onNavigate={setActiveSection} />
                )}

                {activeSection === 'admissions' && isAdmin && (
                  <AdmissionsView
                    data={dashboard}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'students' && isAdmin && (
                  <StudentsManagementView
                    data={dashboard}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'instructors' && isAdmin && (
                  <InstructorsManagementView
                    data={dashboard}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'users' && isAdmin && (
                  <UsersManagementView
                    data={dashboard}
                    onCreateUser={async (payload) => {
                      const res = await api.createUser(payload);
                      setDashboard(res.dashboard);
                      return {
                        onboardingPath: res.onboardingPath,
                        onboardingExpiresAt: res.onboardingExpiresAt,
                      };
                    }}
                    onIssueResetToken={async (userId) => {
                      const res = await api.issueUserResetToken(userId);
                      return {
                        onboardingPath: res.onboardingPath,
                        onboardingExpiresAt: res.onboardingExpiresAt,
                        userName: res.user.name,
                      };
                    }}
                    onUpdateUser={async (userId, payload) => {
                      const res = await api.updateUser(userId, payload);
                      setDashboard(res.dashboard);
                    }}
                  />
                )}

                {activeSection === 'catalog' && isStaff && (
                  <CoursesCohortsView
                    data={dashboard}
                    onCreateCourse={async (payload) => {
                      const res = await api.createCourse(payload);
                      setDashboard(res.dashboard);
                    }}
                    onCreateCohort={async (payload) => {
                      const res = await api.createCohort(payload);
                      setDashboard(res.dashboard);
                    }}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'batches' && isAdmin && (
                  <BatchesManagementView
                    data={dashboard}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'enrollments' && isStaff && (
                  <EnrollmentsView
                    data={dashboard}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'courses' && isStaff && (
                  <CourseTrackingView
                    data={dashboard}
                    onToggleModule={async (payload) => {
                      const res = await api.toggleModuleCompletion(payload);
                      setDashboard(res.dashboard);
                    }}
                    onSaveGrade={async (payload) => {
                      const res = await api.saveGrade(payload);
                      setDashboard(res.dashboard);
                    }}
                    onDashboardUpdate={setDashboard}
                  />
                )}

                {activeSection === 'attendance' && isStaff && (
                  <AttendanceAlertsView
                    data={dashboard}
                    onMarkAttendance={async (payload) => {
                      const res = await api.markAttendance(payload);
                      setDashboard(res.dashboard);
                    }}
                    onBulkMarkAttendance={async (payload) => {
                      const res = await api.bulkMarkAttendance(payload);
                      setDashboard(res.dashboard);
                      return res.updatedCount;
                    }}
                    onRunReminders={async () => {
                      const res = await api.runSessionReminders();
                      setDashboard(res.dashboard);
                      return res.createdCount;
                    }}
                  />
                )}

                {activeSection === 'reports' && isStaff && (
                  <ProgressReportView
                    data={dashboard}
                    isInstructor
                    onSaveRemark={async (payload) => {
                      const res = await api.saveProgressRemark(payload);
                      setDashboard(res.dashboard);
                    }}
                  />
                )}

                {activeSection === 'schedules' && (
                  <SchedulesView
                    data={dashboard}
                    isInstructor={isStaff}
                    onCreateSession={
                      isStaff
                        ? async (payload) => {
                            const res = await api.createSession(payload);
                            setDashboard(res.dashboard);
                            return res.remindersCreatedCount;
                          }
                        : undefined
                    }
                  />
                )}

                {activeSection === 'finance' && (isAdmin || user.role === 'student') && (
                  <FinanceView
                    data={dashboard}
                    isAdmin={isAdmin}
                    onDashboardUpdate={setDashboard}
                    onCreateInvoice={
                      isAdmin
                        ? async (payload) => {
                            const res = await api.createInvoice(payload);
                            setDashboard(res.dashboard);
                          }
                        : undefined
                    }
                    onRecordPayment={
                      isAdmin
                        ? async (invoiceId, payload) => {
                            const res = await api.recordPayment(invoiceId, payload);
                            setDashboard(res.dashboard);
                          }
                        : undefined
                    }
                    onVoidInvoice={
                      isAdmin
                        ? async (invoiceId) => {
                            const res = await api.voidInvoice(invoiceId);
                            setDashboard(res.dashboard);
                          }
                        : undefined
                    }
                  />
                )}

                {activeSection === 'documents' && (
                  <DocumentsView
                    data={dashboard}
                    onUploadDocument={async (payload) => {
                      const res = await api.uploadDocument(payload);
                      setDashboard(res.dashboard);
                    }}
                    onArchiveDocument={async (docId) => {
                      const res = await api.archiveDocument(docId);
                      setDashboard(res.dashboard);
                    }}
                  />
                )}

                {activeSection === 'certificates' && (
                  <CertificatesView
                    data={dashboard}
                    onIssueCertificate={
                      isStaff
                        ? async (payload) => {
                            const res = await api.issueCertificate(payload);
                            setDashboard(res.dashboard);
                            return res.certificateCode;
                          }
                        : undefined
                    }
                    onRevokeCertificate={
                      isAdmin
                        ? async (certId, reason) => {
                            const res = await api.revokeCertificate(certId, reason);
                            setDashboard(res.dashboard);
                          }
                        : undefined
                    }
                    onVerifyCertificate={async (codeOrHash) => {
                      const res = await api.verifyCertificate(codeOrHash);
                      return res.certificate;
                    }}
                  />
                )}

                {activeSection === 'audit' && isAdmin && (
                  <AuditLogsView data={dashboard} />
                )}

                {activeSection === 'settings' && isAdmin && (
                  <AcademySettingsView onDashboardUpdate={setDashboard} />
                )}

                {activeSection === 'student-home' && user.role === 'student' && (
                  <StudentDashboard
                    data={dashboard}
                    onMarkNotificationRead={async (id) => {
                      const res = await api.markNotificationRead(id);
                      setDashboard(res.dashboard);
                    }}
                    onMarkAllRead={async () => {
                      const res = await api.markAllNotificationsRead();
                      setDashboard(res.dashboard);
                    }}
                    onNavigate={setActiveSection}
                  />
                )}

                {activeSection === 'student-report' && user.role === 'student' && (
                  <ProgressReportView data={dashboard} isInstructor={false} />
                )}
              </>
            )}
          </main>
        </div>

        {passwordModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-modal-title"
          >
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-700" />
                  <h3
                    id="change-password-modal-title"
                    className="font-display text-base font-semibold text-slate-900"
                  >
                    Change Account Password
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  aria-label="Close change password modal"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {passwordError && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{passwordError}</span>
                </div>
              )}

              {passwordNotice && (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{passwordNotice}</span>
                </div>
              )}

              <form onSubmit={handleChangePasswordSubmit} className="mt-4 space-y-3.5">
                <div>
                  <label
                    htmlFor="modal-current-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Current Password
                  </label>
                  <input
                    id="modal-current-password"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-new-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    New Password (minimum 8 characters)
                  </label>
                  <input
                    id="modal-new-password"
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-confirm-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="modal-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPasswordModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    {passwordSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <HomeOrLegacyRedirect academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/courses"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicCoursesPage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/courses/:slug"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicCourseDetailPage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/about"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicAboutPage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/admissions"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicAdmissionsPage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/contact"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicContactPage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/verify-certificate"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <PublicVerifyCertificatePage academy={publicAcademy} />
          </PublicLayout>
        }
      />
      <Route
        path="/login"
        element={
          authChecking ? (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
              <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="h-5 w-48 bg-slate-200 rounded" />
                <div className="h-4 w-full bg-slate-100 rounded" />
              </div>
            </div>
          ) : user && !user.mustChangePassword ? (
            <Navigate to="/portal" replace />
          ) : user && user.mustChangePassword ? (
            renderMustChangePasswordGate(user)
          ) : (
            <AuthView academy={publicAcademy} onAuthenticated={handleAuthenticated} />
          )
        }
      />
      <Route path="/portal" element={renderPortal()} />
      <Route path="/portal/*" element={renderPortal()} />
      <Route
        path="*"
        element={
          <PublicLayout academy={publicAcademy} currentUser={user}>
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center space-y-4">
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Page Not Found
              </h1>
              <p className="text-sm text-slate-600">
                The page you requested does not exist on the IGS — InfoCom Global Services portal.
              </p>
              <div className="pt-2 flex items-center justify-center gap-3">
                <Link
                  to="/"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md"
                >
                  Return Home
                </Link>
                <Link
                  to="/courses"
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md"
                >
                  Browse Programs
                </Link>
              </div>
            </div>
          </PublicLayout>
        }
      />
    </Routes>
  );
}
