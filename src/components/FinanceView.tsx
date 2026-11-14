import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Plus,
  Printer,
  Receipt,
  X,
} from 'lucide-react';
import { formatCents, formatMoney, fromCents, toCents } from '../shared/academic';
import type {
  DashboardPayload,
  FeeInvoice,
  PaymentMethod,
  PaymentReceipt,
} from '../shared/types';

interface FinanceViewProps {
  data: DashboardPayload;
  isAdmin: boolean;
  onCreateInvoice?: (payload: {
    studentId: string;
    courseId: string;
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
  onCreateInvoice,
  onRecordPayment,
  onVoidInvoice,
}: FinanceViewProps) {
  const [statusFilter, setStatusFilter] = useState<'All' | 'Unpaid' | 'Partial' | 'Paid' | 'Voided'>('All');
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<FeeInvoice | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<PaymentReceipt | null>(null);
  const [notice, setNotice] = useState('');

  // Create invoice state
  const [studentId, setStudentId] = useState(data.students[0]?.id ?? '');
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [amountDue, setAmountDue] = useState('1200.00');
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [invError, setInvError] = useState('');
  const [invSaving, setInvSaving] = useState(false);

  // Payment form state
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Card');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [paySaving, setPaySaving] = useState(false);

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
    return {
      billed,
      paid,
      outstanding: Math.max(0, billed - paid),
    };
  }, [data.invoices]);

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!onCreateInvoice) return;
    setInvError('');
    setInvSaving(true);
    try {
      await onCreateInvoice({
        studentId,
        courseId,
        description: description.trim(),
        amountDue: amountDue.trim(),
        dueDate: new Date(dueDate).toISOString(),
      });
      setInvoiceModalOpen(false);
      setDescription('');
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

  async function handleVoid(inv: FeeInvoice) {
    if (!onVoidInvoice) return;
    setNotice('');
    try {
      await onVoidInvoice(inv.id);
      setNotice(`Invoice ${inv.invoiceNumber} voided.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Cannot void invoice.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Financial Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">
            {isAdmin ? 'Total Billed Tuition' : 'Total Tuition Billed'}
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCents(totals.billed)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">
            {isAdmin ? 'Total Collected' : 'Total Paid'}
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {formatCents(totals.paid)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Outstanding Balance</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCents(totals.outstanding)}
          </div>
        </div>
      </section>

      {/* Filter & Actions Toolbar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
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

        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              const selectedCourse = data.courses.find((c) => c.id === courseId);
              if (selectedCourse) {
                setAmountDue(selectedCourse.tuitionFee);
                setDescription(`${selectedCourse.code} ${selectedCourse.title} Tuition`);
              }
              setInvError('');
              setInvoiceModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
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
                  <th className="py-2.5 px-4 text-right">Amount Due</th>
                  <th className="py-2.5 px-4 text-right">Paid</th>
                  <th className="py-2.5 px-4">Due Date</th>
                  <th className="py-2.5 px-4">Status</th>
                  {isAdmin && <th className="py-2.5 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {visibleInvoices.map((inv) => {
                  const student = data.students.find((s) => s.id === inv.studentId);
                  const remaining = toCents(inv.amountDue) - toCents(inv.amountPaid);
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="font-mono text-xs font-semibold text-blue-700">
                          {inv.invoiceNumber}
                        </div>
                        <div className="text-xs text-slate-700 mt-0.5">{inv.description}</div>
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
                        {formatMoney(inv.amountDue)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-emerald-700 tabular-nums">
                        {formatMoney(inv.amountPaid)}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {new Date(inv.dueDate).toLocaleDateString('en-US')}
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
                      {isAdmin && (
                        <td className="py-3 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {remaining > 0 && inv.status !== 'Voided' && (
                              <button
                                type="button"
                                onClick={() => openPaymentModal(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>Record Payment</span>
                              </button>
                            )}
                            {toCents(inv.amountPaid) === 0 && inv.status !== 'Voided' && (
                              <button
                                type="button"
                                onClick={() => handleVoid(inv)}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                              >
                                Void
                              </button>
                            )}
                          </div>
                        </td>
                      )}
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
                  <th className="py-2.5 px-5 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {data.payments.map((p) => {
                  const student = data.students.find((s) => s.id === p.studentId);
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
                        {new Date(p.paidAt).toLocaleDateString('en-US')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {formatMoney(p.amount)}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => setReceiptPreview(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>View Receipt</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Issue Invoice Modal */}
      {invoiceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Issue Tuition Invoice
              </h3>
              <button
                type="button"
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Student
                </label>
                <select
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Course
                </label>
                <select
                  value={courseId}
                  onChange={(e) => {
                    const cId = e.target.value;
                    setCourseId(cId);
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount Due (USD)
                  </label>
                  <input
                    type="text"
                    required
                    value={amountDue}
                    onChange={(e) => setAmountDue(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Due Date
                  </label>
                  <input
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
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Record Tuition Payment
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {payTarget.invoiceNumber} · Balance:{' '}
                  {formatCents(toCents(payTarget.amountDue) - toCents(payTarget.amountPaid))}
                </p>
              </div>
              <button
                type="button"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Amount (USD)
                  </label>
                  <input
                    type="text"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Method
                  </label>
                  <select
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Transaction Reference
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <input
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

      {/* Printable Official Receipt Modal */}
      {receiptPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="print-surface w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-xs font-medium text-blue-700">
                  InfoCom AMS · Official Payment Receipt
                </p>
                <h3 className="font-mono text-lg font-semibold text-slate-900 mt-0.5">
                  {receiptPreview.receiptNumber}
                </h3>
              </div>
              <button
                type="button"
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
                  {new Date(receiptPreview.paidAt).toLocaleString('en-US')}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                <span className="font-semibold text-slate-900">Amount Paid</span>
                <span className="font-mono font-semibold text-emerald-700">
                  {formatMoney(receiptPreview.amount)}
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
