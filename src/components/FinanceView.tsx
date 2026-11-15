import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgePercent,
  CheckCircle2,
  CreditCard,
  FileText,
  GraduationCap,
  Layers,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  X,
} from 'lucide-react';
import { formatCents, formatMoney, fromCents, toCents } from '../shared/academic';
import type {
  DashboardPayload,
  FeeInvoice,
  InvoiceDetailPayload,
  PaymentMethod,
  PaymentReceipt,
} from '../shared/types';
import { api } from '../utils/api';

type FinanceSectionTab =
  | 'ledger'
  | 'structures'
  | 'adjustments'
  | 'refunds';

interface FinanceViewProps {
  data: DashboardPayload;
  isAdmin: boolean;
  onDashboardUpdate?: (dashboard: DashboardPayload) => void;
  onCreateInvoice?: (payload: {
    studentId: string;
    courseId: string;
    feeStructureId?: string | null;
    description: string;
    amountDue: string;
    dueDate: string;
  }) => Promise<void>;
  onRecordPayment?: (
    invoiceId: string,
    payload: {
      amount: string;
      method: PaymentMethod;
      referenceCode: string;
      notes: string;
    }
  ) => Promise<void>;
  onVoidInvoice?: (invoiceId: string) => Promise<void>;
}

export function FinanceView({
  data,
  isAdmin,
  onDashboardUpdate,
  onCreateInvoice,
  onRecordPayment,
  onVoidInvoice,
}: FinanceViewProps) {
  const currency = data.academy?.currency || 'INR';
  const [sectionTab, setSectionTab] = useState<FinanceSectionTab>('ledger');
  const [statusFilter, setStatusFilter] = useState<
    'All' | 'Unpaid' | 'Partial' | 'Paid' | 'Voided'
  >('All');

  const [notice, setNotice] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  // Issue Invoice modal state
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [studentId, setStudentId] = useState(data.students[0]?.id ?? '');
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const [selectedFeeStructureId, setSelectedFeeStructureId] = useState('');
  const [description, setDescription] = useState('');
  const [amountDue, setAmountDue] = useState('1200.00');
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [invError, setInvError] = useState('');
  const [invSaving, setInvSaving] = useState(false);

  // Payment modal state
  const [payTarget, setPayTarget] = useState<FeeInvoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Card');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // Printable Receipt & Printable Invoice modals
  const [receiptPreview, setReceiptPreview] = useState<PaymentReceipt | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<InvoiceDetailPayload | null>(null);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);

  // Apply Adjustment modal (Discount / Scholarship onto Invoice)
  const [adjTarget, setAdjTarget] = useState<FeeInvoice | null>(null);
  const [adjKind, setAdjKind] = useState<'discount' | 'scholarship'>('discount');
  const [adjTargetId, setAdjTargetId] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);

  // Issue Refund modal
  const [refundTarget, setRefundTarget] = useState<PaymentReceipt | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);

  // Fee Plan creation modal
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planCode, setPlanCode] = useState('');
  const [planName, setPlanName] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planInstallments, setPlanInstallments] = useState('1');
  const [planError, setPlanError] = useState('');
  const [planSaving, setPlanSaving] = useState(false);

  // Fee Structure creation modal
  const [structModalOpen, setStructModalOpen] = useState(false);
  const [structCourseId, setStructCourseId] = useState(data.courses[0]?.id ?? '');
  const [structFeePlanId, setStructFeePlanId] = useState('');
  const [structTuition, setStructTuition] = useState('15000.00');
  const [structRegFee, setStructRegFee] = useState('1000.00');
  const [structLabFee, setStructLabFee] = useState('1500.00');
  const [structError, setStructError] = useState('');
  const [structSaving, setStructSaving] = useState(false);

  // Discount creation modal
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [dscCode, setDscCode] = useState('');
  const [dscName, setDscName] = useState('');
  const [dscType, setDscType] = useState<'Percentage' | 'Fixed'>('Percentage');
  const [dscValue, setDscValue] = useState('10.00');
  const [dscValidTo, setDscValidTo] = useState('');
  const [dscError, setDscError] = useState('');
  const [dscSaving, setDscSaving] = useState(false);

  // Scholarship creation modal
  const [scholarshipModalOpen, setScholarshipModalOpen] = useState(false);
  const [schCode, setSchCode] = useState('');
  const [schName, setSchName] = useState('');
  const [schSponsor, setSchSponsor] = useState('');
  const [schType, setSchType] = useState<'Percentage' | 'Fixed'>('Percentage');
  const [schValue, setSchValue] = useState('25.00');
  const [schMaxRecipients, setSchMaxRecipients] = useState('15');
  const [schError, setSchError] = useState('');
  const [schSaving, setSchSaving] = useState(false);

  const feePlans = data.feePlans ?? [];
  const feeStructures = data.feeStructures ?? [];
  const discounts = data.discounts ?? [];
  const scholarships = data.scholarships ?? [];
  const refunds = data.refunds ?? [];

  const activeDiscounts = useMemo(
    () => discounts.filter((d) => d.isActive),
    [discounts]
  );
  const activeScholarships = useMemo(
    () => scholarships.filter((s) => s.isActive),
    [scholarships]
  );

  const courseFeeStructures = useMemo(
    () =>
      feeStructures.filter((fs) => fs.isActive && fs.courseId === courseId),
    [feeStructures, courseId]
  );

  const visibleInvoices = useMemo(() => {
    return data.invoices.filter((inv) => {
      if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
      return true;
    });
  }, [data.invoices, statusFilter]);

  const totals = useMemo(() => {
    const active = data.invoices.filter((i) => i.status !== 'Voided' && !i.isArchived);
    const billed = active.reduce((s, i) => s + toCents(i.amountDue), 0);
    const paid = active.reduce((s, i) => s + toCents(i.amountPaid), 0);
    const refunded = refunds
      .filter((r) => r.status !== 'Cancelled')
      .reduce((s, r) => s + toCents(r.amount), 0);
    return {
      billed,
      paid,
      outstanding: Math.max(0, billed - paid),
      refunded,
    };
  }, [data.invoices, refunds]);

  async function openInvoiceDetailModal(inv: FeeInvoice) {
    setErrorBanner('');
    setInvoicePreviewLoading(true);
    try {
      const detail = await api.getInvoiceDetail(inv.id);
      setInvoicePreview(detail);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to load invoice breakdown.'
      );
    } finally {
      setInvoicePreviewLoading(false);
    }
  }

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!onCreateInvoice) return;
    setInvError('');
    setInvSaving(true);
    try {
      await onCreateInvoice({
        studentId,
        courseId,
        feeStructureId: selectedFeeStructureId || null,
        description: description.trim(),
        amountDue: amountDue.trim(),
        dueDate: new Date(dueDate).toISOString(),
      });
      setInvoiceModalOpen(false);
      setDescription('');
      setSelectedFeeStructureId('');
      setNotice('Tuition invoice issued and student notified.');
    } catch (err) {
      setInvError(err instanceof Error ? err.message : 'Unable to issue invoice.');
    } finally {
      setInvSaving(false);
    }
  }

  function openPaymentModal(inv: FeeInvoice) {
    const remaining = Math.max(0, toCents(inv.amountDue) - toCents(inv.amountPaid));
    setPayTarget(inv);
    setPayAmount(fromCents(remaining));
    setPayRef(`TXN-${Math.floor(100000 + Math.random() * 899999)}`);
    setPayNotes('');
    setPayError('');
  }

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onRecordPayment || !payTarget) return;
    setPayError('');
    setPaySaving(true);
    try {
      await onRecordPayment(payTarget.id, {
        amount: payAmount.trim(),
        method: payMethod,
        referenceCode: payRef.trim(),
        notes: payNotes.trim(),
      });
      setPayTarget(null);
      setNotice('Payment recorded and official receipt generated.');
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setPaySaving(false);
    }
  }

  function openAdjustmentModal(inv: FeeInvoice) {
    setAdjTarget(inv);
    const defaultKind: 'discount' | 'scholarship' =
      activeDiscounts.length > 0 ? 'discount' : 'scholarship';
    setAdjKind(defaultKind);
    setAdjTargetId(
      defaultKind === 'discount'
        ? activeDiscounts[0]?.id ?? ''
        : activeScholarships[0]?.id ?? ''
    );
    setAdjNotes('');
    setAdjError('');
  }

  async function handleAdjustmentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!adjTarget || !adjTargetId) {
      setAdjError('Please select an active discount or scholarship.');
      return;
    }
    setAdjError('');
    setAdjSaving(true);
    try {
      const res = await api.applyInvoiceAdjustment(adjTarget.id, {
        kind: adjKind,
        targetId: adjTargetId,
        notes: adjNotes.trim(),
      });
      onDashboardUpdate?.(res.dashboard);
      setAdjTarget(null);
      setNotice(
        `Applied ${adjKind} adjustment (-${formatCents(res.adjustmentCents, currency)}) to ${adjTarget.invoiceNumber}.`
      );
    } catch (err) {
      setAdjError(
        err instanceof Error ? err.message : 'Failed to apply invoice adjustment.'
      );
    } finally {
      setAdjSaving(false);
    }
  }

  function openRefundModal(p: PaymentReceipt) {
    const refundable = Math.max(
      0,
      toCents(p.amount) - toCents(p.refundedAmount ?? '0.00')
    );
    setRefundTarget(p);
    setRefundAmount(fromCents(refundable));
    setRefundReason('');
    setRefundError('');
  }

  async function handleRefundSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!refundTarget) return;
    setRefundError('');
    setRefundSaving(true);
    try {
      const res = await api.refundPayment(refundTarget.id, {
        amount: refundAmount.trim(),
        reason: refundReason.trim(),
      });
      onDashboardUpdate?.(res.dashboard);
      setRefundTarget(null);
      setNotice(
        `Processed refund ${res.refundNumber} against receipt ${refundTarget.receiptNumber}.`
      );
    } catch (err) {
      setRefundError(
        err instanceof Error ? err.message : 'Failed to process refund.'
      );
    } finally {
      setRefundSaving(false);
    }
  }

  async function handleVoid(inv: FeeInvoice) {
    if (!onVoidInvoice) return;
    setNotice('');
    setErrorBanner('');
    try {
      await onVoidInvoice(inv.id);
      setNotice(`Invoice ${inv.invoiceNumber} voided.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Cannot void invoice.');
    }
  }

  async function handleCreateFeePlan(e: React.FormEvent) {
    e.preventDefault();
    setPlanError('');
    setPlanSaving(true);
    try {
      const res = await api.createFeePlan({
        code: planCode.trim(),
        name: planName.trim(),
        description: planDescription.trim(),
        installmentCount: Number(planInstallments) || 1,
      });
      onDashboardUpdate?.(res.dashboard);
      setPlanModalOpen(false);
      setPlanCode('');
      setPlanName('');
      setPlanDescription('');
      setPlanInstallments('1');
      setNotice('Fee plan created.');
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Failed to create fee plan.');
    } finally {
      setPlanSaving(false);
    }
  }

  async function handleToggleFeePlan(id: string, currentActive: boolean) {
    setErrorBanner('');
    try {
      const res = await api.updateFeePlan(id, { isActive: !currentActive });
      onDashboardUpdate?.(res.dashboard);
      setNotice(`Fee plan ${!currentActive ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update fee plan.');
    }
  }

  async function handleCreateFeeStructure(e: React.FormEvent) {
    e.preventDefault();
    setStructError('');
    setStructSaving(true);
    try {
      const res = await api.createFeeStructure({
        courseId: structCourseId,
        feePlanId: structFeePlanId || null,
        tuitionAmount: structTuition.trim(),
        registrationFee: structRegFee.trim() || '0.00',
        labFee: structLabFee.trim() || '0.00',
      });
      onDashboardUpdate?.(res.dashboard);
      setStructModalOpen(false);
      setNotice('Course fee structure saved.');
    } catch (err) {
      setStructError(
        err instanceof Error ? err.message : 'Failed to create fee structure.'
      );
    } finally {
      setStructSaving(false);
    }
  }

  async function handleToggleFeeStructure(id: string, currentActive: boolean) {
    setErrorBanner('');
    try {
      const res = await api.updateFeeStructure(id, { isActive: !currentActive });
      onDashboardUpdate?.(res.dashboard);
      setNotice(`Fee structure ${!currentActive ? 'activated' : 'archived'}.`);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to update fee structure.'
      );
    }
  }

  async function handleCreateDiscount(e: React.FormEvent) {
    e.preventDefault();
    setDscError('');
    setDscSaving(true);
    try {
      const res = await api.createDiscount({
        code: dscCode.trim(),
        name: dscName.trim(),
        discountType: dscType,
        value: dscValue.trim(),
        validTo: dscValidTo ? new Date(dscValidTo).toISOString() : null,
      });
      onDashboardUpdate?.(res.dashboard);
      setDiscountModalOpen(false);
      setDscCode('');
      setDscName('');
      setDscValue('10.00');
      setDscValidTo('');
      setNotice('Fee discount created.');
    } catch (err) {
      setDscError(err instanceof Error ? err.message : 'Failed to create discount.');
    } finally {
      setDscSaving(false);
    }
  }

  async function handleToggleDiscount(id: string, currentActive: boolean) {
    setErrorBanner('');
    try {
      const res = await api.updateDiscount(id, { isActive: !currentActive });
      onDashboardUpdate?.(res.dashboard);
      setNotice(`Discount ${!currentActive ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update discount.');
    }
  }

  async function handleCreateScholarship(e: React.FormEvent) {
    e.preventDefault();
    setSchError('');
    setSchSaving(true);
    try {
      const res = await api.createScholarship({
        code: schCode.trim(),
        name: schName.trim(),
        sponsorName: schSponsor.trim(),
        coverageType: schType,
        coverageValue: schValue.trim(),
        maxRecipients: Number(schMaxRecipients) || 10,
      });
      onDashboardUpdate?.(res.dashboard);
      setScholarshipModalOpen(false);
      setSchCode('');
      setSchName('');
      setSchSponsor('');
      setSchValue('25.00');
      setNotice('Scholarship program created.');
    } catch (err) {
      setSchError(
        err instanceof Error ? err.message : 'Failed to create scholarship.'
      );
    } finally {
      setSchSaving(false);
    }
  }

  async function handleToggleScholarship(id: string, currentActive: boolean) {
    setErrorBanner('');
    try {
      const res = await api.updateScholarship(id, { isActive: !currentActive });
      onDashboardUpdate?.(res.dashboard);
      setNotice(`Scholarship ${!currentActive ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to update scholarship.'
      );
    }
  }

  const isPrintModalOpen = Boolean(invoicePreview || receiptPreview);

  return (
    <div className="space-y-6">
      {/* Main Interactive Workspace (hidden on print when a receipt/invoice modal is open) */}
      <div className={isPrintModalOpen ? 'no-print space-y-6' : 'space-y-6'}>
        {/* Financial Summary Strip */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">
              {isAdmin ? 'Total Net Billed' : 'Total Tuition Billed'}
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCents(totals.billed, currency)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">
              {isAdmin ? 'Net Collected' : 'Total Paid'}
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {formatCents(totals.paid, currency)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Outstanding Balance</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCents(totals.outstanding, currency)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Processed Refunds</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
              {formatCents(totals.refunded, currency)}
            </div>
          </div>
        </section>

        {/* Sub-Navigation Tabs */}
        <div className="no-print bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            <button
              type="button"
              onClick={() => setSectionTab('ledger')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                sectionTab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Invoices & Receipts
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setSectionTab('structures')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    sectionTab === 'structures'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Fee Plans & Structures
                </button>
                <button
                  type="button"
                  onClick={() => setSectionTab('adjustments')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    sectionTab === 'adjustments'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Discounts & Scholarships
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setSectionTab('refunds')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                sectionTab === 'refunds'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Refunds ({refunds.length})
            </button>
          </div>

          {isAdmin && sectionTab === 'ledger' && (
            <button
              type="button"
              onClick={() => {
                const selectedCourse = data.courses.find((c) => c.id === courseId);
                if (selectedCourse) {
                  setAmountDue(selectedCourse.tuitionFee);
                  setDescription(`${selectedCourse.code} ${selectedCourse.title} Tuition`);
                }
                setSelectedFeeStructureId('');
                setInvError('');
                setInvoiceModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Issue Fee Invoice</span>
            </button>
          )}
        </div>

        {notice && (
          <div
            role="status"
            className="no-print flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="no-print flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}

        {/* TAB 1: INVOICES & RECEIPTS */}
        {sectionTab === 'ledger' && (
          <>
            <div className="no-print flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                {(['All', 'Unpaid', 'Partial', 'Paid', 'Voided'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                      statusFilter === tab
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {invoicePreviewLoading && (
                <span className="text-xs text-slate-500">Loading invoice document...</span>
              )}
            </div>

            {/* Invoices Table */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Fee Invoices Ledger
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {visibleInvoices.length} invoices
                </span>
              </div>

              {visibleInvoices.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No invoices found for the selected filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Invoice & Description</th>
                        {isAdmin && <th className="py-2.5 px-4">Student</th>}
                        <th className="py-2.5 px-4 text-right">Net Due</th>
                        <th className="py-2.5 px-4 text-right">Paid</th>
                        <th className="py-2.5 px-4">Due Date</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {visibleInvoices.map((inv) => {
                        const student = data.students.find((s) => s.id === inv.studentId);
                        const remaining = toCents(inv.amountDue) - toCents(inv.amountPaid);
                        const discountCents = toCents(inv.discountTotal ?? '0.00');
                        const scholarshipCents = toCents(inv.scholarshipTotal ?? '0.00');
                        const invCurrency = inv.currency || currency;
                        return (
                          <tr key={inv.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-5">
                              <div className="font-mono text-xs font-semibold text-blue-700">
                                {inv.invoiceNumber}
                              </div>
                              <div className="text-xs text-slate-700 mt-0.5">
                                {inv.description}
                              </div>
                              {(discountCents > 0 || scholarshipCents > 0) && (
                                <div className="text-[11px] text-emerald-700 font-mono tabular-nums mt-0.5">
                                  {discountCents > 0
                                    ? `Discount -${formatCents(discountCents, invCurrency)}`
                                    : ''}
                                  {discountCents > 0 && scholarshipCents > 0 ? ' · ' : ''}
                                  {scholarshipCents > 0
                                    ? `Scholarship -${formatCents(scholarshipCents, invCurrency)}`
                                    : ''}
                                </div>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="py-3 px-4 text-xs">
                                <div className="font-medium text-slate-900">
                                  {student?.name ?? inv.studentId}
                                </div>
                                <div className="font-mono text-slate-500">
                                  {student?.studentCode}
                                </div>
                              </td>
                            )}
                            <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                              {formatMoney(inv.amountDue, invCurrency)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs text-emerald-700 tabular-nums">
                              {formatMoney(inv.amountPaid, invCurrency)}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {new Date(inv.dueDate).toLocaleDateString('en-IN')}
                            </td>
                            <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                              <span
                                className={
                                  inv.status === 'Paid'
                                    ? 'text-emerald-700'
                                    : inv.status === 'Partial'
                                      ? 'text-amber-700'
                                      : inv.status === 'Voided'
                                        ? 'text-slate-400'
                                        : 'text-red-700'
                                }
                              >
                                {inv.status}
                              </span>
                            </td>
                            <td className="py-3 px-5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openInvoiceDetailModal(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>View Invoice</span>
                                </button>
                                {isAdmin && remaining > 0 && inv.status !== 'Voided' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openPaymentModal(inv)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
                                    >
                                      <CreditCard className="w-3.5 h-3.5" />
                                      <span>Record Payment</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openAdjustmentModal(inv)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer whitespace-nowrap"
                                    >
                                      <BadgePercent className="w-3.5 h-3.5" />
                                      <span>Apply Adjustment</span>
                                    </button>
                                  </>
                                )}
                                {isAdmin &&
                                  toCents(inv.amountPaid) === 0 &&
                                  inv.status !== 'Voided' && (
                                    <button
                                      type="button"
                                      onClick={() => handleVoid(inv)}
                                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                                    >
                                      Void
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Payment Receipts History */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Official Payment Receipts
                  </h2>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {data.payments.length} receipts
                </span>
              </div>

              {data.payments.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No payment receipts recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Receipt #</th>
                        {isAdmin && <th className="py-2.5 px-4">Student</th>}
                        <th className="py-2.5 px-4">Method & Reference</th>
                        <th className="py-2.5 px-4">Paid At</th>
                        <th className="py-2.5 px-4 text-right">Amount</th>
                        <th className="py-2.5 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {data.payments.map((p) => {
                        const student = data.students.find((s) => s.id === p.studentId);
                        const refundedCents = toCents(p.refundedAmount ?? '0.00');
                        const refundableCents = Math.max(
                          0,
                          toCents(p.amount) - refundedCents
                        );
                        return (
                          <tr key={p.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900">
                              {p.receiptNumber}
                            </td>
                            {isAdmin && (
                              <td className="py-3 px-4 text-xs text-slate-700">
                                {student?.name ?? p.studentId}
                              </td>
                            )}
                            <td className="py-3 px-4 text-xs text-slate-600">
                              {p.method}
                              {p.referenceCode ? ` · ${p.referenceCode}` : ''}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                              {new Date(p.paidAt).toLocaleDateString('en-IN')}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                              <div>{formatMoney(p.amount, currency)}</div>
                              {refundedCents > 0 && (
                                <div className="text-[11px] font-normal text-amber-700">
                                  Refunded {formatCents(refundedCents, currency)}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setReceiptPreview(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer whitespace-nowrap"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span>View Receipt</span>
                                </button>
                                {isAdmin && refundableCents > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openRefundModal(p)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md cursor-pointer whitespace-nowrap"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Issue Refund</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB 2: FEE PLANS & STRUCTURES (ADMIN) */}
        {sectionTab === 'structures' && isAdmin && (
          <div className="space-y-6">
            {/* Fee Plans */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Installment Fee Plans
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPlanError('');
                    setPlanModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Fee Plan</span>
                </button>
              </div>
              {feePlans.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No fee plans configured yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Code</th>
                        <th className="py-2.5 px-4">Plan Name & Description</th>
                        <th className="py-2.5 px-4 text-right">Installments</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {feePlans.map((fp) => (
                        <tr key={fp.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900">
                            {fp.code}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="font-medium text-slate-900">{fp.name}</div>
                            {fp.description && (
                              <div className="text-slate-500 mt-0.5">{fp.description}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                            {fp.installmentCount}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium">
                            <span
                              className={fp.isActive ? 'text-emerald-700' : 'text-slate-500'}
                            >
                              {fp.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleFeePlan(fp.id, fp.isActive)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              {fp.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Course Fee Structures */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Itemized Course Fee Structures
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    const defaultCourse = data.courses.find((c) => c.id === structCourseId) ?? data.courses[0];
                    if (defaultCourse) {
                      setStructCourseId(defaultCourse.id);
                      setStructTuition(defaultCourse.tuitionFee);
                    }
                    setStructError('');
                    setStructModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Fee Structure</span>
                </button>
              </div>
              {feeStructures.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No itemized fee structures configured yet. Create one to auto-itemize Tuition, Registration, and Lab fees on new invoices.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Course & Plan</th>
                        <th className="py-2.5 px-4 text-right">Tuition</th>
                        <th className="py-2.5 px-4 text-right">Registration</th>
                        <th className="py-2.5 px-4 text-right">Lab Fee</th>
                        <th className="py-2.5 px-4 text-right">Total</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {feeStructures.map((fs) => (
                        <tr key={fs.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-5 text-xs">
                            <div className="font-medium text-slate-900">
                              {fs.courseCode} · {fs.courseTitle}
                            </div>
                            <div className="text-slate-500 mt-0.5">
                              {fs.feePlanName ? `Plan: ${fs.feePlanName}` : 'Standard Direct'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                            {formatMoney(fs.tuitionAmount, currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {formatMoney(fs.registrationFee, currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {formatMoney(fs.labFee, currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                            {formatMoney(fs.totalAmount, currency)}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium">
                            <span
                              className={fs.isActive ? 'text-emerald-700' : 'text-slate-500'}
                            >
                              {fs.isActive ? 'Active' : 'Archived'}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleFeeStructure(fs.id, fs.isActive)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              {fs.isActive ? 'Archive' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 3: DISCOUNTS & SCHOLARSHIPS (ADMIN) */}
        {sectionTab === 'adjustments' && isAdmin && (
          <div className="space-y-6">
            {/* Discounts */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <BadgePercent className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Fee Discounts & Concessions
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDscError('');
                    setDiscountModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Discount</span>
                </button>
              </div>
              {discounts.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No fee discounts configured yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Code</th>
                        <th className="py-2.5 px-4">Discount Name</th>
                        <th className="py-2.5 px-4">Type</th>
                        <th className="py-2.5 px-4 text-right">Value</th>
                        <th className="py-2.5 px-4">Valid Until</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {discounts.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900">
                            {d.code}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium text-slate-900">
                            {d.name}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {d.discountType}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                            {d.discountType === 'Percentage'
                              ? `${d.value}%`
                              : formatMoney(d.value, currency)}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {d.validTo
                              ? new Date(d.validTo).toLocaleDateString('en-IN')
                              : 'No expiry'}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium">
                            <span
                              className={d.isActive ? 'text-emerald-700' : 'text-slate-500'}
                            >
                              {d.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleDiscount(d.id, d.isActive)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              {d.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Scholarships */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-blue-700" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Scholarships & Merit Grants
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSchError('');
                    setScholarshipModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Scholarship</span>
                </button>
              </div>
              {scholarships.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No scholarship programs configured yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-5">Code</th>
                        <th className="py-2.5 px-4">Program & Sponsor</th>
                        <th className="py-2.5 px-4">Coverage</th>
                        <th className="py-2.5 px-4 text-right">Seat Cap</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {scholarships.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900">
                            {s.code}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="font-medium text-slate-900">{s.name}</div>
                            {s.sponsorName && (
                              <div className="text-slate-500 mt-0.5">
                                Sponsor: {s.sponsorName}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-blue-700 tabular-nums">
                            {s.coverageType === 'Percentage'
                              ? `${s.coverageValue}%`
                              : formatMoney(s.coverageValue, currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {s.maxRecipients}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium">
                            <span
                              className={s.isActive ? 'text-emerald-700' : 'text-slate-500'}
                            >
                              {s.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleScholarship(s.id, s.isActive)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              {s.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: REFUNDS LEDGER */}
        {sectionTab === 'refunds' && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-700" />
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Processed Payment Refunds
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {refunds.length} refunds
              </span>
            </div>
            {refunds.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No payment refunds have been issued.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-5">Refund #</th>
                      <th className="py-2.5 px-4">Receipt / Invoice</th>
                      {isAdmin && <th className="py-2.5 px-4">Student</th>}
                      <th className="py-2.5 px-4">Reason</th>
                      <th className="py-2.5 px-4">Processed At</th>
                      <th className="py-2.5 px-5 text-right">Refund Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {refunds.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-5 font-mono text-xs font-semibold text-amber-800">
                          {r.refundNumber}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">
                          {r.receiptNumber || r.paymentId} · {r.invoiceNumber || r.invoiceId}
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-4 text-xs text-slate-800">
                            {r.studentName || r.studentId}
                          </td>
                        )}
                        <td className="py-3 px-4 text-xs text-slate-600">{r.reason}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                          {new Date(r.processedAt).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-3 px-5 text-right font-mono text-xs font-semibold text-amber-800 tabular-nums">
                          {formatMoney(r.amount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Issue Invoice Modal */}
      {invoiceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-invoice-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="issue-invoice-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Issue Tuition Invoice
              </h3>
              <button
                type="button"
                aria-label="Close issue invoice modal"
                onClick={() => setInvoiceModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {invError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{invError}</span>
              </div>
            )}
            <form onSubmit={handleCreateInvoice} className="mt-4 space-y-3.5">
              <div>
                <label
                  htmlFor="inv-student"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Student
                </label>
                <select
                  id="inv-student"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.studentCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="inv-course"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Course
                </label>
                <select
                  id="inv-course"
                  value={courseId}
                  onChange={(e) => {
                    const cId = e.target.value;
                    setCourseId(cId);
                    setSelectedFeeStructureId('');
                    const c = data.courses.find((cr) => cr.id === cId);
                    if (c) {
                      setAmountDue(c.tuitionFee);
                      setDescription(`${c.code} ${c.title} Tuition`);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>
              {courseFeeStructures.length > 0 && (
                <div>
                  <label
                    htmlFor="inv-fee-structure"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Fee Structure Template (optional)
                  </label>
                  <select
                    id="inv-fee-structure"
                    value={selectedFeeStructureId}
                    onChange={(e) => {
                      const fsId = e.target.value;
                      setSelectedFeeStructureId(fsId);
                      const fs = courseFeeStructures.find((item) => item.id === fsId);
                      if (fs) {
                        setAmountDue(fs.totalAmount);
                      } else {
                        const c = data.courses.find((cr) => cr.id === courseId);
                        if (c) setAmountDue(c.tuitionFee);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="">Custom / Course Base Tuition</option>
                    {courseFeeStructures.map((fs) => (
                      <option key={fs.id} value={fs.id}>
                        {fs.feePlanName || 'Standard'} — Total{' '}
                        {formatMoney(fs.totalAmount, currency)} (T:{' '}
                        {formatMoney(fs.tuitionAmount, currency)} + Reg:{' '}
                        {formatMoney(fs.registrationFee, currency)} + Lab:{' '}
                        {formatMoney(fs.labFee, currency)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label
                  htmlFor="inv-desc"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Description
                </label>
                <input
                  id="inv-desc"
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="inv-amount"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Amount Due ({currency})
                  </label>
                  <input
                    id="inv-amount"
                    type="text"
                    required
                    readOnly={Boolean(selectedFeeStructureId)}
                    value={amountDue}
                    onChange={(e) => setAmountDue(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg read-only:bg-slate-50"
                  />
                </div>
                <div>
                  <label
                    htmlFor="inv-due-date"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Due Date
                  </label>
                  <input
                    id="inv-due-date"
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInvoiceModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={invSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {invSaving ? 'Issuing...' : 'Issue Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-payment-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="record-payment-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Record Tuition Payment
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {payTarget.invoiceNumber} · Balance:{' '}
                  {formatCents(
                    toCents(payTarget.amountDue) - toCents(payTarget.amountPaid),
                    payTarget.currency || currency
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close record payment modal"
                onClick={() => setPayTarget(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {payError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{payError}</span>
              </div>
            )}
            <form onSubmit={handlePaymentSubmit} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="pay-amount"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Payment Amount ({payTarget.currency || currency})
                  </label>
                  <input
                    id="pay-amount"
                    type="text"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pay-method"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Method
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Corporate Sponsorship">Corporate Sponsorship</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="pay-ref"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Transaction Reference
                </label>
                <input
                  id="pay-ref"
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="pay-notes"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Notes
                </label>
                <input
                  id="pay-notes"
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paySaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {paySaving ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Apply Discount / Scholarship Modal */}
      {adjTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-adjustment-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="apply-adjustment-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Apply Fee Adjustment
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {adjTarget.invoiceNumber} · Payable:{' '}
                  {formatCents(
                    toCents(adjTarget.amountDue) - toCents(adjTarget.amountPaid),
                    adjTarget.currency || currency
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close fee adjustment modal"
                onClick={() => setAdjTarget(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {adjError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{adjError}</span>
              </div>
            )}
            <form onSubmit={handleAdjustmentSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Adjustment Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjKind('discount');
                      setAdjTargetId(activeDiscounts[0]?.id ?? '');
                    }}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border cursor-pointer ${
                      adjKind === 'discount'
                        ? 'bg-blue-50 border-blue-600 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Discount ({activeDiscounts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjKind('scholarship');
                      setAdjTargetId(activeScholarships[0]?.id ?? '');
                    }}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border cursor-pointer ${
                      adjKind === 'scholarship'
                        ? 'bg-blue-50 border-blue-600 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Scholarship ({activeScholarships.length})
                  </button>
                </div>
              </div>
              <div>
                <label
                  htmlFor="adj-select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {adjKind === 'discount' ? 'Select Active Discount' : 'Select Active Scholarship'}
                </label>
                <select
                  id="adj-select"
                  value={adjTargetId}
                  onChange={(e) => setAdjTargetId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {adjKind === 'discount' ? (
                    activeDiscounts.length === 0 ? (
                      <option value="">No active discounts configured</option>
                    ) : (
                      activeDiscounts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name} (
                          {d.discountType === 'Percentage'
                            ? `${d.value}%`
                            : formatMoney(d.value, currency)}
                          )
                        </option>
                      ))
                    )
                  ) : activeScholarships.length === 0 ? (
                    <option value="">No active scholarships configured</option>
                  ) : (
                    activeScholarships.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name} (
                        {s.coverageType === 'Percentage'
                          ? `${s.coverageValue}%`
                          : formatMoney(s.coverageValue, currency)}
                        )
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label
                  htmlFor="adj-notes"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Authorization Remarks
                </label>
                <input
                  id="adj-notes"
                  type="text"
                  placeholder="Optional approval note"
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjSaving || !adjTargetId}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {adjSaving ? 'Applying...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Refund Modal */}
      {refundTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-refund-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="issue-refund-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Issue Payment Refund
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {refundTarget.receiptNumber} · Refundable:{' '}
                  {formatCents(
                    Math.max(
                      0,
                      toCents(refundTarget.amount) -
                        toCents(refundTarget.refundedAmount ?? '0.00')
                    ),
                    currency
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close issue refund modal"
                onClick={() => setRefundTarget(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {refundError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{refundError}</span>
              </div>
            )}
            <form onSubmit={handleRefundSubmit} className="mt-4 space-y-3.5">
              <div>
                <label
                  htmlFor="refund-amount"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Refund Amount ({currency})
                </label>
                <input
                  id="refund-amount"
                  type="text"
                  required
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="refund-reason"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Refund Reason
                </label>
                <input
                  id="refund-reason"
                  type="text"
                  required
                  minLength={4}
                  placeholder="e.g., Course withdrawal within refund window"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRefundTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refundSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer"
                >
                  {refundSaving ? 'Processing...' : 'Confirm Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Fee Plan Modal */}
      {planModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-fee-plan-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="add-fee-plan-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Installment Fee Plan
              </h3>
              <button
                type="button"
                aria-label="Close fee plan modal"
                onClick={() => setPlanModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {planError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{planError}</span>
              </div>
            )}
            <form onSubmit={handleCreateFeePlan} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="plan-code"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Code
                  </label>
                  <input
                    id="plan-code"
                    type="text"
                    required
                    placeholder="FP-3TERM"
                    value={planCode}
                    onChange={(e) => setPlanCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="plan-installments"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Installments
                  </label>
                  <input
                    id="plan-installments"
                    type="number"
                    min={1}
                    max={24}
                    required
                    value={planInstallments}
                    onChange={(e) => setPlanInstallments(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="plan-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Plan Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  required
                  placeholder="3-Installment Monthly Plan"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="plan-desc"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Description
                </label>
                <input
                  id="plan-desc"
                  type="text"
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={planSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {planSaving ? 'Saving...' : 'Create Fee Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Fee Structure Modal */}
      {structModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-fee-structure-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="add-fee-structure-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Course Fee Structure
              </h3>
              <button
                type="button"
                aria-label="Close fee structure modal"
                onClick={() => setStructModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {structError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{structError}</span>
              </div>
            )}
            <form onSubmit={handleCreateFeeStructure} className="mt-4 space-y-3.5">
              <div>
                <label
                  htmlFor="struct-course"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Course
                </label>
                <select
                  id="struct-course"
                  value={structCourseId}
                  onChange={(e) => setStructCourseId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="struct-plan"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Associated Fee Plan (optional)
                </label>
                <select
                  id="struct-plan"
                  value={structFeePlanId}
                  onChange={(e) => setStructFeePlanId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="">None (Standard Direct)</option>
                  {feePlans
                    .filter((fp) => fp.isActive)
                    .map((fp) => (
                      <option key={fp.id} value={fp.id}>
                        {fp.code} — {fp.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label
                    htmlFor="struct-tuition"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Tuition ({currency})
                  </label>
                  <input
                    id="struct-tuition"
                    type="text"
                    required
                    value={structTuition}
                    onChange={(e) => setStructTuition(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="struct-reg"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Reg Fee
                  </label>
                  <input
                    id="struct-reg"
                    type="text"
                    required
                    value={structRegFee}
                    onChange={(e) => setStructRegFee(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="struct-lab"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Lab Fee
                  </label>
                  <input
                    id="struct-lab"
                    type="text"
                    required
                    value={structLabFee}
                    onChange={(e) => setStructLabFee(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStructModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={structSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {structSaving ? 'Saving...' : 'Save Fee Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Discount Modal */}
      {discountModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-discount-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="add-discount-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Fee Discount
              </h3>
              <button
                type="button"
                aria-label="Close discount modal"
                onClick={() => setDiscountModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {dscError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{dscError}</span>
              </div>
            )}
            <form onSubmit={handleCreateDiscount} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="dsc-code"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Code
                  </label>
                  <input
                    id="dsc-code"
                    type="text"
                    required
                    placeholder="EARLY10"
                    value={dscCode}
                    onChange={(e) => setDscCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="dsc-type"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Type
                  </label>
                  <select
                    id="dsc-type"
                    value={dscType}
                    onChange={(e) =>
                      setDscType(e.target.value as 'Percentage' | 'Fixed')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="Percentage">Percentage (%)</option>
                    <option value="Fixed">Fixed ({currency})</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="dsc-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Discount Name
                </label>
                <input
                  id="dsc-name"
                  type="text"
                  required
                  placeholder="Early Admission Concession"
                  value={dscName}
                  onChange={(e) => setDscName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="dsc-value"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Value ({dscType === 'Percentage' ? '%' : currency})
                  </label>
                  <input
                    id="dsc-value"
                    type="text"
                    required
                    value={dscValue}
                    onChange={(e) => setDscValue(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="dsc-valid-to"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Valid Until (optional)
                  </label>
                  <input
                    id="dsc-valid-to"
                    type="date"
                    value={dscValidTo}
                    onChange={(e) => setDscValidTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDiscountModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dscSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {dscSaving ? 'Saving...' : 'Create Discount'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Scholarship Modal */}
      {scholarshipModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-scholarship-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="add-scholarship-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Create Scholarship Program
              </h3>
              <button
                type="button"
                aria-label="Close scholarship modal"
                onClick={() => setScholarshipModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {schError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{schError}</span>
              </div>
            )}
            <form onSubmit={handleCreateScholarship} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sch-code"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Code
                  </label>
                  <input
                    id="sch-code"
                    type="text"
                    required
                    placeholder="MERIT25"
                    value={schCode}
                    onChange={(e) => setSchCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sch-type"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Coverage Type
                  </label>
                  <select
                    id="sch-type"
                    value={schType}
                    onChange={(e) =>
                      setSchType(e.target.value as 'Percentage' | 'Fixed')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="Percentage">Percentage (%)</option>
                    <option value="Fixed">Fixed ({currency})</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="sch-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Scholarship Name
                </label>
                <input
                  id="sch-name"
                  type="text"
                  required
                  placeholder="Sopore Merit Grant"
                  value={schName}
                  onChange={(e) => setSchName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="sch-sponsor"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Sponsor Name (optional)
                </label>
                <input
                  id="sch-sponsor"
                  type="text"
                  placeholder="IGS Academic Trust"
                  value={schSponsor}
                  onChange={(e) => setSchSponsor(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sch-value"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Coverage ({schType === 'Percentage' ? '%' : currency})
                  </label>
                  <input
                    id="sch-value"
                    type="text"
                    required
                    value={schValue}
                    onChange={(e) => setSchValue(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sch-cap"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Max Recipients
                  </label>
                  <input
                    id="sch-cap"
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={schMaxRecipients}
                    onChange={(e) => setSchMaxRecipients(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setScholarshipModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={schSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {schSaving ? 'Saving...' : 'Create Scholarship'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Official INR Invoice Modal */}
      {invoicePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="printable-invoice-title"
        >
          <div className="print-surface w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-lg space-y-5 my-auto">
            {/* Official Letterhead */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="flex items-start gap-3">
                {invoicePreview.academy.logoDataUrl && (
                  <img
                    src={invoicePreview.academy.logoDataUrl}
                    alt={`${invoicePreview.academy.name} logo`}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 object-contain border border-slate-200 rounded-lg p-1 bg-white shrink-0"
                  />
                )}
                <div>
                  <p className="text-xs font-semibold text-blue-700">
                    {invoicePreview.academy.name} · Official Fee Invoice
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {invoicePreview.academy.address}
                  </p>
                  {(invoicePreview.academy.email ||
                    invoicePreview.academy.phone ||
                    invoicePreview.academy.website) && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {[
                        invoicePreview.academy.email,
                        invoicePreview.academy.phone,
                        invoicePreview.academy.website,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <h3
                    id="printable-invoice-title"
                    className="font-mono text-xl font-semibold text-slate-900 mt-2"
                  >
                    {invoicePreview.invoice.invoiceNumber}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close invoice preview"
                onClick={() => setInvoicePreview(null)}
                className="no-print p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bill To & Course Meta */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div>
                <div className="font-medium text-slate-500">Billed To Student</div>
                <div className="font-semibold text-slate-900 mt-1">
                  {invoicePreview.student.name}
                </div>
                <div className="font-mono text-slate-600 mt-0.5">
                  {invoicePreview.student.studentCode || invoicePreview.student.id} ·{' '}
                  {invoicePreview.student.email}
                </div>
                {invoicePreview.student.phone && (
                  <div className="text-slate-600 mt-0.5">
                    {invoicePreview.student.phone}
                  </div>
                )}
              </div>
              <div className="sm:text-right">
                <div className="font-medium text-slate-500">Course & Billing Dates</div>
                <div className="font-semibold text-slate-900 mt-1">
                  {invoicePreview.course.code} — {invoicePreview.course.title}
                </div>
                <div className="font-mono text-slate-600 mt-0.5">
                  Issued:{' '}
                  {new Date(invoicePreview.invoice.createdAt).toLocaleDateString('en-IN')} ·
                  Due:{' '}
                  {new Date(invoicePreview.invoice.dueDate).toLocaleDateString('en-IN')}
                </div>
                <div className="font-medium text-slate-800 mt-0.5">
                  Status: {invoicePreview.invoice.status}
                </div>
              </div>
            </div>

            {/* Itemized Line Items */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-3 font-medium">Category</th>
                    <th className="py-2 px-3 font-medium">Description</th>
                    <th className="py-2 px-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {invoicePreview.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-700">
                        {item.itemType}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{item.description}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                          toCents(item.lineTotal) < 0
                            ? 'text-emerald-700 font-medium'
                            : 'text-slate-900'
                        }`}
                      >
                        {formatMoney(
                          item.lineTotal,
                          invoicePreview.invoice.currency || currency
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Breakdown */}
            <div className="border-t border-slate-200 pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(
                    invoicePreview.invoice.subtotal ?? invoicePreview.invoice.amountDue,
                    invoicePreview.invoice.currency || currency
                  )}
                </span>
              </div>
              {toCents(invoicePreview.invoice.discountTotal ?? '0.00') > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discounts Applied</span>
                  <span className="font-mono tabular-nums">
                    -
                    {formatMoney(
                      invoicePreview.invoice.discountTotal ?? '0.00',
                      invoicePreview.invoice.currency || currency
                    )}
                  </span>
                </div>
              )}
              {toCents(invoicePreview.invoice.scholarshipTotal ?? '0.00') > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Scholarship Grants</span>
                  <span className="font-mono tabular-nums">
                    -
                    {formatMoney(
                      invoicePreview.invoice.scholarshipTotal ?? '0.00',
                      invoicePreview.invoice.currency || currency
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold text-slate-900 pt-1 border-t border-slate-200">
                <span>Net Amount Due</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(
                    invoicePreview.invoice.amountDue,
                    invoicePreview.invoice.currency || currency
                  )}
                </span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Total Paid (Allocations)</span>
                <span className="font-mono tabular-nums">
                  {formatMoney(
                    invoicePreview.invoice.amountPaid,
                    invoicePreview.invoice.currency || currency
                  )}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Remaining Balance</span>
                <span className="font-mono tabular-nums">
                  {formatCents(
                    Math.max(
                      0,
                      toCents(invoicePreview.invoice.amountDue) -
                        toCents(invoicePreview.invoice.amountPaid)
                    ),
                    invoicePreview.invoice.currency || currency
                  )}
                </span>
              </div>
            </div>

            {/* Payment Allocations & Refunds Footnote */}
            {(invoicePreview.allocations.length > 0 ||
              invoicePreview.refunds.length > 0) && (
              <div className="border-t border-slate-200 pt-3 space-y-2 text-[11px] text-slate-600">
                {invoicePreview.allocations.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-700">
                      Payment Receipts:{' '}
                    </span>
                    {invoicePreview.allocations
                      .map(
                        (a) =>
                          `${a.receiptNumber} (${a.method}, ${formatMoney(a.allocatedAmount, invoicePreview.invoice.currency || currency)})`
                      )
                      .join(' · ')}
                  </div>
                )}
                {invoicePreview.refunds.length > 0 && (
                  <div className="text-amber-800">
                    <span className="font-semibold">Refunds Issued: </span>
                    {invoicePreview.refunds
                      .map(
                        (r) =>
                          `${r.refundNumber} (${formatMoney(r.amount, invoicePreview.invoice.currency || currency)} — ${r.reason})`
                      )
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}

            <div className="no-print pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInvoicePreview(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Invoice</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Official Receipt Modal */}
      {receiptPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="printable-receipt-title"
        >
          <div className="print-surface w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-xs font-medium text-blue-700">
                  {data.academy?.name ?? 'IGS — InfoCom Global Services'} · Official Receipt
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {data.academy?.address ||
                    'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.'}
                </p>
                <h3
                  id="printable-receipt-title"
                  className="font-mono text-lg font-semibold text-slate-900 mt-1"
                >
                  {receiptPreview.receiptNumber}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close receipt preview"
                onClick={() => setReceiptPreview(null)}
                className="no-print p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500">Student</span>
                <span className="font-medium text-slate-900">
                  {data.students.find((s) => s.id === receiptPreview.studentId)?.name ??
                    receiptPreview.studentId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
                <span className="font-medium text-slate-900">{receiptPreview.method}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Reference</span>
                <span className="font-mono text-slate-900">
                  {receiptPreview.referenceCode || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Paid Date</span>
                <span className="font-mono text-slate-900">
                  {new Date(receiptPreview.paidAt).toLocaleString('en-IN')}
                </span>
              </div>
              {toCents(receiptPreview.refundedAmount ?? '0.00') > 0 && (
                <div className="flex justify-between text-amber-800">
                  <span>Refunded Against Receipt</span>
                  <span className="font-mono font-medium">
                    {formatMoney(receiptPreview.refundedAmount ?? '0.00', currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                <span className="font-semibold text-slate-900">Amount Paid</span>
                <span className="font-mono font-semibold text-emerald-700">
                  {formatMoney(receiptPreview.amount, currency)}
                </span>
              </div>
            </div>
            <div className="no-print pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
