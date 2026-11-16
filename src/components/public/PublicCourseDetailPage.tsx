import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Layers } from 'lucide-react';
import { formatMoney } from '../../shared/academic';
import type { PublicAcademyInfo, PublicCourseDetail } from '../../shared/types';
import { api } from '../../utils/api';

interface PublicCourseDetailPageProps {
  academy: PublicAcademyInfo | null;
}

export function PublicCourseDetailPage({ academy }: PublicCourseDetailPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const [course, setCourse] = useState<PublicCourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDemoEnv, setIsDemoEnv] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    setLoading(true);
    setError('');
    api
      .getPublicCourseDetail(slug)
      .then((res) => {
        if (!active) return;
        setCourse(res.course);
        setIsDemoEnv(Boolean(res.isDemoEnvironment));
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Unable to load course details.'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded" />
        <div className="h-64 bg-slate-100 border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center space-y-4">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Program Not Found
        </h1>
        <p className="text-sm text-slate-600">
          {error || 'This training program is either unpublished or unavailable.'}
        </p>
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-900 rounded-md"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Published Programs</span>
        </Link>
      </div>
    );
  }

  const currency = course.currency || academy?.currency || 'INR';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      <div>
        <Link
          to="/courses"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Published Programs</span>
        </Link>
      </div>

      {(isDemoEnv || course.isDemo) && (
        <div
          role="status"
          className="px-4 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950"
        >
          {course.isDemo ? (
            <>
              <strong>Development Sample Program:</strong> This syllabus is a seeded development fixture (<code>NODE_ENV=development</code>) and is excluded automatically in production environments.
            </>
          ) : (
            <>
              <strong>Development Environment Notice:</strong> Local development sample catalog data is active alongside Admin-published programs and is excluded automatically in production.
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-start justify-between gap-6">
        <div className="space-y-3 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
            <span className="font-semibold text-blue-800">{course.code}</span>
            <span aria-hidden="true">·</span>
            <span>{course.category}</span>
            {course.departmentName && (
              <>
                <span aria-hidden="true">·</span>
                <span>{course.departmentName}</span>
              </>
            )}
            {course.isDemo && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-300 rounded">
                Sample Program
              </span>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {course.title}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {course.description}
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 w-full lg:w-72 shrink-0 space-y-4">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Duration
              </span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {course.durationWeeks} weeks
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 inline-flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Modules &amp; Labs
              </span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {course.moduleCount} · {course.totalLabHours} hrs
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-slate-500">Program Fee</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {course.tuitionFee !== null
                  ? formatMoney(course.tuitionFee, currency)
                  : 'Enquire at Campus'}
              </span>
            </div>
          </div>

          <Link
            to={`/admissions?course=${encodeURIComponent(course.id)}`}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md transition-colors"
          >
            <span>Apply for This Program</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Syllabus & Prerequisites */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Curriculum Modules
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {course.modules.length} modules
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="py-3 px-6">Code</th>
                  <th className="py-3 px-4">Module Title</th>
                  <th className="py-3 px-4 text-right">Assessment Weight</th>
                  <th className="py-3 px-6 text-right">Lab Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {course.modules.map((m) => (
                  <tr key={m.id}>
                    <td className="py-3 px-6 font-mono font-semibold text-blue-800 whitespace-nowrap">
                      {m.code}
                    </td>
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {m.title}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {m.weight}%
                    </td>
                    <td className="py-3 px-6 text-right font-mono tabular-nums text-slate-700">
                      {m.labHours} hrs
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Learning Objectives
            </h2>
            {course.learningObjectives.length === 0 ? (
              <p className="text-xs text-slate-500">
                Practical competency verified through lab assignments and module assessments.
              </p>
            ) : (
              <ul className="space-y-2 text-xs text-slate-700">
                {course.learningObjectives.map((obj, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{obj}</span>
                  </li>
                ))}
              </ul>
            )}

            {course.prerequisites && (
              <div className="pt-3 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-900">Prerequisites</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {course.prerequisites}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Upcoming &amp; Active Cohorts
            </h2>
            {course.activeCohorts.length === 0 ? (
              <p className="text-xs text-slate-500">
                Submit an admission enquiry to be notified of the next cohort intake schedule.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 text-xs">
                {course.activeCohorts.map((coh) => (
                  <div key={coh.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between font-medium text-slate-900">
                      <span>{coh.name}</span>
                      <span className="font-mono text-emerald-700">{coh.status}</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {coh.code} · {new Date(coh.startDate).toLocaleDateString('en-IN')} –{' '}
                      {new Date(coh.endDate).toLocaleDateString('en-IN')} · {coh.capacity} seats
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
