import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { toCents } from '../../src/shared/academic.ts';
import {
  createInvoiceSchema,
  createUserSchema,
  issueCertificateSchema,
  notificationPreferencesUpdateSchema,
  recordPaymentSchema,
  revokeCertificateSchema,
  updateUserSchema,
  uploadDocumentSchema,
} from '../../src/shared/validation.ts';
import { storePrivateDocument } from '../storage/index.ts';
import {
  findUserByEmail,
  generateNextInvoiceNumber,
  generateUniqueStaffCode,
  generateUniqueStudentCode,
  getActiveDocumentContent,
  getUserDashboardById,
  issueAccountSetupToken,
  issueVerifiedCertificate,
  recordAuditLog,
  recordInvoicePayment,
  runSessionReminderSweep,
  toPublicUser,
  verifyCertificateByCode,
} from '../ams-service.ts';
import { hashPassword } from '../auth.ts';
import { prisma } from '../db/prisma.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import {
  listAuditLogsPaginated,
  listNotificationsPaginated,
  listPaymentsPaginated,
  revokeAllUserSessionsInDb,
} from '../repositories/ams.repository.ts';
import {
  canInstructorAccessCourse,
  canInstructorAccessStudent,
  hasInstructorPermission,
} from '../security/permissions.ts';
import { isSmtpConfigured, verifySmtpConnection } from '../email/mailer.ts';
import { queueTransactionalEmail, runFeeReminderSweep } from '../jobs/worker.ts';

export const adminOpsRouter = Router();

// Public certificate verification endpoint
adminOpsRouter.get('/certificates/verify/:code', async (req: Request, res: Response) => {
  try {
    const cert = await verifyCertificateByCode(req.params.code);
    if (!cert) {
      res.status(404).json({ error: 'No certificate matched that verification code or hash.' });
      return;
    }
    res.json({ certificate: cert });
  } catch (err) {
    console.error('GET /api/certificates/verify/:code error:', err);
    res.status(500).json({ error: 'Unable to verify certificate right now.' });
  }
});

// Paginated repository endpoints for large datasets
adminOpsRouter.get(
  '/audit-logs',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await listAuditLogsPaginated({
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 25,
        action: typeof req.query.action === 'string' ? req.query.action : undefined,
        entityType: typeof req.query.entityType === 'string' ? req.query.entityType : undefined,
      });
      res.json(result);
    } catch (err) {
      console.error('GET /api/audit-logs error:', err);
      res.status(500).json({ error: 'Failed to load audit logs.' });
    }
  }
);

adminOpsRouter.get(
  '/payments',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.authUser!.role === 'instructor') {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }
      const requestedStudentId =
        typeof req.query.studentId === 'string' && req.query.studentId.trim()
          ? req.query.studentId.trim()
          : undefined;
      if (
        req.authUser!.role === 'student' &&
        requestedStudentId &&
        requestedStudentId !== req.authUser!.id
      ) {
        res.status(403).json({ error: 'Access denied to another student\'s financial records.' });
        return;
      }
      const studentId =
        req.authUser!.role === 'student'
          ? req.authUser!.id
          : requestedStudentId;
      const result = await listPaymentsPaginated({
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 25,
        studentId,
      });
      res.json(result);
    } catch (err) {
      console.error('GET /api/payments error:', err);
      res.status(500).json({ error: 'Failed to load payments.' });
    }
  }
);

adminOpsRouter.get(
  '/notifications',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await listNotificationsPaginated({
        userId: req.authUser!.id,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 25,
        unreadOnly: req.query.unreadOnly === 'true',
      });
      res.json(result);
    } catch (err) {
      console.error('GET /api/notifications error:', err);
      res.status(500).json({ error: 'Failed to load notifications.' });
    }
  }
);

// Admin-only User Management
adminOpsRouter.post(
  '/users',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid user details.' });
        return;
      }
      const input = parsed.data;
      const existing = await findUserByEmail(input.email);
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const prefix =
        input.role === 'admin' ? 'adm' : input.role === 'instructor' ? 'ins' : 'stu';
      const id = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

      const hasPassword = Boolean(input.password && input.password.trim().length > 0);
      const newUserHash = hasPassword ? await hashPassword(input.password!) : null;
      const mustChangePassword = !hasPassword || Boolean(input.requirePasswordChange);

      const { created, onboarding } = await prisma.$transaction(async (tx) => {
        const studentCode =
          input.role === 'student' ? await generateUniqueStudentCode(tx) : null;
        const staffCode =
          input.role !== 'student' ? await generateUniqueStaffCode(tx) : null;

        const user = await tx.user.create({
          data: {
            id,
            name: input.name,
            email: input.email.toLowerCase(),
            role: input.role,
            status: 'active',
            studentCode,
            staffCode,
            department:
              input.department ||
              (input.role === 'admin'
                ? 'Administration'
                : input.role === 'instructor'
                  ? 'Academic Faculty'
                  : null),
            phone: input.phone || null,
            passwordHash: newUserHash,
            passwordUpdatedAt: hasPassword ? new Date() : null,
            mustChangePassword,
          },
        });

        const roleRow = await tx.role.findUnique({ where: { code: input.role } });
        if (roleRow) {
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: roleRow.id } },
            update: {},
            create: {
              id: `ur-${user.id}-${roleRow.code}`,
              userId: user.id,
              roleId: roleRow.id,
              assignedByUserId: req.authUser!.id,
            },
          });
        }

        if (user.role === 'student' && user.studentCode) {
          await tx.studentProfile.create({
            data: {
              id: `sp-${user.id}`,
              userId: user.id,
              studentCode: user.studentCode,
            },
          });
        } else if (user.role === 'instructor' && user.staffCode) {
          await tx.instructorProfile.create({
            data: {
              id: `ip-${user.id}`,
              userId: user.id,
              staffCode: user.staffCode,
              specialization: user.department ?? '',
            },
          });
        }

        let issuedOnboarding: {
          rawToken: string;
          onboardingPath: string;
          expiresAt: string;
        } | null = null;
        if (!hasPassword) {
          issuedOnboarding = await issueAccountSetupToken(tx, {
            userId: user.id,
            createdByUserId: req.authUser!.id,
            ttlHours: 72,
          });
          await tx.deliveryLog.create({
            data: {
              id: `del-${crypto.randomUUID().slice(0, 8)}`,
              userId: user.id,
              channel: 'in_app',
              recipient: user.email,
              status: 'Delivered',
            },
          });
          const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
          await queueTransactionalEmail(tx, {
            userId: user.id,
            kind: 'account_setup',
            recipientEmail: user.email,
            subject: 'Complete Your Account Setup — IGS — InfoCom Global Services',
            bodyText: `Hello ${user.name},\n\nYour IGS — InfoCom Global Services ${user.role} account has been created. Complete your password setup using the link below (valid for 72 hours):\n${origin}${issuedOnboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
            bypassPreferences: true,
            redactSensitive: true,
          });
        }

        return { created: user, onboarding: issuedOnboarding };
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'USER_CREATED',
        entityType: 'user',
        entityId: created.id,
        summary: onboarding
          ? `Created ${created.role} account for ${created.name} (${created.email}) with single-use 72h setup token.`
          : `Created ${created.role} account for ${created.name} (${created.email}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({
        user: toPublicUser(created),
        ...(onboarding
          ? {
              onboardingToken: onboarding.rawToken,
              onboardingPath: onboarding.onboardingPath,
              onboardingExpiresAt: onboarding.expiresAt,
            }
          : {}),
        dashboard,
      });
    } catch (err) {
      console.error('POST /api/users error:', err);
      res.status(500).json({ error: 'Failed to create user account.' });
    }
  }
);

adminOpsRouter.post(
  '/users/:id/reset-token',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }
      if (target.status === 'suspended' || target.status === 'archived') {
        res.status(400).json({
          error: `Cannot issue setup/reset link for a ${target.status} account.`,
        });
        return;
      }

      const issued = await prisma.$transaction(async (tx) => {
        const token = await issueAccountSetupToken(tx, {
          userId: target.id,
          createdByUserId: req.authUser!.id,
          ttlHours: 72,
        });
        await tx.deliveryLog.create({
          data: {
            id: `del-${crypto.randomUUID().slice(0, 8)}`,
            userId: target.id,
            channel: 'in_app',
            recipient: target.email,
            status: 'Delivered',
          },
        });
        const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        await queueTransactionalEmail(tx, {
          userId: target.id,
          kind: 'password_reset',
          recipientEmail: target.email,
          subject: 'Portal Password Reset — IGS — InfoCom Global Services',
          bodyText: `Hello ${target.name},\n\nAn administrator issued a single-use password setup/reset link for your account (${target.email}), valid for 72 hours:\n${origin}${token.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        });
        return token;
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'ONBOARDING_TOKEN_ISSUED',
        entityType: 'user',
        entityId: target.id,
        summary: `Issued single-use 72h password setup/reset token for ${target.email}.`,
      });

      res.json({
        ok: true,
        onboardingToken: issued.rawToken,
        onboardingPath: issued.onboardingPath,
        onboardingExpiresAt: issued.expiresAt,
        user: toPublicUser(target),
      });
    } catch (err) {
      console.error('POST /api/users/:id/reset-token error:', err);
      res.status(500).json({ error: 'Failed to issue password setup link.' });
    }
  }
);

adminOpsRouter.patch(
  '/users/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid user update.' });
        return;
      }

      const targetId = req.params.id;
      const input = parsed.data;
      if (targetId === req.authUser!.id && input.status && input.status !== 'active') {
        res.status(400).json({ error: 'You cannot deactivate or archive your own active admin account.' });
        return;
      }
      if (targetId === req.authUser!.id && input.role && input.role !== 'admin') {
        res.status(400).json({ error: 'You cannot downgrade your own admin role.' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { id: targetId } });
      if (!existing) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      const roleChanged = Boolean(input.role && input.role !== existing.role);
      const deactivated = Boolean(input.status && input.status !== 'active');

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.department !== undefined ? { department: input.department } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(roleChanged || deactivated ? { sessionVersion: { increment: 1 } } : {}),
          },
        });

        if (roleChanged && input.role) {
          const newRoleRow = await tx.role.findUnique({ where: { code: input.role } });
          if (newRoleRow) {
            await tx.userRole.upsert({
              where: { userId_roleId: { userId: targetId, roleId: newRoleRow.id } },
              update: {},
              create: {
                id: `ur-${targetId}-${newRoleRow.code}`,
                userId: targetId,
                roleId: newRoleRow.id,
                assignedByUserId: req.authUser!.id,
              },
            });
          }
        }
      });

      if (roleChanged || deactivated) {
        await revokeAllUserSessionsInDb(
          targetId,
          deactivated ? 'account_deactivated' : 'role_changed'
        );
      }

      await recordAuditLog({
        actor: req.authUser!,
        action: 'USER_UPDATED',
        entityType: 'user',
        entityId: targetId,
        summary: `Updated account ${existing.email} (${Object.keys(input).join(', ')}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/users/:id error:', err);
      res.status(500).json({ error: 'Failed to update user account.' });
    }
  }
);

// Fees & Financial Management (Admin)
adminOpsRouter.post(
  '/invoices',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid invoice details.' });
        return;
      }

      const input = parsed.data;
      const [student, course, feeStructure] = await Promise.all([
        prisma.user.findFirst({ where: { id: input.studentId, role: 'student' } }),
        prisma.course.findUnique({ where: { id: input.courseId } }),
        input.feeStructureId
          ? prisma.feeStructure.findUnique({ where: { id: input.feeStructureId } })
          : Promise.resolve(null),
      ]);

      if (!student || !course) {
        res.status(400).json({ error: 'Valid student and course are required.' });
        return;
      }

      if (input.feeStructureId && (!feeStructure || feeStructure.courseId !== course.id)) {
        res.status(400).json({ error: 'Selected fee structure does not belong to this course.' });
        return;
      }

      const invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const invoiceNumber = await generateNextInvoiceNumber();

      const itemRows: Array<{
        itemType: 'Tuition' | 'Registration' | 'Lab';
        description: string;
        amount: string;
      }> = [];

      let formattedAmount = Number(input.amountDue).toFixed(2);
      if (feeStructure) {
        const tuitionCents = toCents(feeStructure.tuitionAmount.toFixed(2));
        const regCents = toCents(feeStructure.registrationFee.toFixed(2));
        const labCents = toCents(feeStructure.labFee.toFixed(2));
        const totalCents = tuitionCents + regCents + labCents;
        if (totalCents > 0) {
          formattedAmount = (totalCents / 100).toFixed(2);
          itemRows.push({
            itemType: 'Tuition',
            description: `${course.code} ${course.title} — Tuition Fee`,
            amount: (tuitionCents / 100).toFixed(2),
          });
          if (regCents > 0) {
            itemRows.push({
              itemType: 'Registration',
              description: `${course.code} — Registration Fee`,
              amount: (regCents / 100).toFixed(2),
            });
          }
          if (labCents > 0) {
            itemRows.push({
              itemType: 'Lab',
              description: `${course.code} — Computer Lab Fee`,
              amount: (labCents / 100).toFixed(2),
            });
          }
        }
      }

      if (itemRows.length === 0) {
        itemRows.push({
          itemType: 'Tuition',
          description: input.description,
          amount: formattedAmount,
        });
      }

      const acadRow = await prisma.academy.findFirst({ select: { currency: true } });
      const activeCurrency = acadRow?.currency || 'INR';
      const displayCurrencySymbol = activeCurrency === 'INR' ? '₹' : `${activeCurrency} `;

      await prisma.$transaction(async (tx) => {
        await tx.invoice.create({
          data: {
            id: invoiceId,
            invoiceNumber,
            studentId: student.id,
            enrollmentId: input.enrollmentId ?? null,
            courseId: course.id,
            feeStructureId: feeStructure?.id ?? null,
            description: input.description,
            subtotal: formattedAmount,
            amountDue: formattedAmount,
            amountPaid: '0.00',
            currency: activeCurrency,
            status: 'Unpaid',
            dueDate: new Date(input.dueDate),
            issuedByUserId: req.authUser!.id,
          },
        });

        for (const row of itemRows) {
          await tx.invoiceItem.create({
            data: {
              id: `item-${crypto.randomUUID().slice(0, 8)}`,
              invoiceId,
              itemType: row.itemType,
              description: row.description,
              quantity: 1,
              unitPrice: row.amount,
              lineTotal: row.amount,
            },
          });
        }

        const notif = await tx.notification.create({
          data: {
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: student.id,
            kind: 'finance',
            title: `Tuition Invoice Issued · ${invoiceNumber}`,
            message: `Invoice ${invoiceNumber} for ${displayCurrencySymbol}${formattedAmount} (${input.description}) is due on ${new Date(input.dueDate).toLocaleDateString('en-IN')}.`,
            relatedCourseId: course.id,
            read: false,
          },
        });

        await tx.deliveryLog.create({
          data: {
            id: `del-${crypto.randomUUID().slice(0, 8)}`,
            notificationId: notif.id,
            userId: student.id,
            channel: 'in_app',
            recipient: student.email,
            status: 'Delivered',
          },
        });

        await queueTransactionalEmail(tx, {
          notificationId: notif.id,
          userId: student.id,
          kind: 'finance',
          recipientEmail: student.email,
          subject: `${notif.title} — IGS — InfoCom Global Services`,
          bodyText: notif.message,
        });
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'INVOICE_ISSUED',
        entityType: 'fee_invoice',
        entityId: invoiceId,
        summary: `Issued invoice ${invoiceNumber} (${displayCurrencySymbol}${formattedAmount}) to ${student.name}.`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ invoiceId, invoiceNumber, dashboard });
    } catch (err) {
      console.error('POST /api/invoices error:', err);
      res.status(500).json({ error: 'Failed to create fee invoice.' });
    }
  }
);

adminOpsRouter.patch(
  '/invoices/:id/void',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      if (toCents(invoice.amountPaid.toString()) > 0) {
        res.status(400).json({ error: 'Invoices with recorded payments cannot be voided to preserve ledger integrity.' });
        return;
      }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'Voided', isArchived: true },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'INVOICE_VOIDED',
        entityType: 'fee_invoice',
        entityId: invoice.id,
        summary: `Voided and archived unpaid invoice ${invoice.invoiceNumber}.`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/invoices/:id/void error:', err);
      res.status(500).json({ error: 'Failed to void invoice.' });
    }
  }
);

adminOpsRouter.post(
  '/invoices/:id/payments',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = recordPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payment payload.' });
        return;
      }

      const result = await recordInvoicePayment({
        actor: req.authUser!,
        invoiceId: req.params.id,
        amount: Number(parsed.data.amount).toFixed(2),
        method: parsed.data.method,
        referenceCode: parsed.data.referenceCode,
        notes: parsed.data.notes,
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ receiptNumber: result.receiptNumber, dashboard });
    } catch (err) {
      console.error('POST /api/invoices/:id/payments error:', err);
      res.status(500).json({ error: 'Failed to record payment.' });
    }
  }
);

adminOpsRouter.post(
  '/invoices/send-reminders',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const includeUpcomingDays =
        typeof req.body?.includeUpcomingDays === 'number' && Number.isFinite(req.body.includeUpcomingDays)
          ? Math.min(30, Math.max(0, req.body.includeUpcomingDays))
          : 3;
      const result = await runFeeReminderSweep({ includeUpcomingDays });
      await recordAuditLog({
        actor: req.authUser!,
        action: 'FEE_REMINDERS_QUEUED',
        entityType: 'fee_invoice',
        entityId: 'sweep',
        summary: `Scanned ${result.scannedInvoices} unpaid/partial invoices and queued ${result.queuedCount} fee reminder notifications.`,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('POST /api/invoices/send-reminders error:', err);
      res.status(500).json({ error: 'Failed to queue fee reminders.' });
    }
  }
);

adminOpsRouter.get(
  '/admin/email-delivery',
  requireAuth,
  requireRoles('admin'),
  async (req: Request, res: Response) => {
    try {
      const verify = req.query.verify === 'true';
      const [smtpStatus, groupedCounts, recentDeliveries, recentJobs] = await Promise.all([
        verify ? verifySmtpConnection() : Promise.resolve(null),
        prisma.deliveryLog.groupBy({
          by: ['status'],
          where: { channel: 'email' },
          _count: { _all: true },
        }),
        prisma.deliveryLog.findMany({
          where: { channel: 'email' },
          orderBy: { sentAt: 'desc' },
          take: 25,
          select: {
            id: true,
            notificationId: true,
            userId: true,
            applicationId: true,
            recipient: true,
            status: true,
            providerMessageId: true,
            errorMessage: true,
            sentAt: true,
          },
        }),
        prisma.backgroundJob.findMany({
          where: { jobType: 'notification_email' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            status: true,
            attempts: true,
            maxAttempts: true,
            lastError: true,
            runAfter: true,
            completedAt: true,
            createdAt: true,
          },
        }),
      ]);

      const countsByStatus: Record<string, number> = {
        Queued: 0,
        Delivered: 0,
        Skipped: 0,
        Failed: 0,
      };
      for (const row of groupedCounts) {
        countsByStatus[row.status] = row._count._all;
      }

      res.json({
        smtpConfigured: isSmtpConfigured(),
        verification: smtpStatus,
        countsByStatus,
        recentDeliveries: recentDeliveries.map((d) => ({
          ...d,
          sentAt: d.sentAt.toISOString(),
        })),
        recentJobs: recentJobs.map((j) => ({
          ...j,
          runAfter: j.runAfter.toISOString(),
          completedAt: j.completedAt ? j.completedAt.toISOString() : null,
          createdAt: j.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error('GET /api/admin/email-delivery error:', err);
      res.status(500).json({ error: 'Failed to load email delivery telemetry.' });
    }
  }
);

// Certificate issuance & revocation
adminOpsRouter.post(
  '/certificates',
  requireAuth,
  requireRoles('admin', 'instructor'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermission(req.authUser!, 'certificates:issue');
        if (!permitted) {
          res.status(403).json({ error: 'Your instructor permissions do not allow issuing certificates.' });
          return;
        }
      }
      const parsed = issueCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid certificate request.' });
        return;
      }

      const result = await issueVerifiedCertificate({
        actor: req.authUser!,
        ...parsed.data,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ certificateCode: result.certificateCode, dashboard });
    } catch (err) {
      console.error('POST /api/certificates error:', err);
      res.status(500).json({ error: 'Failed to issue certificate.' });
    }
  }
);

adminOpsRouter.post(
  '/certificates/:id/revoke',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = revokeCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Revocation reason is required.' });
        return;
      }

      const cert = await prisma.certificate.findUnique({ where: { id: req.params.id } });
      if (!cert) {
        res.status(404).json({ error: 'Certificate not found.' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.certificate.update({
          where: { id: cert.id },
          data: { status: 'Revoked', revokedReason: parsed.data.reason },
        });

        await tx.notification.create({
          data: {
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: cert.studentId,
            kind: 'certificate',
            title: `Certificate Revoked · ${cert.certificateCode}`,
            message: `Certificate ${cert.certificateCode} has been revoked: ${parsed.data.reason}`,
            relatedCourseId: cert.courseId,
            read: false,
          },
        });
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'CERTIFICATE_REVOKED',
        entityType: 'certificate',
        entityId: cert.id,
        summary: `Revoked certificate ${cert.certificateCode}: ${parsed.data.reason}`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('POST /api/certificates/:id/revoke error:', err);
      res.status(500).json({ error: 'Failed to revoke certificate.' });
    }
  }
);

adminOpsRouter.get(
  '/certificates/:id/download',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cert = await prisma.certificate.findUnique({
        where: { id: req.params.id },
        include: {
          student: { select: { name: true, studentCode: true } },
          course: { select: { code: true, title: true } },
          template: true,
        },
      });
      if (!cert) {
        res.status(404).json({ error: 'Certificate not found.' });
        return;
      }

      if (req.authUser!.role === 'student' && cert.studentId !== req.authUser!.id) {
        res.status(403).json({ error: 'Access denied to another student\'s certificate.' });
        return;
      }
      if (req.authUser!.role === 'instructor') {
        const assigned = await canInstructorAccessCourse(req.authUser!.id, cert.courseId);
        if (!assigned) {
          res.status(403).json({ error: 'Access denied to certificate outside your assigned courses.' });
          return;
        }
      }

      const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
      const academyName = academy?.name || 'IGS — InfoCom Global Services';
      const academySubtitle = academy?.legalName || 'Computer Institute · Downtown Sopore';
      const academyAddress =
        academy?.address ||
        'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

      const hostOrigin =
        process.env.APP_URL ||
        (req.get('host') ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000');
      const verifyUrl = `${hostOrigin.replace(/\/+$/, '')}/verify-certificate?verifyCert=${encodeURIComponent(
        cert.certificateCode
      )}`;
      const qrPng = await QRCode.toBuffer(verifyUrl, {
        width: 160,
        margin: 1,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 36,
          info: {
            Title: `${cert.certificateCode} — ${academyName}`,
            Author: academyName,
          },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (e) => reject(e));

        const w = doc.page.width;
        const h = doc.page.height;

        // Crisp double border
        doc.rect(24, 24, w - 48, h - 48).lineWidth(2).stroke('#1E3A8A');
        doc.rect(32, 32, w - 64, h - 64).lineWidth(0.75).stroke('#94A3B8');

        const officialLogoPath = path.resolve(
          process.cwd(),
          'public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg'
        );
        if (fs.existsSync(officialLogoPath)) {
          doc.image(officialLogoPath, 54, 46, { fit: [120, 62] });
        }

        // Header
        doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor('#0F172A')
          .text(academyName.toUpperCase(), 56, 54, { align: 'center', width: w - 112 });
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#475569')
          .text(`${academySubtitle} · Learn Today, Build Tomorrow.`, 56, 78, {
            align: 'center',
            width: w - 112,
          });
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#64748B')
          .text(academyAddress, 56, 94, { align: 'center', width: w - 112 });

        // Title
        const certTitle = cert.template?.titleFormat || 'VERIFIED CERTIFICATE OF COMPLETION';
        doc
          .font('Helvetica-Bold')
          .fontSize(24)
          .fillColor('#1E3A8A')
          .text(certTitle.toUpperCase(), 56, 134, { align: 'center', width: w - 112 });

        doc
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#475569')
          .text('This is to formally certify that', 56, 178, { align: 'center', width: w - 112 });

        // Recipient
        doc
          .font('Helvetica-Bold')
          .fontSize(26)
          .fillColor('#0F172A')
          .text(cert.student?.name ?? 'Student', 56, 204, { align: 'center', width: w - 112 });

        if (cert.student?.studentCode) {
          doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor('#64748B')
            .text(`Student ID: ${cert.student.studentCode}`, 56, 238, {
              align: 'center',
              width: w - 112,
            });
        }

        doc
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#475569')
          .text('has successfully satisfied all curriculum, assessment, and attendance requirements for', 56, 266, {
            align: 'center',
            width: w - 112,
          });

        const courseTitle = cert.courseTitleSnapshot ?? cert.course?.title ?? '';
        const courseCode = cert.course?.code ? `${cert.course.code} — ` : '';
        doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor('#0F172A')
          .text(`${courseCode}${courseTitle}`, 56, 292, { align: 'center', width: w - 112 });

        // Metrics row
        const metricsText = `Final Score: ${cert.finalScore.toFixed(2)}%   ·   Grade: ${cert.letterGrade}   ·   Attendance: ${cert.attendanceRate}%   ·   Status: ${cert.status}`;
        doc
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .fillColor(cert.status === 'Revoked' ? '#B91C1C' : '#0F766E')
          .text(metricsText, 56, 330, { align: 'center', width: w - 112 });

        if (cert.status === 'Revoked') {
          doc
            .font('Helvetica-Bold')
            .fontSize(14)
            .fillColor('#B91C1C')
            .text(
              `REVOKED CERTIFICATE${cert.revokedReason ? ` — ${cert.revokedReason}` : ''}`,
              56,
              352,
              { align: 'center', width: w - 112 }
            );
        }

        // Bottom signature + QR block
        const footerY = h - 155;
        doc
          .moveTo(64, footerY + 46)
          .lineTo(280, footerY + 46)
          .lineWidth(0.75)
          .stroke('#94A3B8');
        doc
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .fillColor('#0F172A')
          .text(cert.template?.signatoryName || cert.issuedByName, 64, footerY + 52, { width: 220 });
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#475569')
          .text(cert.template?.signatoryTitle || academyName, 64, footerY + 68, { width: 220 });

        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#334155')
          .text(`Certificate Code: ${cert.certificateCode}`, 310, footerY + 34, { width: 280 })
          .text(`Issued Date: ${cert.issuedAt.toISOString().slice(0, 10)}`, 310, footerY + 50, {
            width: 280,
          })
          .text(`SHA-256 Digest: ${cert.verificationHash.slice(0, 24)}...`, 310, footerY + 66, {
            width: 280,
          });

        // QR Code
        doc.image(qrPng, w - 156, footerY - 6, { width: 92, height: 92 });
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#64748B')
          .text('Scan to verify', w - 156, footerY + 90, { width: 92, align: 'center' });

        doc.end();
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${cert.certificateCode}.pdf"`
      );
      res.send(pdfBuffer);
    } catch (err) {
      console.error('GET /api/certificates/:id/download error:', err);
      res.status(500).json({ error: 'Failed to download certificate.' });
    }
  }
);

// Automated Session Reminders & Notification Read State
adminOpsRouter.post(
  '/notifications/run-reminders',
  requireAuth,
  requireRoles('admin', 'instructor'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const created = await runSessionReminderSweep();
      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ createdCount: created.length, dashboard });
    } catch (err) {
      console.error('POST /api/notifications/run-reminders error:', err);
      res.status(500).json({ error: 'Failed to run session reminder sweep.' });
    }
  }
);

adminOpsRouter.patch(
  '/notifications/:id/read',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notif = await prisma.notification.findUnique({
        where: { id: req.params.id },
      });
      if (!notif) {
        res.status(404).json({ error: 'Notification not found.' });
        return;
      }
      if (notif.userId !== req.authUser!.id) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }

      await prisma.notification.update({
        where: { id: notif.id },
        data: { read: true },
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/notifications/:id/read error:', err);
      res.status(500).json({ error: 'Failed to update notification state.' });
    }
  }
);

adminOpsRouter.post(
  '/notifications/read-all',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.notification.updateMany({
        where: { userId: req.authUser!.id },
        data: { read: true },
      });
      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('POST /api/notifications/read-all error:', err);
      res.status(500).json({ error: 'Failed to mark notifications read.' });
    }
  }
);

adminOpsRouter.get(
  '/notifications/preferences',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const saved = await prisma.notificationPreference.findMany({
        where: { userId: req.authUser!.id },
      });
      const defaultKinds = ['all', 'attendance', 'reminder', 'grade', 'enrollment', 'finance', 'certificate'];
      const channels: Array<'in_app' | 'email'> = ['in_app', 'email'];
      const savedMap = new Map(saved.map((s) => [`${s.channel}:${s.kind}`, s.enabled]));

      const preferences = channels.flatMap((channel) =>
        defaultKinds.map((kind) => ({
          channel,
          kind,
          enabled: savedMap.get(`${channel}:${kind}`) ?? true,
        }))
      );

      res.json({ preferences });
    } catch (err) {
      console.error('GET /api/notifications/preferences error:', err);
      res.status(500).json({ error: 'Failed to load notification preferences.' });
    }
  }
);

adminOpsRouter.put(
  '/notifications/preferences',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = notificationPreferencesUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid preference settings.' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        for (const pref of parsed.data.preferences) {
          await tx.notificationPreference.upsert({
            where: {
              userId_channel_kind: {
                userId: req.authUser!.id,
                channel: pref.channel,
                kind: pref.kind,
              },
            },
            update: { enabled: pref.enabled },
            create: {
              id: `np-${crypto.randomUUID().slice(0, 8)}`,
              userId: req.authUser!.id,
              channel: pref.channel,
              kind: pref.kind,
              enabled: pref.enabled,
            },
          });
        }
      });

      res.json({ ok: true, preferences: parsed.data.preferences });
    } catch (err) {
      console.error('PUT /api/notifications/preferences error:', err);
      res.status(500).json({ error: 'Failed to save notification preferences.' });
    }
  }
);

// Document Vault (Object storage with PostgreSQL metadata)
adminOpsRouter.post(
  '/documents',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = uploadDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid document payload.' });
        return;
      }

      const input = parsed.data;
      const isStudent = req.authUser!.role === 'student';
      const studentAllowedCategories = new Set(['ID Verification', 'Assignment', 'Other']);
      if (isStudent && !studentAllowedCategories.has(input.category)) {
        res.status(403).json({ error: 'Students may only upload ID Verification, Assignment, or Other documents.' });
        return;
      }

      const ownerUserId = isStudent ? req.authUser!.id : (input.ownerUserId || req.authUser!.id);

      if (req.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermission(req.authUser!, 'documents:upload');
        if (!permitted) {
          res.status(403).json({ error: 'Your instructor permissions do not allow uploading documents.' });
          return;
        }
        if (input.category === 'Receipt') {
          res.status(403).json({ error: 'Instructors cannot upload financial receipt documents.' });
          return;
        }
        if (input.courseId) {
          const allowedCourse = await canInstructorAccessCourse(req.authUser!.id, input.courseId);
          if (!allowedCourse) {
            res.status(403).json({ error: 'You are not assigned to upload documents for this course.' });
            return;
          }
        }
        if (ownerUserId !== req.authUser!.id) {
          const allowedStudent = await canInstructorAccessStudent(req.authUser!.id, ownerUserId);
          if (!allowedStudent) {
            res.status(403).json({ error: 'You cannot upload documents for a student outside your assigned courses.' });
            return;
          }
        }
      }

      const ownerRow = await prisma.user.findUnique({ where: { id: ownerUserId } });
      if (!ownerRow) {
        res.status(400).json({ error: 'Document owner account not found.' });
        return;
      }

      let stored;
      try {
        stored = await storePrivateDocument({
          fileName: input.fileName,
          mimeType: input.mimeType,
          contentBase64: input.contentBase64,
        });
      } catch (storageErr) {
        res.status(400).json({
          error: storageErr instanceof Error ? storageErr.message : 'Invalid file attachment.',
        });
        return;
      }

      const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;

      await prisma.fileAsset.create({
        data: {
          id: docId,
          ownerUserId,
          courseId: input.courseId || null,
          title: input.title,
          category: input.category,
          fileName: stored.cleanFileName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          contentBase64: '',
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          checksumSha256: stored.checksumSha256,
          uploadedByUserId: req.authUser!.id,
          isArchived: false,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'DOCUMENT_UPLOADED',
        entityType: 'document',
        entityId: docId,
        summary: `Uploaded "${input.title}" (${input.category}, ${stored.sizeBytes} bytes, ${stored.storageProvider}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ documentId: docId, dashboard });
    } catch (err) {
      console.error('POST /api/documents error:', err);
      res.status(500).json({ error: 'Failed to upload document.' });
    }
  }
);

adminOpsRouter.get(
  '/documents/:id/download',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await getActiveDocumentContent(req.params.id, req.authUser!);
      if (!result) {
        res.status(404).json({ error: 'Document not found or archived.' });
        return;
      }
      if (result === 'FORBIDDEN') {
        res.status(403).json({ error: 'You do not have access to download this document.' });
        return;
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.fileName.replace(/["\r\n]/g, '')}"`
      );
      res.send(result.buffer);
    } catch (err) {
      console.error('GET /api/documents/:id/download error:', err);
      res.status(500).json({ error: 'Failed to download document.' });
    }
  }
);

adminOpsRouter.patch(
  '/documents/:id/archive',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const doc = await prisma.fileAsset.findUnique({ where: { id: req.params.id } });
      if (!doc) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }

      const canArchive =
        req.authUser!.role === 'admin' ||
        doc.ownerUserId === req.authUser!.id ||
        doc.uploadedByUserId === req.authUser!.id;
      if (!canArchive) {
        res.status(403).json({ error: 'Only an administrator or document owner can archive this record.' });
        return;
      }

      await prisma.fileAsset.update({
        where: { id: doc.id },
        data: { isArchived: true },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'DOCUMENT_ARCHIVED',
        entityType: 'document',
        entityId: doc.id,
        summary: `Archived document "${doc.title}" (${doc.fileName}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/documents/:id/archive error:', err);
      res.status(500).json({ error: 'Failed to archive document.' });
    }
  }
);
