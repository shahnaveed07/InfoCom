import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  admissions,
  certificates,
  courses,
  documents,
  enrollments,
  feeInvoices,
  notifications,
  users,
} from '../../src/db/schema.ts';
import { toCents } from '../../src/shared/academic.ts';
import {
  createAdmissionSchema,
  createInvoiceSchema,
  createUserSchema,
  issueCertificateSchema,
  recordPaymentSchema,
  revokeCertificateSchema,
  updateAdmissionSchema,
  updateUserSchema,
  uploadDocumentSchema,
} from '../../src/shared/validation.ts';
import {
  findUserByEmail,
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
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { ensureDatabaseMigratedAndSeeded } from '../migrate.ts';

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

// Public admission application submission
adminOpsRouter.post('/admissions/public', async (req: Request, res: Response) => {
  try {
    await ensureDatabaseMigratedAndSeeded();
    const parsed = createAdmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission details.' });
      return;
    }
    const input = parsed.data;
    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.id, input.targetCourseId))
      .limit(1);
    if (!course) {
      res.status(400).json({ error: 'Selected target course was not found.' });
      return;
    }

    const admissionId = `adm-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(admissions).values({
      id: admissionId,
      applicantName: input.applicantName,
      applicantEmail: input.applicantEmail.toLowerCase(),
      phone: input.phone,
      targetCourseId: course.id,
      preferredCohort: input.preferredCohort,
      status: 'Submitted',
      notes: input.notes,
    });

    await recordAuditLog({
      actor: { email: input.applicantEmail.toLowerCase(), role: 'applicant' },
      action: 'ADMISSION_SUBMITTED',
      entityType: 'admission',
      entityId: admissionId,
      summary: `Public admission application submitted by ${input.applicantName} for ${course.code}.`,
    });

    res.status(201).json({ admissionId });
  } catch (err) {
    console.error('POST /api/admissions/public error:', err);
    res.status(500).json({ error: 'Failed to submit admission application.' });
  }
});

// Admin-only User Management
adminOpsRouter.post(
  '/users',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await ensureDatabaseMigratedAndSeeded();
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
      const randNum = Math.floor(100 + Math.random() * 899);

      const [created] = await db
        .insert(users)
        .values({
          id,
          name: input.name,
          email: input.email.toLowerCase(),
          role: input.role,
          status: 'active',
          studentCode: input.role === 'student' ? `NTA-2026-${randNum}` : null,
          staffCode: input.role !== 'student' ? `INF-STF-${randNum}` : null,
          department: input.department || (input.role === 'admin' ? 'Administration' : input.role === 'instructor' ? 'Academic Faculty' : null),
          phone: input.phone || null,
          passwordHash: hashPassword(input.password),
        })
        .returning();

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
      await ensureDatabaseMigratedAndSeeded();
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

      const [existing] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.role !== undefined) updates.role = input.role;
      if (input.status !== undefined) updates.status = input.status;
      if (input.department !== undefined) updates.department = input.department;
      if (input.phone !== undefined) updates.phone = input.phone;

      await db.update(users).set(updates).where(eq(users.id, targetId));

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

// Admissions management (Admin)
adminOpsRouter.get(
  '/admissions',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ admissions: dashboard.admissions });
    } catch (err) {
      console.error('GET /api/admissions error:', err);
      res.status(500).json({ error: 'Failed to load admissions.' });
    }
  }
);

adminOpsRouter.post(
  '/admissions',
  requireAuth,
  requireRoles('admin', 'instructor'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await ensureDatabaseMigratedAndSeeded();
      const parsed = createAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission details.' });
        return;
      }
      const input = parsed.data;
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, input.targetCourseId))
        .limit(1);
      if (!course) {
        res.status(400).json({ error: 'Selected course does not exist.' });
        return;
      }

      const admissionId = `adm-${crypto.randomUUID().slice(0, 8)}`;
      await db.insert(admissions).values({
        id: admissionId,
        applicantName: input.applicantName,
        applicantEmail: input.applicantEmail.toLowerCase(),
        phone: input.phone,
        targetCourseId: course.id,
        preferredCohort: input.preferredCohort,
        status: 'Submitted',
        notes: input.notes,
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'ADMISSION_CREATED',
        entityType: 'admission',
        entityId: admissionId,
        summary: `Logged admission application for ${input.applicantName} (${course.code}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ admissionId, dashboard });
    } catch (err) {
      console.error('POST /api/admissions error:', err);
      res.status(500).json({ error: 'Failed to record admission application.' });
    }
  }
);

adminOpsRouter.patch(
  '/admissions/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await ensureDatabaseMigratedAndSeeded();
      const parsed = updateAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission update.' });
        return;
      }

      const [admission] = await db
        .select()
        .from(admissions)
        .where(eq(admissions.id, req.params.id))
        .limit(1);
      if (!admission) {
        res.status(404).json({ error: 'Admission application not found.' });
        return;
      }

      const input = parsed.data;
      const shouldConvert = Boolean(input.convertToEnrollment) && !admission.convertedUserId;

      await db.transaction(async (tx) => {
        if (shouldConvert) {
          const [course] = await tx
            .select()
            .from(courses)
            .where(eq(courses.id, admission.targetCourseId))
            .limit(1);
          if (!course) {
            throw new Error('Target course not found for admission conversion.');
          }

          const existingUsers = await tx
            .select()
            .from(users)
            .where(eq(users.email, admission.applicantEmail.toLowerCase()))
            .limit(1);

          let studentId = existingUsers[0]?.id;
          if (!studentId) {
            studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;
            await tx.insert(users).values({
              id: studentId,
              name: admission.applicantName,
              email: admission.applicantEmail.toLowerCase(),
              role: 'student',
              status: 'active',
              studentCode: `NTA-2026-${Math.floor(100 + Math.random() * 899)}`,
              phone: admission.phone || null,
              passwordHash: hashPassword('Student!2026'),
            });
          }

          const existingEnr = await tx
            .select()
            .from(enrollments)
            .where(
              and(
                eq(enrollments.studentId, studentId),
                eq(enrollments.courseId, course.id)
              )
            );
          const hasActive = existingEnr.some((e) => e.status !== 'Dropped');

          let enrollmentId = existingEnr[0]?.id;
          if (!hasActive) {
            enrollmentId = `enr-${crypto.randomUUID().slice(0, 8)}`;
            await tx.insert(enrollments).values({
              id: enrollmentId,
              studentId,
              courseId: course.id,
              cohort: admission.preferredCohort,
              status: 'Active',
              completedModuleIds: [],
            });
          }

          if (toCents(String(course.tuitionFee)) > 0) {
            await tx.insert(feeInvoices).values({
              id: `inv-${crypto.randomUUID().slice(0, 8)}`,
              invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 8999)}`,
              studentId,
              enrollmentId: enrollmentId ?? null,
              courseId: course.id,
              description: `${course.code} ${course.title} Tuition (${admission.preferredCohort})`,
              amountDue: String(course.tuitionFee),
              amountPaid: '0.00',
              currency: 'USD',
              status: 'Unpaid',
              dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
              issuedByUserId: req.authUser!.id,
            });
          }

          await tx.insert(notifications).values({
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: studentId,
            kind: 'admission',
            title: `Admission Accepted · ${course.code}`,
            message: `Your admission to ${course.title} (${admission.preferredCohort}) is confirmed and tuition invoice has been issued.`,
            relatedCourseId: course.id,
            read: false,
          });

          await tx
            .update(admissions)
            .set({
              status: 'Enrolled',
              notes: input.notes ?? admission.notes,
              reviewedByUserId: req.authUser!.id,
              convertedUserId: studentId,
              reviewedAt: new Date(),
            })
            .where(eq(admissions.id, admission.id));
        } else {
          await tx
            .update(admissions)
            .set({
              status: input.status,
              notes: input.notes ?? admission.notes,
              reviewedByUserId: req.authUser!.id,
              reviewedAt: new Date(),
            })
            .where(eq(admissions.id, admission.id));
        }
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: shouldConvert ? 'ADMISSION_CONVERTED' : 'ADMISSION_REVIEWED',
        entityType: 'admission',
        entityId: admission.id,
        summary: shouldConvert
          ? `Accepted and enrolled applicant ${admission.applicantName} with tuition invoice.`
          : `Updated admission ${admission.id} status to ${input.status}.`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.json({ dashboard });
    } catch (err) {
      console.error('PATCH /api/admissions/:id error:', err);
      res.status(500).json({ error: 'Failed to update admission application.' });
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
      await ensureDatabaseMigratedAndSeeded();
      const parsed = createInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid invoice details.' });
        return;
      }

      const input = parsed.data;
      const [student] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, input.studentId), eq(users.role, 'student')))
        .limit(1);
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, input.courseId))
        .limit(1);

      if (!student || !course) {
        res.status(400).json({ error: 'Valid student and course are required.' });
        return;
      }

      const invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const invoiceNumber = `INV-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const formattedAmount = Number(input.amountDue).toFixed(2);

      await db.transaction(async (tx) => {
        await tx.insert(feeInvoices).values({
          id: invoiceId,
          invoiceNumber,
          studentId: student.id,
          enrollmentId: input.enrollmentId ?? null,
          courseId: course.id,
          description: input.description,
          amountDue: formattedAmount,
          amountPaid: '0.00',
          currency: 'USD',
          status: 'Unpaid',
          dueDate: new Date(input.dueDate),
          issuedByUserId: req.authUser!.id,
        });

        await tx.insert(notifications).values({
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: student.id,
          kind: 'finance',
          title: `Tuition Invoice Issued · ${invoiceNumber}`,
          message: `Invoice ${invoiceNumber} for $${formattedAmount} (${input.description}) is due on ${new Date(input.dueDate).toLocaleDateString('en-US')}.`,
          relatedCourseId: course.id,
          read: false,
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
      await ensureDatabaseMigratedAndSeeded();
      const [invoice] = await db
        .select()
        .from(feeInvoices)
        .where(eq(feeInvoices.id, req.params.id))
        .limit(1);
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      if (toCents(String(invoice.amountPaid)) > 0) {
        res.status(400).json({ error: 'Invoices with recorded payments cannot be voided to preserve ledger integrity.' });
        return;
      }

      await db
        .update(feeInvoices)
        .set({ status: 'Voided', isArchived: true, updatedAt: new Date() })
        .where(eq(feeInvoices.id, invoice.id));

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
      await ensureDatabaseMigratedAndSeeded();
      const parsed = revokeCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Revocation reason is required.' });
        return;
      }

      const [cert] = await db
        .select()
        .from(certificates)
        .where(eq(certificates.id, req.params.id))
        .limit(1);
      if (!cert) {
        res.status(404).json({ error: 'Certificate not found.' });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(certificates)
          .set({ status: 'Revoked', revokedReason: parsed.data.reason })
          .where(eq(certificates.id, cert.id));

        await tx.insert(notifications).values({
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: cert.studentId,
          kind: 'certificate',
          title: `Certificate Revoked · ${cert.certificateCode}`,
          message: `Certificate ${cert.certificateCode} has been revoked: ${parsed.data.reason}`,
          relatedCourseId: cert.courseId,
          read: false,
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
      await ensureDatabaseMigratedAndSeeded();
      const [notif] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, req.params.id))
        .limit(1);
      if (!notif) {
        res.status(404).json({ error: 'Notification not found.' });
        return;
      }
      if (req.authUser!.role === 'student' && notif.userId !== req.authUser!.id) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }

      await db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.id, notif.id));

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
      await ensureDatabaseMigratedAndSeeded();
      if (req.authUser!.role === 'student') {
        await db
          .update(notifications)
          .set({ read: true })
          .where(eq(notifications.userId, req.authUser!.id));
      } else {
        await db.update(notifications).set({ read: true });
      }
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
      await ensureDatabaseMigratedAndSeeded();
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
      const [ownerRow] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1);
      if (!ownerRow) {
        res.status(400).json({ error: 'Document owner account not found.' });
        return;
      }

      const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
      await db.insert(documents).values({
        id: docId,
        ownerUserId,
        courseId: input.courseId || null,
        title: input.title,
        category: input.category,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: decoded.byteLength,
        contentBase64: input.contentBase64,
        uploadedByUserId: req.authUser!.id,
        isArchived: false,
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
      await ensureDatabaseMigratedAndSeeded();
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, req.params.id))
        .limit(1);
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

      await db
        .update(documents)
        .set({ isArchived: true })
        .where(eq(documents.id, doc.id));

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
