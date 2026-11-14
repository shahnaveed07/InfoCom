import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Award,
  BookOpen,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Layers,
  Receipt,
  ScrollText,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  formatCents,
  formatMoney,
  isInactiveEnrollmentStatus,
  toCents,
} from '../shared/academic';
import type {
  AdminAnalyticsDetail,
  AnalyticsPreset,
  DashboardPayload,
} from '../shared/types';
import { api } from '../utils/api';
import type { NavSection } from './Sidebar';

interface AdminOverviewProps {
  data: DashboardPayload;
  onNavigate: (section: NavSection) => void;
}

const PRESET_OPTIONS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: '90d', label: '90 Days' },
  { id: 'all', label: 'All Time' },
  { id: 'custom', label: 'Custom' },
];

export function AdminOverview({ data, onNavigate }: AdminOverviewProps) {
  const [preset, setPreset] = useState<AnalyticsPreset>('30d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [detail, setDetail] = useState<AdminAnalyticsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currency = data.academy?.currency || 'USD';

  useEffect(() => {
    let active = true;
    if (preset === 'custom' && (!fromDate || !toDate)) {
      return;
    }
    setLoading(true);
    setError('');
    api
      .getAdminAnalytics({
        preset,
        from: preset === 'custom' ? fromDate : undefined,
        to: preset === 'custom' ? toDate : undefined,
      })
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Unable to load analytics.'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [preset, fromDate, toDate, data]);

  const kpis = detail?.kpis;
  const revenueSeries = detail?.monthlyRevenueSeries ?? [];
  const enrollmentSeries = detail?.enrollmentTrendSeries ?? [];
  const maxRevenueCents = Math.max(
    100,
    ...revenueSeries.flatMap((m) => [m.billedCents, m.collectedCents])
  );
  const maxEnrollmentCount = Math.max(
    1,
    ...enrollmentSeries.flatMap((m) => [m.enrollments, m.completions])
  );

  const attendanceTotal = kpis?.attendanceOverview.total ?? 0;
  const presentCount = kpis?.attendanceOverview.present ?? 0;
  const lateCount = kpis?.attendanceOverview.late ?? 0;
  const absentCount = kpis?.attendanceOverview.absent ?? 0;

  return (
    <div className="space-y-6">
      {/* Date Range Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Executive Academy Operations
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live database metrics across enrollment, schedules, attendance, and tuition collection
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Analytics date range filter"
            className="inline-flex flex-wrap items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1"
          >
            {PRESET_OPTIONS.map((opt) => {
              const active = preset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreset(opt.id)}
                  aria-pressed={active}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="analytics-from-date">
                From date
              </label>
              <input
                id="analytics-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
              <span className="text-xs text-slate-400">to</span>
              <label className="sr-only" htmlFor="analytics-to-date">
                To date
              </label>
              <input
                id="analytics-to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 12 Live KPI Cards */}
      <section
        aria-label="Academy KPI metrics"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        <button
          type="button"
          onClick={() => onNavigate('students')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Students</span>
            <Users className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.activeStudents ?? data.analytics.totalStudents}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Manage student directory
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('instructors')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Instructors</span>
            <UserCheck className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.activeInstructors ?? data.analytics.totalInstructors}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Faculty & permissions
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('admissions')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Admissions Pending</span>
            <ClipboardCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.admissionsPending ?? data.analytics.pendingAdmissions}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Awaiting review or enrollment
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Active Courses</span>
            <BookOpen className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.activeCourses ?? data.courses.filter((c) => !c.isArchived).length}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Curriculum & departments
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('batches')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Batches</span>
            <Layers className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.totalBatches ?? data.cohorts.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Cohorts & seat capacity
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('schedules')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Today&apos;s Classes</span>
            <CalendarClock className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.todaysClassesCount ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Scheduled campus sessions
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('attendance')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Attendance Overview</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-display text-2xl font-semibold text-slate-900 tabular-nums">
              {loading && !kpis ? '—' : `${kpis?.attendanceOverview.rate ?? data.analytics.meanAttendanceRate}%`}
            </span>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {presentCount}P · {lateCount}L · {absentCount}A
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            {attendanceTotal} marks in selected window
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('finance')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Outstanding Fees</span>
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis
              ? '—'
              : formatCents(kpis?.outstandingFeesCents ?? data.analytics.outstandingCents, currency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Receivables balance due
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('finance')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Monthly Revenue</span>
            <Receipt className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-emerald-700 tabular-nums">
            {loading && !kpis
              ? '—'
              : formatCents(kpis?.monthlyRevenueCents ?? 0, currency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Current month collected
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('finance')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Period Tuition Collected</span>
            <CreditCard className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis
              ? '—'
              : formatCents(kpis?.totalCollectedCents ?? data.analytics.totalCollectedCents, currency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            {data.analytics.collectionRatePct}% overall collection rate
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('certificates')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Certificates Issued</span>
            <Award className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.certificatesIssued ?? data.analytics.certificatesIssued}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Verified credentials
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('admissions')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Pending Admin Actions</span>
            <Calendar className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {loading && !kpis ? '—' : kpis?.pendingAdminActionsCount ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Admissions, overdue & alerts
          </div>
        </button>
      </section>

      {/* Two Real API-Driven SVG Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Monthly Revenue Billed vs Collected */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Monthly Revenue: Billed vs Collected
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Last 6 months from PostgreSQL invoices and payments
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" />
                Billed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-700 inline-block" />
                Collected
              </span>
            </div>
          </div>

          {revenueSeries.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
              No monthly billing or payment data recorded yet.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox="0 0 540 190"
                className="w-full h-48"
                role="img"
                aria-label="Monthly revenue billed versus collected bar chart"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const y = 150 - frac * 125;
                  return (
                    <line
                      key={frac}
                      x1="20"
                      x2="525"
                      y1={y}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                    />
                  );
                })}
                {revenueSeries.map((pt, idx) => {
                  const groupWidth = 500 / revenueSeries.length;
                  const cx = 25 + idx * groupWidth + groupWidth / 2;
                  const billedH = Math.max(
                    pt.billedCents > 0 ? 4 : 0,
                    Math.round((pt.billedCents / maxRevenueCents) * 120)
                  );
                  const collectedH = Math.max(
                    pt.collectedCents > 0 ? 4 : 0,
                    Math.round((pt.collectedCents / maxRevenueCents) * 120)
                  );
                  return (
                    <g key={pt.monthKey}>
                      <rect
                        x={cx - 16}
                        y={150 - billedH}
                        width="14"
                        height={billedH}
                        rx="3"
                        fill="#cbd5e1"
                      />
                      <rect
                        x={cx + 2}
                        y={150 - collectedH}
                        width="14"
                        height={collectedH}
                        rx="3"
                        fill="#1d4ed8"
                      />
                      <text
                        x={cx}
                        y="170"
                        textAnchor="middle"
                        fontSize="10"
                        fill="#64748b"
                        fontFamily="ui-monospace, SFMono-Regular, monospace"
                      >
                        {pt.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2 border-t border-slate-100 pt-2.5">
                {revenueSeries.map((m) => (
                  <div key={m.monthKey} className="text-center">
                    <div className="text-[10px] text-slate-500">{m.label}</div>
                    <div className="font-mono text-[11px] font-semibold text-slate-900 tabular-nums">
                      {formatCents(m.collectedCents, currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Chart 2: Enrollment Trend & Attendance Breakdown */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Enrollment & Completion Trend
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Monthly new enrollments alongside completed programs
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-700 inline-block" />
                  Enrolled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
                  Completed
                </span>
              </div>
            </div>

            {enrollmentSeries.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                No enrollment trend records found for this period.
              </div>
            ) : (
              <svg
                viewBox="0 0 540 165"
                className="w-full h-40"
                role="img"
                aria-label="Enrollment and completion monthly trend chart"
              >
                {[0, 0.5, 1].map((frac) => {
                  const y = 130 - frac * 105;
                  return (
                    <line
                      key={frac}
                      x1="20"
                      x2="525"
                      y1={y}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                    />
                  );
                })}
                {enrollmentSeries.map((pt, idx) => {
                  const groupWidth = 500 / enrollmentSeries.length;
                  const cx = 25 + idx * groupWidth + groupWidth / 2;
                  const enrH = Math.max(
                    pt.enrollments > 0 ? 5 : 0,
                    Math.round((pt.enrollments / maxEnrollmentCount) * 100)
                  );
                  const compH = Math.max(
                    pt.completions > 0 ? 5 : 0,
                    Math.round((pt.completions / maxEnrollmentCount) * 100)
                  );
                  return (
                    <g key={pt.monthKey}>
                      <rect
                        x={cx - 15}
                        y={130 - enrH}
                        width="13"
                        height={enrH}
                        rx="3"
                        fill="#1d4ed8"
                      />
                      <rect
                        x={cx + 2}
                        y={130 - compH}
                        width="13"
                        height={compH}
                        rx="3"
                        fill="#059669"
                      />
                      <text
                        x={cx}
                        y="150"
                        textAnchor="middle"
                        fontSize="10"
                        fill="#64748b"
                        fontFamily="ui-monospace, SFMono-Regular, monospace"
                      >
                        {pt.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* Attendance Composition Bar */}
          <div className="mt-4 pt-3.5 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium text-slate-700">
                Attendance Distribution ({attendanceTotal} total marks)
              </span>
              <span className="font-mono text-slate-900 font-semibold tabular-nums">
                {kpis?.attendanceOverview.rate ?? 100}% Weighted
              </span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
              {attendanceTotal > 0 ? (
                <>
                  <div
                    style={{ width: `${(presentCount / attendanceTotal) * 100}%` }}
                    className="bg-emerald-600 h-full"
                    title={`Present: ${presentCount}`}
                  />
                  <div
                    style={{ width: `${(lateCount / attendanceTotal) * 100}%` }}
                    className="bg-amber-500 h-full"
                    title={`Late: ${lateCount}`}
                  />
                  <div
                    style={{ width: `${(absentCount / attendanceTotal) * 100}%` }}
                    className="bg-red-600 h-full"
                    title={`Absent: ${absentCount}`}
                  />
                </>
              ) : (
                <div className="bg-slate-200 w-full h-full" />
              )}
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-600 font-mono tabular-nums">
              <span className="text-emerald-700">Present: {presentCount}</span>
              <span className="text-amber-700">Late: {lateCount}</span>
              <span className="text-red-700">Absent: {absentCount}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Today's Classes + Pending Administrative Actions + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Classes */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Today&apos;s Classes
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Live campus schedule
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('schedules')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap"
            >
              <span>Timetable</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {!detail || detail.todaysClasses.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No classes scheduled for today. Visit Timetable to schedule a session.
              </div>
            ) : (
              detail.todaysClasses.map((ses) => (
                <div key={ses.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{ses.title}</p>
                    <span className="font-mono text-[11px] text-blue-700 shrink-0 tabular-nums">
                      {new Date(ses.startIso).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {ses.cohort} · {ses.room} · {ses.instructorName}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent Transactions */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Recent Transactions
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Latest fee receipts recorded
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('finance')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap"
            >
              <span>Ledger</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {!detail || detail.recentTransactions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No payment transactions in the selected period.
              </div>
            ) : (
              detail.recentTransactions.slice(0, 6).map((tx) => (
                <div
                  key={tx.id}
                  className="px-5 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {tx.studentName}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 truncate">
                      {tx.receiptNumber} · {tx.method}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                      {formatMoney(tx.amount, currency)}
                    </div>
                    <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                      {new Date(tx.paidAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Pending Administrative Actions */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Pending Administrative Actions
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Items requiring review or follow-up
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {!detail || detail.pendingActions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                All admissions and overdue receivables are clear.
              </div>
            ) : (
              detail.pendingActions.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.targetSection as NavSection)}
                  className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors cursor-pointer flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {item.detail}
                    </p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Program Enrollment & Revenue Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Program Enrollment & Revenue Performance
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Active cohorts, billed tuition, and collected payments per course
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('finance')}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Open Ledger</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {data.courses.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No courses configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Course Program</th>
                  <th className="py-2.5 px-4 text-right">Enrolled</th>
                  <th className="py-2.5 px-4 text-right">Tuition</th>
                  <th className="py-2.5 px-4 text-right">Billed</th>
                  <th className="py-2.5 px-5 text-right">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {data.courses.map((course) => {
                  const activeCount = data.enrollments.filter(
                    (e) => e.courseId === course.id && !isInactiveEnrollmentStatus(e.status)
                  ).length;
                  const courseInvoices = data.invoices.filter(
                    (inv) =>
                      inv.courseId === course.id &&
                      inv.status !== 'Voided' &&
                      !inv.isArchived
                  );
                  const billed = courseInvoices.reduce(
                    (sum, inv) => sum + toCents(inv.amountDue),
                    0
                  );
                  const collected = courseInvoices.reduce(
                    (sum, inv) => sum + toCents(inv.amountPaid),
                    0
                  );
                  return (
                    <tr key={course.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{course.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">{course.code}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{course.instructorName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {activeCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {formatMoney(course.tuitionFee, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {formatCents(billed, currency)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {formatCents(collected, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Audit Trail */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ScrollText className="w-4 h-4 text-blue-700 shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Recent Academy Audit Trail
              </h2>
              <p className="text-xs text-slate-500">
                Immutable security and administrative activity log persisted in PostgreSQL
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <span>Full Audit Log</span>
          </button>
        </div>

        {data.auditLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No audit log entries recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {data.auditLogs.slice(0, 6).map((log) => (
              <div
                key={log.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-800">
                      {log.action}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{log.actorEmail}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{log.actorRole}</span>
                  </div>
                  <p className="text-sm text-slate-700 mt-0.5">{log.summary}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                  {new Date(log.createdAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
