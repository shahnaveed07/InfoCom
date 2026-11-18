import { fromCents, toCents } from '../../src/shared/academic.ts';
import {
  applyInvoiceAdjustmentSchema,
  createDiscountSchema,
  createFeePlanSchema,
  createFeeStructureSchema,
  createInvoiceSchema,
  createScholarshipSchema,
  recordPaymentSchema,
  refundPaymentSchema,
  updateDiscountSchema,
  updateFeePlanSchema,
  updateFeeStructureSchema,
  updateScholarshipSchema,
} from '../../src/shared/validation.ts';
import {
  generateNextInvoiceNumberD1,
  getInvoiceDetailForUserD1,
  getUserDashboardByIdD1,
  recordAuditLogD1,
} from '../d1/ams-service.ts';
import {
  d1First,
  d1Run,
  nowIso,
  randomId,
} from '../d1/client.ts';
import { listPaymentsPaginatedD1 } from '../d1/repository.ts';
import {
  applyInvoiceAdjustmentD1,
  processPaymentRefundD1,
  recordInvoicePaymentD1,
} from '../d1/workflows.ts';
import { queueD1TransactionalEmail, runD1FeeReminderSweep } from '../jobs/d1-worker.ts';
import type { WorkerRouteEntry } from '../worker-router.ts';

function normalizeOptionalIso(val: string | null | undefined): string | null {
  if (!val || !val.trim()) return null;
  const ms = Date.parse(val);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export const workerFinanceRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/payments',
    auth: 'required',
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        return c.json(403, { error: 'Access denied.' });
      }
      const requestedStudentId = (c.query.get('studentId') ?? '').trim() || undefined;
      if (
        c.authUser!.role === 'student' &&
        requestedStudentId &&
        requestedStudentId !== c.authUser!.id
      ) {
        return c.json(403, {
          error: "Access denied to another student's financial records.",
        });
      }
      const studentId =
        c.authUser!.role === 'student' ? c.authUser!.id : requestedStudentId;

      const result = await listPaymentsPaginatedD1(
        {
          page: Number(c.query.get('page')) || 1,
          pageSize: Number(c.query.get('pageSize')) || 25,
          studentId,
        },
        c.db
      );
      return c.json(200, result);
    },
  },
  {
    method: 'POST',
    pattern: '/api/invoices',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createInvoiceSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid invoice details.',
        });
      }

      const input = parsed.data;
      const [student, course, academy] = await Promise.all([
        d1First<{ id: string; name: string; email: string }>(
          "SELECT id, name, email FROM users WHERE id = ? AND role = 'student' LIMIT 1",
          [input.studentId],
          c.db
        ),
        d1First<{ id: string; code: string; title: string }>(
          'SELECT id, code, title FROM courses WHERE id = ? LIMIT 1',
          [input.courseId],
          c.db
        ),
        d1First<{ currency: string }>(
          'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
          [],
          c.db
        ),
      ]);

      if (!student || !course) {
        return c.json(400, {
          error: 'Valid student and course are required to issue an invoice.',
        });
      }

      const amountCents = toCents(input.amountDue);
      if (amountCents <= 0) {
        return c.json(400, { error: 'Invoice amount due must exceed 0.00.' });
      }
      const amountStr = fromCents(amountCents);
      const dueDateIso = normalizeOptionalIso(input.dueDate) ?? new Date(Date.now() + 14 * 86400_000).toISOString();
      const invoiceId = randomId('inv', 8);
      const invoiceNumber = await generateNextInvoiceNumberD1(c.db);
      const now = nowIso();
      const currency = academy?.currency || 'INR';

      await d1Run(
        `INSERT INTO fee_invoices (
          id, invoice_number, student_id, enrollment_id, course_id, fee_structure_id,
          description, subtotal, discount_total, scholarship_total, amount_due, amount_paid,
          currency, status, due_date, issued_by_user_id, is_archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', ?, '0.00', ?, 'Unpaid', ?, ?, 0, ?, ?)`,
        [
          invoiceId,
          invoiceNumber,
          student.id,
          input.enrollmentId || null,
          course.id,
          input.feeStructureId || null,
          input.description,
          amountStr,
          amountStr,
          currency,
          dueDateIso,
          c.authUser!.id,
          now,
          now,
        ],
        c.db
      );

      await d1Run(
        `INSERT INTO invoice_items (
          id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at
        ) VALUES (?, ?, 'Tuition', ?, 1, ?, ?, ?)`,
        [randomId('item', 8), invoiceId, input.description, amountStr, amountStr, now],
        c.db
      );

      const notifId = randomId('not', 8);
      await d1Run(
        `INSERT INTO notifications (id, user_id, kind, title, message, related_course_id, read, created_at)
         VALUES (?, ?, 'fee', ?, ?, ?, 0, ?)`,
        [
          notifId,
          student.id,
          `Invoice Issued · ${invoiceNumber}`,
          `A tuition/fee invoice (${invoiceNumber}) of ${currency} ${amountStr} is due on ${dueDateIso.slice(0, 10)}.`,
          course.id,
          now,
        ],
        c.db
      );

      await queueD1TransactionalEmail(
        {
          notificationId: notifId,
          userId: student.id,
          kind: 'fee',
          recipientEmail: student.email,
          subject: `Invoice ${invoiceNumber} Issued — IGS — InfoCom Global Services`,
          bodyText: `Hello ${student.name},\n\nInvoice ${invoiceNumber} for ${input.description} (${currency} ${amountStr}) has been issued with due date ${dueDateIso.slice(0, 10)}.\n\n— IGS — InfoCom Global Services`,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'INVOICE_CREATED',
          entityType: 'invoice',
          entityId: invoiceId,
          ipAddress: c.ipAddress,
          summary: `Issued invoice ${invoiceNumber} (${currency} ${amountStr}) to ${student.name}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { invoiceId, invoiceNumber, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/invoices/:id/void',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const invoice = await d1First<Record<string, unknown>>(
        'SELECT * FROM fee_invoices WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!invoice) {
        return c.json(404, { error: 'Invoice not found.' });
      }
      if (String(invoice.status) === 'Voided') {
        return c.json(400, { error: 'Invoice is already voided.' });
      }
      if (toCents(String(invoice.amount_paid ?? '0')) > 0) {
        return c.json(400, {
          error: 'Cannot void an invoice that already has recorded payments. Issue a refund instead.',
        });
      }

      const now = nowIso();
      await d1Run(
        "UPDATE fee_invoices SET status = 'Voided', updated_at = ? WHERE id = ?",
        [now, String(invoice.id)],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'INVOICE_VOIDED',
          entityType: 'invoice',
          entityId: String(invoice.id),
          ipAddress: c.ipAddress,
          summary: `Voided unpaid invoice ${String(invoice.invoice_number)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/invoices/send-reminders',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const result = await runD1FeeReminderSweep(undefined, c.db);
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { remindersCreatedCount: result.queuedCount, dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/invoices/:id',
    auth: 'required',
    handler: async (c) => {
      const detail = await getInvoiceDetailForUserD1(c.params.id, c.authUser!, c.db);
      if (detail === 'FORBIDDEN') {
        return c.json(403, { error: 'Access denied to this invoice.' });
      }
      if (!detail) {
        return c.json(404, { error: 'Invoice not found.' });
      }
      return c.json(200, detail);
    },
  },
  {
    method: 'POST',
    pattern: '/api/invoices/:id/payments',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = recordPaymentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid payment payload.',
        });
      }

      const result = await recordInvoicePaymentD1(
        {
          invoiceId: c.params.id,
          actor: c.authUser!,
          amount: parsed.data.amount,
          method: parsed.data.method,
          referenceCode: parsed.data.referenceCode,
          notes: parsed.data.notes,
        },
        c.db
      );

      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, {
        receiptNumber: result.receiptNumber,
        paymentId: result.paymentId,
        dashboard,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/invoices/:id/adjustments',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = applyInvoiceAdjustmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid adjustment payload.',
        });
      }

      const result = await applyInvoiceAdjustmentD1(
        {
          invoiceId: c.params.id,
          actor: c.authUser!,
          kind: parsed.data.kind,
          targetId: parsed.data.targetId,
          notes: parsed.data.notes,
        },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { adjustmentCents: result.adjustmentCents, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/payments/:id/refund',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = refundPaymentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid refund payload.',
        });
      }

      const result = await processPaymentRefundD1(
        {
          paymentId: c.params.id,
          actor: c.authUser!,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
        },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { refundNumber: result.refundNumber, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/fee-plans',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createFeePlanSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid fee plan data.',
        });
      }

      const input = parsed.data;
      const normalizedCode = input.code.toUpperCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM fee_plans WHERE code = ? LIMIT 1',
        [normalizedCode],
        c.db
      );
      if (existing) {
        return c.json(409, { error: `Fee plan code ${normalizedCode} already exists.` });
      }

      const academy = await d1First<{ currency: string }>(
        'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      const id = randomId('fp', 8);
      const now = nowIso();
      await d1Run(
        `INSERT INTO fee_plans (id, code, name, description, installment_count, currency, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          normalizedCode,
          input.name,
          input.description ?? '',
          input.installmentCount,
          academy?.currency || 'INR',
          input.isActive ?? true,
          now,
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'FEE_PLAN_CREATED',
          entityType: 'fee_plan',
          entityId: id,
          ipAddress: c.ipAddress,
          summary: `Created fee plan ${normalizedCode} (${input.name}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { feePlanId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/fee-plans/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateFeePlanSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid fee plan update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM fee_plans WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Fee plan not found.' });
      }

      const input = parsed.data;
      const normalizedCode = input.code ? input.code.toUpperCase() : undefined;
      if (normalizedCode && normalizedCode !== String(existing.code)) {
        const conflict = await d1First<{ id: string }>(
          'SELECT id FROM fee_plans WHERE code = ? LIMIT 1',
          [normalizedCode],
          c.db
        );
        if (conflict) {
          return c.json(409, { error: `Fee plan code ${normalizedCode} already exists.` });
        }
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (normalizedCode !== undefined) {
        sets.push('code = ?');
        vals.push(normalizedCode);
      }
      if (input.name !== undefined) {
        sets.push('name = ?');
        vals.push(input.name);
      }
      if (input.description !== undefined) {
        sets.push('description = ?');
        vals.push(input.description);
      }
      if (input.installmentCount !== undefined) {
        sets.push('installment_count = ?');
        vals.push(input.installmentCount);
      }
      if (input.isActive !== undefined) {
        sets.push('is_active = ?');
        vals.push(input.isActive);
      }

      if (sets.length > 0) {
        vals.push(String(existing.id));
        await d1Run(`UPDATE fee_plans SET ${sets.join(', ')} WHERE id = ?`, vals, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'FEE_PLAN_UPDATED',
          entityType: 'fee_plan',
          entityId: String(existing.id),
          ipAddress: c.ipAddress,
          summary: `Updated fee plan ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/fee-structures',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createFeeStructureSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid fee structure data.',
        });
      }

      const input = parsed.data;
      const course = await d1First<{ id: string; code: string }>(
        'SELECT id, code FROM courses WHERE id = ? LIMIT 1',
        [input.courseId],
        c.db
      );
      if (!course) {
        return c.json(400, { error: 'Valid course is required for fee structure.' });
      }
      if (input.feePlanId) {
        const fp = await d1First<{ id: string }>(
          'SELECT id FROM fee_plans WHERE id = ? LIMIT 1',
          [input.feePlanId],
          c.db
        );
        if (!fp) {
          return c.json(400, { error: 'Selected fee plan was not found.' });
        }
      }
      if (input.batchId) {
        const batch = await d1First<{ id: string; course_id: string }>(
          'SELECT id, course_id FROM cohorts WHERE id = ? LIMIT 1',
          [input.batchId],
          c.db
        );
        if (!batch || batch.course_id !== course.id) {
          return c.json(400, { error: 'Selected batch does not belong to this course.' });
        }
      }

      const id = randomId('fs', 8);
      const tuitionStr = fromCents(toCents(input.tuitionAmount));
      const regStr = fromCents(toCents(input.registrationFee ?? '0.00'));
      const labStr = fromCents(toCents(input.labFee ?? '0.00'));
      const now = nowIso();

      await d1Run(
        `INSERT INTO fee_structures (
          id, course_id, batch_id, fee_plan_id, tuition_amount, registration_fee,
          lab_fee, effective_from, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          course.id,
          input.batchId || null,
          input.feePlanId || null,
          tuitionStr,
          regStr,
          labStr,
          now,
          input.isActive ?? true,
          now,
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'FEE_STRUCTURE_CREATED',
          entityType: 'fee_structure',
          entityId: id,
          ipAddress: c.ipAddress,
          summary: `Created fee structure for ${course.code}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { feeStructureId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/fee-structures/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateFeeStructureSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid fee structure update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM fee_structures WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Fee structure not found.' });
      }

      const input = parsed.data;
      const targetCourseId = input.courseId ?? String(existing.course_id);
      if (input.courseId) {
        const course = await d1First<{ id: string }>(
          'SELECT id FROM courses WHERE id = ? LIMIT 1',
          [input.courseId],
          c.db
        );
        if (!course) return c.json(400, { error: 'Target course not found.' });
      }
      if (input.feePlanId) {
        const fp = await d1First<{ id: string }>(
          'SELECT id FROM fee_plans WHERE id = ? LIMIT 1',
          [input.feePlanId],
          c.db
        );
        if (!fp) return c.json(400, { error: 'Selected fee plan was not found.' });
      }
      if (input.batchId) {
        const batch = await d1First<{ id: string; course_id: string }>(
          'SELECT id, course_id FROM cohorts WHERE id = ? LIMIT 1',
          [input.batchId],
          c.db
        );
        if (!batch || batch.course_id !== targetCourseId) {
          return c.json(400, { error: 'Selected batch does not belong to this course.' });
        }
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (input.courseId !== undefined) {
        sets.push('course_id = ?');
        vals.push(input.courseId);
      }
      if (input.batchId !== undefined) {
        sets.push('batch_id = ?');
        vals.push(input.batchId || null);
      }
      if (input.feePlanId !== undefined) {
        sets.push('fee_plan_id = ?');
        vals.push(input.feePlanId || null);
      }
      if (input.tuitionAmount !== undefined) {
        sets.push('tuition_amount = ?');
        vals.push(fromCents(toCents(input.tuitionAmount)));
      }
      if (input.registrationFee !== undefined) {
        sets.push('registration_fee = ?');
        vals.push(fromCents(toCents(input.registrationFee)));
      }
      if (input.labFee !== undefined) {
        sets.push('lab_fee = ?');
        vals.push(fromCents(toCents(input.labFee)));
      }
      if (input.isActive !== undefined) {
        sets.push('is_active = ?');
        vals.push(input.isActive);
      }

      if (sets.length > 0) {
        vals.push(String(existing.id));
        await d1Run(`UPDATE fee_structures SET ${sets.join(', ')} WHERE id = ?`, vals, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'FEE_STRUCTURE_UPDATED',
          entityType: 'fee_structure',
          entityId: String(existing.id),
          ipAddress: c.ipAddress,
          summary: `Updated fee structure ${String(existing.id)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/discounts',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createDiscountSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid discount data.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM discounts WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (existing) {
        return c.json(409, { error: `Discount code ${upperCode} already exists.` });
      }

      const id = randomId('dsc', 8);
      const valStr = fromCents(toCents(input.value));
      await d1Run(
        `INSERT INTO discounts (id, code, name, discount_type, value, is_active, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          upperCode,
          input.name,
          input.discountType,
          valStr,
          input.isActive ?? true,
          normalizeOptionalIso(input.validFrom),
          normalizeOptionalIso(input.validTo),
          nowIso(),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DISCOUNT_CREATED',
          entityType: 'discount',
          entityId: id,
          ipAddress: c.ipAddress,
          summary: `Created discount ${upperCode} (${input.name}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { discountId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/discounts/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateDiscountSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid discount update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM discounts WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) return c.json(404, { error: 'Discount not found.' });

      const input = parsed.data;
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?');
        vals.push(input.name);
      }
      if (input.discountType !== undefined) {
        sets.push('discount_type = ?');
        vals.push(input.discountType);
      }
      if (input.value !== undefined) {
        sets.push('value = ?');
        vals.push(fromCents(toCents(input.value)));
      }
      if (input.isActive !== undefined) {
        sets.push('is_active = ?');
        vals.push(input.isActive);
      }
      if (input.validFrom !== undefined) {
        sets.push('valid_from = ?');
        vals.push(normalizeOptionalIso(input.validFrom));
      }
      if (input.validTo !== undefined) {
        sets.push('valid_to = ?');
        vals.push(normalizeOptionalIso(input.validTo));
      }

      if (sets.length > 0) {
        vals.push(String(existing.id));
        await d1Run(`UPDATE discounts SET ${sets.join(', ')} WHERE id = ?`, vals, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DISCOUNT_UPDATED',
          entityType: 'discount',
          entityId: String(existing.id),
          ipAddress: c.ipAddress,
          summary: `Updated discount ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/scholarships',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createScholarshipSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid scholarship data.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM scholarships WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (existing) {
        return c.json(409, { error: `Scholarship code ${upperCode} already exists.` });
      }

      const id = randomId('sch', 8);
      const valStr = fromCents(toCents(input.coverageValue));
      await d1Run(
        `INSERT INTO scholarships (id, code, name, sponsor_name, coverage_type, coverage_value, max_recipients, academic_year_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          upperCode,
          input.name,
          input.sponsorName ?? '',
          input.coverageType,
          valStr,
          input.maxRecipients,
          input.academicYearId || null,
          input.isActive ?? true,
          nowIso(),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'SCHOLARSHIP_CREATED',
          entityType: 'scholarship',
          entityId: id,
          ipAddress: c.ipAddress,
          summary: `Created scholarship ${upperCode} (${input.name}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { scholarshipId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/scholarships/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateScholarshipSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid scholarship update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM scholarships WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) return c.json(404, { error: 'Scholarship not found.' });

      const input = parsed.data;
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?');
        vals.push(input.name);
      }
      if (input.sponsorName !== undefined) {
        sets.push('sponsor_name = ?');
        vals.push(input.sponsorName);
      }
      if (input.coverageType !== undefined) {
        sets.push('coverage_type = ?');
        vals.push(input.coverageType);
      }
      if (input.coverageValue !== undefined) {
        sets.push('coverage_value = ?');
        vals.push(fromCents(toCents(input.coverageValue)));
      }
      if (input.maxRecipients !== undefined) {
        sets.push('max_recipients = ?');
        vals.push(input.maxRecipients);
      }
      if (input.academicYearId !== undefined) {
        sets.push('academic_year_id = ?');
        vals.push(input.academicYearId || null);
      }
      if (input.isActive !== undefined) {
        sets.push('is_active = ?');
        vals.push(input.isActive);
      }

      if (sets.length > 0) {
        vals.push(String(existing.id));
        await d1Run(`UPDATE scholarships SET ${sets.join(', ')} WHERE id = ?`, vals, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'SCHOLARSHIP_UPDATED',
          entityType: 'scholarship',
          entityId: String(existing.id),
          ipAddress: c.ipAddress,
          summary: `Updated scholarship ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
];
