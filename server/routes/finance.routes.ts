import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { fromCents, toCents } from '../../src/shared/academic.ts';
import {
  applyInvoiceAdjustmentSchema,
  createDiscountSchema,
  createFeePlanSchema,
  createFeeStructureSchema,
  createScholarshipSchema,
  refundPaymentSchema,
  updateDiscountSchema,
  updateFeePlanSchema,
  updateFeeStructureSchema,
  updateScholarshipSchema,
} from '../../src/shared/validation.ts';
import {
  applyInvoiceAdjustment,
  getInvoiceDetailForUser,
  getUserDashboardById,
  processPaymentRefund,
  recordAuditLog,
} from '../ams-service.ts';
import { prisma } from '../db/prisma.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';

export const financeRouter = Router();

// Fee Plans CRUD (Admin)
financeRouter.post(
  '/fee-plans',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createFeePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid fee plan data.' });
        return;
      }

      const input = parsed.data;
      const normalizedCode = input.code.toUpperCase();
      const existing = await prisma.feePlan.findUnique({ where: { code: normalizedCode } });
      if (existing) {
        res.status(409).json({ error: `Fee plan code ${normalizedCode} already exists.` });
        return;
      }

      const academy = await prisma.academy.findFirst({ select: { currency: true } });
      const id = `fp-${crypto.randomUUID().slice(0, 8)}`;

      await prisma.feePlan.create({
        data: {
          id,
          code: normalizedCode,
          name: input.name,
          description: input.description ?? '',
          installmentCount: input.installmentCount,
          currency: academy?.currency || 'INR',
          isActive: input.isActive ?? true,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'FEE_PLAN_CREATED',
        entityType: 'fee_plan',
        entityId: id,
        summary: `Created fee plan ${normalizedCode} (${input.name}, ${input.installmentCount} installments).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ feePlanId: id, dashboard });
    } catch (err) {
      console.error('POST /api/fee-plans error:', err);
      res.status(500).json({ error: 'Failed to create fee plan.' });
    }
  }
);

financeRouter.patch(
  '/fee-plans/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateFeePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid fee plan update.' });
        return;
      }

      const existing = await prisma.feePlan.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        res.status(404).json({ error: 'Fee plan not found.' });
        return;
      }

      const input = parsed.data;
      const normalizedCode = input.code ? input.code.toUpperCase() : undefined;
      if (normalizedCode && normalizedCode !== existing.code) {
        const conflict = await prisma.feePlan.findUnique({ where: { code: normalizedCode } });
        if (conflict) {
          res.status(409).json({ error: `Fee plan code ${normalizedCode} already exists.` });
          return;
        }
      }

      await prisma.feePlan.update({
        where: { id: existing.id },
        data: {
          ...(normalizedCode !== undefined ? { code: normalizedCode } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.installmentCount !== undefined ? { installmentCount: input.installmentCount } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'FEE_PLAN_UPDATED',
        entityType: 'fee_plan',
        entityId: existing.id,
        summary: `Updated fee plan ${existing.code} (${Object.keys(input).join(', ')}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/fee-plans/:id error:', err);
      res.status(500).json({ error: 'Failed to update fee plan.' });
    }
  }
);

// Fee Structures CRUD (Admin)
financeRouter.post(
  '/fee-structures',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createFeeStructureSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid fee structure data.' });
        return;
      }

      const input = parsed.data;
      const course = await prisma.course.findUnique({ where: { id: input.courseId } });
      if (!course) {
        res.status(400).json({ error: 'Valid course is required for fee structure.' });
        return;
      }

      if (input.feePlanId) {
        const fp = await prisma.feePlan.findUnique({ where: { id: input.feePlanId } });
        if (!fp) {
          res.status(400).json({ error: 'Selected fee plan was not found.' });
          return;
        }
      }

      if (input.batchId) {
        const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
        if (!batch || batch.courseId !== course.id) {
          res.status(400).json({ error: 'Selected batch does not belong to this course.' });
          return;
        }
      }

      const id = `fs-${crypto.randomUUID().slice(0, 8)}`;
      const tuitionStr = fromCents(toCents(input.tuitionAmount));
      const regStr = fromCents(toCents(input.registrationFee ?? '0.00'));
      const labStr = fromCents(toCents(input.labFee ?? '0.00'));

      await prisma.feeStructure.create({
        data: {
          id,
          courseId: course.id,
          batchId: input.batchId || null,
          feePlanId: input.feePlanId || null,
          tuitionAmount: tuitionStr,
          registrationFee: regStr,
          labFee: labStr,
          isActive: input.isActive ?? true,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'FEE_STRUCTURE_CREATED',
        entityType: 'fee_structure',
        entityId: id,
        summary: `Created fee structure for ${course.code} (Tuition ${tuitionStr}, Reg ${regStr}, Lab ${labStr}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ feeStructureId: id, dashboard });
    } catch (err) {
      console.error('POST /api/fee-structures error:', err);
      res.status(500).json({ error: 'Failed to create fee structure.' });
    }
  }
);

financeRouter.patch(
  '/fee-structures/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateFeeStructureSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid fee structure update.' });
        return;
      }

      const existing = await prisma.feeStructure.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        res.status(404).json({ error: 'Fee structure not found.' });
        return;
      }

      const input = parsed.data;
      const targetCourseId = input.courseId ?? existing.courseId;
      if (input.courseId) {
        const course = await prisma.course.findUnique({ where: { id: input.courseId } });
        if (!course) {
          res.status(400).json({ error: 'Target course not found.' });
          return;
        }
      }
      if (input.feePlanId) {
        const fp = await prisma.feePlan.findUnique({ where: { id: input.feePlanId } });
        if (!fp) {
          res.status(400).json({ error: 'Selected fee plan was not found.' });
          return;
        }
      }
      if (input.batchId) {
        const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
        if (!batch || batch.courseId !== targetCourseId) {
          res.status(400).json({ error: 'Selected batch does not belong to this course.' });
          return;
        }
      }

      await prisma.feeStructure.update({
        where: { id: existing.id },
        data: {
          ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
          ...(input.batchId !== undefined ? { batchId: input.batchId || null } : {}),
          ...(input.feePlanId !== undefined ? { feePlanId: input.feePlanId || null } : {}),
          ...(input.tuitionAmount !== undefined ? { tuitionAmount: fromCents(toCents(input.tuitionAmount)) } : {}),
          ...(input.registrationFee !== undefined ? { registrationFee: fromCents(toCents(input.registrationFee)) } : {}),
          ...(input.labFee !== undefined ? { labFee: fromCents(toCents(input.labFee)) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'FEE_STRUCTURE_UPDATED',
        entityType: 'fee_structure',
        entityId: existing.id,
        summary: `Updated fee structure ${existing.id} (${Object.keys(input).join(', ')}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/fee-structures/:id error:', err);
      res.status(500).json({ error: 'Failed to update fee structure.' });
    }
  }
);

// Discounts CRUD (Admin)
financeRouter.post(
  '/discounts',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createDiscountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid discount data.' });
        return;
      }

      const input = parsed.data;
      const normalizedCode = input.code.toUpperCase();
      const existing = await prisma.discount.findUnique({ where: { code: normalizedCode } });
      if (existing) {
        res.status(409).json({ error: `Discount code ${normalizedCode} already exists.` });
        return;
      }

      const id = `dsc-${crypto.randomUUID().slice(0, 8)}`;
      const valueStr = fromCents(toCents(input.value));

      await prisma.discount.create({
        data: {
          id,
          code: normalizedCode,
          name: input.name,
          discountType: input.discountType,
          value: valueStr,
          isActive: input.isActive ?? true,
          validFrom: input.validFrom ? new Date(input.validFrom) : null,
          validTo: input.validTo ? new Date(input.validTo) : null,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'DISCOUNT_CREATED',
        entityType: 'discount',
        entityId: id,
        summary: `Created discount ${normalizedCode} (${input.discountType} ${valueStr}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ discountId: id, dashboard });
    } catch (err) {
      console.error('POST /api/discounts error:', err);
      res.status(500).json({ error: 'Failed to create discount.' });
    }
  }
);

financeRouter.patch(
  '/discounts/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateDiscountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid discount update.' });
        return;
      }

      const existing = await prisma.discount.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        res.status(404).json({ error: 'Discount not found.' });
        return;
      }

      const input = parsed.data;
      const effectiveType = input.discountType ?? existing.discountType;
      const effectiveValue = input.value !== undefined ? Number(input.value) : Number(existing.value);
      if (effectiveType === 'Percentage' && effectiveValue > 100) {
        res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
        return;
      }

      await prisma.discount.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
          ...(input.value !== undefined ? { value: fromCents(toCents(input.value)) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.validFrom !== undefined
            ? { validFrom: input.validFrom ? new Date(input.validFrom) : null }
            : {}),
          ...(input.validTo !== undefined
            ? { validTo: input.validTo ? new Date(input.validTo) : null }
            : {}),
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'DISCOUNT_UPDATED',
        entityType: 'discount',
        entityId: existing.id,
        summary: `Updated discount ${existing.code} (${Object.keys(input).join(', ')}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/discounts/:id error:', err);
      res.status(500).json({ error: 'Failed to update discount.' });
    }
  }
);

// Scholarships CRUD (Admin)
financeRouter.post(
  '/scholarships',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createScholarshipSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid scholarship data.' });
        return;
      }

      const input = parsed.data;
      const normalizedCode = input.code.toUpperCase();
      const existing = await prisma.scholarship.findUnique({ where: { code: normalizedCode } });
      if (existing) {
        res.status(409).json({ error: `Scholarship code ${normalizedCode} already exists.` });
        return;
      }

      if (input.academicYearId) {
        const ay = await prisma.academicYear.findUnique({ where: { id: input.academicYearId } });
        if (!ay) {
          res.status(400).json({ error: 'Selected academic year not found.' });
          return;
        }
      }

      const id = `sch-${crypto.randomUUID().slice(0, 8)}`;
      const valueStr = fromCents(toCents(input.coverageValue));

      await prisma.scholarship.create({
        data: {
          id,
          code: normalizedCode,
          name: input.name,
          sponsorName: input.sponsorName ?? '',
          coverageType: input.coverageType,
          coverageValue: valueStr,
          maxRecipients: input.maxRecipients,
          academicYearId: input.academicYearId || null,
          isActive: input.isActive ?? true,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'SCHOLARSHIP_CREATED',
        entityType: 'scholarship',
        entityId: id,
        summary: `Created scholarship ${normalizedCode} (${input.coverageType} ${valueStr}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ scholarshipId: id, dashboard });
    } catch (err) {
      console.error('POST /api/scholarships error:', err);
      res.status(500).json({ error: 'Failed to create scholarship.' });
    }
  }
);

financeRouter.patch(
  '/scholarships/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateScholarshipSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid scholarship update.' });
        return;
      }

      const existing = await prisma.scholarship.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        res.status(404).json({ error: 'Scholarship not found.' });
        return;
      }

      const input = parsed.data;
      const effectiveType = input.coverageType ?? existing.coverageType;
      const effectiveValue =
        input.coverageValue !== undefined
          ? Number(input.coverageValue)
          : Number(existing.coverageValue);
      if (effectiveType === 'Percentage' && effectiveValue > 100) {
        res.status(400).json({ error: 'Percentage scholarship coverage cannot exceed 100%.' });
        return;
      }

      await prisma.scholarship.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.sponsorName !== undefined ? { sponsorName: input.sponsorName } : {}),
          ...(input.coverageType !== undefined ? { coverageType: input.coverageType } : {}),
          ...(input.coverageValue !== undefined
            ? { coverageValue: fromCents(toCents(input.coverageValue)) }
            : {}),
          ...(input.maxRecipients !== undefined ? { maxRecipients: input.maxRecipients } : {}),
          ...(input.academicYearId !== undefined
            ? { academicYearId: input.academicYearId || null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'SCHOLARSHIP_UPDATED',
        entityType: 'scholarship',
        entityId: existing.id,
        summary: `Updated scholarship ${existing.code} (${Object.keys(input).join(', ')}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/scholarships/:id error:', err);
      res.status(500).json({ error: 'Failed to update scholarship.' });
    }
  }
);

// Invoice Detail (Admin or owning Student)
financeRouter.get(
  '/invoices/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const detail = await getInvoiceDetailForUser(req.params.id, req.authUser!);
      if (!detail) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      if (detail === 'FORBIDDEN') {
        res.status(403).json({ error: 'You do not have permission to view this invoice.' });
        return;
      }
      res.json(detail);
    } catch (err) {
      console.error('GET /api/invoices/:id error:', err);
      res.status(500).json({ error: 'Failed to load invoice details.' });
    }
  }
);

// Apply Discount or Scholarship to Invoice (Admin)
financeRouter.post(
  '/invoices/:id/adjustments',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = applyInvoiceAdjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid adjustment payload.' });
        return;
      }

      const result = await applyInvoiceAdjustment({
        actor: req.authUser!,
        invoiceId: req.params.id,
        kind: parsed.data.kind,
        targetId: parsed.data.targetId,
        notes: parsed.data.notes,
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ adjustmentCents: result.adjustmentCents, dashboard });
    } catch (err) {
      console.error('POST /api/invoices/:id/adjustments error:', err);
      res.status(500).json({ error: 'Failed to apply invoice adjustment.' });
    }
  }
);

// Process Payment Refund (Admin)
financeRouter.post(
  '/payments/:id/refund',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = refundPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid refund payload.' });
        return;
      }

      const result = await processPaymentRefund({
        actor: req.authUser!,
        paymentId: req.params.id,
        amount: fromCents(toCents(parsed.data.amount)),
        reason: parsed.data.reason,
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ refundNumber: result.refundNumber, dashboard });
    } catch (err) {
      console.error('POST /api/payments/:id/refund error:', err);
      res.status(500).json({ error: 'Failed to process payment refund.' });
    }
  }
);
