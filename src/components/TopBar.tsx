import React from 'react';
import { Bell, Menu } from 'lucide-react';
import type { UserPublic } from '../shared/types';
import type { NavSection } from './Sidebar';

interface TopBarProps {
  user: UserPublic;
  activeSection: NavSection;
  unreadCount: number;
  onOpenMobileNav: () => void;
  onJumpToNotifications: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Academy Overview',
  admissions: 'Admissions Pipeline',
  students: 'Student Directory & Profiles',
  instructors: 'Instructor & Faculty Management',
  users: 'User Accounts & Roles',
  catalog: 'Course Master Data & Departments',
  batches: 'Batch Cohorts & Classrooms',
  enrollments: 'Enrollment Management',
  courses: 'Course & Module Tracking',
  attendance: 'Attendance & Automated Alerts',
  schedules: 'Class Timetable & Scheduling',
  finance: 'Fees, Payments & Receipts',
  documents: 'Document Vault',
  certificates: 'Certificates & Verification',
  reports: 'Academic Progress Reports',
  audit: 'System Audit Logs',
  settings: 'Academy Settings & Configuration',
  'student-home': 'Student Dashboard',
  'student-report': 'My Progress Report',
};

export function TopBar({
  user,
  activeSection,
  unreadCount,
  onOpenMobileNav,
  onJumpToNotifications,
  primaryAction,
}: TopBarProps) {
  const portalLabel =
    user.role === 'admin'
      ? 'Administration Portal'
      : user.role === 'instructor'
        ? 'Instructor Portal'
        : 'Student Portal';

  return (
    <header className="no-print bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
            {portalLabel}
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 truncate">
            {SECTION_TITLES[activeSection]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={onJumpToNotifications}
          aria-label={`View notifications (${unreadCount} unread)`}
          className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Bell className="w-3.5 h-3.5 text-slate-500" />
          <span className="tabular-nums">
            {unreadCount > 0 ? (
              <>
                {unreadCount}
                <span className="hidden sm:inline"> Alerts</span>
              </>
            ) : (
              <span className="hidden sm:inline">Alerts</span>
            )}
          </span>
        </button>

        {primaryAction && (
          <button
            type="button"
            onClick={primaryAction.onClick}
            className="inline-flex items-center justify-center px-3 sm:px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {primaryAction.label}
          </button>
        )}
      </div>
    </header>
  );
}
