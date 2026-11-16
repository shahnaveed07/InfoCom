import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { PublicAcademyInfo } from '../../shared/types';
import { usePublicSiteData } from '../../utils/public-data';

interface PublicContactPageProps {
  academy: PublicAcademyInfo | null;
}

export function PublicContactPage({ academy }: PublicContactPageProps) {
  const { academy: siteAcademy } = usePublicSiteData();
  const effectiveAcademy = academy ?? siteAcademy;
  const instituteName = effectiveAcademy?.name || 'IGS — InfoCom Global Services';
  const slogan = effectiveAcademy?.slogan || 'Learn Today, Build Tomorrow.';
  const address =
    effectiveAcademy?.address ||
    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';
  const phone = effectiveAcademy?.phone?.trim() || '';
  const email = effectiveAcademy?.email?.trim() || '';
  const website = effectiveAcademy?.website?.trim() || '';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-10">
      <div className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold text-blue-800">
          {instituteName} · {slogan}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
          Campus Location &amp; Inquiries
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-2xl">
          Visit our Downtown Sopore institute office for admissions counseling, batch schedules, and student credential support.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-blue-800 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Sopore Main Campus
              </h2>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{address}</p>
            </div>
          </div>

          {phone && (
            <div className="flex items-start gap-3 pt-4 border-t border-slate-200">
              <Phone className="w-5 h-5 text-blue-800 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Campus Phone</h3>
                <a
                  href={`tel:${phone}`}
                  className="mt-1 inline-block text-sm font-mono text-blue-800 hover:underline"
                >
                  {phone}
                </a>
              </div>
            </div>
          )}

          {email && (
            <div className="flex items-start gap-3 pt-4 border-t border-slate-200">
              <Mail className="w-5 h-5 text-blue-800 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Official Email</h3>
                <a
                  href={`mailto:${email}`}
                  className="mt-1 inline-block text-sm text-blue-800 hover:underline"
                >
                  {email}
                </a>
              </div>
            </div>
          )}

          {website && (
            <div className="flex items-start gap-3 pt-4 border-t border-slate-200">
              <Globe className="w-5 h-5 text-blue-800 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Website</h3>
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm text-blue-800 hover:underline"
                >
                  {website}
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="md:col-span-5 bg-slate-900 text-slate-100 rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-white">
              Online Services
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Prospective students may submit an online admission application directly or review active syllabus outlines prior to visiting the Sopore campus.
            </p>
          </div>
          <div className="space-y-2.5">
            <Link
              to="/admissions"
              className="w-full inline-flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-md"
            >
              <span>Submit Admission Application</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              to="/verify-certificate"
              className="w-full inline-flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-700 rounded-md"
            >
              <span>Verify Official Certificate</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              to="/login"
              className="w-full inline-flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-200 border border-slate-700 hover:bg-slate-800 rounded-md"
            >
              <span>Student / Staff Portal Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
