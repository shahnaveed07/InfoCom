import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Award,
  Calendar,
  CheckCircle2,
  CreditCard,
  Edit3,
  GraduationCap,
  Plus,
  Save,
  Settings,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { formatInvoiceNumber } from '../shared/academic';
import type {
  AcademicTerm,
  AcademicYear,
  AcademySettingsPayload,
  DashboardPayload,
  PortalActivationPolicy,
} from '../shared/types';
import { api } from '../utils/api';

interface AcademySettingsViewProps {
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

export function AcademySettingsView({
  onDashboardUpdate,
}: AcademySettingsViewProps) {
  const [settings, setSettings] = useState<AcademySettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'general' | 'calendar' | 'policies' | 'finance'>(
    'general'
  );

  // General academy state
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [currency, setCurrency] = useState('INR');

  // Policies state
  const [studentIdPrefix, setStudentIdPrefix] = useState('IGS');
  const [invoicePrefix, setInvoicePrefix] = useState('INV-2026');
  const [invoiceNextSeq, setInvoiceNextSeq] = useState('1001');
  const [feeDueDays, setFeeDueDays] = useState('14');
  const [lateFeePct, setLateFeePct] = useState('0');
  const [passingScore, setPassingScore] = useState('70');
  const [distinctionScore, setDistinctionScore] = useState('90');
  const [minAttendanceRatePct, setMinAttendanceRatePct] = useState('75');
  const [lateWeightPct, setLateWeightPct] = useState('75');
  const [reminderWindowHours, setReminderWindowHours] = useState('24');
  const [certificateCodePrefix, setCertificateCodePrefix] = useState('INF-CERT-2026');
  const [certificateMinCompletionPct, setCertificateMinCompletionPct] = useState('100');
  const [certificateMinScore, setCertificateMinScore] = useState('70');
  const [certificateMinAttendancePct, setCertificateMinAttendancePct] = useState('75');
  const [portalActivationPolicy, setPortalActivationPolicy] =
    useState<PortalActivationPolicy>('on_approval');

  // Certificate template state
  const [tmplName, setTmplName] = useState('Standard Completion Credential');
  const [tmplTitleFormat, setTmplTitleFormat] = useState(
    'Certificate of Technical Completion'
  );
  const [tmplSigName, setTmplSigName] = useState('Academy Director');
  const [tmplSigTitle, setTmplSigTitle] = useState('Academic Head');

  // Academic Year / Term forms
  const [ayCode, setAyCode] = useState('');
  const [ayName, setAyName] = useState('');
  const [ayStart, setAyStart] = useState('2026-09-01');
  const [ayEnd, setAyEnd] = useState('2027-08-31');
  const [ayCurrent, setAyCurrent] = useState(false);
  const [aySaving, setAySaving] = useState(false);

  const [atYearId, setAtYearId] = useState('');
  const [atCode, setAtCode] = useState('');
  const [atName, setAtName] = useState('');
  const [atStart, setAtStart] = useState('2027-01-10');
  const [atEnd, setAtEnd] = useState('2027-04-30');
  const [atCurrent, setAtCurrent] = useState(false);
  const [atSaving, setAtSaving] = useState(false);

  // Edit Academic Year / Term modals
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [editAyName, setEditAyName] = useState('');
  const [editAyStart, setEditAyStart] = useState('');
  const [editAyEnd, setEditAyEnd] = useState('');
  const [editAyStatus, setEditAyStatus] = useState<'Planned' | 'Active' | 'Completed' | 'Archived'>('Active');
  const [editAyCurrent, setEditAyCurrent] = useState(false);
  const [editAySaving, setEditAySaving] = useState(false);

  const [editingTerm, setEditingTerm] = useState<AcademicTerm | null>(null);
  const [editAtName, setEditAtName] = useState('');
  const [editAtStart, setEditAtStart] = useState('');
  const [editAtEnd, setEditAtEnd] = useState('');
  const [editAtStatus, setEditAtStatus] = useState<'Planned' | 'Active' | 'Completed' | 'Archived'>('Active');
  const [editAtCurrent, setEditAtCurrent] = useState(false);
  const [editAtSaving, setEditAtSaving] = useState(false);

  const hydrateFromPayload = useCallback((p: AcademySettingsPayload) => {
    setSettings(p);
    setName(p.academy.name);
    setLegalName(p.academy.legalName);
    setEmail(p.academy.email);
    setPhone(p.academy.phone);
    setWebsite(p.academy.website);
    setAddress(p.academy.address);
    setLogoDataUrl(p.academy.logoDataUrl);
    setTimezone(p.academy.timezone || 'Asia/Kolkata');
    setCurrency(p.academy.currency || 'INR');

    setStudentIdPrefix(p.policies.studentIdPrefix || 'IGS');
    setInvoicePrefix(p.policies.invoicePrefix);
    setInvoiceNextSeq(String(p.policies.invoiceNextSeq));
    setFeeDueDays(String(p.policies.feeDueDays));
    setLateFeePct(String(p.policies.lateFeePct));
    setPassingScore(String(p.policies.passingScore));
    setDistinctionScore(String(p.policies.distinctionScore));
    setMinAttendanceRatePct(String(p.policies.minAttendanceRatePct));
    setLateWeightPct(String(p.policies.lateWeightPct));
    setReminderWindowHours(String(p.policies.reminderWindowHours));
    setCertificateCodePrefix(p.policies.certificateCodePrefix);
    setCertificateMinCompletionPct(String(p.policies.certificateMinCompletionPct));
    setCertificateMinScore(String(p.policies.certificateMinScore));
    setCertificateMinAttendancePct(String(p.policies.certificateMinAttendancePct));
    setPortalActivationPolicy(p.policies.portalActivationPolicy ?? 'on_approval');

    if (p.certificateTemplate) {
      setTmplName(p.certificateTemplate.name);
      setTmplTitleFormat(p.certificateTemplate.titleFormat);
      setTmplSigName(p.certificateTemplate.signatoryName);
      setTmplSigTitle(p.certificateTemplate.signatoryTitle);
    }
    if (p.academicYears[0]) {
      setAtYearId((prev) => prev || p.academicYears[0].id);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getSettings()
      .then((res) => {
        if (active) hydrateFromPayload(res);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load settings.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hydrateFromPayload]);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 480 * 1024) {
      setError('Logo image must be smaller than 480 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
        setError('');
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await api.updateSettings({
        academy: {
          name: name.trim(),
          legalName: legalName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          website: website.trim(),
          address: address.trim(),
          logoDataUrl,
          timezone: timezone.trim() || 'Asia/Kolkata',
          currency: currency.trim().toUpperCase() || 'INR',
        },
        policies: {
          studentIdPrefix: studentIdPrefix.trim().toUpperCase() || 'IGS',
          invoicePrefix: invoicePrefix.trim().toUpperCase(),
          invoiceNextSeq: Number(invoiceNextSeq) || 1001,
          feeDueDays: Number(feeDueDays) || 14,
          lateFeePct: Number(lateFeePct) || 0,
          passingScore: Number(passingScore) || 70,
          distinctionScore: Number(distinctionScore) || 90,
          minAttendanceRatePct: Number(minAttendanceRatePct) || 75,
          lateWeightPct: Number(lateWeightPct) || 75,
          reminderWindowHours: Number(reminderWindowHours) || 24,
          certificateCodePrefix: certificateCodePrefix.trim().toUpperCase(),
          certificateMinCompletionPct: Number(certificateMinCompletionPct) || 100,
          certificateMinScore: Number(certificateMinScore) || 70,
          certificateMinAttendancePct: Number(certificateMinAttendancePct) || 75,
          portalActivationPolicy,
        },
        certificateTemplate: {
          name: tmplName.trim(),
          titleFormat: tmplTitleFormat.trim(),
          signatoryName: tmplSigName.trim(),
          signatoryTitle: tmplSigTitle.trim(),
        },
      });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setNotice('Academy settings, policies, and branding saved to PostgreSQL.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateYear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setAySaving(true);
    try {
      const res = await api.createAcademicYear({
        code: ayCode.trim().toUpperCase(),
        name: ayName.trim(),
        startDate: new Date(ayStart).toISOString(),
        endDate: new Date(ayEnd).toISOString(),
        isCurrent: ayCurrent,
      });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setAyCode('');
      setAyName('');
      setNotice('Academic year created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create academic year.');
    } finally {
      setAySaving(false);
    }
  }

  async function handleCreateTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!atYearId) return;
    setError('');
    setAtSaving(true);
    try {
      const res = await api.createAcademicTerm({
        academicYearId: atYearId,
        code: atCode.trim().toUpperCase(),
        name: atName.trim(),
        startDate: new Date(atStart).toISOString(),
        endDate: new Date(atEnd).toISOString(),
        isCurrent: atCurrent,
      });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setAtCode('');
      setAtName('');
      setNotice('Academic term created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create academic term.');
    } finally {
      setAtSaving(false);
    }
  }

  async function handleSetCurrentYear(id: string) {
    try {
      const res = await api.updateAcademicYear(id, { isCurrent: true });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setNotice('Current academic year updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update year.');
    }
  }

  async function handleSetCurrentTerm(id: string) {
    try {
      const res = await api.updateAcademicTerm(id, { isCurrent: true });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setNotice('Current academic term updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update term.');
    }
  }

  function openEditYear(ay: AcademicYear) {
    setEditingYear(ay);
    setEditAyName(ay.name);
    setEditAyStart(ay.startDate ? ay.startDate.slice(0, 10) : '');
    setEditAyEnd(ay.endDate ? ay.endDate.slice(0, 10) : '');
    const st = (['Planned', 'Active', 'Completed', 'Archived'].includes(ay.status)
      ? ay.status
      : 'Active') as 'Planned' | 'Active' | 'Completed' | 'Archived';
    setEditAyStatus(st);
    setEditAyCurrent(ay.isCurrent);
    setError('');
  }

  async function handleSaveEditYear(e: React.FormEvent) {
    e.preventDefault();
    if (!editingYear) return;
    setError('');
    setEditAySaving(true);
    try {
      const res = await api.updateAcademicYear(editingYear.id, {
        name: editAyName.trim(),
        startDate: new Date(editAyStart).toISOString(),
        endDate: new Date(editAyEnd).toISOString(),
        status: editAyStatus,
        isCurrent: editAyCurrent,
      });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setEditingYear(null);
      setNotice('Academic year updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update academic year.');
    } finally {
      setEditAySaving(false);
    }
  }

  function openEditTerm(at: AcademicTerm) {
    setEditingTerm(at);
    setEditAtName(at.name);
    setEditAtStart(at.startDate ? at.startDate.slice(0, 10) : '');
    setEditAtEnd(at.endDate ? at.endDate.slice(0, 10) : '');
    const st = (['Planned', 'Active', 'Completed', 'Archived'].includes(at.status)
      ? at.status
      : 'Active') as 'Planned' | 'Active' | 'Completed' | 'Archived';
    setEditAtStatus(st);
    setEditAtCurrent(at.isCurrent);
    setError('');
  }

  async function handleSaveEditTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTerm) return;
    setError('');
    setEditAtSaving(true);
    try {
      const res = await api.updateAcademicTerm(editingTerm.id, {
        name: editAtName.trim(),
        startDate: new Date(editAtStart).toISOString(),
        endDate: new Date(editAtEnd).toISOString(),
        status: editAtStatus,
        isCurrent: editAtCurrent,
      });
      hydrateFromPayload(res.settings);
      onDashboardUpdate(res.dashboard);
      setEditingTerm(null);
      setNotice('Academic term updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update academic term.');
    } finally {
      setEditAtSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
        Loading academy configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Settings className="w-4 h-4 text-blue-700" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Academy Settings & Governance Configuration
            </h2>
            <p className="text-xs text-slate-500">
              Manage institution branding, timezone ({timezone}), academic calendar, grading & attendance policies, invoice numbering, and certificates
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div
          role="tablist"
          aria-label="Academy settings categories"
          className="border-b border-slate-200 px-4 flex flex-wrap gap-2 bg-slate-50/70"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'general'}
            onClick={() => setTab('general')}
            className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'general'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Academy Info & Branding</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calendar'}
            onClick={() => setTab('calendar')}
            className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'calendar'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Academic Years & Terms</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'policies'}
            onClick={() => setTab('policies')}
            className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'policies'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Grading & Attendance Rules</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'finance'}
            onClick={() => setTab('finance')}
            className={`inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'finance'
                ? 'border-blue-700 text-blue-800'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Fees, Invoices & Certificates</span>
          </button>
        </div>

        {tab === 'calendar' ? (
          <div className="p-6 space-y-8">
            {/* Academic Years */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Academic Years
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {(settings?.academicYears ?? []).map((ay) => (
                    <div
                      key={ay.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-medium text-slate-900">
                          {ay.name}{' '}
                          <span className="font-mono text-slate-500">({ay.code})</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          {new Date(ay.startDate).toLocaleDateString('en-IN')} –{' '}
                          {new Date(ay.endDate).toLocaleDateString('en-IN')} · {ay.status}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {ay.isCurrent ? (
                          <span className="font-semibold text-emerald-700">Current</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetCurrentYear(ay.id)}
                            className="px-2.5 py-1 font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap"
                          >
                            Set Current
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditYear(ay)}
                          aria-label={`Edit academic year ${ay.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer whitespace-nowrap"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleCreateYear}
                className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Plus className="w-3.5 h-3.5 text-blue-700" />
                  <span>Add Academic Year</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ay-code-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Code
                    </label>
                    <input
                      id="ay-code-in"
                      type="text"
                      required
                      value={ayCode}
                      onChange={(e) => setAyCode(e.target.value)}
                      placeholder="AY-2027"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="ay-name-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Name
                    </label>
                    <input
                      id="ay-name-in"
                      type="text"
                      required
                      value={ayName}
                      onChange={(e) => setAyName(e.target.value)}
                      placeholder="Academic Year 2027"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ay-start-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Start Date
                    </label>
                    <input
                      id="ay-start-in"
                      type="date"
                      required
                      value={ayStart}
                      onChange={(e) => setAyStart(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="ay-end-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      End Date
                    </label>
                    <input
                      id="ay-end-in"
                      type="date"
                      required
                      value={ayEnd}
                      onChange={(e) => setAyEnd(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ayCurrent}
                    onChange={(e) => setAyCurrent(e.target.checked)}
                  />
                  <span>Mark as current academic year</span>
                </label>
                <button
                  type="submit"
                  disabled={aySaving}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {aySaving ? 'Adding...' : 'Add Academic Year'}
                </button>
              </form>
            </div>

            {/* Academic Terms */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-6 border-t border-slate-200">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                  Academic Terms
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {(settings?.academicTerms ?? []).map((at) => (
                    <div
                      key={at.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-medium text-slate-900">
                          {at.name}{' '}
                          <span className="font-mono text-slate-500">({at.code})</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {at.academicYearName} ·{' '}
                          {new Date(at.startDate).toLocaleDateString('en-IN')} –{' '}
                          {new Date(at.endDate).toLocaleDateString('en-IN')} · {at.status}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {at.isCurrent ? (
                          <span className="font-semibold text-emerald-700">Current</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetCurrentTerm(at.id)}
                            className="px-2.5 py-1 font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap"
                          >
                            Set Current
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditTerm(at)}
                          aria-label={`Edit academic term ${at.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer whitespace-nowrap"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleCreateTerm}
                className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Plus className="w-3.5 h-3.5 text-blue-700" />
                  <span>Add Academic Term</span>
                </div>
                <div>
                  <label htmlFor="at-year-select" className="block text-[11px] font-medium text-slate-700 mb-1">
                    Academic Year
                  </label>
                  <select
                    id="at-year-select"
                    value={atYearId}
                    onChange={(e) => setAtYearId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    {(settings?.academicYears ?? []).map((ay) => (
                      <option key={ay.id} value={ay.id}>
                        {ay.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="at-code-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Term Code
                    </label>
                    <input
                      id="at-code-in"
                      type="text"
                      required
                      value={atCode}
                      onChange={(e) => setAtCode(e.target.value)}
                      placeholder="TERM-2027-SPR"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="at-name-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Term Name
                    </label>
                    <input
                      id="at-name-in"
                      type="text"
                      required
                      value={atName}
                      onChange={(e) => setAtName(e.target.value)}
                      placeholder="Spring 2027"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="at-start-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Start Date
                    </label>
                    <input
                      id="at-start-in"
                      type="date"
                      required
                      value={atStart}
                      onChange={(e) => setAtStart(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="at-end-in" className="block text-[11px] font-medium text-slate-700 mb-1">
                      End Date
                    </label>
                    <input
                      id="at-end-in"
                      type="date"
                      required
                      value={atEnd}
                      onChange={(e) => setAtEnd(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={atCurrent}
                    onChange={(e) => setAtCurrent(e.target.checked)}
                  />
                  <span>Mark as current term</span>
                </label>
                <button
                  type="submit"
                  disabled={atSaving}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {atSaving ? 'Adding...' : 'Add Academic Term'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveSettings} className="p-6 space-y-6">
            {tab === 'general' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="acad-name-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Academy Display Name
                    </label>
                    <input
                      id="acad-name-in"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="acad-legal-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Legal Entity Name
                    </label>
                    <input
                      id="acad-legal-in"
                      type="text"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="acad-email-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Registrar Email
                    </label>
                    <input
                      id="acad-email-in"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="acad-phone-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Contact Phone
                    </label>
                    <input
                      id="acad-phone-in"
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="acad-web-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Website URL
                    </label>
                    <input
                      id="acad-web-in"
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="acad-address-in" className="block text-xs font-medium text-slate-700 mb-1">
                      Campus Address
                    </label>
                    <input
                      id="acad-address-in"
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="acad-tz-select" className="block text-xs font-medium text-slate-700 mb-1">
                      Default Timezone
                    </label>
                    <select
                      id="acad-tz-select"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    >
                      {!COMMON_TIMEZONES.includes(timezone) && (
                        <option value={timezone}>{timezone}</option>
                      )}
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Branding Logo Upload */}
                <div className="border-t border-slate-200 pt-4">
                  <span className="block text-xs font-medium text-slate-700 mb-2">
                    Institution Logo (PNG, JPEG, WebP, or SVG under 480 KB)
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    <img
                      src={logoDataUrl || '/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg'}
                      alt="Academy logo preview"
                      className="h-14 w-auto max-w-[160px] rounded-lg border border-slate-200 object-contain bg-[#EAEAE8] p-1"
                    />
                    <label
                      htmlFor="acad-logo-upload"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <span>{logoDataUrl ? 'Replace Logo' : 'Upload Custom Override'}</span>
                      <input
                        id="acad-logo-upload"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleLogoUpload}
                        className="sr-only"
                      />
                    </label>
                    {logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoDataUrl('')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Logo</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'policies' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="pol-pass-score" className="block text-xs font-medium text-slate-700 mb-1">
                    Default Passing Score (%)
                  </label>
                  <input
                    id="pol-pass-score"
                    type="number"
                    min={1}
                    max={100}
                    value={passingScore}
                    onChange={(e) => setPassingScore(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pol-distinction-score" className="block text-xs font-medium text-slate-700 mb-1">
                    Distinction Threshold (%)
                  </label>
                  <input
                    id="pol-distinction-score"
                    type="number"
                    min={1}
                    max={100}
                    value={distinctionScore}
                    onChange={(e) => setDistinctionScore(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pol-min-att" className="block text-xs font-medium text-slate-700 mb-1">
                    Minimum Attendance Rate (%)
                  </label>
                  <input
                    id="pol-min-att"
                    type="number"
                    min={1}
                    max={100}
                    value={minAttendanceRatePct}
                    onChange={(e) => setMinAttendanceRatePct(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pol-late-weight" className="block text-xs font-medium text-slate-700 mb-1">
                    Late Attendance Weight (%)
                  </label>
                  <input
                    id="pol-late-weight"
                    type="number"
                    min={0}
                    max={100}
                    value={lateWeightPct}
                    onChange={(e) => setLateWeightPct(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pol-reminder-hrs" className="block text-xs font-medium text-slate-700 mb-1">
                    Session Reminder Lead Window (Hours)
                  </label>
                  <input
                    id="pol-reminder-hrs"
                    type="number"
                    min={1}
                    max={168}
                    value={reminderWindowHours}
                    onChange={(e) => setReminderWindowHours(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3 pt-4 border-t border-slate-200">
                  <label
                    htmlFor="pol-portal-activation"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Admission Portal Activation Policy
                  </label>
                  <select
                    id="pol-portal-activation"
                    value={portalActivationPolicy}
                    onChange={(e) =>
                      setPortalActivationPolicy(e.target.value as PortalActivationPolicy)
                    }
                    className="w-full max-w-md px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    <option value="on_approval">
                      On Admission Approval (Standard)
                    </option>
                    <option value="immediate">
                      Immediate Activation upon Approval
                    </option>
                    <option value="manual_activation">
                      Manual Admin Activation Required
                    </option>
                    <option value="after_first_payment">
                      Activate Automatically After First Payment
                    </option>
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Controls whether newly admitted students gain active portal login status immediately on approval, only after recording their first tuition payment, or via explicit administrator activation.
                  </p>
                </div>
              </div>
            )}

            {tab === 'finance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                    Fee & Invoice Numbering Settings
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                    <div>
                      <label htmlFor="pol-stu-prefix" className="block text-xs font-medium text-slate-700 mb-1">
                        Student ID Prefix
                      </label>
                      <input
                        id="pol-stu-prefix"
                        type="text"
                        required
                        maxLength={10}
                        value={studentIdPrefix}
                        onChange={(e) => setStudentIdPrefix(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-currency" className="block text-xs font-medium text-slate-700 mb-1">
                        Currency
                      </label>
                      <select
                        id="pol-currency"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      >
                        <option value="INR">INR (₹)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="SGD">SGD (S$)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pol-inv-prefix" className="block text-xs font-medium text-slate-700 mb-1">
                        Invoice Prefix
                      </label>
                      <input
                        id="pol-inv-prefix"
                        type="text"
                        required
                        value={invoicePrefix}
                        onChange={(e) => setInvoicePrefix(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-inv-seq" className="block text-xs font-medium text-slate-700 mb-1">
                        Next Sequence
                      </label>
                      <input
                        id="pol-inv-seq"
                        type="number"
                        min={1}
                        value={invoiceNextSeq}
                        onChange={(e) => setInvoiceNextSeq(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-due-days" className="block text-xs font-medium text-slate-700 mb-1">
                        Default Due Days
                      </label>
                      <input
                        id="pol-due-days"
                        type="number"
                        min={1}
                        max={180}
                        value={feeDueDays}
                        onChange={(e) => setFeeDueDays(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-late-fee" className="block text-xs font-medium text-slate-700 mb-1">
                        Late Fee (%)
                      </label>
                      <input
                        id="pol-late-fee"
                        type="number"
                        min={0}
                        max={50}
                        step="0.5"
                        value={lateFeePct}
                        onChange={(e) => setLateFeePct(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 font-mono">
                    Next generated invoice preview:{' '}
                    <strong className="text-slate-900">
                      {formatInvoiceNumber(invoicePrefix, Number(invoiceNextSeq) || 1)}
                    </strong>
                  </p>
                </div>

                <div className="pt-5 border-t border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-blue-700" />
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Certificate Issuance & Template Settings
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="pol-cert-prefix" className="block text-xs font-medium text-slate-700 mb-1">
                        Certificate Code Prefix
                      </label>
                      <input
                        id="pol-cert-prefix"
                        type="text"
                        required
                        value={certificateCodePrefix}
                        onChange={(e) => setCertificateCodePrefix(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-cert-comp" className="block text-xs font-medium text-slate-700 mb-1">
                        Min Completion (%)
                      </label>
                      <input
                        id="pol-cert-comp"
                        type="number"
                        min={1}
                        max={100}
                        value={certificateMinCompletionPct}
                        onChange={(e) => setCertificateMinCompletionPct(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-cert-score" className="block text-xs font-medium text-slate-700 mb-1">
                        Min Weighted Score (%)
                      </label>
                      <input
                        id="pol-cert-score"
                        type="number"
                        min={1}
                        max={100}
                        value={certificateMinScore}
                        onChange={(e) => setCertificateMinScore(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="pol-cert-att" className="block text-xs font-medium text-slate-700 mb-1">
                        Min Attendance (%)
                      </label>
                      <input
                        id="pol-cert-att"
                        type="number"
                        min={1}
                        max={100}
                        value={certificateMinAttendancePct}
                        onChange={(e) => setCertificateMinAttendancePct(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                    <div>
                      <label htmlFor="tmpl-name-in" className="block text-xs font-medium text-slate-700 mb-1">
                        Template Name
                      </label>
                      <input
                        id="tmpl-name-in"
                        type="text"
                        value={tmplName}
                        onChange={(e) => setTmplName(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="tmpl-title-in" className="block text-xs font-medium text-slate-700 mb-1">
                        Credential Heading
                      </label>
                      <input
                        id="tmpl-title-in"
                        type="text"
                        value={tmplTitleFormat}
                        onChange={(e) => setTmplTitleFormat(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="tmpl-sig-name" className="block text-xs font-medium text-slate-700 mb-1">
                        Signatory Name
                      </label>
                      <input
                        id="tmpl-sig-name"
                        type="text"
                        value={tmplSigName}
                        onChange={(e) => setTmplSigName(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="tmpl-sig-title" className="block text-xs font-medium text-slate-700 mb-1">
                        Signatory Title
                      </label>
                      <input
                        id="tmpl-sig-title"
                        type="text"
                        value={tmplSigTitle}
                        onChange={(e) => setTmplSigTitle(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving Settings...' : 'Save Configuration'}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Edit Academic Year Modal */}
      {editingYear && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-ay-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 id="edit-ay-title" className="font-display text-sm font-semibold text-slate-900">
                Edit Academic Year · <span className="font-mono">{editingYear.code}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingYear(null)}
                aria-label="Close edit academic year dialog"
                className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEditYear} className="p-5 space-y-3">
              <div>
                <label htmlFor="edit-ay-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Academic Year Name
                </label>
                <input
                  id="edit-ay-name"
                  type="text"
                  required
                  value={editAyName}
                  onChange={(e) => setEditAyName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-ay-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="edit-ay-start"
                    type="date"
                    required
                    value={editAyStart}
                    onChange={(e) => setEditAyStart(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-ay-end" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="edit-ay-end"
                    type="date"
                    required
                    value={editAyEnd}
                    onChange={(e) => setEditAyEnd(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="edit-ay-status" className="block text-xs font-medium text-slate-700 mb-1">
                  Status
                </label>
                <select
                  id="edit-ay-status"
                  value={editAyStatus}
                  onChange={(e) =>
                    setEditAyStatus(
                      e.target.value as 'Planned' | 'Active' | 'Completed' | 'Archived'
                    )
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Planned">Planned</option>
                  <option value="Active">Active</option>
                  <option value="Completed">Completed</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editAyCurrent}
                  onChange={(e) => setEditAyCurrent(e.target.checked)}
                />
                <span>Mark as current academic year</span>
              </label>
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingYear(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAySaving}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {editAySaving ? 'Saving...' : 'Save Year'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Academic Term Modal */}
      {editingTerm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-at-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 id="edit-at-title" className="font-display text-sm font-semibold text-slate-900">
                Edit Academic Term · <span className="font-mono">{editingTerm.code}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingTerm(null)}
                aria-label="Close edit academic term dialog"
                className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEditTerm} className="p-5 space-y-3">
              <div>
                <label htmlFor="edit-at-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Term Name
                </label>
                <input
                  id="edit-at-name"
                  type="text"
                  required
                  value={editAtName}
                  onChange={(e) => setEditAtName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-at-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="edit-at-start"
                    type="date"
                    required
                    value={editAtStart}
                    onChange={(e) => setEditAtStart(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-at-end" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="edit-at-end"
                    type="date"
                    required
                    value={editAtEnd}
                    onChange={(e) => setEditAtEnd(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="edit-at-status" className="block text-xs font-medium text-slate-700 mb-1">
                  Status
                </label>
                <select
                  id="edit-at-status"
                  value={editAtStatus}
                  onChange={(e) =>
                    setEditAtStatus(
                      e.target.value as 'Planned' | 'Active' | 'Completed' | 'Archived'
                    )
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Planned">Planned</option>
                  <option value="Active">Active</option>
                  <option value="Completed">Completed</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editAtCurrent}
                  onChange={(e) => setEditAtCurrent(e.target.checked)}
                />
                <span>Mark as current term</span>
              </label>
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingTerm(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAtSaving}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {editAtSaving ? 'Saving...' : 'Save Term'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
