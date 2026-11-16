import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import {
  isValidAdmissionTransition,
  shouldActivatePortalOnApproval,
  toCents,
} from '../../src/shared/academic.ts';
import type {
  AdmissionApplication,
  AdmissionDetailPayload,
  AdmissionDocumentRecord,
  AdmissionDocumentStatus,
  AdmissionStatus,
  UserPublic,
} from '../../src/shared/types.ts';
import {
  approveAdmissionSchema,
  createAdmissionSchema,
  updateAdmissionSchema,
  uploadAdmissionDocumentSchema,
  verifyAdmissionDocumentSchema,
} from '../../src/shared/validation.ts';
import {
  generateNextInvoiceNumber,
  generateUniqueApplicationNumber,
  generateUniqueStudentCode,
  getPortalActivationPolicy,
  getUserDashboardById,
  issueAccountSetupToken,
  recordAuditLog,
  toPublicUser,
} from '../ams-service.ts';
import { prisma } from '../db/prisma.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/security.ts';
import { queueTransactionalEmail } from '../jobs/worker.ts';
import { readPrivateDocument, storePrivateDocument } from '../storage/index.ts';

export const admissionsRouter = Router();

class WorkflowError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const publicAdmissionLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  keyPrefix: 'public-admission',
  message: 'Too many admission submissions from this network. Please wait before submitting again.',
});

function parseOptionalDate(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const ms = Date.parse(val);
  return Number.isNaN(ms) ? null : new Date(ms);
}

async function notifyApplicant(
  tx: Prisma.TransactionClient,
  params: {
    applicationId: string;
    applicantEmail: string;
    userId?: string | null;
    courseId?: string | null;
    title: string;
    message: string;
  }
) {
  const email = params.applicantEmail.trim().toLowerCase();
  let resolvedUserId = params.userId ?? null;
  if (!resolvedUserId && email) {
    const matchedUser = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    resolvedUserId = matchedUser?.id ?? null;
  }

  let notificationId: string | null = null;
  if (resolvedUserId) {
    const notif = await tx.notification.create({
      data: {
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: resolvedUserId,
        kind: 'admission',
        title: params.title,
        message: params.message,
        relatedCourseId: params.courseId ?? null,
        read: false,
      },
    });
    notificationId = notif.id;
  }

  await tx.deliveryLog.create({
    data: {
      id: `del-${crypto.randomUUID().slice(0, 8)}`,
      notificationId,
      userId: resolvedUserId,
      applicationId: params.applicationId,
      channel: 'in_app',
      recipient: email || params.applicationId,
      status: 'Delivered',
    },
  });

  if (email && email.includes('@')) {
    await queueTransactionalEmail(tx, {
      notificationId,
      userId: resolvedUserId,
      applicationId: params.applicationId,
      kind: 'admission',
      recipientEmail: email,
      subject: `${params.title} — IGS — InfoCom Global Services`,
      bodyText: params.message,
    });
  }
}

async function buildAdmissionDetailPayload(applicationId: string): Promise<AdmissionDetailPayload | null> {
  const app = await prisma.admissionApplication.findUnique({
    where: { id: applicationId },
    include: {
      admissionDocuments: {
        include: {
          fileAsset: {
            select: {
              id: true,
              title: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              isArchived: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      statusHistory: {
        orderBy: { changedAt: 'desc' },
      },
      convertedUser: true,
    },
  });
  if (!app) return null;

  const [batches, enrollments, feePlans, portalActivationPolicy] = await Promise.all([
    prisma.batch.findMany({
      where: { courseId: app.targetCourseId, status: { not: 'Archived' } },
      include: {
        instructor: { select: { name: true } },
        classroom: { select: { name: true } },
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.enrollment.findMany({
      where: {
        courseId: app.targetCourseId,
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
      select: { cohortId: true, cohort: true },
    }),
    prisma.feePlan.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    }),
    getPortalActivationPolicy(),
  ]);

  const documents: AdmissionDocumentRecord[] = app.admissionDocuments
    .filter((d) => !d.fileAsset.isArchived)
    .map((d) => ({
      id: d.id,
      applicationId: d.applicationId,
      fileAssetId: d.fileAssetId,
      documentType: d.documentType,
      title: d.fileAsset.title,
      fileName: d.fileAsset.fileName,
      mimeType: d.fileAsset.mimeType,
      sizeBytes: d.fileAsset.sizeBytes,
      verifiedStatus: d.verifiedStatus as AdmissionDocumentStatus,
      verificationRemarks: d.verificationRemarks,
      verifiedByUserId: d.verifiedByUserId,
      verifiedByName: d.verifiedByName,
      verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      isLatest: d.isLatest,
      createdAt: d.createdAt.toISOString(),
    }));

  const statusHistory = app.statusHistory.map((h) => ({
    id: h.id,
    applicationId: h.applicationId,
    previousStatus: h.previousStatus,
    newStatus: h.newStatus,
    reason: h.reason,
    actorUserId: h.actorUserId,
    actorName: h.actorName,
    actorRole: h.actorRole,
    changedAt: h.changedAt.toISOString(),
  }));

  const mappedApp: AdmissionApplication = {
    id: app.id,
    applicationNumber: app.applicationNumber,
    applicantName: app.applicantName,
    applicantEmail: app.applicantEmail,
    phone: app.phone,
    dateOfBirth: app.dateOfBirth ? app.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: app.gender,
    nationality: app.nationality,
    address: app.address,
    city: app.city,
    postalCode: app.postalCode,
    guardianName: app.guardianName,
    guardianRelationship: app.guardianRelationship,
    guardianPhone: app.guardianPhone,
    guardianEmail: app.guardianEmail,
    previousQualification: app.previousQualification,
    previousInstitution: app.previousInstitution,
    graduationYear: app.graduationYear,
    previousScore: app.previousScore,
    targetCourseId: app.targetCourseId,
    targetBatchId: app.targetBatchId,
    allocatedBatchId: app.allocatedBatchId,
    feePlanId: app.feePlanId,
    preferredCohort: app.preferredCohort,
    status: app.status as AdmissionStatus,
    notes: app.notes,
    applicantRemarks: app.applicantRemarks,
    reviewRemarks: app.reviewRemarks,
    rejectionReason: app.rejectionReason,
    reviewedByUserId: app.reviewedByUserId,
    convertedUserId: app.convertedUserId,
    portalActivated: app.portalActivated,
    portalActivatedAt: app.portalActivatedAt ? app.portalActivatedAt.toISOString() : null,
    submittedAt: app.submittedAt.toISOString(),
    draftSavedAt: app.draftSavedAt ? app.draftSavedAt.toISOString() : null,
    reviewedAt: app.reviewedAt ? app.reviewedAt.toISOString() : null,
    approvedAt: app.approvedAt ? app.approvedAt.toISOString() : null,
    updatedAt: app.updatedAt.toISOString(),
    documentsCount: documents.length,
    verifiedDocumentsCount: documents.filter((d) => d.verifiedStatus === 'Verified').length,
    documents,
    statusHistory,
  };

  return {
    application: mappedApp,
    documents,
    statusHistory,
    eligibleBatches: batches.map((b) => {
      const enrolledCount = enrollments.filter(
        (e) => e.cohortId === b.id || e.cohort === b.name
      ).length;
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        courseId: b.courseId,
        termId: b.termId,
        instructorId: b.instructorId,
        instructorName: b.instructor?.name ?? 'Instructor',
        classroomId: b.classroomId,
        classroomName: b.classroom?.name ?? null,
        capacity: b.capacity,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
        status: b.status as 'Planned' | 'Active' | 'Completed' | 'Archived',
        enrolledCount,
        seatsRemaining: Math.max(0, b.capacity - enrolledCount),
      };
    }),
    feePlans: feePlans.map((fp) => ({
      id: fp.id,
      code: fp.code,
      name: fp.name,
      description: fp.description,
      installmentCount: fp.installmentCount,
      currency: fp.currency,
      isActive: fp.isActive,
    })),
    linkedStudent: app.convertedUser ? toPublicUser(app.convertedUser) : null,
    portalActivationPolicy,
  };
}

async function approveAdmissionWorkflow(params: {
  admissionId: string;
  actor: UserPublic;
  targetCourseId?: string;
  targetBatchId: string;
  feePlanId?: string | null;
  waitlistIfFull?: boolean;
  reviewRemarks?: string;
  issueInvoice?: boolean;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const admission = await tx.admissionApplication.findUnique({
      where: { id: params.admissionId },
      include: { admissionDocuments: true },
    });
    if (!admission) {
      throw new WorkflowError(404, 'Admission application not found.');
    }
    if (
      admission.status === 'Approved' ||
      admission.status === 'Enrolled' ||
      admission.status === 'Rejected' ||
      admission.status === 'Withdrawn'
    ) {
      throw new WorkflowError(
        409,
        `Application is already in ${admission.status} state and cannot be re-approved.`
      );
    }

    const courseId = params.targetCourseId || admission.targetCourseId;
    const [course, batch] = await Promise.all([
      tx.course.findUnique({
        where: { id: courseId },
        include: { instructor: true },
      }),
      tx.batch.findUnique({
        where: { id: params.targetBatchId },
        include: { instructor: true },
      }),
    ]);

    if (!course) {
      throw new WorkflowError(400, 'Selected target course was not found.');
    }
    if (!batch || batch.courseId !== course.id) {
      throw new WorkflowError(
        400,
        'Allocated batch does not exist or does not belong to the selected course.'
      );
    }
    if (batch.status === 'Archived' || batch.status === 'Completed') {
      throw new WorkflowError(
        400,
        `Cannot allocate new admission to a ${batch.status.toLowerCase()} batch.`
      );
    }

    const activeSeatCount = await tx.enrollment.count({
      where: {
        courseId: course.id,
        OR: [{ cohortId: batch.id }, { cohort: batch.name }],
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });

    let enrollmentStatus: 'Active' | 'Waitlisted' = 'Active';
    if (activeSeatCount >= batch.capacity) {
      if (params.waitlistIfFull) {
        enrollmentStatus = 'Waitlisted';
      } else {
        throw new WorkflowError(
          409,
          `Batch ${batch.name} is at full capacity (${activeSeatCount}/${batch.capacity}). Select another batch or choose Waitlist if Full.`
        );
      }
    }

    const studentEmail = admission.applicantEmail.trim().toLowerCase();
    if (!studentEmail) {
      throw new WorkflowError(400, 'Applicant email is required before approving an application.');
    }

    const activationPolicy = await getPortalActivationPolicy(tx);
    const activateNow = shouldActivatePortalOnApproval(activationPolicy);
    const now = new Date();

    let studentRow = await tx.user.findUnique({ where: { email: studentEmail } });
    if (studentRow && studentRow.role !== 'student') {
      throw new WorkflowError(
        409,
        `An existing ${studentRow.role} account already uses ${studentEmail}. Use a unique applicant email.`
      );
    }

    let studentCode = studentRow?.studentCode ?? null;
    let studentProfileId = '';
    let issuedOnboarding: {
      rawToken: string;
      onboardingPath: string;
      expiresAt: string;
    } | null = null;
    if (!studentRow) {
      const studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;
      studentCode = await generateUniqueStudentCode(tx);

      studentRow = await tx.user.create({
        data: {
          id: studentId,
          name: admission.applicantName || studentEmail.split('@')[0],
          email: studentEmail,
          role: 'student',
          status: activateNow ? 'active' : 'inactive',
          studentCode,
          phone: admission.phone || null,
          passwordHash: null,
          mustChangePassword: true,
        },
      });

      issuedOnboarding = await issueAccountSetupToken(tx, {
        userId: studentRow.id,
        createdByUserId: params.actor.id,
        ttlHours: 72,
      });

      const roleRow = await tx.role.findUnique({ where: { code: 'student' } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: studentRow.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${studentRow.id}-student`,
            userId: studentRow.id,
            roleId: roleRow.id,
            assignedByUserId: params.actor.id,
          },
        });
      }

      const fullAddress = [admission.address, admission.city, admission.postalCode]
        .filter((part) => Boolean(part && part.trim()))
        .join(', ');
      const emergencyContact = [
        admission.guardianName,
        admission.guardianRelationship ? `(${admission.guardianRelationship})` : '',
        admission.guardianPhone,
      ]
        .filter(Boolean)
        .join(' ');

      const profileRow = await tx.studentProfile.create({
        data: {
          id: `sp-${studentRow.id}`,
          userId: studentRow.id,
          studentCode,
          departmentId: course.departmentId ?? null,
          dateOfBirth: admission.dateOfBirth,
          address: fullAddress,
          emergencyContact,
        },
      });
      studentProfileId = profileRow.id;
    } else {
      if (!studentCode) {
        studentCode = await generateUniqueStudentCode(tx);
        studentRow = await tx.user.update({
          where: { id: studentRow.id },
          data: {
            studentCode,
            ...(activateNow && studentRow.status === 'inactive' ? { status: 'active' } : {}),
          },
        });
      } else if (activateNow && studentRow.status === 'inactive') {
        studentRow = await tx.user.update({
          where: { id: studentRow.id },
          data: { status: 'active' },
        });
      }

      let existingProfile = await tx.studentProfile.findUnique({
        where: { userId: studentRow.id },
      });
      if (!existingProfile) {
        existingProfile = await tx.studentProfile.create({
          data: {
            id: `sp-${studentRow.id}`,
            userId: studentRow.id,
            studentCode,
            departmentId: course.departmentId ?? null,
            dateOfBirth: admission.dateOfBirth,
            address: [admission.address, admission.city, admission.postalCode].filter(Boolean).join(', '),
          },
        });
      }
      studentProfileId = existingProfile.id;
    }

    if (admission.guardianName.trim()) {
      const existingGuardian = await tx.guardian.findFirst({
        where: {
          studentProfileId,
          fullName: admission.guardianName.trim(),
        },
      });
      if (!existingGuardian) {
        await tx.guardian.create({
          data: {
            id: `grd-${crypto.randomUUID().slice(0, 8)}`,
            studentProfileId,
            fullName: admission.guardianName.trim(),
            relationship: admission.guardianRelationship.trim() || 'Guardian',
            phone: admission.guardianPhone.trim(),
            email: admission.guardianEmail.trim(),
            isPrimary: true,
          },
        });
      }
    }

    const existingEnrollment = await tx.enrollment.findFirst({
      where: {
        studentId: studentRow.id,
        courseId: course.id,
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });
    if (existingEnrollment) {
      throw new WorkflowError(
        409,
        `${studentRow.name} already has a ${existingEnrollment.status.toLowerCase()} enrollment in ${course.code}.`
      );
    }

    const enrollmentId = `enr-${crypto.randomUUID().slice(0, 8)}`;
    await tx.enrollment.create({
      data: {
        id: enrollmentId,
        studentId: studentRow.id,
        courseId: course.id,
        cohortId: batch.id,
        cohort: batch.name,
        status: enrollmentStatus,
        completedModuleIds: [],
        tuitionSnapshot: course.tuitionFee,
        batchNameSnapshot: batch.name,
        instructorNameSnapshot: batch.instructor?.name ?? course.instructor?.name ?? null,
      },
    });

    await tx.enrollmentHistory.create({
      data: {
        id: `eh-${crypto.randomUUID().slice(0, 8)}`,
        enrollmentId,
        previousStatus: null,
        newStatus: enrollmentStatus,
        newBatchId: batch.id,
        reason: `Allocated upon admission approval (${admission.applicationNumber || admission.id})`,
        changedByUserId: params.actor.id,
      },
    });

    // Resolve Fee Plan & Fee Structure
    let feePlan = null;
    const requestedFeePlanId = params.feePlanId || admission.feePlanId;
    if (requestedFeePlanId) {
      feePlan = await tx.feePlan.findUnique({ where: { id: requestedFeePlanId } });
    }
    if (!feePlan) {
      feePlan = await tx.feePlan.findFirst({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
    }

    const feeStruct = await tx.feeStructure.findFirst({
      where: {
        courseId: course.id,
        isActive: true,
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const tuitionAmount = feeStruct ? feeStruct.tuitionAmount : course.tuitionFee;
    const registrationFee = feeStruct ? feeStruct.registrationFee : course.tuitionFee.constructor('0.00') as unknown as Prisma.Decimal;
    const labFee = feeStruct ? feeStruct.labFee : course.tuitionFee.constructor('0.00') as unknown as Prisma.Decimal;

    const tuitionCents = toCents(tuitionAmount.toString());
    const regCents = feeStruct ? toCents(registrationFee.toString()) : 0;
    const labCents = feeStruct ? toCents(labFee.toString()) : 0;
    const totalFeeCents = tuitionCents + regCents + labCents;

    let invoiceId: string | null = null;
    if (params.issueInvoice !== false && totalFeeCents > 0) {
      const academyRow = await tx.academy.findFirst({ select: { currency: true } });
      invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const invNum = await generateNextInvoiceNumber(tx);
      const totalDueStr = (totalFeeCents / 100).toFixed(2);
      const planLabel = feePlan ? ` · ${feePlan.name}` : '';
      const invDesc = `${course.code} ${course.title} Tuition (${batch.name}${planLabel})`;

      await tx.invoice.create({
        data: {
          id: invoiceId,
          invoiceNumber: invNum,
          studentId: studentRow.id,
          enrollmentId,
          courseId: course.id,
          feeStructureId: feeStruct?.id ?? null,
          description: invDesc,
          subtotal: totalDueStr,
          amountDue: totalDueStr,
          amountPaid: '0.00',
          currency: academyRow?.currency || feePlan?.currency || 'INR',
          status: 'Unpaid',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          issuedByUserId: params.actor.id,
        },
      });

      if (tuitionCents > 0) {
        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId,
            itemType: 'Tuition',
            description: `${course.code} Tuition (${batch.name})`,
            quantity: 1,
            unitPrice: tuitionAmount,
            lineTotal: tuitionAmount,
          },
        });
      }
      if (regCents > 0) {
        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId,
            itemType: 'Registration',
            description: 'Admission Registration Fee',
            quantity: 1,
            unitPrice: (regCents / 100).toFixed(2),
            lineTotal: (regCents / 100).toFixed(2),
          },
        });
      }
      if (labCents > 0) {
        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId,
            itemType: 'Lab',
            description: 'Laboratory & Compute Sandbox Fee',
            quantity: 1,
            unitPrice: (labCents / 100).toFixed(2),
            lineTotal: (labCents / 100).toFixed(2),
          },
        });
      }
    }

    // Reassign uploaded admission documents to the newly linked student
    const docAssetIds = admission.admissionDocuments.map((ad) => ad.fileAssetId);
    if (docAssetIds.length > 0) {
      await tx.fileAsset.updateMany({
        where: { id: { in: docAssetIds } },
        data: { ownerUserId: studentRow.id },
      });
    }

    const portalIsActive = studentRow.status === 'active';
    await tx.admissionApplication.update({
      where: { id: admission.id },
      data: {
        status: 'Approved',
        targetCourseId: course.id,
        targetBatchId: admission.targetBatchId ?? batch.id,
        allocatedBatchId: batch.id,
        feePlanId: feePlan?.id ?? null,
        preferredCohort: batch.name,
        convertedUserId: studentRow.id,
        reviewedByUserId: params.actor.id,
        reviewRemarks: params.reviewRemarks ?? admission.reviewRemarks,
        reviewedAt: now,
        approvedAt: now,
        portalActivated: portalIsActive,
        portalActivatedAt: portalIsActive ? now : null,
      },
    });

    await tx.admissionStatusHistory.create({
      data: {
        id: `ash-${crypto.randomUUID().slice(0, 8)}`,
        applicationId: admission.id,
        previousStatus: admission.status,
        newStatus: 'Approved',
        reason:
          params.reviewRemarks?.trim() ||
          `Approved and allocated to ${course.code} · ${batch.name} (${enrollmentStatus})`,
        actorUserId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        changedAt: now,
      },
    });

    await notifyApplicant(tx, {
      applicationId: admission.id,
      applicantEmail: studentEmail,
      userId: studentRow.id,
      courseId: course.id,
      title: `Admission Approved · ${course.code}`,
      message: `Congratulations ${studentRow.name}! Your application (${admission.applicationNumber || admission.id}) is approved for ${course.title} (${batch.name}, status: ${enrollmentStatus}). Student ID: ${studentCode}.`,
    });

    await notifyApplicant(tx, {
      applicationId: admission.id,
      applicantEmail: studentEmail,
      userId: studentRow.id,
      courseId: course.id,
      title: `Enrollment Confirmed · ${batch.name}`,
      message: `Enrollment created in ${course.code} (${batch.name}).${portalIsActive ? ' Your student portal access is active.' : ` Portal activation is pending (${activationPolicy.replace(/_/g, ' ')} policy).`}`,
    });

    if (issuedOnboarding && portalIsActive) {
      const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
      await queueTransactionalEmail(tx, {
        userId: studentRow.id,
        applicationId: admission.id,
        kind: 'account_setup',
        recipientEmail: studentEmail,
        subject: 'Set Up Your Student Portal Password — IGS — InfoCom Global Services',
        bodyText: `Hello ${studentRow.name},\n\nYour student account (${studentCode}) has been activated. Complete your password setup using the link below (valid for 72 hours):\n${origin}${issuedOnboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
        bypassPreferences: true,
        redactSensitive: true,
      });
    }

    return {
      admissionId: admission.id,
      applicationNumber: admission.applicationNumber,
      studentId: studentRow.id,
      studentName: studentRow.name,
      studentCode,
      enrollmentId,
      enrollmentStatus,
      invoiceId,
      courseCode: course.code,
      batchName: batch.name,
      portalActivated: portalIsActive,
      portalActivationPolicy: activationPolicy,
      ...(issuedOnboarding
        ? {
            onboardingToken: issuedOnboarding.rawToken,
            onboardingPath: issuedOnboarding.onboardingPath,
            onboardingExpiresAt: issuedOnboarding.expiresAt,
          }
        : {}),
    };
  });

  await recordAuditLog({
    actor: params.actor,
    action: 'ADMISSION_APPROVED',
    entityType: 'admission',
    entityId: result.admissionId,
    summary: `Approved admission ${result.applicationNumber || result.admissionId} for ${result.studentName} (${result.studentCode}) -> ${result.courseCode} / ${result.batchName}.`,
    metadata: {
      studentId: result.studentId,
      enrollmentId: result.enrollmentId,
      invoiceId: result.invoiceId,
      portalActivated: result.portalActivated,
      policy: result.portalActivationPolicy,
    },
  });

  return result;
}

// Public catalog of active non-archived courses, batches, and fee plans for online applications (no PII)
admissionsRouter.get(
  '/admissions/public/catalog',
  async (_req: Request, res: Response) => {
    try {
      const [academy, courses, batches, feePlans] = await Promise.all([
        prisma.academy.findFirst({ select: { name: true, currency: true } }),
        prisma.course.findMany({
          where: { isPublished: true, isArchived: false },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            slug: true,
            title: true,
            track: true,
            category: true,
            durationWeeks: true,
            tuitionFee: true,
            showTuitionPublicly: true,
          },
        }),
        prisma.batch.findMany({
          where: {
            status: { in: ['Planned', 'Active'] },
          },
          orderBy: { startDate: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            courseId: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        }),
        prisma.feePlan.findMany({
          where: { isActive: true },
          orderBy: { installmentCount: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            installmentCount: true,
            currency: true,
          },
        }),
      ]);

      res.json({
        academyName: academy?.name ?? 'IGS — InfoCom Global Services',
        currency: academy?.currency ?? 'INR',
        courses: courses.map((c) => ({
          id: c.id,
          code: c.code,
          slug: c.slug,
          title: c.title,
          track: c.track,
          category: c.category,
          durationWeeks: c.durationWeeks,
          showTuitionPublicly: c.showTuitionPublicly,
          tuitionFee: c.showTuitionPublicly ? c.tuitionFee.toFixed(2) : null,
        })),
        batches: batches.map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          courseId: b.courseId,
          startDate: b.startDate.toISOString(),
          endDate: b.endDate.toISOString(),
          status: b.status,
        })),
        feePlans,
      });
    } catch (err) {
      console.error('GET /api/admissions/public/catalog error:', err);
      res.status(500).json({ error: 'Failed to load admission program catalog.' });
    }
  }
);

// Public application submission (supports Draft and Submitted)
admissionsRouter.post(
  '/admissions/public',
  publicAdmissionLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = createAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission details.' });
        return;
      }

      const input = parsed.data;
      const course = await prisma.course.findFirst({
        where: { id: input.targetCourseId, isPublished: true, isArchived: false },
      });
      if (!course) {
        res.status(400).json({ error: 'Selected target course is unavailable for public admissions.' });
        return;
      }

      let targetBatch = null;
      if (input.targetBatchId) {
        targetBatch = await prisma.batch.findUnique({ where: { id: input.targetBatchId } });
        if (!targetBatch || targetBatch.courseId !== course.id) {
          res.status(400).json({ error: 'Selected preferred batch does not match the chosen course.' });
          return;
        }
      }

      const admissionId = `adm-${crypto.randomUUID().slice(0, 8)}`;
      const applicationNumber = await generateUniqueApplicationNumber();
      const now = new Date();
      const initialStatus = input.status ?? 'Submitted';
      const preferredCohort = input.preferredCohort || targetBatch?.name || 'Upcoming Intake';

      await prisma.$transaction(async (tx) => {
        await tx.admissionApplication.create({
          data: {
            id: admissionId,
            applicationNumber,
            applicantName: input.applicantName || 'Draft Applicant',
            applicantEmail: (input.applicantEmail || '').toLowerCase(),
            phone: input.phone,
            dateOfBirth: parseOptionalDate(input.dateOfBirth),
            gender: input.gender,
            nationality: input.nationality,
            address: input.address,
            city: input.city,
            postalCode: input.postalCode,
            guardianName: input.guardianName,
            guardianRelationship: input.guardianRelationship,
            guardianPhone: input.guardianPhone,
            guardianEmail: input.guardianEmail.toLowerCase(),
            previousQualification: input.previousQualification,
            previousInstitution: input.previousInstitution,
            graduationYear: input.graduationYear,
            previousScore: input.previousScore,
            targetCourseId: course.id,
            targetBatchId: targetBatch?.id ?? null,
            feePlanId: input.feePlanId || null,
            preferredCohort,
            status: initialStatus,
            notes: input.notes,
            applicantRemarks: input.applicantRemarks,
            draftSavedAt: initialStatus === 'Draft' ? now : null,
          },
        });

        for (const doc of input.documents ?? []) {
          let stored;
          try {
            stored = await storePrivateDocument({
              fileName: doc.fileName,
              mimeType: doc.mimeType,
              contentBase64: doc.contentBase64,
            });
          } catch (storageErr) {
            throw new WorkflowError(
              400,
              storageErr instanceof Error ? storageErr.message : 'Invalid attached document.'
            );
          }
          const fileAssetId = `doc-${crypto.randomUUID().slice(0, 8)}`;
          await tx.fileAsset.create({
            data: {
              id: fileAssetId,
              ownerUserId: null,
              courseId: course.id,
              title: doc.title,
              category: doc.category,
              fileName: stored.cleanFileName,
              mimeType: stored.mimeType,
              sizeBytes: stored.sizeBytes,
              contentBase64: '',
              storageProvider: stored.storageProvider,
              storageKey: stored.storageKey,
              checksumSha256: stored.checksumSha256,
              uploadedByUserId: null,
            },
          });
          await tx.admissionDocument.create({
            data: {
              id: `admd-${crypto.randomUUID().slice(0, 8)}`,
              applicationId: admissionId,
              fileAssetId,
              documentType: doc.documentType,
              verifiedStatus: 'Pending',
            },
          });
        }

        await tx.admissionStatusHistory.create({
          data: {
            id: `ash-${crypto.randomUUID().slice(0, 8)}`,
            applicationId: admissionId,
            previousStatus: null,
            newStatus: initialStatus,
            reason:
              initialStatus === 'Draft'
                ? 'Public application saved as draft'
                : 'Public admission application submitted',
            actorName: input.applicantName || 'Public Applicant',
            actorRole: 'applicant',
            changedAt: now,
          },
        });

        if (initialStatus === 'Submitted' && input.applicantEmail) {
          await notifyApplicant(tx, {
            applicationId: admissionId,
            applicantEmail: input.applicantEmail,
            courseId: course.id,
            title: `Application Received · ${applicationNumber}`,
            message: `We received your application (${applicationNumber}) for ${course.title} (${preferredCohort}).`,
          });
        }
      });

      await recordAuditLog({
        actor: {
          email: (input.applicantEmail || 'draft@applicant.local').toLowerCase(),
          role: 'applicant',
        },
        action: initialStatus === 'Draft' ? 'ADMISSION_DRAFT_SAVED' : 'ADMISSION_SUBMITTED',
        entityType: 'admission',
        entityId: admissionId,
        summary: `Public admission ${applicationNumber} (${initialStatus}) for ${course.code}.`,
      });

      res.status(201).json({ admissionId, applicationNumber, status: initialStatus });
    } catch (err) {
      if (err instanceof WorkflowError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('POST /api/admissions/public error:', err);
      res.status(500).json({ error: 'Failed to submit admission application.' });
    }
  }
);

// List admissions with optional filters (Admin)
admissionsRouter.get(
  '/admissions',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const dashboard = await getUserDashboardById(req.authUser!.id);
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const courseFilter = typeof req.query.courseId === 'string' ? req.query.courseId.trim() : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

      const filtered = dashboard.admissions.filter((a) => {
        if (statusFilter && statusFilter !== 'All' && a.status !== statusFilter) return false;
        if (courseFilter && courseFilter !== 'All' && a.targetCourseId !== courseFilter) return false;
        if (search) {
          const hay = `${a.applicationNumber ?? ''} ${a.applicantName} ${a.applicantEmail} ${a.preferredCohort} ${a.phone}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

      res.json({
        admissions: filtered,
        feePlans: dashboard.feePlans ?? [],
        total: filtered.length,
      });
    } catch (err) {
      console.error('GET /api/admissions error:', err);
      res.status(500).json({ error: 'Failed to load admissions.' });
    }
  }
);

// Admission Detail (Admin)
admissionsRouter.get(
  '/admissions/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const detail = await buildAdmissionDetailPayload(req.params.id);
      if (!detail) {
        res.status(404).json({ error: 'Admission application not found.' });
        return;
      }
      res.json(detail);
    } catch (err) {
      console.error('GET /api/admissions/:id error:', err);
      res.status(500).json({ error: 'Failed to load admission details.' });
    }
  }
);

// Create Admission (Draft or Submitted) (Admin)
admissionsRouter.post(
  '/admissions',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission details.' });
        return;
      }
      const input = parsed.data;
      const course = await prisma.course.findUnique({ where: { id: input.targetCourseId } });
      if (!course) {
        res.status(400).json({ error: 'Selected course does not exist.' });
        return;
      }

      let targetBatch = null;
      if (input.targetBatchId) {
        targetBatch = await prisma.batch.findUnique({ where: { id: input.targetBatchId } });
        if (!targetBatch || targetBatch.courseId !== course.id) {
          res.status(400).json({ error: 'Selected batch does not belong to the chosen course.' });
          return;
        }
      }

      const admissionId = `adm-${crypto.randomUUID().slice(0, 8)}`;
      const applicationNumber = await generateUniqueApplicationNumber();
      const now = new Date();
      const initialStatus = input.status ?? 'Submitted';
      const preferredCohort = input.preferredCohort || targetBatch?.name || 'Upcoming Intake';

      await prisma.$transaction(async (tx) => {
        await tx.admissionApplication.create({
          data: {
            id: admissionId,
            applicationNumber,
            applicantName: input.applicantName || 'Draft Applicant',
            applicantEmail: (input.applicantEmail || '').toLowerCase(),
            phone: input.phone,
            dateOfBirth: parseOptionalDate(input.dateOfBirth),
            gender: input.gender,
            nationality: input.nationality,
            address: input.address,
            city: input.city,
            postalCode: input.postalCode,
            guardianName: input.guardianName,
            guardianRelationship: input.guardianRelationship,
            guardianPhone: input.guardianPhone,
            guardianEmail: input.guardianEmail.toLowerCase(),
            previousQualification: input.previousQualification,
            previousInstitution: input.previousInstitution,
            graduationYear: input.graduationYear,
            previousScore: input.previousScore,
            targetCourseId: course.id,
            targetBatchId: targetBatch?.id ?? null,
            feePlanId: input.feePlanId || null,
            preferredCohort,
            status: initialStatus,
            notes: input.notes,
            applicantRemarks: input.applicantRemarks,
            draftSavedAt: initialStatus === 'Draft' ? now : null,
          },
        });

        for (const doc of input.documents ?? []) {
          let stored;
          try {
            stored = await storePrivateDocument({
              fileName: doc.fileName,
              mimeType: doc.mimeType,
              contentBase64: doc.contentBase64,
            });
          } catch (storageErr) {
            throw new WorkflowError(
              400,
              storageErr instanceof Error ? storageErr.message : 'Invalid attached document.'
            );
          }
          const fileAssetId = `doc-${crypto.randomUUID().slice(0, 8)}`;
          await tx.fileAsset.create({
            data: {
              id: fileAssetId,
              ownerUserId: null,
              courseId: course.id,
              title: doc.title,
              category: doc.category,
              fileName: stored.cleanFileName,
              mimeType: stored.mimeType,
              sizeBytes: stored.sizeBytes,
              contentBase64: '',
              storageProvider: stored.storageProvider,
              storageKey: stored.storageKey,
              checksumSha256: stored.checksumSha256,
              uploadedByUserId: req.authUser!.id,
            },
          });
          await tx.admissionDocument.create({
            data: {
              id: `admd-${crypto.randomUUID().slice(0, 8)}`,
              applicationId: admissionId,
              fileAssetId,
              documentType: doc.documentType,
              verifiedStatus: 'Pending',
            },
          });
        }

        await tx.admissionStatusHistory.create({
          data: {
            id: `ash-${crypto.randomUUID().slice(0, 8)}`,
            applicationId: admissionId,
            previousStatus: null,
            newStatus: initialStatus,
            reason:
              initialStatus === 'Draft'
                ? 'Application created as Draft'
                : 'Application created and submitted',
            actorUserId: req.authUser!.id,
            actorName: req.authUser!.name,
            actorRole: req.authUser!.role,
            changedAt: now,
          },
        });

        if (initialStatus === 'Submitted' && input.applicantEmail) {
          await notifyApplicant(tx, {
            applicationId: admissionId,
            applicantEmail: input.applicantEmail,
            courseId: course.id,
            title: `Application Submitted · ${applicationNumber}`,
            message: `Your admission application (${applicationNumber}) for ${course.title} (${preferredCohort}) has been logged for review.`,
          });
        }
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: initialStatus === 'Draft' ? 'ADMISSION_DRAFT_CREATED' : 'ADMISSION_CREATED',
        entityType: 'admission',
        entityId: admissionId,
        summary: `Created ${initialStatus} admission ${applicationNumber} for ${input.applicantName || 'Draft'} (${course.code}).`,
      });

      const dashboard = await getUserDashboardById(req.authUser!.id);
      res.status(201).json({ admissionId, applicationNumber, status: initialStatus, dashboard });
    } catch (err) {
      if (err instanceof WorkflowError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('POST /api/admissions error:', err);
      res.status(500).json({ error: 'Failed to record admission application.' });
    }
  }
);

// Update Draft/Application fields or Transition status (Admin)
admissionsRouter.patch(
  '/admissions/:id',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = updateAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid admission update.' });
        return;
      }

      const admission = await prisma.admissionApplication.findUnique({
        where: { id: req.params.id },
      });
      if (!admission) {
        res.status(404).json({ error: 'Admission application not found.' });
        return;
      }

      const input = parsed.data;

      // Support legacy convertToEnrollment: true flag cleanly by delegating to atomic approval workflow
      if (input.convertToEnrollment && !admission.convertedUserId) {
        const courseId = input.targetCourseId || admission.targetCourseId;
        let targetBatchId = input.targetBatchId || admission.targetBatchId;
        if (!targetBatchId) {
          const matched = await prisma.batch.findFirst({
            where: {
              courseId,
              OR: [
                { name: input.preferredCohort || admission.preferredCohort },
                { status: 'Active' },
              ],
            },
            orderBy: { startDate: 'asc' },
          });
          targetBatchId = matched?.id ?? null;
        }
        if (!targetBatchId) {
          res.status(400).json({
            error: 'No authorized batch found for this course. Specify a targetBatchId via /approve.',
          });
          return;
        }

        const approved = await approveAdmissionWorkflow({
          admissionId: admission.id,
          actor: req.authUser!,
          targetCourseId: courseId,
          targetBatchId,
          feePlanId: input.feePlanId ?? admission.feePlanId,
          waitlistIfFull: Boolean(input.waitlistIfFull),
          reviewRemarks: input.reviewRemarks ?? input.notes ?? admission.reviewRemarks,
        });

        const [dashboard, detail] = await Promise.all([
          getUserDashboardById(req.authUser!.id),
          buildAdmissionDetailPayload(admission.id),
        ]);
        res.json({ ...approved, detail, dashboard });
        return;
      }

      if (input.status === 'Approved') {
        res.status(400).json({
          error: 'Use POST /api/admissions/:id/approve to allocate a batch, fee plan, and student enrollment.',
        });
        return;
      }

      const currentStatus = admission.status as AdmissionStatus;
      const nextStatus = (input.status ?? currentStatus) as AdmissionStatus;

      if (!isValidAdmissionTransition(currentStatus, nextStatus)) {
        res.status(400).json({
          error: `Invalid admission transition from "${currentStatus}" to "${nextStatus}".`,
        });
        return;
      }

      const nextName = input.applicantName ?? admission.applicantName;
      const nextEmail = (input.applicantEmail ?? admission.applicantEmail).toLowerCase();
      const nextCourseId = input.targetCourseId ?? admission.targetCourseId;
      const nextCohort = input.preferredCohort ?? admission.preferredCohort;
      const nextBatchId = input.targetBatchId !== undefined ? input.targetBatchId : admission.targetBatchId;

      if (nextStatus === 'Submitted' && currentStatus === 'Draft') {
        if (nextName.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
          res.status(400).json({
            error: 'Applicant name and valid email are required before submitting a draft.',
          });
          return;
        }
        if (!nextCohort && !nextBatchId) {
          res.status(400).json({
            error: 'Preferred cohort or batch is required before submitting a draft.',
          });
          return;
        }
      }

      if (nextStatus === 'Rejected' && currentStatus !== 'Rejected') {
        const rejReason = (input.rejectionReason ?? input.reason ?? input.reviewRemarks ?? '').trim();
        if (rejReason.length < 3) {
          res.status(400).json({
            error: 'A rejection reason (at least 3 characters) is required when rejecting an application.',
          });
          return;
        }
      }

      if (nextBatchId) {
        const batch = await prisma.batch.findUnique({ where: { id: nextBatchId } });
        if (!batch || batch.courseId !== nextCourseId) {
          res.status(400).json({ error: 'Selected batch does not match the target course.' });
          return;
        }
      }

      const now = new Date();
      const statusChanged = nextStatus !== currentStatus;

      await prisma.$transaction(async (tx) => {
        await tx.admissionApplication.update({
          where: { id: admission.id },
          data: {
            ...(input.applicantName !== undefined ? { applicantName: input.applicantName } : {}),
            ...(input.applicantEmail !== undefined ? { applicantEmail: input.applicantEmail.toLowerCase() } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.dateOfBirth !== undefined ? { dateOfBirth: parseOptionalDate(input.dateOfBirth) } : {}),
            ...(input.gender !== undefined ? { gender: input.gender } : {}),
            ...(input.nationality !== undefined ? { nationality: input.nationality } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
            ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
            ...(input.guardianName !== undefined ? { guardianName: input.guardianName } : {}),
            ...(input.guardianRelationship !== undefined ? { guardianRelationship: input.guardianRelationship } : {}),
            ...(input.guardianPhone !== undefined ? { guardianPhone: input.guardianPhone } : {}),
            ...(input.guardianEmail !== undefined ? { guardianEmail: input.guardianEmail.toLowerCase() } : {}),
            ...(input.previousQualification !== undefined ? { previousQualification: input.previousQualification } : {}),
            ...(input.previousInstitution !== undefined ? { previousInstitution: input.previousInstitution } : {}),
            ...(input.graduationYear !== undefined ? { graduationYear: input.graduationYear } : {}),
            ...(input.previousScore !== undefined ? { previousScore: input.previousScore } : {}),
            ...(input.targetCourseId !== undefined ? { targetCourseId: input.targetCourseId } : {}),
            ...(input.targetBatchId !== undefined ? { targetBatchId: input.targetBatchId } : {}),
            ...(input.feePlanId !== undefined ? { feePlanId: input.feePlanId } : {}),
            ...(input.preferredCohort !== undefined ? { preferredCohort: input.preferredCohort } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.applicantRemarks !== undefined ? { applicantRemarks: input.applicantRemarks } : {}),
            ...(input.reviewRemarks !== undefined ? { reviewRemarks: input.reviewRemarks } : {}),
            ...(input.rejectionReason !== undefined ? { rejectionReason: input.rejectionReason } : {}),
            ...(nextStatus === 'Rejected' && !input.rejectionReason && input.reason
              ? { rejectionReason: input.reason }
              : {}),
            status: nextStatus,
            reviewedByUserId: statusChanged && nextStatus !== 'Draft' ? req.authUser!.id : admission.reviewedByUserId,
            reviewedAt: statusChanged && nextStatus !== 'Draft' ? now : admission.reviewedAt,
            ...(currentStatus === 'Draft' && nextStatus === 'Submitted' ? { submittedAt: now } : {}),
            ...(nextStatus === 'Draft' ? { draftSavedAt: now } : {}),
          },
        });

        if (statusChanged) {
          const reasonText =
            input.reason?.trim() ||
            (nextStatus === 'Rejected'
              ? input.rejectionReason?.trim() || input.reviewRemarks?.trim()
              : input.reviewRemarks?.trim()) ||
            `Transitioned from ${currentStatus} to ${nextStatus}`;

          await tx.admissionStatusHistory.create({
            data: {
              id: `ash-${crypto.randomUUID().slice(0, 8)}`,
              applicationId: admission.id,
              previousStatus: currentStatus,
              newStatus: nextStatus,
              reason: reasonText,
              actorUserId: req.authUser!.id,
              actorName: req.authUser!.name,
              actorRole: req.authUser!.role,
              changedAt: now,
            },
          });

          if (nextEmail) {
            await notifyApplicant(tx, {
              applicationId: admission.id,
              applicantEmail: nextEmail,
              userId: admission.convertedUserId,
              courseId: nextCourseId,
              title: `Application ${nextStatus} · ${admission.applicationNumber || admission.id}`,
              message: `Application status updated from ${currentStatus} to ${nextStatus}. ${reasonText}`,
            });
          }
        }
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: statusChanged ? 'ADMISSION_STATUS_CHANGED' : 'ADMISSION_UPDATED',
        entityType: 'admission',
        entityId: admission.id,
        summary: statusChanged
          ? `Updated admission ${admission.applicationNumber || admission.id} status from ${currentStatus} to ${nextStatus}.`
          : `Updated admission application ${admission.applicationNumber || admission.id} details.`,
      });

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayload(admission.id),
        getUserDashboardById(req.authUser!.id),
      ]);
      res.json({ detail, dashboard });
    } catch (err) {
      if (err instanceof WorkflowError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('PATCH /api/admissions/:id error:', err);
      res.status(500).json({ error: 'Failed to update admission application.' });
    }
  }
);

// Upload admission document (Admin)
admissionsRouter.post(
  '/admissions/:id/documents',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = uploadAdmissionDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid document payload.' });
        return;
      }

      const admission = await prisma.admissionApplication.findUnique({
        where: { id: req.params.id },
      });
      if (!admission) {
        res.status(404).json({ error: 'Admission application not found.' });
        return;
      }

      const input = parsed.data;
      let stored;
      try {
        stored = await storePrivateDocument({
          fileName: input.fileName,
          mimeType: input.mimeType,
          contentBase64: input.contentBase64,
        });
      } catch (storageErr) {
        res.status(400).json({
          error: storageErr instanceof Error ? storageErr.message : 'Invalid document upload.',
        });
        return;
      }

      const fileAssetId = `doc-${crypto.randomUUID().slice(0, 8)}`;
      const admissionDocId = `admd-${crypto.randomUUID().slice(0, 8)}`;

      await prisma.$transaction(async (tx) => {
        await tx.fileAsset.create({
          data: {
            id: fileAssetId,
            ownerUserId: admission.convertedUserId ?? null,
            courseId: admission.targetCourseId,
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

        await tx.admissionDocument.create({
          data: {
            id: admissionDocId,
            applicationId: admission.id,
            fileAssetId,
            documentType: input.documentType,
            verifiedStatus: 'Pending',
          },
        });
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'ADMISSION_DOCUMENT_UPLOADED',
        entityType: 'admission_document',
        entityId: admissionDocId,
        summary: `Uploaded "${input.title}" (${input.documentType}) for admission ${admission.applicationNumber || admission.id}.`,
      });

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayload(admission.id),
        getUserDashboardById(req.authUser!.id),
      ]);
      res.status(201).json({ documentId: admissionDocId, detail, dashboard });
    } catch (err) {
      console.error('POST /api/admissions/:id/documents error:', err);
      res.status(500).json({ error: 'Failed to upload admission document.' });
    }
  }
);

// Verify, request replacement, or reject admission document (Admin)
admissionsRouter.patch(
  '/admissions/:id/documents/:docId',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = verifyAdmissionDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid document verification payload.' });
        return;
      }

      const { status, verificationRemarks } = parsed.data;
      if ((status === 'Replacement Required' || status === 'Rejected') && verificationRemarks.trim().length < 3) {
        res.status(400).json({
          error: 'Verification remarks are required when rejecting or requesting a replacement document.',
        });
        return;
      }

      const docRow = await prisma.admissionDocument.findFirst({
        where: { id: req.params.docId, applicationId: req.params.id },
        include: { application: true, fileAsset: { select: { title: true } } },
      });
      if (!docRow) {
        res.status(404).json({ error: 'Admission document record not found.' });
        return;
      }

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.admissionDocument.update({
          where: { id: docRow.id },
          data: {
            verifiedStatus: status,
            verificationRemarks: verificationRemarks.trim(),
            verifiedByUserId: req.authUser!.id,
            verifiedByName: req.authUser!.name,
            verifiedAt: now,
          },
        });

        if (docRow.application.applicantEmail) {
          await notifyApplicant(tx, {
            applicationId: docRow.applicationId,
            applicantEmail: docRow.application.applicantEmail,
            userId: docRow.application.convertedUserId,
            courseId: docRow.application.targetCourseId,
            title: `Document ${status} · ${docRow.documentType}`,
            message: `Document "${docRow.fileAsset.title}" (${docRow.documentType}) marked as ${status}.${verificationRemarks.trim() ? ` Remarks: ${verificationRemarks.trim()}` : ''}`,
          });
        }
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'ADMISSION_DOCUMENT_VERIFIED',
        entityType: 'admission_document',
        entityId: docRow.id,
        summary: `Marked document "${docRow.fileAsset.title}" on ${docRow.application.applicationNumber || docRow.applicationId} as ${status}.`,
      });

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayload(docRow.applicationId),
        getUserDashboardById(req.authUser!.id),
      ]);
      res.json({ detail, dashboard });
    } catch (err) {
      console.error('PATCH /api/admissions/:id/documents/:docId error:', err);
      res.status(500).json({ error: 'Failed to verify admission document.' });
    }
  }
);

// Private Admission Document Download (Strict RBAC: Admin or Owning Linked Student only)
admissionsRouter.get(
  '/admissions/:id/documents/:docId/download',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const docRow = await prisma.admissionDocument.findFirst({
        where: { id: req.params.docId, applicationId: req.params.id },
        include: {
          application: { select: { convertedUserId: true } },
          fileAsset: true,
        },
      });
      if (!docRow || docRow.fileAsset.isArchived) {
        res.status(404).json({ error: 'Admission document not found.' });
        return;
      }

      const isAdmin = req.authUser!.role === 'admin';
      const isOwningStudent =
        req.authUser!.role === 'student' &&
        docRow.application.convertedUserId !== null &&
        docRow.application.convertedUserId === req.authUser!.id;

      if (!isAdmin && !isOwningStudent) {
        res.status(403).json({
          error: 'Access denied. Admission documents are private and restricted to authorized administrators or the linked student.',
        });
        return;
      }

      const buffer = await readPrivateDocument({
        storageProvider: docRow.fileAsset.storageProvider,
        storageKey: docRow.fileAsset.storageKey,
        contentBase64: docRow.fileAsset.contentBase64,
      });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', docRow.fileAsset.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${docRow.fileAsset.fileName.replace(/["\r\n]/g, '')}"`
      );
      res.send(buffer);
    } catch (err) {
      console.error('GET /api/admissions/:id/documents/:docId/download error:', err);
      res.status(500).json({ error: 'Failed to download admission document.' });
    }
  }
);

// Atomic Admission Approval Workflow (Admin)
admissionsRouter.post(
  '/admissions/:id/approve',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = approveAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid approval payload.' });
        return;
      }

      const approved = await approveAdmissionWorkflow({
        admissionId: req.params.id,
        actor: req.authUser!,
        ...parsed.data,
      });

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayload(req.params.id),
        getUserDashboardById(req.authUser!.id),
      ]);
      res.json({ ...approved, detail, dashboard });
    } catch (err) {
      if (err instanceof WorkflowError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('POST /api/admissions/:id/approve error:', err);
      res.status(500).json({ error: 'Failed to approve admission application.' });
    }
  }
);

// Activate Student Portal Login (for manual_activation / after_first_payment policies) (Admin)
admissionsRouter.post(
  '/admissions/:id/activate-portal',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const admission = await prisma.admissionApplication.findUnique({
        where: { id: req.params.id },
      });
      if (!admission) {
        res.status(404).json({ error: 'Admission application not found.' });
        return;
      }
      if (!admission.convertedUserId) {
        res.status(400).json({ error: 'Application must be approved and linked to a student profile first.' });
        return;
      }

      const student = await prisma.user.findUnique({
        where: { id: admission.convertedUserId },
      });
      if (!student) {
        res.status(404).json({ error: 'Linked student account not found.' });
        return;
      }

      const now = new Date();
      let onboardingIssued: { rawToken: string; onboardingPath: string; expiresAt: string } | null = null;
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: student.id },
          data: { status: 'active' },
        });
        await tx.admissionApplication.update({
          where: { id: admission.id },
          data: {
            portalActivated: true,
            portalActivatedAt: now,
          },
        });
        await notifyApplicant(tx, {
          applicationId: admission.id,
          applicantEmail: student.email,
          userId: student.id,
          courseId: admission.targetCourseId,
          title: 'Student Portal Activated',
          message: `Welcome ${student.name}! Your InfoCom Academy student portal login (${student.studentCode ?? student.email}) has been activated.`,
        });
        if (!student.passwordHash) {
          onboardingIssued = await issueAccountSetupToken(tx, {
            userId: student.id,
            createdByUserId: req.authUser!.id,
            ttlHours: 72,
          });
          const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
          await queueTransactionalEmail(tx, {
            userId: student.id,
            applicationId: admission.id,
            kind: 'account_setup',
            recipientEmail: student.email,
            subject: 'Complete Your Student Portal Setup — IGS — InfoCom Global Services',
            bodyText: `Hello ${student.name},\n\nYour student portal access is now active. Set your password using the link below (valid for 72 hours):\n${origin}${onboardingIssued.onboardingPath}\n\n— IGS — InfoCom Global Services`,
            bypassPreferences: true,
            redactSensitive: true,
          });
        }
      });

      await recordAuditLog({
        actor: req.authUser!,
        action: 'PORTAL_ACCESS_ACTIVATED',
        entityType: 'admission',
        entityId: admission.id,
        summary: `Activated student portal access for ${student.name} (${student.studentCode ?? student.email}).`,
      });

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayload(admission.id),
        getUserDashboardById(req.authUser!.id),
      ]);
      res.json({ portalActivated: true, detail, dashboard });
    } catch (err) {
      console.error('POST /api/admissions/:id/activate-portal error:', err);
      res.status(500).json({ error: 'Failed to activate student portal account.' });
    }
  }
);
