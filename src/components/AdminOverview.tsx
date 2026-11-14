import React from 'react';
import {
  ArrowUpRight,
  Award,
  CreditCard,
  ScrollText,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatCents, formatMoney, toCents } from '../shared/academic';
import type { DashboardPayload } from '../shared/types';
import type { NavSection } from './Sidebar';

interface AdminOverviewProps {
  data: DashboardPayload;
  onNavigate: (section: NavSection) => void;
}

export function AdminOverview({ data, onNavigate }: AdminOverviewProps) {
  const { analytics } = data;
  const pendingAdmissions = data.admissions.filter(
    (a) => a.status === 'Submitted' || a.status === 'Under Review' || a.status === 'Accepted'
  );

  return (
    <div className="space-y-6">
      {/* 4-Column Executive KPI Strip */}
      <section aria-label="Academy analytics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Total Students & Faculty</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {analytics.totalStudents}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {analytics.totalInstructors} instructors
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Active Enrollments</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {analytics.activeEnrollments}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {analytics.meanAttendanceRate}% attendance
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Tuition Collected</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCents(analytics.totalCollectedCents)}
            </span>
            <span className="text-xs font-mono font-medium text-emerald-700 tabular-nums">
              {analytics.collectionRatePct}% rate
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Outstanding Receivables</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCents(analytics.outstandingCents)}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {analytics.pendingAdmissions} admissions open
            </span>
          </div>
        </div>
      </section>

      {/* Course Revenue & Enrollment Breakdown + Admissions Queue */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                    (e) => e.courseId === course.id && e.status !== 'Dropped'
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
                        {formatMoney(course.tuitionFee)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {formatCents(billed)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {formatCents(collected)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Admissions & Operations Quick Queue */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Admissions Queue
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Applications awaiting review or conversion
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admissions')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Review All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 flex-1">
            {pendingAdmissions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                All submitted admission applications have been processed.
              </div>
            ) : (
              pendingAdmissions.slice(0, 5).map((adm) => {
                const course = data.courses.find((c) => c.id === adm.targetCourseId);
                return (
                  <div key={adm.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {adm.applicantName}
                      </p>
                      <span className="text-[11px] font-medium text-blue-700 shrink-0">
                        {adm.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {course?.code ?? adm.targetCourseId} · {adm.preferredCohort}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50/70 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Directory</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('certificates')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Award className="w-3.5 h-3.5" />
              <span>Certificates</span>
            </button>
          </div>
        </section>
      </div>

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
                Immutable security and financial activity log persisted in PostgreSQL
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('admissions')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Admissions</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('finance')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Fees & Receipts</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <span>Full Audit Log</span>
            </button>
          </div>
        </div>

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
      </section>
    </div>
  );
}
