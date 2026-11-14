import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  FileCheck2,
  FileText,
  History,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { isPendingAdmissionStatus } from '../shared/academic';
import type {
  AdmissionApplication,
  AdmissionDetailPayload,
  AdmissionDocumentStatus,
  AdmissionStatus,
  DashboardPayload,
  DocumentCategory,
} from '../shared/types';
import { api } from '../utils/api';

interface AdmissionsViewProps {
  data: DashboardPayload;
  onDashboardUpdate: (dashboard: DashboardPayload) => void;
}

const STATUS_TABS: ReadonlyArray<'All' | AdmissionStatus> = [
  'All',
  'Draft',
  'Submitted',
  'Under Review',
  'Documents Required',
  'Approved',
  'Rejected',
  'Withdrawn',
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function getAdmissionStatusColor(status: AdmissionStatus): string {
  switch (status) {
    case 'Approved':
    case 'Enrolled':
    case 'Accepted':
      return 'text-emerald-700';
    case 'Rejected':
    case 'Withdrawn':
      return 'text-red-700';
    case 'Documents Required':
      return 'text-amber-700';
    case 'Draft':
      return 'text-slate-600';
    default:
      return 'text-blue-700';
  }
}

function getDocStatusColor(status: AdmissionDocumentStatus): string {
  switch (status) {
    case 'Verified':
      return 'text-emerald-700';
    case 'Replacement Required':
      return 'text-amber-700';
    case 'Rejected':
      return 'text-red-700';
    default:
      return 'text-blue-700';
  }
}

function formatPortalPolicyLabel(policy: string): string {
  switch (policy) {
    case 'immediate':
      return 'Immediate upon Approval';
    case 'on_approval':
      return 'On Admission Approval';
    case 'manual_activation':
      return 'Manual Admin Activation';
    case 'after_first_payment':
      return 'After First Tuition Payment';
    default:
      return policy;
  }
}

export function AdmissionsView({ data, onDashboardUpdate }: AdmissionsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'All' | AdmissionStatus>('All');
  const [courseFilter, setCourseFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // Create / Edit Draft Modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [applicantName, setApplicantName] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [previousQualification, setPreviousQualification] = useState('');
  const [previousInstitution, setPreviousInstitution] = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [previousScore, setPreviousScore] = useState('');
  const [targetCourseId, setTargetCourseId] = useState(data.courses[0]?.id ?? '');
  const [targetBatchId, setTargetBatchId] = useState('');
  const [feePlanId, setFeePlanId] = useState(data.feePlans?.[0]?.id ?? '');
  const [preferredCohort, setPreferredCohort] = useState('');
  const [applicantRemarks, setApplicantRemarks] = useState('');
  const [initialDocType, setInitialDocType] = useState<'ID Verification' | 'Transcript' | 'Other'>('ID Verification');
  const [initialDocTitle, setInitialDocTitle] = useState('');
  const [initialDocFile, setInitialDocFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [submittingForm, setSubmittingForm] = useState(false);

  // Detail & Verification Drawer state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<AdmissionDetailPayload | null>(null);
  const [detailError, setDetailError] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState(false);

  // Document upload inside detail drawer
  const [docType, setDocType] = useState<'ID Verification' | 'Transcript' | 'Other'>('ID Verification');
  const [docTitle, setDocTitle] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);

  // Document verification inline prompt
  const [verifyTarget, setVerifyTarget] = useState<{
    docId: string;
    title: string;
    status: Exclude<AdmissionDocumentStatus, 'Pending'>;
  } | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState('');

  // Status Transition reason modal (Reject / Request Docs / Withdraw)
  const [transitionModal, setTransitionModal] = useState<{
    applicationId: string;
    applicantName: string;
    nextStatus: AdmissionStatus;
    title: string;
    requireReason: boolean;
  } | null>(null);
  const [transitionReason, setTransitionReason] = useState('');

  // Approve & Allocate Modal
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveCourseId, setApproveCourseId] = useState('');
  const [approveBatchId, setApproveBatchId] = useState('');
  const [approveFeePlanId, setApproveFeePlanId] = useState('');
  const [approveWaitlistIfFull, setApproveWaitlistIfFull] = useState(false);
  const [approveIssueInvoice, setApproveIssueInvoice] = useState(true);
  const [approveRemarks, setApproveRemarks] = useState('');
  const [approveError, setApproveError] = useState('');
  const [approving, setApproving] = useState(false);

  const feePlans = data.feePlans ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.admissions.filter((a) => {
      if (statusFilter !== 'All' && a.status !== statusFilter) return false;
      if (courseFilter !== 'All' && a.targetCourseId !== courseFilter) return false;
      if (q) {
        const hay = `${a.applicationNumber ?? ''} ${a.applicantName} ${a.applicantEmail} ${a.phone} ${a.preferredCohort}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.admissions, statusFilter, courseFilter, searchQuery]);

  const counts = useMemo(() => {
    const total = data.admissions.length;
    const drafts = data.admissions.filter((a) => a.status === 'Draft').length;
    const pending = data.admissions.filter((a) => isPendingAdmissionStatus(a.status)).length;
    const approved = data.admissions.filter(
      (a) => a.status === 'Approved' || a.status === 'Enrolled'
    ).length;
    return { total, drafts, pending, approved };
  }, [data.admissions]);

  const formCourseBatches = useMemo(
    () =>
      data.cohorts.filter(
        (b) => b.courseId === targetCourseId && b.status !== 'Archived' && b.status !== 'Completed'
      ),
    [data.cohorts, targetCourseId]
  );

  const approveBatches = useMemo(() => {
    const activeBatches = data.cohorts.filter(
      (b) => b.courseId === approveCourseId && b.status !== 'Archived' && b.status !== 'Completed'
    );
    return activeBatches.map((b) => {
      const enrolledCount = data.enrollments.filter(
        (e) =>
          e.courseId === b.courseId &&
          (e.cohortId === b.id || e.cohort === b.name) &&
          e.status !== 'Dropped' &&
          e.status !== 'Cancelled' &&
          e.status !== 'Withdrawn'
      ).length;
      return {
        ...b,
        enrolledCount,
        seatsRemaining: Math.max(0, b.capacity - enrolledCount),
      };
    });
  }, [data.cohorts, data.enrollments, approveCourseId]);

  const openNewApplicationModal = useCallback(() => {
    const defaultCourseId = data.courses[0]?.id ?? '';
    const defaultBatch = data.cohorts.find(
      (c) => c.courseId === defaultCourseId && c.status !== 'Archived'
    );
    setEditingAppId(null);
    setApplicantName('');
    setApplicantEmail('');
    setPhone('');
    setDateOfBirth('');
    setGender('');
    setNationality('');
    setAddress('');
    setCity('');
    setPostalCode('');
    setGuardianName('');
    setGuardianRelationship('');
    setGuardianPhone('');
    setGuardianEmail('');
    setPreviousQualification('');
    setPreviousInstitution('');
    setGraduationYear('');
    setPreviousScore('');
    setTargetCourseId(defaultCourseId);
    setTargetBatchId(defaultBatch?.id ?? '');
    setPreferredCohort(defaultBatch?.name ?? 'Cohort B · Winter');
    setFeePlanId(feePlans[0]?.id ?? '');
    setApplicantRemarks('');
    setInitialDocType('ID Verification');
    setInitialDocTitle('');
    setInitialDocFile(null);
    setFormError('');
    setFormModalOpen(true);
  }, [data.courses, data.cohorts, feePlans]);

  const openEditDraftModal = useCallback((app: AdmissionApplication) => {
    setEditingAppId(app.id);
    setApplicantName(app.applicantName === 'Draft Applicant' ? '' : app.applicantName);
    setApplicantEmail(app.applicantEmail ?? '');
    setPhone(app.phone ?? '');
    setDateOfBirth(app.dateOfBirth ?? '');
    setGender(app.gender ?? '');
    setNationality(app.nationality ?? '');
    setAddress(app.address ?? '');
    setCity(app.city ?? '');
    setPostalCode(app.postalCode ?? '');
    setGuardianName(app.guardianName ?? '');
    setGuardianRelationship(app.guardianRelationship ?? '');
    setGuardianPhone(app.guardianPhone ?? '');
    setGuardianEmail(app.guardianEmail ?? '');
    setPreviousQualification(app.previousQualification ?? '');
    setPreviousInstitution(app.previousInstitution ?? '');
    setGraduationYear(app.graduationYear ?? '');
    setPreviousScore(app.previousScore ?? '');
    setTargetCourseId(app.targetCourseId);
    setTargetBatchId(app.targetBatchId ?? '');
    setPreferredCohort(app.preferredCohort ?? '');
    setFeePlanId(app.feePlanId ?? feePlans[0]?.id ?? '');
    setApplicantRemarks(app.applicantRemarks || app.notes || '');
    setInitialDocFile(null);
    setInitialDocTitle('');
    setFormError('');
    setFormModalOpen(true);
  }, [feePlans]);

  const openDetailDrawer = useCallback(async (admissionId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setVerifyTarget(null);
    setVerifyRemarks('');
    try {
      const detail = await api.fetchAdmissionDetail(admissionId);
      setDetailData(detail);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : 'Unable to load application details.'
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function saveApplicationForm(saveStatus: 'Draft' | 'Submitted') {
    setFormError('');
    if (saveStatus === 'Draft') {
      if (applicantName.trim().length < 2 && !applicantEmail.trim()) {
        setFormError('Enter at least the applicant name or email to save a draft.');
        return;
      }
    } else {
      if (applicantName.trim().length < 2 || !applicantEmail.trim() || !targetCourseId) {
        setFormError('Applicant full name, valid email, and target course are required to submit.');
        return;
      }
    }

    setSubmittingForm(true);
    try {
      const selectedBatch = data.cohorts.find((b) => b.id === targetBatchId);
      const cohortLabel =
        preferredCohort.trim() || selectedBatch?.name || 'Upcoming Intake';

      let documents: Array<{
        documentType: string;
        title: string;
        category: DocumentCategory;
        fileName: string;
        mimeType: string;
        contentBase64: string;
      }> = [];

      if (initialDocFile && !editingAppId) {
        const contentBase64 = await fileToBase64(initialDocFile);
        documents = [
          {
            documentType: initialDocType,
            title: initialDocTitle.trim() || initialDocFile.name,
            category: initialDocType,
            fileName: initialDocFile.name,
            mimeType: initialDocFile.type || 'application/octet-stream',
            contentBase64,
          },
        ];
      }

      const payload = {
        applicantName: applicantName.trim(),
        applicantEmail: applicantEmail.trim(),
        phone: phone.trim(),
        dateOfBirth: dateOfBirth || null,
        gender: gender.trim(),
        nationality: nationality.trim(),
        address: address.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        guardianName: guardianName.trim(),
        guardianRelationship: guardianRelationship.trim(),
        guardianPhone: guardianPhone.trim(),
        guardianEmail: guardianEmail.trim(),
        previousQualification: previousQualification.trim(),
        previousInstitution: previousInstitution.trim(),
        graduationYear: graduationYear.trim(),
        previousScore: previousScore.trim(),
        targetCourseId,
        targetBatchId: targetBatchId || null,
        feePlanId: feePlanId || null,
        preferredCohort: cohortLabel,
        status: saveStatus,
        notes: applicantRemarks.trim(),
        applicantRemarks: applicantRemarks.trim(),
      };

      if (editingAppId) {
        const res = await api.updateAdmission(editingAppId, payload);
        onDashboardUpdate(res.dashboard);
        if (detailOpen && detailData?.application.id === editingAppId && res.detail) {
          setDetailData(res.detail);
        }
        setStatusNotice(
          saveStatus === 'Draft'
            ? 'Application draft saved.'
            : 'Application submitted for admissions review.'
        );
      } else {
        const res = await api.createAdmission({ ...payload, documents });
        onDashboardUpdate(res.dashboard);
        setStatusNotice(
          saveStatus === 'Draft'
            ? `Draft ${res.applicationNumber ?? ''} saved.`
            : `Application ${res.applicationNumber ?? ''} submitted.`
        );
      }

      setFormModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to save admission application.'
      );
    } finally {
      setSubmittingForm(false);
    }
  }

  async function handleQuickStatusChange(
    applicationId: string,
    nextStatus: AdmissionStatus,
    reason?: string
  ) {
    setWorkflowBusy(true);
    setActionError('');
    setStatusNotice('');
    try {
      const res = await api.updateAdmission(applicationId, {
        status: nextStatus,
        reason,
        ...(nextStatus === 'Rejected' && reason ? { rejectionReason: reason } : {}),
      });
      onDashboardUpdate(res.dashboard);
      if (res.detail) {
        setDetailData(res.detail);
      }
      setStatusNotice(`Application status updated to ${nextStatus}.`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to update application status.'
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleConfirmTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!transitionModal) return;
    if (transitionModal.requireReason && transitionReason.trim().length < 3) {
      setActionError('Please enter a brief reason (at least 3 characters).');
      return;
    }
    const target = transitionModal;
    const reasonText = transitionReason.trim();
    setTransitionModal(null);
    setTransitionReason('');
    await handleQuickStatusChange(target.applicationId, target.nextStatus, reasonText);
  }

  async function handleDetailDocUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!detailData || !docFile) return;
    setDocUploading(true);
    setDetailError('');
    try {
      const contentBase64 = await fileToBase64(docFile);
      const res = await api.uploadAdmissionDocument(detailData.application.id, {
        documentType: docType,
        title: docTitle.trim() || docFile.name,
        category: docType,
        fileName: docFile.name,
        mimeType: docFile.type || 'application/octet-stream',
        contentBase64,
      });
      setDetailData(res.detail);
      onDashboardUpdate(res.dashboard);
      setDocTitle('');
      setDocFile(null);
      setStatusNotice(`Document "${docFile.name}" attached to application.`);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : 'Failed to upload admission document.'
      );
    } finally {
      setDocUploading(false);
    }
  }

  async function handleDocVerifySubmit(
    docId: string,
    status: Exclude<AdmissionDocumentStatus, 'Pending'>,
    remarks: string
  ) {
    if (!detailData) return;
    if ((status === 'Replacement Required' || status === 'Rejected') && remarks.trim().length < 3) {
      setDetailError('Verification remarks are required when requesting replacement or rejecting a document.');
      return;
    }
    setWorkflowBusy(true);
    setDetailError('');
    try {
      const res = await api.verifyAdmissionDocument(detailData.application.id, docId, {
        status,
        verificationRemarks: remarks.trim(),
      });
      setDetailData(res.detail);
      onDashboardUpdate(res.dashboard);
      setVerifyTarget(null);
      setVerifyRemarks('');
      setStatusNotice(`Document marked as ${status}.`);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : 'Unable to verify document.'
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  function openApproveModal(app: AdmissionApplication) {
    const courseId = app.targetCourseId;
    const availableBatches = data.cohorts.filter(
      (b) => b.courseId === courseId && b.status !== 'Archived' && b.status !== 'Completed'
    );
    const defaultBatch =
      availableBatches.find((b) => b.id === app.targetBatchId) ||
      availableBatches.find((b) => b.name === app.preferredCohort) ||
      availableBatches[0];

    setApproveCourseId(courseId);
    setApproveBatchId(defaultBatch?.id ?? '');
    setApproveFeePlanId(app.feePlanId ?? feePlans[0]?.id ?? '');
    setApproveWaitlistIfFull(false);
    setApproveIssueInvoice(true);
    setApproveRemarks(app.reviewRemarks ?? '');
    setApproveError('');
    setApproveModalOpen(true);
  }

  async function handleApproveSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetApp = detailData?.application;
    if (!targetApp) return;
    if (!approveBatchId) {
      setApproveError('Select an authorized batch before approving.');
      return;
    }
    setApproving(true);
    setApproveError('');
    try {
      const res = await api.approveAdmission(targetApp.id, {
        targetCourseId: approveCourseId,
        targetBatchId: approveBatchId,
        feePlanId: approveFeePlanId || null,
        waitlistIfFull: approveWaitlistIfFull,
        reviewRemarks: approveRemarks.trim(),
        issueInvoice: approveIssueInvoice,
      });
      onDashboardUpdate(res.dashboard);
      setDetailData(res.detail);
      setApproveModalOpen(false);
      setStatusNotice(
        `Approved ${targetApp.applicantName} (${res.studentCode}) — allocated to ${res.batchName} (${res.enrollmentStatus}).`
      );
    } catch (err) {
      setApproveError(
        err instanceof Error ? err.message : 'Unable to approve admission.'
      );
    } finally {
      setApproving(false);
    }
  }

  async function handleActivatePortal(admissionId: string) {
    setWorkflowBusy(true);
    setDetailError('');
    try {
      const res = await api.activateAdmissionPortal(admissionId);
      setDetailData(res.detail);
      onDashboardUpdate(res.dashboard);
      setStatusNotice('Student portal access has been activated.');
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : 'Failed to activate student portal.'
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total Applications</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {counts.total}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">All intake cohorts</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Saved Drafts</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {counts.drafts}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Incomplete applications</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Pending Review</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-blue-700 tabular-nums">
            {counts.pending}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Submitted & docs review</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Approved & Enrolled</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {counts.approved}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Converted to students</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="admission-search" className="sr-only">
                Search admissions
              </label>
              <input
                id="admission-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search app #, applicant, email, phone..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="sm:w-56">
              <label htmlFor="admission-course-filter" className="sr-only">
                Filter by course
              </label>
              <select
                id="admission-course-filter"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
              >
                <option value="All">All Courses</option>
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={openNewApplicationModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Admission Application</span>
          </button>
        </div>

        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="group"
          aria-label="Filter admissions by workflow status"
        >
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice('')}
            aria-label="Dismiss notice"
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError('')}
            aria-label="Dismiss error"
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Admissions Pipeline Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Admissions Pipeline & Document Verification
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filtered.length} of {data.admissions.length} applications
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No admission applications match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Application & Applicant</th>
                  <th className="py-2.5 px-4">Target Program & Batch</th>
                  <th className="py-2.5 px-4">Documents</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Updated</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((adm) => {
                  const course = data.courses.find((c) => c.id === adm.targetCourseId);
                  const batch = data.cohorts.find(
                    (b) => b.id === (adm.allocatedBatchId || adm.targetBatchId)
                  );
                  const docTotal = adm.documentsCount ?? 0;
                  const docVerified = adm.verifiedDocumentsCount ?? 0;
                  return (
                    <tr key={adm.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {adm.applicationNumber || adm.id}
                          </span>
                        </div>
                        <div className="font-medium text-slate-900 mt-0.5">
                          {adm.applicantName}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {adm.applicantEmail || 'No email saved yet'}
                          {adm.phone ? ` · ${adm.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">
                          {course?.code ?? adm.targetCourseId} — {course?.title ?? ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {batch ? `${batch.name} (${batch.code})` : adm.preferredCohort || 'Batch TBD'}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-mono tabular-nums text-slate-700">
                        {docTotal === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : (
                          <span>
                            {docVerified}/{docTotal} verified
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className={`text-xs font-semibold ${getAdmissionStatusColor(adm.status)}`}>
                          {adm.status}
                        </div>
                        {adm.convertedUserId && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {adm.portalActivated ? 'Portal Active' : 'Portal Pending'}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums">
                        {new Date(adm.updatedAt || adm.submittedAt).toLocaleDateString('en-US')}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {adm.status === 'Draft' && (
                            <button
                              type="button"
                              onClick={() => openEditDraftModal(adm)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit Draft</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void openDetailDrawer(adm.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Draft Application Modal */}
      {formModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admission-form-title"
        >
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="admission-form-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                {editingAppId ? 'Edit Draft Admission Application' : 'New Admission Application'}
              </h3>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                aria-label="Close application form"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="mt-5 space-y-6">
              {/* Section 1: Applicant Personal & Contact */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  1. Applicant Personal & Contact Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adm-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      id="adm-name"
                      type="text"
                      value={applicantName}
                      onChange={(e) => setApplicantName(e.target.value)}
                      placeholder="e.g., Priya Nair"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-email" className="block text-xs font-medium text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      id="adm-email"
                      type="email"
                      value={applicantEmail}
                      onChange={(e) => setApplicantEmail(e.target.value)}
                      placeholder="applicant@example.com"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      id="adm-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-dob" className="block text-xs font-medium text-slate-700 mb-1">
                      Date of Birth
                    </label>
                    <input
                      id="adm-dob"
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-gender" className="block text-xs font-medium text-slate-700 mb-1">
                      Gender
                    </label>
                    <input
                      id="adm-gender"
                      type="text"
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-nationality" className="block text-xs font-medium text-slate-700 mb-1">
                      Nationality
                    </label>
                    <input
                      id="adm-nationality"
                      type="text"
                      value={nationality}
                      onChange={(e) => setNationality(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </section>

              {/* Section 2: Address */}
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  2. Address
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label htmlFor="adm-address" className="block text-xs font-medium text-slate-700 mb-1">
                      Street Address
                    </label>
                    <input
                      id="adm-address"
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="adm-city" className="block text-xs font-medium text-slate-700 mb-1">
                      City
                    </label>
                    <input
                      id="adm-city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-postal" className="block text-xs font-medium text-slate-700 mb-1">
                      Postal Code
                    </label>
                    <input
                      id="adm-postal"
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </section>

              {/* Section 3: Guardian Information */}
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  3. Guardian & Emergency Contact
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adm-gname" className="block text-xs font-medium text-slate-700 mb-1">
                      Guardian Name
                    </label>
                    <input
                      id="adm-gname"
                      type="text"
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-grel" className="block text-xs font-medium text-slate-700 mb-1">
                      Relationship
                    </label>
                    <input
                      id="adm-grel"
                      type="text"
                      value={guardianRelationship}
                      onChange={(e) => setGuardianRelationship(e.target.value)}
                      placeholder="Parent / Sponsor / Spouse"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-gphone" className="block text-xs font-medium text-slate-700 mb-1">
                      Guardian Phone
                    </label>
                    <input
                      id="adm-gphone"
                      type="tel"
                      value={guardianPhone}
                      onChange={(e) => setGuardianPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-gemail" className="block text-xs font-medium text-slate-700 mb-1">
                      Guardian Email
                    </label>
                    <input
                      id="adm-gemail"
                      type="email"
                      value={guardianEmail}
                      onChange={(e) => setGuardianEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </section>

              {/* Section 4: Previous Academic Info */}
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  4. Previous Academic Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label htmlFor="adm-qual" className="block text-xs font-medium text-slate-700 mb-1">
                      Qualification
                    </label>
                    <input
                      id="adm-qual"
                      type="text"
                      value={previousQualification}
                      onChange={(e) => setPreviousQualification(e.target.value)}
                      placeholder="B.Sc. Computer Science"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-inst" className="block text-xs font-medium text-slate-700 mb-1">
                      Institution
                    </label>
                    <input
                      id="adm-inst"
                      type="text"
                      value={previousInstitution}
                      onChange={(e) => setPreviousInstitution(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-gradyr" className="block text-xs font-medium text-slate-700 mb-1">
                      Graduation Year
                    </label>
                    <input
                      id="adm-gradyr"
                      type="text"
                      value={graduationYear}
                      onChange={(e) => setGraduationYear(e.target.value)}
                      placeholder="2025"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-score" className="block text-xs font-medium text-slate-700 mb-1">
                      GPA / Score
                    </label>
                    <input
                      id="adm-score"
                      type="text"
                      value={previousScore}
                      onChange={(e) => setPreviousScore(e.target.value)}
                      placeholder="3.8 / 4.0"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                </div>
              </section>

              {/* Section 5: Program & Batch */}
              <section className="space-y-3 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  5. Program, Batch & Fee Plan
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="adm-course" className="block text-xs font-medium text-slate-700 mb-1">
                      Target Course
                    </label>
                    <select
                      id="adm-course"
                      value={targetCourseId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setTargetCourseId(nextId);
                        const match = data.cohorts.find(
                          (b) => b.courseId === nextId && b.status !== 'Archived'
                        );
                        setTargetBatchId(match?.id ?? '');
                        if (match) setPreferredCohort(match.name);
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                    >
                      {data.courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="adm-batch" className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred Batch
                    </label>
                    <select
                      id="adm-batch"
                      value={targetBatchId}
                      onChange={(e) => {
                        const bId = e.target.value;
                        setTargetBatchId(bId);
                        const b = data.cohorts.find((c) => c.id === bId);
                        if (b) setPreferredCohort(b.name);
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                    >
                      <option value="">Any upcoming batch</option>
                      {formCourseBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name} (Cap {b.capacity})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="adm-cohort" className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred Cohort Label
                    </label>
                    <input
                      id="adm-cohort"
                      type="text"
                      value={preferredCohort}
                      onChange={(e) => setPreferredCohort(e.target.value)}
                      placeholder="Cohort B · Winter"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="adm-feeplan" className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred Fee Plan
                    </label>
                    <select
                      id="adm-feeplan"
                      value={feePlanId}
                      onChange={(e) => setFeePlanId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                    >
                      <option value="">Default Academy Plan</option>
                      {feePlans.map((fp) => (
                        <option key={fp.id} value={fp.id}>
                          {fp.code} — {fp.name} ({fp.installmentCount}x)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="adm-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                    Application Remarks & Background Notes
                  </label>
                  <textarea
                    id="adm-remarks"
                    rows={2}
                    value={applicantRemarks}
                    onChange={(e) => setApplicantRemarks(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </section>

              {/* Section 6: Initial Document Upload (for new applications) */}
              {!editingAppId && (
                <section className="space-y-3 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    6. Initial Supporting Document (Optional)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="adm-init-doctype" className="block text-xs font-medium text-slate-700 mb-1">
                        Document Type
                      </label>
                      <select
                        id="adm-init-doctype"
                        value={initialDocType}
                        onChange={(e) =>
                          setInitialDocType(
                            e.target.value as 'ID Verification' | 'Transcript' | 'Other'
                          )
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="ID Verification">ID Verification</option>
                        <option value="Transcript">Transcript</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="adm-init-doctitle" className="block text-xs font-medium text-slate-700 mb-1">
                        Document Title
                      </label>
                      <input
                        id="adm-init-doctitle"
                        type="text"
                        value={initialDocTitle}
                        onChange={(e) => setInitialDocTitle(e.target.value)}
                        placeholder="Government ID / Academic Transcript"
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="adm-init-docfile" className="block text-xs font-medium text-slate-700 mb-1">
                        Attach File (Max 2 MB)
                      </label>
                      <input
                        id="adm-init-docfile"
                        type="file"
                        onChange={(e) => setInitialDocFile(e.target.files?.[0] ?? null)}
                        className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:text-xs file:font-medium file:text-slate-700"
                      />
                    </div>
                  </div>
                </section>
              )}

              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  disabled={submittingForm}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingForm}
                  onClick={() => void saveApplicationForm('Draft')}
                  className="px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {submittingForm ? 'Saving...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={submittingForm}
                  onClick={() => void saveApplicationForm('Submitted')}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {submittingForm ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Application Detail, Document Verification & Status Timeline Modal */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admission-detail-title"
        >
          <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl p-6 shadow-lg my-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3.5 gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {detailData?.application.applicationNumber || 'Admission Record'}
                  </span>
                  {detailData && (
                    <span
                      className={`text-xs font-semibold ${getAdmissionStatusColor(detailData.application.status)}`}
                    >
                      {detailData.application.status}
                    </span>
                  )}
                </div>
                <h3
                  id="admission-detail-title"
                  className="font-display text-base font-semibold text-slate-900 mt-1"
                >
                  {detailData?.application.applicantName || 'Loading Application...'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                aria-label="Close application detail"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {detailError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{detailError}</span>
              </div>
            )}

            {detailLoading || !detailData ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Loading full admission record, documents, and audit history...
              </div>
            ) : (
              <div className="mt-5 space-y-6">
                {/* Workflow Action Toolbar */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    Active Portal Activation Policy:{' '}
                    <span className="font-semibold text-slate-900">
                      {formatPortalPolicyLabel(detailData.portalActivationPolicy)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {detailData.application.status === 'Draft' && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditDraftModal(detailData.application)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Draft</span>
                        </button>
                        <button
                          type="button"
                          disabled={workflowBusy}
                          onClick={() =>
                            void handleQuickStatusChange(detailData.application.id, 'Submitted', 'Draft submitted by administrator')
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Submit Application</span>
                        </button>
                      </>
                    )}

                    {(detailData.application.status === 'Submitted' ||
                      detailData.application.status === 'Documents Required') && (
                      <button
                        type="button"
                        disabled={workflowBusy}
                        onClick={() =>
                          void handleQuickStatusChange(
                            detailData.application.id,
                            'Under Review',
                            'Assigned to admissions committee for evaluation'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                      >
                        Move to Under Review
                      </button>
                    )}

                    {(detailData.application.status === 'Submitted' ||
                      detailData.application.status === 'Under Review') && (
                      <button
                        type="button"
                        disabled={workflowBusy}
                        onClick={() => {
                          setTransitionReason('');
                          setTransitionModal({
                            applicationId: detailData.application.id,
                            applicantName: detailData.application.applicantName,
                            nextStatus: 'Documents Required',
                            title: 'Request Additional Documents',
                            requireReason: true,
                          });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md cursor-pointer whitespace-nowrap"
                      >
                        Request Documents
                      </button>
                    )}

                    {(detailData.application.status === 'Submitted' ||
                      detailData.application.status === 'Under Review' ||
                      detailData.application.status === 'Documents Required' ||
                      detailData.application.status === 'Accepted') && (
                      <>
                        <button
                          type="button"
                          disabled={workflowBusy}
                          onClick={() => openApproveModal(detailData.application)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Approve & Enroll</span>
                        </button>
                        <button
                          type="button"
                          disabled={workflowBusy}
                          onClick={() => {
                            setTransitionReason('');
                            setTransitionModal({
                              applicationId: detailData.application.id,
                              applicantName: detailData.application.applicantName,
                              nextStatus: 'Rejected',
                              title: 'Reject Admission Application',
                              requireReason: true,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}

                    {detailData.application.status !== 'Approved' &&
                      detailData.application.status !== 'Enrolled' &&
                      detailData.application.status !== 'Rejected' &&
                      detailData.application.status !== 'Withdrawn' && (
                        <button
                          type="button"
                          disabled={workflowBusy}
                          onClick={() => {
                            setTransitionReason('');
                            setTransitionModal({
                              applicationId: detailData.application.id,
                              applicantName: detailData.application.applicantName,
                              nextStatus: 'Withdrawn',
                              title: 'Withdraw Admission Application',
                              requireReason: false,
                            });
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          Withdraw
                        </button>
                      )}

                    {detailData.linkedStudent && !detailData.application.portalActivated && (
                      <button
                        type="button"
                        disabled={workflowBusy}
                        onClick={() => void handleActivatePortal(detailData.application.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer whitespace-nowrap"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Activate Portal Access</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Linked Student Banner (when approved) */}
                {detailData.linkedStudent && (
                  <div className="border border-emerald-200 bg-emerald-50/70 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-emerald-900">
                        Student Profile Linked:{' '}
                        <span className="font-mono">
                          {detailData.linkedStudent.studentCode || detailData.linkedStudent.id}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-800 mt-0.5">
                        Account Status:{' '}
                        <span className="font-semibold">{detailData.linkedStudent.status}</span> ·
                        Portal Access:{' '}
                        <span className="font-semibold">
                          {detailData.application.portalActivated ? 'Activated' : 'Pending Activation'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Applicant Metadata Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-slate-900">Personal & Contact Details</h4>
                    <div className="grid grid-cols-2 gap-y-1.5 text-slate-600">
                      <span>Email:</span>
                      <span className="text-slate-900 font-medium">{detailData.application.applicantEmail || '—'}</span>
                      <span>Phone:</span>
                      <span className="text-slate-900 font-mono">{detailData.application.phone || '—'}</span>
                      <span>Date of Birth:</span>
                      <span className="text-slate-900 font-mono tabular-nums">
                        {detailData.application.dateOfBirth || '—'}
                      </span>
                      <span>Gender / Nationality:</span>
                      <span className="text-slate-900">
                        {[detailData.application.gender, detailData.application.nationality]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                      <span>Address:</span>
                      <span className="text-slate-900">
                        {[detailData.application.address, detailData.application.city, detailData.application.postalCode]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-slate-900">Guardian & Academic Background</h4>
                    <div className="grid grid-cols-2 gap-y-1.5 text-slate-600">
                      <span>Guardian:</span>
                      <span className="text-slate-900">
                        {detailData.application.guardianName
                          ? `${detailData.application.guardianName}${
                              detailData.application.guardianRelationship
                                ? ` (${detailData.application.guardianRelationship})`
                                : ''
                            }`
                          : '—'}
                      </span>
                      <span>Guardian Contact:</span>
                      <span className="text-slate-900">
                        {[detailData.application.guardianPhone, detailData.application.guardianEmail]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                      <span>Qualification:</span>
                      <span className="text-slate-900">
                        {detailData.application.previousQualification || '—'}
                      </span>
                      <span>Institution:</span>
                      <span className="text-slate-900">
                        {detailData.application.previousInstitution || '—'}
                      </span>
                      <span>Year / Score:</span>
                      <span className="text-slate-900 font-mono">
                        {[detailData.application.graduationYear, detailData.application.previousScore]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Remarks */}
                {(detailData.application.applicantRemarks ||
                  detailData.application.reviewRemarks ||
                  detailData.application.rejectionReason ||
                  detailData.application.notes) && (
                  <div className="border border-slate-200 rounded-lg p-4 text-xs space-y-1.5">
                    <h4 className="font-semibold text-slate-900">Remarks & Evaluation Notes</h4>
                    {detailData.application.applicantRemarks && (
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">Applicant Remarks: </span>
                        {detailData.application.applicantRemarks}
                      </p>
                    )}
                    {detailData.application.notes &&
                      detailData.application.notes !== detailData.application.applicantRemarks && (
                        <p className="text-slate-700">
                          <span className="font-medium text-slate-900">Application Notes: </span>
                          {detailData.application.notes}
                        </p>
                      )}
                    {detailData.application.reviewRemarks && (
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">Review Remarks: </span>
                        {detailData.application.reviewRemarks}
                      </p>
                    )}
                    {detailData.application.rejectionReason && (
                      <p className="text-red-700">
                        <span className="font-medium">Rejection Reason: </span>
                        {detailData.application.rejectionReason}
                      </p>
                    )}
                  </div>
                )}

                {/* Document Verification Section */}
                <div className="border border-slate-200 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-blue-700" />
                      <h4 className="text-xs font-semibold text-slate-900">
                        Private Admission Documents & Verification
                      </h4>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {detailData.documents.filter((d) => d.verifiedStatus === 'Verified').length}/
                      {detailData.documents.length} verified
                    </span>
                  </div>

                  {detailData.documents.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No documents uploaded for this application yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                      {detailData.documents.map((doc) => (
                        <div key={doc.id} className="p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                              <div>
                                <div className="text-xs font-medium text-slate-900">
                                  {doc.title}{' '}
                                  <span className="font-mono text-[11px] text-slate-500">
                                    ({doc.documentType})
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {doc.fileName} · {(doc.sizeBytes / 1024).toFixed(1)} KB
                                  {doc.verifiedByName && doc.verifiedAt
                                    ? ` · Reviewed by ${doc.verifiedByName} on ${new Date(
                                        doc.verifiedAt
                                      ).toLocaleDateString('en-US')}`
                                    : ''}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-xs font-semibold ${getDocStatusColor(doc.verifiedStatus)}`}
                              >
                                {doc.verifiedStatus}
                              </span>

                              <button
                                type="button"
                                onClick={() =>
                                  void api.downloadAdmissionDocument(
                                    detailData.application.id,
                                    doc.id,
                                    doc.fileName
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded cursor-pointer whitespace-nowrap"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download</span>
                              </button>

                              <button
                                type="button"
                                disabled={workflowBusy}
                                onClick={() => void handleDocVerifySubmit(doc.id, 'Verified', 'Verified by admissions office')}
                                className="px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded cursor-pointer whitespace-nowrap"
                              >
                                Verify
                              </button>

                              <button
                                type="button"
                                disabled={workflowBusy}
                                onClick={() => {
                                  setVerifyRemarks('');
                                  setVerifyTarget({
                                    docId: doc.id,
                                    title: doc.title,
                                    status: 'Replacement Required',
                                  });
                                }}
                                className="px-2 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded cursor-pointer whitespace-nowrap"
                              >
                                Request Replacement
                              </button>

                              <button
                                type="button"
                                disabled={workflowBusy}
                                onClick={() => {
                                  setVerifyRemarks('');
                                  setVerifyTarget({
                                    docId: doc.id,
                                    title: doc.title,
                                    status: 'Rejected',
                                  });
                                }}
                                className="px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer whitespace-nowrap"
                              >
                                Reject
                              </button>
                            </div>
                          </div>

                          {doc.verificationRemarks && (
                            <div className="text-[11px] text-slate-600 pl-6">
                              Remarks: {doc.verificationRemarks}
                            </div>
                          )}

                          {verifyTarget?.docId === doc.id && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2 space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-900">
                                <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                                <span>
                                  {verifyTarget.status}: {verifyTarget.title}
                                </span>
                              </div>
                              <input
                                type="text"
                                value={verifyRemarks}
                                onChange={(e) => setVerifyRemarks(e.target.value)}
                                placeholder="Enter verification remarks explaining required replacement or rejection..."
                                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setVerifyTarget(null)}
                                  className="px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={workflowBusy}
                                  onClick={() =>
                                    void handleDocVerifySubmit(
                                      doc.id,
                                      verifyTarget.status,
                                      verifyRemarks
                                    )
                                  }
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded cursor-pointer"
                                >
                                  Save Decision
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload Document Form */}
                  <form
                    onSubmit={handleDetailDocUpload}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end"
                  >
                    <div>
                      <label htmlFor="det-doc-type" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Document Type
                      </label>
                      <select
                        id="det-doc-type"
                        value={docType}
                        onChange={(e) =>
                          setDocType(e.target.value as 'ID Verification' | 'Transcript' | 'Other')
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      >
                        <option value="ID Verification">ID Verification</option>
                        <option value="Transcript">Transcript</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="det-doc-title" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Document Title
                      </label>
                      <input
                        id="det-doc-title"
                        type="text"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="Passport / Marksheet"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label htmlFor="det-doc-file" className="block text-[11px] font-medium text-slate-700 mb-1">
                        File (Max 2 MB)
                      </label>
                      <input
                        id="det-doc-file"
                        type="file"
                        required
                        onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                        className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-slate-300 file:bg-white file:text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={docUploading || !docFile}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{docUploading ? 'Uploading...' : 'Attach Document'}</span>
                    </button>
                  </form>
                </div>

                {/* Status Change Audit Timeline */}
                <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-blue-700" />
                    <h4 className="text-xs font-semibold text-slate-900">
                      Status History & Decision Audit Trail
                    </h4>
                  </div>

                  {detailData.statusHistory.length === 0 ? (
                    <p className="text-xs text-slate-500">No status history recorded.</p>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {detailData.statusHistory.map((h) => (
                        <div key={h.id} className="py-2.5 flex flex-wrap items-start justify-between gap-2 text-xs">
                          <div>
                            <div className="font-medium text-slate-900">
                              {h.previousStatus ? `${h.previousStatus} -> ${h.newStatus}` : h.newStatus}
                            </div>
                            {h.reason && <div className="text-slate-600 mt-0.5">{h.reason}</div>}
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Actor: {h.actorName} ({h.actorRole})
                            </div>
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(h.changedAt).toLocaleString('en-US')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Transition Reason Modal */}
      {transitionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transition-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 id="transition-modal-title" className="font-display text-base font-semibold text-slate-900">
                {transitionModal.title}
              </h3>
              <button
                type="button"
                onClick={() => setTransitionModal(null)}
                aria-label="Close transition modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmTransition} className="mt-4 space-y-4">
              <p className="text-xs text-slate-600">
                Transitioning <strong className="text-slate-900">{transitionModal.applicantName}</strong> to{' '}
                <strong className="text-slate-900">{transitionModal.nextStatus}</strong>. This action will be recorded in the status audit trail and notify the applicant.
              </p>
              <div>
                <label htmlFor="transition-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  {transitionModal.requireReason ? 'Reason / Remarks (Required)' : 'Reason (Optional)'}
                </label>
                <textarea
                  id="transition-reason"
                  rows={3}
                  required={transitionModal.requireReason}
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="Provide clear context for this decision..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTransitionModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={workflowBusy}
                  className={`px-4 py-2 text-xs font-medium text-white rounded-lg cursor-pointer ${
                    transitionModal.nextStatus === 'Rejected'
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-blue-700 hover:bg-blue-800'
                  }`}
                >
                  Confirm {transitionModal.nextStatus}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve & Allocate Batch/Fee Plan Modal */}
      {approveModalOpen && detailData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approve-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-700" />
                <h3 id="approve-modal-title" className="font-display text-base font-semibold text-slate-900">
                  Approve Admission & Allocate Enrollment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setApproveModalOpen(false)}
                aria-label="Close approval modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {approveError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{approveError}</span>
              </div>
            )}

            <form onSubmit={handleApproveSubmit} className="mt-4 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700">
                <div>
                  Applicant: <strong className="text-slate-900">{detailData.application.applicantName}</strong> ({detailData.application.applicantEmail})
                </div>
                <div className="mt-1">
                  Portal Policy:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {detailData.portalActivationPolicy}
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="app-course-sel" className="block text-xs font-medium text-slate-700 mb-1">
                  Confirmed Course
                </label>
                <select
                  id="app-course-sel"
                  value={approveCourseId}
                  onChange={(e) => {
                    const nextC = e.target.value;
                    setApproveCourseId(nextC);
                    const b = data.cohorts.find(
                      (c) => c.courseId === nextC && c.status !== 'Archived' && c.status !== 'Completed'
                    );
                    setApproveBatchId(b?.id ?? '');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="app-batch-sel" className="block text-xs font-medium text-slate-700 mb-1">
                  Authorized Batch Allocation
                </label>
                <select
                  id="app-batch-sel"
                  value={approveBatchId}
                  onChange={(e) => setApproveBatchId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Select authorized batch...</option>
                  {approveBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name} ({b.enrolledCount}/{b.capacity} seats · {b.seatsRemaining} open)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="app-feeplan-sel" className="block text-xs font-medium text-slate-700 mb-1">
                  Applicable Fee Plan
                </label>
                <select
                  id="app-feeplan-sel"
                  value={approveFeePlanId}
                  onChange={(e) => setApproveFeePlanId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Default Fee Plan</option>
                  {detailData.feePlans.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.code} — {fp.name} ({fp.installmentCount} installment{fp.installmentCount === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={approveWaitlistIfFull}
                    onChange={(e) => setApproveWaitlistIfFull(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Place student on Waitlist automatically if selected batch is full</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={approveIssueInvoice}
                    onChange={(e) => setApproveIssueInvoice(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Generate tuition invoice using selected fee plan</span>
                </label>
              </div>

              <div>
                <label htmlFor="app-review-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Approval Remarks
                </label>
                <textarea
                  id="app-review-remarks"
                  rows={2}
                  value={approveRemarks}
                  onChange={(e) => setApproveRemarks(e.target.value)}
                  placeholder="Optional registrar review note..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApproveModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {approving ? 'Processing Approval...' : 'Confirm Approval & Enroll'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
