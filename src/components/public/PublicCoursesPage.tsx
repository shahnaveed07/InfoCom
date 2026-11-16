import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Search } from 'lucide-react';
import { formatMoney } from '../../shared/academic';
import type { PublicAcademyInfo, PublicCourseSummary } from '../../shared/types';
import { api } from '../../utils/api';

interface PublicCoursesPageProps {
  academy: PublicAcademyInfo | null;
}

export function PublicCoursesPage({ academy }: PublicCoursesPageProps) {
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getPublicCourses()
      .then((res) => {
        if (!active) return;
        setCourses(res.courses);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Unable to load published programs.'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) {
      if (c.category) set.add(c.category);
    }
    return ['All', ...Array.from(set).sort()];
  }, [courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((c) => {
      if (categoryFilter !== 'All' && c.category !== categoryFilter) return false;
      if (q) {
        const hay = `${c.code} ${c.title} ${c.track} ${c.category} ${c.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [courses, categoryFilter, search]);

  const currency = academy?.currency || 'INR';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="border-b border-slate-200 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-blue-800">
            {academy?.name || 'IGS — InfoCom Global Services'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
            Training Programs Catalog
          </h1>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            Browse published courses, module breakdowns, lab hours, and open cohort schedules at our Downtown Sopore campus.
          </p>
        </div>

        <Link
          to="/admissions"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md whitespace-nowrap shrink-0"
        >
          <span>Apply for Admission</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <label htmlFor="public-course-search" className="sr-only">
            Search published programs
          </label>
          <input
            id="public-course-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses by title or code..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-6 bg-white border border-red-200 rounded-xl text-sm text-red-800">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 bg-white border border-slate-200 rounded-xl text-center space-y-3">
          <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-800">
            No published programs match your current filter.
          </p>
          {categoryFilter !== 'All' || search.trim() ? (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('All');
                setSearch('');
              }}
              className="px-4 py-2 text-xs font-medium text-blue-800 bg-blue-50 rounded-md cursor-pointer"
            >
              Reset Filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((course) => (
            <article
              key={course.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-blue-300 transition-colors"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                  <span className="font-semibold text-blue-800">{course.code}</span>
                  <span aria-hidden="true">·</span>
                  <span>{course.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{course.durationWeeks} weeks</span>
                </div>
                <h2 className="mt-2 font-display text-lg font-semibold text-slate-900">
                  <Link
                    to={`/courses/${course.slug || course.id}`}
                    className="hover:text-blue-800 transition-colors"
                  >
                    {course.title}
                  </Link>
                </h2>
                <p className="mt-2.5 text-sm text-slate-600 leading-relaxed line-clamp-3">
                  {course.description || 'Structured computing curriculum with guided practical labs.'}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono tabular-nums">
                  <span>{course.moduleCount} modules</span>
                  <span aria-hidden="true">·</span>
                  <span>{course.totalLabHours} lab hrs</span>
                  <span aria-hidden="true">·</span>
                  <span>{course.activeCohorts.length} batch(es)</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                  {course.tuitionFee !== null
                    ? formatMoney(course.tuitionFee, course.currency || currency)
                    : 'Fee on campus enquiry'}
                </span>
                <Link
                  to={`/courses/${course.slug || course.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap"
                >
                  <span>View Syllabus</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
