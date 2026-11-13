import React from 'react';
import {
  Bell,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Users,
  X,
} from 'lucide-react';
import type { UserPublic } from '../shared/types';

export type NavSection =
  | 'overview'
  | 'enrollments'
  | 'courses'
  | 'attendance'
  | 'reports'
  | 'schedules'
  | 'student-home'
  | 'student-report';

interface SidebarProps {
  user: UserPublic;
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  unreadCount: number;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  user,
  activeSection,
  onSelectSection,
  unreadCount,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const instructorItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'enrollments', label: 'Enrollments', icon: Users },
    { id: 'courses', label: 'Course Tracking', icon: BookOpen },
    { id: 'attendance', label: 'Attendance & Alerts', icon: ClipboardCheck },
    { id: 'reports', label: 'Progress Reports', icon: FileText },
    { id: 'schedules', label: 'Class Schedules', icon: CalendarClock },
  ];

  const studentItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'student-home',
      label: 'Student Dashboard',
      icon: LayoutDashboard,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'student-report', label: 'My Progress Report', icon: FileText },
    { id: 'schedules', label: 'Upcoming Schedules', icon: CalendarClock },
  ];

  const items = user.role === 'instructor' ? instructorItems : studentItems;

  const content = (
    <div className="h-full flex flex-col bg-white border-r border-slate-200 w-64">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <GraduationCap className="w-5 h-5 text-blue-700 shrink-0" />
          <span className="font-display text-sm font-semibold text-slate-900 truncate">
            Northbridge Academy
          </span>
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

      <nav aria-label="Primary navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
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
              {'badge' in item && typeof item.badge === 'number' && (
                <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums font-semibold text-blue-700">
                  <Bell className="w-3 h-3" />
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {user.role === 'instructor' ? 'Instructor' : 'Student'}
            {user.studentCode ? ` · ${user.studentCode}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block shrink-0 no-print">{content}</aside>

      {/* Mobile slide-over sidebar */}
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
