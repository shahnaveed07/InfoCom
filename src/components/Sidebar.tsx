import React from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Bell,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { AcademyProfile, UserPublic } from '../shared/types';
import { BrandCrest } from './public/BrandCrest';

export type NavSection =
  | 'overview'
  | 'admissions'
  | 'students'
  | 'instructors'
  | 'users'
  | 'catalog'
  | 'batches'
  | 'enrollments'
  | 'courses'
  | 'attendance'
  | 'schedules'
  | 'finance'
  | 'documents'
  | 'certificates'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'student-home'
  | 'student-report';

interface SidebarProps {
  user: UserPublic;
  academy?: AcademyProfile;
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  unreadCount: number;
  onOpenChangePassword: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

type NavItem = {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

export function Sidebar({
  user,
  academy,
  activeSection,
  onSelectSection,
  unreadCount,
  onOpenChangePassword,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const adminItems: NavItem[] = [
    { id: 'overview', label: 'Academy Analytics', icon: LayoutDashboard },
    { id: 'admissions', label: 'Admissions', icon: UserCheck },
    { id: 'students', label: 'Students', icon: GraduationCap },
    { id: 'instructors', label: 'Instructors', icon: Users },
    { id: 'users', label: 'User Accounts', icon: ShieldCheck },
    { id: 'catalog', label: 'Courses & Depts', icon: BookOpen },
    { id: 'batches', label: 'Batches & Rooms', icon: Layers },
    { id: 'enrollments', label: 'Enrollments', icon: Users },
    { id: 'courses', label: 'Grading & Modules', icon: BookOpen },
    { id: 'attendance', label: 'Attendance & Alerts', icon: ClipboardCheck },
    { id: 'schedules', label: 'Timetable', icon: CalendarClock },
    { id: 'finance', label: 'Fees & Receipts', icon: CreditCard },
    { id: 'documents', label: 'Document Vault', icon: FolderOpen },
    { id: 'certificates', label: 'Certificates', icon: Award },
    { id: 'reports', label: 'Progress Reports', icon: FileText },
    { id: 'audit', label: 'Audit Logs', icon: ScrollText },
    { id: 'settings', label: 'Academy Settings', icon: Settings },
  ];

  const instructorItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'enrollments', label: 'Enrollments', icon: Users },
    { id: 'catalog', label: 'Courses & Cohorts', icon: Layers },
    { id: 'courses', label: 'Course Tracking', icon: BookOpen },
    { id: 'attendance', label: 'Attendance & Alerts', icon: ClipboardCheck },
    { id: 'schedules', label: 'Class Schedules', icon: CalendarClock },
    { id: 'certificates', label: 'Certificates', icon: Award },
    { id: 'documents', label: 'Course Documents', icon: FolderOpen },
    { id: 'reports', label: 'Progress Reports', icon: FileText },
  ];

  const studentItems: NavItem[] = [
    {
      id: 'student-home',
      label: 'Student Dashboard',
      icon: LayoutDashboard,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'student-report', label: 'My Progress Report', icon: FileText },
    { id: 'schedules', label: 'Upcoming Schedules', icon: CalendarClock },
    { id: 'finance', label: 'Fees & Receipts', icon: CreditCard },
    { id: 'certificates', label: 'My Certificates', icon: Award },
    { id: 'documents', label: 'Documents & Syllabi', icon: FolderOpen },
  ];

  const items =
    user.role === 'admin'
      ? adminItems
      : user.role === 'instructor'
        ? instructorItems
        : studentItems;

  const roleLabel =
    user.role === 'admin'
      ? 'Administrator'
      : user.role === 'instructor'
        ? 'Instructor'
        : 'Student';

  const content = (
    <div className="h-full flex flex-col bg-white border-r border-slate-200 w-64">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandCrest
            logoDataUrl={academy?.logoDataUrl}
            name={academy?.name ?? 'IGS — InfoCom Global Services'}
            sizeClass="h-9 w-auto max-w-[82px]"
          />
          <div className="min-w-0">
            <span className="font-display text-sm font-semibold text-slate-900 truncate block">
              {academy?.name ?? 'IGS — InfoCom Global Services'}
            </span>
            <span className="text-[11px] text-slate-500 truncate block">
              Computer Institute · Learn Today, Build Tomorrow.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-50 text-blue-800'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-blue-700' : 'text-slate-400'
                  }`}
                />
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </span>
              {typeof item.badge === 'number' && (
                <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums font-semibold text-blue-700">
                  <Bell className="w-3 h-3" />
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {roleLabel}
            {user.studentCode ? ` · ${user.studentCode}` : ''}
            {user.staffCode ? ` · ${user.staffCode}` : ''}
          </p>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Link
            to="/"
            onClick={onCloseMobile}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Public Website</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              onOpenChangePassword();
              onCloseMobile();
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Change Password</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-screen sticky top-0 shrink-0 no-print">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full">{content}</aside>
        </div>
      )}
    </>
  );
}
