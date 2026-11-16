import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { formatMoney } from '../../shared/academic';
import type { PublicAcademyInfo, PublicCourseSummary } from '../../shared/types';
import { api } from '../../utils/api';

interface PublicHomePageProps {
  academy: PublicAcademyInfo | null;
}

const STUDIO_IMAGE_PATH = '/src/assets/images/academy_lab_studio_1794576422024.jpg';

const ADMISSIONS_STEPS = [
  {
    step: '01. Choose Program',
    detail:
      'Review published course syllabi, lab hours, and active batch schedules tailored to your learning goals.',
  },
  {
    step: '02. Submit Application',
    detail:
      'Complete the online admission form with your contact, guardian, and previous academic details.',
  },
  {
    step: '03. Document Verification',
    detail:
      'Our Sopore registrar reviews submitted identification and educational records and confirms cohort availability.',
  },
  {
    step: '04. Portal Activation',
    detail:
      'Approved students receive an institute student ID and single-use setup link issued by Administration.',
  },
] as const;

export function PublicHomePage({ academy }: PublicHomePageProps) {
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseError, setCourseError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingCourses(true);
    api
      .getPublicCourses()
      .then((res) => {
        if (!active) return;
        setCourses(res.courses);
      })
      .catch((err) => {
        if (!active) return;
        setCourseError(
          err instanceof Error ? err.message : 'Unable to load published programs.'
        );
      })
      .finally(() => {
        if (active) setLoadingCourses(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const instituteName = academy?.name || 'IGS — InfoCom Global Services';
  const slogan = academy?.slogan || 'Learn Today, Build Tomorrow.';
  const address =
    academy?.address ||
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';
  const currency = academy?.currency || 'INR';
  const featuredCourses = courses.slice(0, 6);

  return (
    <div>
      {/* Hero Split */}
      <section className="bg-slate-900 text-slate-100 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold tracking-wide text-blue-300">
              Computer Institute · {slogan}
            </p>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-[1.12]">
              Practical computing &amp; software education in Sopore.
            </h1>
            <p className="mt-5 text-base text-slate-300 leading-relaxed max-w-xl">
              {instituteName} delivers instructor-led technical programs covering foundational computing, office automation, programming, databases, web engineering, and data analytics.
            </p>
            <p className="mt-4 inline-flex items-start gap-2 text-xs text-slate-400">
              <MapPin className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <span>{address}</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/courses"
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-950 bg-white hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
              >
                <span>Explore Programs</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/admissions"
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-800 hover:bg-blue-700 border border-blue-700 rounded-md transition-colors whitespace-nowrap"
              >
                <span>Apply for Admission</span>
              </Link>
              <Link
                to="/verify-certificate"
                className="px-3 py-2 text-sm font-medium text-blue-300 hover:text-white underline underline-offset-4 whitespace-nowrap"
              >
                Verify Certificate
              </Link>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[280px] lg:min-h-[380px] rounded-xl overflow-hidden border border-slate-700 bg-slate-800 relative">
              {!imageFailed ? (
                <img
                  src={STUDIO_IMAGE_PATH}
                  alt="IGS — InfoCom Global Services computer institute workstation lab with instructor"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-slate-800 to-slate-900">
                  <BookOpen className="w-12 h-12 text-blue-400 mb-3" />
                  <p className="font-display text-lg font-semibold text-white">
                    {instituteName}
                  </p>
                  <p className="text-xs text-slate-300 mt-1">
                    Computer Institute · Downtown Sopore
                  </p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent p-5">
                <p className="text-xs font-medium text-slate-200">
                  Instructor-led practical lab sessions · Downtown Sopore Campus
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Published Programs */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Published Training Programs
            </h2>
            <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
              Live institute curriculum managed directly from the {instituteName} Academic Catalog.
            </p>
          </div>
          <Link
            to="/courses"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-800 hover:text-blue-950 whitespace-nowrap shrink-0"
          >
            <span>View Full Catalog</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loadingCourses ? (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="h-56 bg-white border border-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : courseError ? (
          <div className="mt-8 p-6 bg-white border border-red-200 rounded-xl text-sm text-red-800">
            {courseError}
          </div>
        ) : featuredCourses.length === 0 ? (
          <div className="mt-8 p-8 bg-white border border-slate-200 rounded-xl text-center space-y-3">
            <p className="text-sm font-medium text-slate-800">
              No training programs are currently published to the public catalog.
            </p>
            <p className="text-xs text-slate-500">
              Visit our Downtown Sopore campus or contact Administration for upcoming batch schedules.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredCourses.map((course) => (
              <article
                key={course.id}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-blue-300 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                    <span className="font-semibold text-blue-800">{course.code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{course.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{course.durationWeeks} wks</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-semibold text-slate-900 leading-snug">
                    <Link
                      to={`/courses/${course.slug || course.id}`}
                      className="hover:text-blue-800 transition-colors"
                    >
                      {course.title}
                    </Link>
                  </h3>
                  <p className="mt-2.5 text-sm text-slate-600 leading-relaxed line-clamp-3">
                    {course.description || 'Structured classroom and hands-on lab curriculum.'}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
                  <div className="font-mono text-slate-700 tabular-nums">
                    {course.tuitionFee !== null
                      ? formatMoney(course.tuitionFee, course.currency || currency)
                      : 'Fee on enquiry'}
                  </div>
                  <Link
                    to={`/courses/${course.slug || course.id}`}
                    className="inline-flex items-center gap-1 font-semibold text-blue-800 hover:text-blue-950 whitespace-nowrap"
                  >
                    <span>Syllabus</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Admissions Process & Certificate Verification Band */}
      <section className="bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                Admissions &amp; Enrollment Workflow
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                Transparent intake review and administrator-controlled student portal provisioning.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {ADMISSIONS_STEPS.map((item) => (
                <div key={item.step} className="space-y-1.5">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    {item.step}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
            <div>
              <Link
                to="/admissions"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md transition-colors"
              >
                <span>Start Admission Application</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-6 sm:p-7 flex flex-col justify-between space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-blue-900">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Official Credential Verification
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Employers and academic reviewers can verify completion certificates issued by {instituteName} using the certificate code, SHA-256 verification digest, or QR link printed on the PDF document.
              </p>
              <ul className="space-y-2 text-xs text-slate-700 pt-1">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Verified against live graduation &amp; attendance thresholds</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Instant revocation status &amp; final assessment grade check</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <Link
                to="/verify-certificate"
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors"
              >
                <span>Verify a Certificate Code</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
