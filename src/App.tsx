import React, { useCallback, useEffect, useState } from 'react';
import { AdminOverview } from './components/AdminOverview';
import { AdmissionsView } from './components/AdmissionsView';
import { AttendanceAlertsView } from './components/AttendanceAlertsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AuthView } from './components/AuthView';
import { CertificatesView } from './components/CertificatesView';
import { CoursesCohortsView } from './components/CoursesCohortsView';
import { CourseTrackingView } from './components/CourseTrackingView';
import { DocumentsView } from './components/DocumentsView';
import { EnrollmentsView } from './components/EnrollmentsView';
import { FinanceView } from './components/FinanceView';
import { InstructorOverview } from './components/InstructorOverview';
import { ProgressReportView } from './components/ProgressReportView';
import { SchedulesView } from './components/SchedulesView';
import { Sidebar, type NavSection } from './components/Sidebar';
import { StudentDashboard } from './components/StudentDashboard';
import { TopBar } from './components/TopBar';
import { UsersManagementView } from './components/UsersManagementView';
import type { DashboardPayload, UserPublic } from './shared/types';
import { api } from './utils/api';

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadWorkspace = useCallback(async (loggedInUser: UserPublic) => {
    setLoadError('');
    try {
      const data = await api.getDashboard();
      setDashboard(data);
      setActiveSection(
        loggedInUser.role === 'student' ? 'student-home' : 'overview'
      );
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
        const res = await api.getMe();
        if (!active) return;
        if (res.user) {
          setUser(res.user);
          await loadWorkspace(res.user);
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
    setUser(loggedInUser);
    await loadWorkspace(loggedInUser);
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setDashboard(null);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
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
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        unreadCount={unreadCount}
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
                    className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
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
                  onCreateAdmission={async (payload) => {
                    const res = await api.createAdmission(payload);
                    setDashboard(res.dashboard);
                  }}
                  onUpdateAdmission={async (id, payload) => {
                    const res = await api.updateAdmission(id, payload);
                    setDashboard(res.dashboard);
                  }}
                />
              )}

              {activeSection === 'users' && isAdmin && (
                <UsersManagementView
                  data={dashboard}
                  onCreateUser={async (payload) => {
                    const res = await api.createUser(payload);
                    setDashboard(res.dashboard);
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
                />
              )}

              {activeSection === 'enrollments' && isStaff && (
                <EnrollmentsView
                  data={dashboard}
                  onCreateEnrollment={async (payload) => {
                    const res = await api.createEnrollment(payload);
                    setDashboard(res.dashboard);
                  }}
                  onUpdateStatus={async (id, status) => {
                    const res = await api.updateEnrollmentStatus(id, status);
                    setDashboard(res.dashboard);
                  }}
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
                />
              )}

              {activeSection === 'attendance' && isStaff && (
                <AttendanceAlertsView
                  data={dashboard}
                  onMarkAttendance={async (payload) => {
                    const res = await api.markAttendance(payload);
                    setDashboard(res.dashboard);
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
    </div>
  );
}
