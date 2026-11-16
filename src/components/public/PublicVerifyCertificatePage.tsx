import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, CheckCircle2, Search, XCircle } from 'lucide-react';
import type { PublicAcademyInfo } from '../../shared/types';
import { api, isBackendUnavailableError, type VerifiedCertificateInfo } from '../../utils/api';
import { usePublicSiteData } from '../../utils/public-data';

interface PublicVerifyCertificatePageProps {
  academy: PublicAcademyInfo | null;
}

const VERIFY_UNAVAILABLE_MESSAGE =
  'Certificate verification service is temporarily unavailable.';

export function PublicVerifyCertificatePage({
  academy,
}: PublicVerifyCertificatePageProps) {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('verifyCert') ?? '';
  const { academy: siteAcademy } = usePublicSiteData();

  const [certQuery, setCertQuery] = useState(initialQuery);
  const [certResult, setCertResult] = useState<VerifiedCertificateInfo | null>(null);
  const [certError, setCertError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!trimmed) return;
    let active = true;
    setCertQuery(trimmed);
    setVerifying(true);
    setCertError('');
    api
      .verifyCertificate(trimmed)
      .then((res) => {
        if (active) setCertResult(res.certificate);
      })
      .catch((err) => {
        if (!active) return;
        setCertError(
          isBackendUnavailableError(err)
            ? VERIFY_UNAVAILABLE_MESSAGE
            : err instanceof Error
              ? err.message
              : 'Certificate verification failed.'
        );
      })
      .finally(() => {
        if (active) setVerifying(false);
      });
    return () => {
      active = false;
    };
  }, [initialQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCertError('');
    setCertResult(null);
    if (!certQuery.trim()) {
      setCertError('Enter a certificate code or SHA-256 verification digest.');
      return;
    }
    setVerifying(true);
    try {
      const res = await api.verifyCertificate(certQuery.trim());
      setCertResult(res.certificate);
    } catch (err) {
      setCertError(
        isBackendUnavailableError(err)
          ? VERIFY_UNAVAILABLE_MESSAGE
          : err instanceof Error
            ? err.message
            : 'Certificate verification failed.'
      );
    } finally {
      setVerifying(false);
    }
  }

  const effectiveAcademy = academy ?? siteAcademy;
  const instituteName = effectiveAcademy?.name || 'IGS — InfoCom Global Services';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-8">
      <div className="border-b border-slate-200 pb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-blue-800">{instituteName}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
            Official Certificate Verification
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Verify the authenticity, academic score, and issuance status of any credential issued by {instituteName}.
          </p>
        </div>
        <Award className="w-8 h-8 text-blue-800 shrink-0 hidden sm:block" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="public-verify-cert-input" className="sr-only">
              Certificate Code or Verification Hash
            </label>
            <input
              id="public-verify-cert-input"
              type="text"
              value={certQuery}
              onChange={(e) => setCertQuery(e.target.value)}
              placeholder="e.g. IGS-CERT-2026-... or SHA-256 hash"
              className="w-full px-3.5 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={verifying}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-950 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Search className="w-4 h-4" />
            <span>{verifying ? 'Checking Registry...' : 'Verify Credential'}</span>
          </button>
        </form>

        {certError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
          >
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{certError}</span>
          </div>
        )}

        {certResult && (
          <div className="border border-slate-200 rounded-lg p-5 bg-slate-50 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <span className="font-mono text-sm font-semibold text-slate-900">
                {certResult.certificateCode}
              </span>
              {certResult.status === 'Issued' ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified Authentic &amp; Active</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                  <XCircle className="w-4 h-4" />
                  <span>Revoked Credential</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
              <div>
                <span className="text-slate-500 block">Recipient</span>
                <strong className="text-slate-900">
                  {certResult.studentName} ({certResult.studentCode})
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">Program</span>
                <strong className="text-slate-900">
                  {certResult.courseCode} — {certResult.courseTitle}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">Assessment &amp; Attendance</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {certResult.finalScore}% ({certResult.letterGrade}) · {certResult.attendanceRate}% attendance
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Issued Date &amp; Signatory</span>
                <span className="text-slate-900">
                  {new Date(certResult.issuedAt).toLocaleDateString('en-IN')} · {certResult.issuedByName}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 font-mono break-all">
              SHA-256 Digest: {certResult.verificationHash}
            </div>

            {certResult.revokedReason && (
              <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 font-medium">
                Revocation Reason: {certResult.revokedReason}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
