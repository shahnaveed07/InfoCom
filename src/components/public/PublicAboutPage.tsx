import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import studioLabImage from '../../assets/images/academy_lab_studio_1794576422024.jpg';
import type { PublicAcademyInfo } from '../../shared/types';
import { usePublicSiteData } from '../../utils/public-data';

interface PublicAboutPageProps {
  academy: PublicAcademyInfo | null;
}

const FOCUS_AREAS = [
  {
    title: '01. Core Computer Literacy & Office Systems',
    description:
      'Foundational operating system navigation, document formatting, spreadsheet modeling, and presentation workflows for students and professionals.',
  },
  {
    title: '02. Programming & Database Engineering',
    description:
      'Structured problem-solving in Python, C/JavaScript, and relational database design with normalized SQL schemas and hands-on laboratory exercises.',
  },
  {
    title: '03. Web Development & Applied Analytics',
    description:
      'Responsive web application development, API integration, and spreadsheet-to-Python analytical reporting aligned with verifiable assessments.',
  },
] as const;

export function PublicAboutPage({ academy }: PublicAboutPageProps) {
  const { academy: siteAcademy } = usePublicSiteData();
  const [imageFailed, setImageFailed] = useState(false);
  const effectiveAcademy = academy ?? siteAcademy;
  const instituteName = effectiveAcademy?.name || 'IGS — InfoCom Global Services';
  const slogan = effectiveAcademy?.slogan || 'Learn Today, Build Tomorrow.';
  const address =
    effectiveAcademy?.address ||
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-14">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-center space-y-4">
          <p className="text-xs font-semibold text-blue-800">
            About {instituteName} · {slogan}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
            Structured computer training and accountable academic records in Sopore.
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Located in Downtown Sopore, {instituteName} serves learners across North Kashmir with guided computer laboratory sessions, cohort scheduling, transparent fee tracking, and verifiable graduation credentials.
          </p>
          <div className="pt-2 flex items-start gap-2.5 text-xs text-slate-700">
            <MapPin className="w-4 h-4 text-blue-800 shrink-0 mt-0.5" />
            <span>{address}</span>
          </div>
          <div className="pt-4 flex flex-wrap gap-3">
            <Link
              to="/courses"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 rounded-md"
            >
              <span>Browse Programs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              to="/admissions"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
            >
              <span>Apply for Admission</span>
            </Link>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="h-full min-h-[280px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
            {!imageFailed ? (
              <img
                src={studioLabImage}
                alt="Students collaborating with instructor in computer laboratory at IGS InfoCom Global Services"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                <BookOpen className="w-10 h-10 text-blue-800 mb-3" />
                <p className="font-display text-base font-semibold text-slate-900">
                  {instituteName}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="font-display text-xl font-bold text-slate-900">
            Academic Practice &amp; Training Methodology
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Every cohort follows structured module weights, attendance tracking, and verified assessment milestones.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FOCUS_AREAS.map((area) => (
            <div key={area.title} className="space-y-2">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                {area.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">{area.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900 text-slate-100 rounded-xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2 text-blue-300 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Verifiable Academic Governance</span>
          </div>
          <h2 className="font-display text-xl font-semibold text-white">
            Admin-Verified Admissions &amp; QR Credential Registry
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Portal accounts are issued strictly by institute Administration after admission verification. Graduating students earn QR-coded PDF certificates anchored to cryptographic verification hashes.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link
            to="/verify-certificate"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-md whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
            <span>Verify Certificate</span>
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-700 rounded-md whitespace-nowrap"
          >
            <span>Campus Directions</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
