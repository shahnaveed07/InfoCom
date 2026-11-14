import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { toCents } from '../../src/shared/academic.ts';
import {
  createInvoiceSchema,
  createUserSchema,
  issueCertificateSchema,
  recordPaymentSchema,
  revokeCertificateSchema,
  updateUserSchema,
  uploadDocumentSchema,
} from '../../src/shared/validation.ts';
import {
  findUserByEmail,
  generateNextInvoiceNumber,
  generateUniqueStaffCode,
  generateUniqueStudentCode,
  getActiveDocumentContent,
  getUserDashboardById,
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
      const studentCode =
        input.role === 'student' ? await generateUniqueStudentCode() : null;
      const staffCode =
        input.role !== 'student' ? await generateUniqueStaffCode() : null;

      const newUserHash = await hashPassword(input.password);
      const created = await prisma.$transaction(async (tx) => {
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
            passwordUpdatedAt: new Date(),
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

        return user;
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: created.id,
        summary: `Created ${created.role} account for ${created.name} (${created.email}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ user: toPublicUser(created), dashboard });
    } catch (err) {
      console.error('POST /api/users error:', err);
      res.status(500).json({ error: 'Failed to create user account.' });
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
      const [student, course] = await Promise.all([
        prisma.user.findFirst({ where: { id: input.studentId, role: 'student' } }),
        prisma.course.findUnique({ where: { id: input.courseId } }),
      ]);

      if (!student || !course) {
        res.status(400).json({ error: 'Valid student and course are required.' });
        return;
      }

      const invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const invoiceNumber = await generateNextInvoiceNumber();
      const formattedAmount = Number(input.amountDue).toFixed(2);

      await prisma.$transaction(async (tx) => {
        await tx.invoice.create({
          data: {
            id: invoiceId,
            invoiceNumber,
            studentId: student.id,
            enrollmentId: input.enrollmentId ?? null,
            courseId: course.id,
            description: input.description,
            subtotal: formattedAmount,
            amountDue: formattedAmount,
            amountPaid: '0.00',
            currency: 'USD',
            status: 'Unpaid',
            dueDate: new Date(input.dueDate),
            issuedByUserId: req.authUser!.id,
          },
        });

        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId,
            itemType: 'Tuition',
            description: input.description,
            quantity: 1,
            unitPrice: formattedAmount,
            lineTotal: formattedAmount,
          },
        });

        const notif = await tx.notification.create({
          data: {
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: student.id,
            kind: 'finance',
            title: `Tuition Invoice Issued · ${invoiceNumber}`,
            message: `Invoice ${invoiceNumber} for $${formattedAmount} (${input.description}) is due on ${new Date(input.dueDate).toLocaleDateString('en-US')}.`,
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
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'INVOICE_ISSUED',
        entityType: 'fee_invoice',
        entityId: invoiceId,
        summary: `Issued invoice ${invoiceNumber} ($${formattedAmount}) to ${student.name}.`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ invoiceNumber, dashboard });
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

      const payload = {
        certificateCode: cert.certificateCode,
        verificationHash: cert.verificationHash,
        studentName: cert.student?.name ?? 'Student',
        studentCode: cert.student?.studentCode ?? '',
        courseCode: cert.course?.code ?? '',
        courseTitle: cert.courseTitleSnapshot ?? cert.course?.title ?? '',
        finalScore: cert.finalScore.toFixed(2),
        letterGrade: cert.letterGrade,
        attendanceRate: cert.attendanceRate,
        issuedByName: cert.issuedByName,
        status: cert.status,
        issuedAt: cert.issuedAt.toISOString(),
      };
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${cert.certificateCode}.json"`
      );
      res.json(payload);
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

// Document Vault (PostgreSQL persisted files)
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
      const decoded = Buffer.from(input.contentBase64, 'base64');
      if (decoded.byteLength === 0 || decoded.byteLength > 2 * 1024 * 1024) {
        res.status(400).json({ error: 'Document must be non-empty and at most 2 MB.' });
        return;
      }

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

      const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
      const checksumSha256 = crypto.createHash('sha256').update(decoded).digest('hex');

      await prisma.fileAsset.create({
        data: {
          id: docId,
          ownerUserId,
          courseId: input.courseId || null,
          title: input.title,
          category: input.category,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: decoded.byteLength,
          contentBase64: input.contentBase64,
          storageProvider: 'postgres',
          checksumSha256,
          uploadedByUserId: req.authUser!.id,
          isArchived: false,
        },
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'DOCUMENT_UPLOADED',
        entityType: 'document',
        entityId: docId,
        summary: `Uploaded "${input.title}" (${input.category}, ${decoded.byteLength} bytes).`,
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

      const buffer = Buffer.from(result.contentBase64, 'base64');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.fileName.replace(/["\r\n]/g, '')}"`
      );
      res.send(buffer);
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
