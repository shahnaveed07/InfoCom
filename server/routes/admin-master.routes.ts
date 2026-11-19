import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import type { AnalyticsPreset } from '../../src/shared/types.ts';
import {
  isTerminalEnrollmentStatus,
  toCents,
} from '../../src/shared/academic.ts';
import {
  academicTermSchema,
  academicYearSchema,
  assignInstructorCoursesSchema,
  assignStudentToCohortSchema,
  courseTransferSchema,
  createClassroomSchema,
  createDepartmentSchema,
  createInstructorSchema,
  createStudentSchema,
  transferEnrollmentSchema,
  updateAcademicTermSchema,
  updateAcademicYearSchema,
  updateAcademySettingsSchema,
  updateClassroomSchema,
  updateCohortSchema,
  updateCourseSchema,
  updateDepartmentSchema,
  updateInstructorPermissionsSchema,
  updateInstructorSchema,
  updateStudentSchema,
} from '../../src/shared/validation.ts';
import {
  computeAdminAnalyticsSummary,
  createEnrollmentWithOptionalInvoice,
  generateNextInvoiceNumber,
  generateUniqueStaffCode,
  generateUniqueStudentCode,
  getAcademySettingsPayload,
  getInstructorDetail,
  getStudentDetail,
  getUserDashboardById,
  issueAccountSetupToken,
  listInstructorsWithMetrics,
  recordAuditLog,
  revokeActiveOnboardingTokens,
  toPublicUser,
} from '../ams-service.ts';
import { hashPassword } from '../auth.ts';
import { prisma } from '../db/prisma.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import {
  listStudentsPaginated,
  revokeAllUserSessionsInDb,
} from '../repositories/ams.repository.ts';
import { queueTransactionalEmail } from '../jobs/worker.ts';

export const adminMasterRouter = Router();

const adminGuard = [requireAuth, requireRoles('admin')] as const;
const staffGuard = [requireAuth, requireRoles('admin', 'instructor')] as const;

// 1. Admin Dashboard Analytics (Live DB stats + date filters + chart series)
adminMasterRouter.get('/admin/analytics', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawPreset = typeof req.query.preset === 'string' ? req.query.preset : '30d';
    const preset: AnalyticsPreset =
      rawPreset === '7d' || rawPreset === '30d' || rawPreset === '90d' || rawPreset === 'all' || rawPreset === 'custom'
        ? rawPreset
        : '30d';
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const summary = await computeAdminAnalyticsSummary({ preset, from, to });
    res.json(summary);
  } catch (err) {
    console.error('GET /api/admin/analytics error:', err);
    res.status(500).json({ error: 'Failed to load academy analytics.' });
  }
});

// 2. Student Management (Directory, Creation, Profile Detail, Edit, Status/Archive)
adminMasterRouter.get('/students', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sortBy =
      req.query.sortBy === 'name' || req.query.sortBy === 'studentCode'
        ? req.query.sortBy
        : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    const result = await listStudentsPaginated({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 15,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      courseId: typeof req.query.courseId === 'string' ? req.query.courseId : undefined,
      sortBy,
      sortDir,
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/students error:', err);
    res.status(500).json({ error: 'Failed to load student directory.' });
  }
});

adminMasterRouter.post('/students', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid student details.' });
      return;
    }

    const input = parsed.data;
    const normalizedEmail = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;
    const hasPassword = Boolean(input.password && input.password.trim().length > 0);
    const pwHash = hasPassword ? await hashPassword(input.password!) : null;
    const mustChangePassword = !hasPassword || Boolean(input.requirePasswordChange);

    const { createdUser, onboarding } = await prisma.$transaction(async (tx) => {
      const studentCode = await generateUniqueStudentCode(tx);
      let departmentName: string | null = null;
      if (input.departmentId) {
        const dept = await tx.department.findUnique({ where: { id: input.departmentId } });
        departmentName = dept?.name ?? null;
      }

      const user = await tx.user.create({
        data: {
          id: studentId,
          name: input.name,
          email: normalizedEmail,
          role: 'student',
          status: 'active',
          studentCode,
          department: departmentName,
          phone: input.phone || null,
          passwordHash: pwHash,
          passwordUpdatedAt: hasPassword ? new Date() : null,
          mustChangePassword,
        },
      });

      const roleRow = await tx.role.findUnique({ where: { code: 'student' } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${user.id}-student`,
            userId: user.id,
            roleId: roleRow.id,
            assignedByUserId: req.authUser!.id,
          },
        });
      }

      await tx.studentProfile.create({
        data: {
          id: `sp-${user.id}`,
          userId: user.id,
          studentCode,
          departmentId: input.departmentId || null,
          dateOfBirth:
            input.dateOfBirth && !Number.isNaN(Date.parse(input.dateOfBirth))
              ? new Date(input.dateOfBirth)
              : null,
          address: input.address,
          emergencyContact: input.emergencyContact,
          academicStanding: input.academicStanding || 'Good Standing',
        },
      });

      if (input.guardianName?.trim()) {
        await tx.guardian.create({
          data: {
            id: `grd-${crypto.randomUUID().slice(0, 8)}`,
            studentProfileId: `sp-${user.id}`,
            fullName: input.guardianName.trim(),
            relationship: input.guardianRelationship?.trim() || 'Parent / Guardian',
            phone: input.guardianPhone?.trim() || '',
            isPrimary: true,
          },
        });
      }

      const issuedOnboarding = !hasPassword
        ? await issueAccountSetupToken(tx, {
            userId: user.id,
            createdByUserId: req.authUser!.id,
            ttlHours: 72,
          })
        : null;

      if (issuedOnboarding) {
        const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        await queueTransactionalEmail(tx, {
          userId: user.id,
          kind: 'account_setup',
          recipientEmail: user.email,
          subject: 'Complete Your Student Portal Setup — IGS — InfoCom Global Services',
          bodyText: `Hello ${user.name},\n\nYour IGS — InfoCom Global Services student account (${user.studentCode}) has been created. Set your password using the single-use link below (valid for 72 hours):\n${origin}${issuedOnboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        });
      }

      return { createdUser: user, onboarding: issuedOnboarding };
    });

    if (input.initialCourseId) {
      const batch = input.initialCohortId
        ? await prisma.batch.findUnique({ where: { id: input.initialCohortId } })
        : await prisma.batch.findFirst({
            where: { courseId: input.initialCourseId, status: 'Active' },
          });
      await createEnrollmentWithOptionalInvoice({
        actor: req.authUser!,
        studentId: createdUser.id,
        courseId: input.initialCourseId,
        cohortId: batch?.id,
        cohort: batch?.name ?? 'Cohort A · Autumn',
        status: input.enrollmentStatus ?? 'Active',
        issueTuitionInvoice: input.issueTuitionInvoice ?? true,
      });
    }

    await recordAuditLog({
      actor: req.authUser!,
      action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'STUDENT_CREATED',
      entityType: 'user',
      entityId: createdUser.id,
      summary: onboarding
        ? `Created student ${createdUser.name} (${createdUser.studentCode}) with single-use 72h setup token.`
        : `Created student ${createdUser.name} (${createdUser.studentCode}).`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({
      student: toPublicUser(createdUser),
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
    console.error('POST /api/students error:', err);
    res.status(500).json({ error: 'Failed to create student record.' });
  }
});

adminMasterRouter.get('/students/:studentId/detail', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const detail = await getStudentDetail(req.params.studentId);
    if (!detail) {
      res.status(404).json({ error: 'Student profile not found.' });
      return;
    }
    res.json(detail);
  } catch (err) {
    console.error('GET /api/students/:studentId/detail error:', err);
    res.status(500).json({ error: 'Failed to load student profile.' });
  }
});

adminMasterRouter.patch('/students/:studentId', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid student update.' });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { id: req.params.studentId, role: 'student' },
    });
    if (!existing) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const input = parsed.data;
    if (input.email && input.email.toLowerCase() !== existing.email) {
      const conflict = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (conflict) {
        res.status(409).json({ error: 'Another account already uses this email.' });
        return;
      }
    }

    const deactivated = Boolean(input.status && input.status !== 'active');

    await prisma.$transaction(async (tx) => {
      let departmentName: string | undefined;
      if (input.departmentId !== undefined) {
        if (input.departmentId) {
          const dept = await tx.department.findUnique({ where: { id: input.departmentId } });
          departmentName = dept?.name ?? '';
        } else {
          departmentName = '';
        }
      }

      await tx.user.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
          ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(departmentName !== undefined ? { department: departmentName || null } : {}),
          ...(deactivated ? { sessionVersion: { increment: 1 } } : {}),
        },
      });

      const dobDate =
        input.dateOfBirth === null || input.dateOfBirth === ''
          ? null
          : input.dateOfBirth && !Number.isNaN(Date.parse(input.dateOfBirth))
            ? new Date(input.dateOfBirth)
            : undefined;

      await tx.studentProfile.upsert({
        where: { userId: existing.id },
        update: {
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(dobDate !== undefined ? { dateOfBirth: dobDate } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact } : {}),
          ...(input.academicStanding !== undefined ? { academicStanding: input.academicStanding } : {}),
        },
        create: {
          id: `sp-${existing.id}`,
          userId: existing.id,
          studentCode: existing.studentCode ?? (await generateUniqueStudentCode(tx)),
          departmentId: input.departmentId || null,
          dateOfBirth: dobDate ?? null,
          address: input.address ?? '',
          emergencyContact: input.emergencyContact ?? '',
          academicStanding: input.academicStanding ?? 'Good Standing',
        },
      });
    });

    if (deactivated) {
      await revokeAllUserSessionsInDb(existing.id, `student_status_${input.status}`);
    }

    await recordAuditLog({
      actor: req.authUser!,
      action: input.status === 'archived' ? 'STUDENT_ARCHIVED' : 'STUDENT_UPDATED',
      entityType: 'user',
      entityId: existing.id,
      summary: `Updated student ${existing.name} (${Object.keys(input).join(', ')}).`,
    });

    const [detail, dashboard] = await Promise.all([
      getStudentDetail(existing.id),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ detail, dashboard });
  } catch (err) {
    console.error('PATCH /api/students/:studentId error:', err);
    res.status(500).json({ error: 'Failed to update student record.' });
  }
});

adminMasterRouter.post('/students/:studentId/reset-password', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const target = await prisma.user.findFirst({
      where: { id: req.params.studentId, role: 'student' },
    });
    if (!target) {
      res.status(404).json({ error: 'Student account not found.' });
      return;
    }
    if (target.status === 'suspended' || target.status === 'archived') {
      res.status(400).json({
        error: `Cannot issue password reset link for a ${target.status} student account.`,
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
        subject: 'Student Portal Password Reset — IGS — InfoCom Global Services',
        bodyText: `Hello ${target.name},\n\nAn administrator issued a single-use password setup/reset link for your student portal (${target.studentCode ?? target.email}), valid for 72 hours:\n${origin}${token.onboardingPath}\n\n— IGS — InfoCom Global Services`,
        bypassPreferences: true,
        redactSensitive: true,
      });
      return token;
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'STUDENT_PASSWORD_RESET_ISSUED',
      entityType: 'user',
      entityId: target.id,
      summary: `Issued single-use 72h password setup/reset link for student ${target.email}.`,
    });

    res.json({
      ok: true,
      onboardingToken: issued.rawToken,
      onboardingPath: issued.onboardingPath,
      onboardingExpiresAt: issued.expiresAt,
      user: toPublicUser(target),
    });
  } catch (err) {
    console.error('POST /api/students/:studentId/reset-password error:', err);
    res.status(500).json({ error: 'Failed to issue student password reset link.' });
  }
});

adminMasterRouter.post(
  '/students/:studentId/revoke-reset-tokens',
  requireAuth,
  requireRoles('admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const target = await prisma.user.findFirst({
        where: { id: req.params.studentId, role: 'student' },
      });
      if (!target) {
        res.status(404).json({ error: 'Student account not found.' });
        return;
      }

      const revokedCount = await revokeActiveOnboardingTokens(prisma, target.id);
      await recordAuditLog({
        actor: req.authUser!,
        action: 'STUDENT_ONBOARDING_TOKENS_REVOKED',
        entityType: 'user',
        entityId: target.id,
        summary: `Revoked ${revokedCount} active onboarding/reset token(s) for student ${target.email}.`,
      });

      res.json({
        ok: true,
        revokedCount,
        user: toPublicUser(target),
      });
    } catch (err) {
      console.error('POST /api/students/:studentId/revoke-reset-tokens error:', err);
      res.status(500).json({ error: 'Failed to revoke student password setup tokens.' });
    }
  }
);

// 3. Instructor Management (Directory, Profile, Create, Assign Courses/Batches, Permissions)
adminMasterRouter.get('/instructors', ...adminGuard, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const items = await listInstructorsWithMetrics();
    res.json({ items });
  } catch (err) {
    console.error('GET /api/instructors error:', err);
    res.status(500).json({ error: 'Failed to load instructor directory.' });
  }
});

adminMasterRouter.post('/instructors', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createInstructorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid instructor details.' });
      return;
    }

    const input = parsed.data;
    const normalizedEmail = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const instructorId = `ins-${crypto.randomUUID().slice(0, 8)}`;
    const hasPassword = Boolean(input.password && input.password.trim().length > 0);
    const pwHash = hasPassword ? await hashPassword(input.password!) : null;
    const mustChangePassword = !hasPassword || Boolean(input.requirePasswordChange);

    const { created, onboarding } = await prisma.$transaction(async (tx) => {
      const staffCode = await generateUniqueStaffCode(tx);
      let departmentName = 'Academic Faculty';
      if (input.departmentId) {
        const dept = await tx.department.findUnique({ where: { id: input.departmentId } });
        if (dept) departmentName = dept.name;
      }

      const user = await tx.user.create({
        data: {
          id: instructorId,
          name: input.name,
          email: normalizedEmail,
          role: 'instructor',
          status: 'active',
          staffCode,
          department: departmentName,
          phone: input.phone || null,
          passwordHash: pwHash,
          passwordUpdatedAt: hasPassword ? new Date() : null,
          mustChangePassword,
        },
      });

      const roleRow = await tx.role.findUnique({ where: { code: 'instructor' } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${user.id}-instructor`,
            userId: user.id,
            roleId: roleRow.id,
            assignedByUserId: req.authUser!.id,
          },
        });
      }

      await tx.instructorProfile.create({
        data: {
          id: `ip-${user.id}`,
          userId: user.id,
          staffCode,
          departmentId: input.departmentId || null,
          specialization: input.specialization,
          qualification: input.qualification,
          bio: input.bio,
          hireDate:
            input.hireDate && !Number.isNaN(Date.parse(input.hireDate))
              ? new Date(input.hireDate)
              : new Date(),
          permissionsConfigured: Array.isArray(input.permissions),
          permissions: input.permissions ?? [],
        },
      });

      if (input.courseIds.length > 0) {
        await tx.course.updateMany({
          where: { id: { in: input.courseIds } },
          data: { instructorId: user.id },
        });
      }

      for (const batchId of input.batchIds) {
        const batch = await tx.batch.findUnique({ where: { id: batchId } });
        if (!batch) continue;
        await tx.batch.update({
          where: { id: batch.id },
          data: { instructorId: user.id },
        });
        await tx.instructorAssignment.upsert({
          where: { instructorId_batchId: { instructorId: user.id, batchId: batch.id } },
          update: { isActive: true, unassignedAt: null },
          create: {
            id: `ia-${crypto.randomUUID().slice(0, 8)}`,
            instructorId: user.id,
            batchId: batch.id,
            courseId: batch.courseId,
            role: 'Lead',
            isActive: true,
          },
        });
      }

      const issuedOnboarding = !hasPassword
        ? await issueAccountSetupToken(tx, {
            userId: user.id,
            createdByUserId: req.authUser!.id,
            ttlHours: 72,
          })
        : null;

      if (issuedOnboarding) {
        const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        await queueTransactionalEmail(tx, {
          userId: user.id,
          kind: 'account_setup',
          recipientEmail: user.email,
          subject: 'Complete Your Instructor Portal Setup — IGS — InfoCom Global Services',
          bodyText: `Hello ${user.name},\n\nYour IGS — InfoCom Global Services instructor account (${user.staffCode}) has been provisioned. Set your password using the single-use link below (valid for 72 hours):\n${origin}${issuedOnboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        });
      }

      return { created: user, onboarding: issuedOnboarding };
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'INSTRUCTOR_CREATED',
      entityType: 'user',
      entityId: created.id,
      summary: onboarding
        ? `Created instructor ${created.name} (${created.staffCode}) with single-use 72h setup token.`
        : `Created instructor ${created.name} (${created.staffCode}).`,
    });

    const [items, dashboard] = await Promise.all([
      listInstructorsWithMetrics(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.status(201).json({
      instructor: toPublicUser(created),
      ...(onboarding
        ? {
            onboardingToken: onboarding.rawToken,
            onboardingPath: onboarding.onboardingPath,
            onboardingExpiresAt: onboarding.expiresAt,
          }
        : {}),
      items,
      dashboard,
    });
  } catch (err) {
    console.error('POST /api/instructors error:', err);
    res.status(500).json({ error: 'Failed to create instructor account.' });
  }
});

adminMasterRouter.get('/instructors/:instructorId/detail', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const detail = await getInstructorDetail(req.params.instructorId);
    if (!detail) {
      res.status(404).json({ error: 'Instructor not found.' });
      return;
    }
    res.json(detail);
  } catch (err) {
    console.error('GET /api/instructors/:instructorId/detail error:', err);
    res.status(500).json({ error: 'Failed to load instructor profile.' });
  }
});

adminMasterRouter.patch('/instructors/:instructorId', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateInstructorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid instructor update.' });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { id: req.params.instructorId, role: 'instructor' },
    });
    if (!existing) {
      res.status(404).json({ error: 'Instructor not found.' });
      return;
    }

    const input = parsed.data;
    if (input.email && input.email.toLowerCase() !== existing.email) {
      const conflict = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (conflict) {
        res.status(409).json({ error: 'Another account already uses this email.' });
        return;
      }
    }

    const deactivated = Boolean(input.status && input.status !== 'active');

    await prisma.$transaction(async (tx) => {
      let deptName: string | undefined;
      if (input.departmentId !== undefined) {
        if (input.departmentId) {
          const d = await tx.department.findUnique({ where: { id: input.departmentId } });
          deptName = d?.name ?? 'Academic Faculty';
        } else {
          deptName = 'Academic Faculty';
        }
      }

      await tx.user.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
          ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(deptName !== undefined ? { department: deptName } : {}),
          ...(deactivated ? { sessionVersion: { increment: 1 } } : {}),
        },
      });

      const hireDate =
        input.hireDate === null || input.hireDate === ''
          ? null
          : input.hireDate && !Number.isNaN(Date.parse(input.hireDate))
            ? new Date(input.hireDate)
            : undefined;

      await tx.instructorProfile.upsert({
        where: { userId: existing.id },
        update: {
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(input.specialization !== undefined ? { specialization: input.specialization } : {}),
          ...(input.qualification !== undefined ? { qualification: input.qualification } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(hireDate !== undefined ? { hireDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        create: {
          id: `ip-${existing.id}`,
          userId: existing.id,
          staffCode: existing.staffCode ?? (await generateUniqueStaffCode(tx)),
          departmentId: input.departmentId || null,
          specialization: input.specialization ?? '',
          qualification: input.qualification ?? '',
          bio: input.bio ?? '',
          hireDate: hireDate ?? new Date(),
          status: input.status ?? existing.status,
        },
      });
    });

    if (deactivated) {
      await revokeAllUserSessionsInDb(existing.id, `instructor_status_${input.status}`);
    }

    await recordAuditLog({
      actor: req.authUser!,
      action: 'INSTRUCTOR_UPDATED',
      entityType: 'user',
      entityId: existing.id,
      summary: `Updated instructor ${existing.name} (${Object.keys(input).join(', ')}).`,
    });

    const [detail, items, dashboard] = await Promise.all([
      getInstructorDetail(existing.id),
      listInstructorsWithMetrics(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ detail, items, dashboard });
  } catch (err) {
    console.error('PATCH /api/instructors/:instructorId error:', err);
    res.status(500).json({ error: 'Failed to update instructor.' });
  }
});

adminMasterRouter.put('/instructors/:instructorId/assignments', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = assignInstructorCoursesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assignment payload.' });
      return;
    }

    const instructor = await prisma.user.findFirst({
      where: { id: req.params.instructorId, role: 'instructor' },
    });
    if (!instructor) {
      res.status(404).json({ error: 'Instructor not found.' });
      return;
    }

    const { courseIds, batchIds } = parsed.data;
    const fallbackLead = await prisma.user.findFirst({
      where: { role: 'admin', status: 'active' },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      if (courseIds.length > 0) {
        await tx.course.updateMany({
          where: { id: { in: courseIds } },
          data: { instructorId: instructor.id },
        });
      }
      if (fallbackLead) {
        await tx.course.updateMany({
          where: {
            instructorId: instructor.id,
            ...(courseIds.length > 0 ? { id: { notIn: courseIds } } : {}),
          },
          data: { instructorId: fallbackLead.id },
        });
      }

      await tx.instructorAssignment.updateMany({
        where: {
          instructorId: instructor.id,
          isActive: true,
          ...(batchIds.length > 0 ? { batchId: { notIn: batchIds } } : {}),
        },
        data: { isActive: false, unassignedAt: new Date() },
      });

      if (fallbackLead) {
        await tx.batch.updateMany({
          where: {
            instructorId: instructor.id,
            ...(batchIds.length > 0 ? { id: { notIn: batchIds } } : {}),
          },
          data: { instructorId: fallbackLead.id },
        });
      }

      for (const bId of batchIds) {
        const batch = await tx.batch.findUnique({ where: { id: bId } });
        if (!batch) continue;
        await tx.batch.update({
          where: { id: batch.id },
          data: { instructorId: instructor.id },
        });
        await tx.instructorAssignment.upsert({
          where: {
            instructorId_batchId: { instructorId: instructor.id, batchId: batch.id },
          },
          update: { isActive: true, unassignedAt: null },
          create: {
            id: `ia-${crypto.randomUUID().slice(0, 8)}`,
            instructorId: instructor.id,
            batchId: batch.id,
            courseId: batch.courseId,
            role: 'Lead',
            isActive: true,
          },
        });
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'INSTRUCTOR_ASSIGNMENTS_UPDATED',
      entityType: 'user',
      entityId: instructor.id,
      summary: `Assigned ${courseIds.length} courses and ${batchIds.length} batches to ${instructor.name}.`,
    });

    const [detail, items, dashboard] = await Promise.all([
      getInstructorDetail(instructor.id),
      listInstructorsWithMetrics(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ detail, items, dashboard });
  } catch (err) {
    console.error('PUT /api/instructors/:instructorId/assignments error:', err);
    res.status(500).json({ error: 'Failed to update instructor assignments.' });
  }
});

adminMasterRouter.put('/instructors/:instructorId/permissions', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateInstructorPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid permissions payload.' });
      return;
    }

    const instructor = await prisma.user.findFirst({
      where: { id: req.params.instructorId, role: 'instructor' },
    });
    if (!instructor) {
      res.status(404).json({ error: 'Instructor not found.' });
      return;
    }

    const uniquePerms = Array.from(new Set(parsed.data.permissions));
    await prisma.instructorProfile.upsert({
      where: { userId: instructor.id },
      update: {
        permissionsConfigured: true,
        permissions: uniquePerms,
      },
      create: {
        id: `ip-${instructor.id}`,
        userId: instructor.id,
        staffCode: instructor.staffCode ?? (await generateUniqueStaffCode()),
        permissionsConfigured: true,
        permissions: uniquePerms,
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'INSTRUCTOR_PERMISSIONS_UPDATED',
      entityType: 'user',
      entityId: instructor.id,
      summary: `Updated granular permissions for ${instructor.name} (${uniquePerms.length} enabled).`,
      metadata: { permissions: uniquePerms },
    });

    const [detail, items] = await Promise.all([
      getInstructorDetail(instructor.id),
      listInstructorsWithMetrics(),
    ]);
    res.json({ detail, items });
  } catch (err) {
    console.error('PUT /api/instructors/:instructorId/permissions error:', err);
    res.status(500).json({ error: 'Failed to update instructor permissions.' });
  }
});

// 4. Departments & Course Master Data
adminMasterRouter.get('/departments', ...staffGuard, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [departments, courses] = await Promise.all([
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.course.findMany({ select: { departmentId: true } }),
    ]);
    res.json({
      items: departments.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        headUserId: d.headUserId,
        status: d.status,
        courseCount: courses.filter((c) => c.departmentId === d.id).length,
      })),
    });
  } catch (err) {
    console.error('GET /api/departments error:', err);
    res.status(500).json({ error: 'Failed to load departments.' });
  }
});

adminMasterRouter.post('/departments', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createDepartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid department details.' });
      return;
    }

    const input = parsed.data;
    const upperCode = input.code.toUpperCase();
    const dup = await prisma.department.findUnique({ where: { code: upperCode } });
    if (dup) {
      res.status(409).json({ error: `Department code ${upperCode} already exists.` });
      return;
    }

    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!academy) {
      res.status(400).json({ error: 'Academy record must be initialized first.' });
      return;
    }

    const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.department.create({
      data: {
        id,
        academyId: academy.id,
        code: upperCode,
        name: input.name,
        headUserId: input.headUserId || null,
        status: input.status,
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: id,
      summary: `Created department ${input.name} (${upperCode}).`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ departmentId: id, dashboard });
  } catch (err) {
    console.error('POST /api/departments error:', err);
    res.status(500).json({ error: 'Failed to create department.' });
  }
});

adminMasterRouter.patch('/departments/:id', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateDepartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid department update.' });
      return;
    }

    const existing = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Department not found.' });
      return;
    }

    const input = parsed.data;
    await prisma.department.update({
      where: { id: existing.id },
      data: {
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.headUserId !== undefined ? { headUserId: input.headUserId || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'DEPARTMENT_UPDATED',
      entityType: 'department',
      entityId: existing.id,
      summary: `Updated department ${existing.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/departments/:id error:', err);
    res.status(500).json({ error: 'Failed to update department.' });
  }
});

adminMasterRouter.patch('/courses/:courseId', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateCourseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid course update.' });
      return;
    }

    const existing = await prisma.course.findUnique({
      where: { id: req.params.courseId },
      include: { modules: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const input = parsed.data;
    if (input.slug !== undefined) {
      const conflict = await prisma.course.findFirst({
        where: { slug: input.slug, NOT: { id: existing.id } },
      });
      if (conflict) {
        res.status(409).json({ error: `Course slug "${input.slug}" is already assigned to ${conflict.code}.` });
        return;
      }
    }
    if (input.modules) {
      const totalWeight = input.modules.reduce((acc, m) => acc + m.weight, 0);
      if (totalWeight !== 100) {
        res.status(400).json({ error: `Module weights must sum to 100% (currently ${totalWeight}%).` });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id: existing.id },
        data: {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.track !== undefined ? { track: input.track } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.prerequisites !== undefined ? { prerequisites: input.prerequisites } : {}),
          ...(input.learningObjectives !== undefined ? { learningObjectives: input.learningObjectives } : {}),
          ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
          ...(input.minAttendanceRate !== undefined ? { minAttendanceRate: input.minAttendanceRate } : {}),
          ...(input.gradingConfig !== undefined ? { gradingConfig: input.gradingConfig } : {}),
          ...(input.instructorId !== undefined ? { instructorId: input.instructorId } : {}),
          ...(input.durationWeeks !== undefined ? { durationWeeks: input.durationWeeks } : {}),
          ...(input.tuitionFee !== undefined ? { tuitionFee: Number(input.tuitionFee).toFixed(2) } : {}),
          ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
          ...(input.showTuitionPublicly !== undefined ? { showTuitionPublicly: input.showTuitionPublicly } : {}),
          ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        },
      });

      if (input.modules) {
        const existingById = new Map(existing.modules.map((m) => [m.id, m]));
        const incomingIds = new Set(
          input.modules.map((m) => m.id).filter((id): id is string => Boolean(id))
        );

        // Delete removed modules only if they have no grades
        for (const oldMod of existing.modules) {
          if (!incomingIds.has(oldMod.id)) {
            const gradeCount = await tx.grade.count({ where: { moduleId: oldMod.id } });
            if (gradeCount === 0) {
              await tx.courseModule.delete({ where: { id: oldMod.id } });
            }
          }
        }

        for (let i = 0; i < input.modules.length; i += 1) {
          const m = input.modules[i];
          const upperModCode = m.code.toUpperCase();
          if (m.id && existingById.has(m.id)) {
            await tx.courseModule.update({
              where: { id: m.id },
              data: {
                code: upperModCode,
                title: m.title,
                weight: m.weight,
                labHours: m.labHours,
                sortOrder: i + 1,
              },
            });
          } else {
            const modId = `mod-${existing.id}-${i + 1}-${crypto.randomUUID().slice(0, 4)}`;
            await tx.courseModule.create({
              data: {
                id: modId,
                courseId: existing.id,
                code: upperModCode,
                title: m.title,
                weight: m.weight,
                labHours: m.labHours,
                sortOrder: i + 1,
              },
            });
          }
        }
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action:
        input.isArchived === true
          ? 'COURSE_ARCHIVED'
          : input.isArchived === false
            ? 'COURSE_ACTIVATED'
            : 'COURSE_UPDATED',
      entityType: 'course',
      entityId: existing.id,
      summary: `Updated course master data for ${existing.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/courses/:courseId error:', err);
    res.status(500).json({ error: 'Failed to update course master data.' });
  }
});

// 5. Classrooms, Batch Editing, Student Assignment & Batch Transfer
adminMasterRouter.get('/classrooms', ...staffGuard, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const items = await prisma.classroom.findMany({ orderBy: { code: 'asc' } });
    res.json({ items });
  } catch (err) {
    console.error('GET /api/classrooms error:', err);
    res.status(500).json({ error: 'Failed to load classrooms.' });
  }
});

adminMasterRouter.post('/classrooms', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createClassroomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid classroom details.' });
      return;
    }

    const input = parsed.data;
    const upperCode = input.code.toUpperCase();
    const dup = await prisma.classroom.findUnique({ where: { code: upperCode } });
    if (dup) {
      res.status(409).json({ error: `Classroom code ${upperCode} already exists.` });
      return;
    }

    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!academy) {
      res.status(400).json({ error: 'Academy record not found.' });
      return;
    }

    const id = `room-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.classroom.create({
      data: {
        id,
        academyId: academy.id,
        code: upperCode,
        name: input.name,
        building: input.building,
        capacity: input.capacity,
        equipment: input.equipment,
        isActive: input.isActive,
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'CLASSROOM_CREATED',
      entityType: 'classroom',
      entityId: id,
      summary: `Added classroom ${input.name} (${upperCode}, cap ${input.capacity}).`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ classroomId: id, dashboard });
  } catch (err) {
    console.error('POST /api/classrooms error:', err);
    res.status(500).json({ error: 'Failed to create classroom.' });
  }
});

adminMasterRouter.patch('/classrooms/:id', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateClassroomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid classroom update.' });
      return;
    }
    const existing = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Classroom not found.' });
      return;
    }
    const input = parsed.data;
    await prisma.classroom.update({
      where: { id: existing.id },
      data: {
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.building !== undefined ? { building: input.building } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.equipment !== undefined ? { equipment: input.equipment } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'CLASSROOM_UPDATED',
      entityType: 'classroom',
      entityId: existing.id,
      summary: `Updated classroom ${existing.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/classrooms/:id error:', err);
    res.status(500).json({ error: 'Failed to update classroom.' });
  }
});

adminMasterRouter.patch('/cohorts/:cohortId', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateCohortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid batch update.' });
      return;
    }

    const existing = await prisma.batch.findUnique({ where: { id: req.params.cohortId } });
    if (!existing) {
      res.status(404).json({ error: 'Batch cohort not found.' });
      return;
    }

    const input = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.batch.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.termId !== undefined ? { termId: input.termId || null } : {}),
          ...(input.instructorId !== undefined ? { instructorId: input.instructorId } : {}),
          ...(input.classroomId !== undefined ? { classroomId: input.classroomId || null } : {}),
          ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      if (input.name && input.name !== existing.name) {
        await tx.enrollment.updateMany({
          where: { cohortId: existing.id },
          data: { cohort: input.name, batchNameSnapshot: input.name },
        });
      }

      if (input.instructorId && input.instructorId !== existing.instructorId) {
        await tx.instructorAssignment.upsert({
          where: {
            instructorId_batchId: { instructorId: input.instructorId, batchId: existing.id },
          },
          update: { isActive: true, unassignedAt: null },
          create: {
            id: `ia-${crypto.randomUUID().slice(0, 8)}`,
            instructorId: input.instructorId,
            batchId: existing.id,
            courseId: existing.courseId,
            role: 'Lead',
            isActive: true,
          },
        });
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COHORT_UPDATED',
      entityType: 'cohort',
      entityId: existing.id,
      summary: `Updated batch ${existing.code} (${Object.keys(input).join(', ')}).`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/cohorts/:cohortId error:', err);
    res.status(500).json({ error: 'Failed to update batch.' });
  }
});

adminMasterRouter.post('/cohorts/:cohortId/assign-student', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = assignStudentToCohortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid student assignment.' });
      return;
    }

    const batch = await prisma.batch.findUnique({ where: { id: req.params.cohortId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch cohort not found.' });
      return;
    }

    const activeInBatch = await prisma.enrollment.count({
      where: {
        courseId: batch.courseId,
        OR: [{ cohortId: batch.id }, { cohort: batch.name }],
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });
    if (parsed.data.status === 'Active' && activeInBatch >= batch.capacity) {
      res.status(409).json({
        error: `Batch ${batch.name} is at full capacity (${activeInBatch}/${batch.capacity}). Increase capacity or waitlist the student.`,
      });
      return;
    }

    const result = await createEnrollmentWithOptionalInvoice({
      actor: req.authUser!,
      studentId: parsed.data.studentId,
      courseId: batch.courseId,
      cohortId: batch.id,
      cohort: batch.name,
      status: parsed.data.status,
      issueTuitionInvoice: parsed.data.issueTuitionInvoice,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ enrollmentId: result.enrollmentId, dashboard });
  } catch (err) {
    console.error('POST /api/cohorts/:cohortId/assign-student error:', err);
    res.status(500).json({ error: 'Failed to assign student to batch.' });
  }
});

adminMasterRouter.post('/enrollments/:enrollmentId/transfer', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = transferEnrollmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid batch transfer request.' });
      return;
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: req.params.enrollmentId },
      include: { student: true, course: true },
    });
    if (!enrollment) {
      res.status(404).json({ error: 'Enrollment record not found.' });
      return;
    }
    if (isTerminalEnrollmentStatus(enrollment.status)) {
      res.status(400).json({ error: `Cannot transfer a ${enrollment.status.toLowerCase()} enrollment.` });
      return;
    }

    const targetBatch = await prisma.batch.findUnique({
      where: { id: parsed.data.toBatchId },
      include: { instructor: true },
    });
    if (!targetBatch) {
      res.status(404).json({ error: 'Destination batch not found.' });
      return;
    }
    if (targetBatch.courseId !== enrollment.courseId) {
      res.status(400).json({
        error: 'Destination batch must belong to the same course program.',
      });
      return;
    }
    if (targetBatch.id === enrollment.cohortId) {
      res.status(400).json({ error: 'Student is already assigned to this batch.' });
      return;
    }

    const targetCount = await prisma.enrollment.count({
      where: {
        courseId: targetBatch.courseId,
        OR: [{ cohortId: targetBatch.id }, { cohort: targetBatch.name }],
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });
    if (targetCount >= targetBatch.capacity) {
      res.status(409).json({
        error: `Destination batch ${targetBatch.name} is full (${targetCount}/${targetBatch.capacity}).`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          cohortId: targetBatch.id,
          cohort: targetBatch.name,
          batchNameSnapshot: targetBatch.name,
          instructorNameSnapshot: targetBatch.instructor?.name ?? null,
        },
      });

      await tx.enrollmentHistory.create({
        data: {
          id: `eh-${crypto.randomUUID().slice(0, 8)}`,
          enrollmentId: enrollment.id,
          previousStatus: enrollment.status,
          newStatus: enrollment.status,
          previousBatchId: enrollment.cohortId,
          newBatchId: targetBatch.id,
          reason: `Transferred from "${enrollment.cohort}" to "${targetBatch.name}": ${parsed.data.reason}`,
          changedByUserId: req.authUser!.id,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: enrollment.studentId,
          kind: 'enrollment',
          title: `Batch Transfer · ${enrollment.course.code}`,
          message: `Your cohort for ${enrollment.course.title} has been transferred to ${targetBatch.name}. Reason: ${parsed.data.reason}`,
          relatedCourseId: enrollment.courseId,
          read: false,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: enrollment.studentId,
          channel: 'in_app',
          recipient: enrollment.student.email,
          status: 'Delivered',
        },
      });
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'BATCH_TRANSFERRED',
      entityType: 'enrollment',
      entityId: enrollment.id,
      summary: `Transferred ${enrollment.student.name} from "${enrollment.cohort}" to "${targetBatch.name}".`,
      metadata: {
        fromBatchId: enrollment.cohortId,
        toBatchId: targetBatch.id,
        reason: parsed.data.reason,
      },
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('POST /api/enrollments/:enrollmentId/transfer error:', err);
    res.status(500).json({ error: 'Failed to transfer student batch.' });
  }
});

adminMasterRouter.post('/enrollments/:enrollmentId/course-transfer', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = courseTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid course transfer request.' });
      return;
    }

    const { toCourseId, toBatchId, reason, status, issueTuitionInvoice } = parsed.data;
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: req.params.enrollmentId },
      include: { student: true, course: true },
    });
    if (!enrollment) {
      res.status(404).json({ error: 'Enrollment record not found.' });
      return;
    }
    if (isTerminalEnrollmentStatus(enrollment.status)) {
      res.status(400).json({
        error: `Cannot perform course transfer on a ${enrollment.status.toLowerCase()} enrollment.`,
      });
      return;
    }
    if (toCourseId === enrollment.courseId) {
      res.status(400).json({
        error: 'Destination course matches current course. Use batch transfer instead.',
      });
      return;
    }

    const [targetCourse, targetBatch] = await Promise.all([
      prisma.course.findUnique({
        where: { id: toCourseId },
        include: { instructor: true },
      }),
      prisma.batch.findUnique({
        where: { id: toBatchId },
        include: { instructor: true },
      }),
    ]);

    if (!targetCourse) {
      res.status(404).json({ error: 'Destination course not found.' });
      return;
    }
    if (!targetBatch || targetBatch.courseId !== targetCourse.id) {
      res.status(400).json({
        error: 'Destination batch does not exist or does not belong to the destination course.',
      });
      return;
    }

    const existingTargetEnrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: enrollment.studentId,
        courseId: targetCourse.id,
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });
    if (existingTargetEnrollment) {
      res.status(409).json({
        error: `${enrollment.student.name} already has a ${existingTargetEnrollment.status.toLowerCase()} enrollment in ${targetCourse.code}.`,
      });
      return;
    }

    const targetCount = await prisma.enrollment.count({
      where: {
        courseId: targetBatch.courseId,
        OR: [{ cohortId: targetBatch.id }, { cohort: targetBatch.name }],
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
      },
    });
    if (status === 'Active' && targetCount >= targetBatch.capacity) {
      res.status(409).json({
        error: `Destination batch ${targetBatch.name} is full (${targetCount}/${targetBatch.capacity}).`,
      });
      return;
    }

    const newEnrollmentId = `enr-${crypto.randomUUID().slice(0, 8)}`;

    await prisma.$transaction(async (tx) => {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'Withdrawn' },
      });

      await tx.enrollmentHistory.create({
        data: {
          id: `eh-${crypto.randomUUID().slice(0, 8)}`,
          enrollmentId: enrollment.id,
          previousStatus: enrollment.status,
          newStatus: 'Withdrawn',
          previousBatchId: enrollment.cohortId,
          newBatchId: targetBatch.id,
          reason: `Transferred out to ${targetCourse.code} (${targetBatch.name}): ${reason}`,
          changedByUserId: req.authUser!.id,
        },
      });

      await tx.enrollment.create({
        data: {
          id: newEnrollmentId,
          studentId: enrollment.studentId,
          courseId: targetCourse.id,
          cohortId: targetBatch.id,
          cohort: targetBatch.name,
          status,
          completedModuleIds: [],
          tuitionSnapshot: targetCourse.tuitionFee,
          batchNameSnapshot: targetBatch.name,
          instructorNameSnapshot:
            targetBatch.instructor?.name ?? targetCourse.instructor?.name ?? null,
        },
      });

      await tx.enrollmentHistory.create({
        data: {
          id: `eh-${crypto.randomUUID().slice(0, 8)}`,
          enrollmentId: newEnrollmentId,
          previousStatus: enrollment.status,
          newStatus: status,
          previousBatchId: enrollment.cohortId,
          newBatchId: targetBatch.id,
          reason: `Course transfer from ${enrollment.course.code} (${enrollment.cohort}) to ${targetCourse.code} (${targetBatch.name}): ${reason}`,
          changedByUserId: req.authUser!.id,
        },
      });

      if (issueTuitionInvoice && toCents(targetCourse.tuitionFee.toString()) > 0) {
        const feeStruct = await tx.feeStructure.findFirst({
          where: { courseId: targetCourse.id, isActive: true },
        });
        const invId = `inv-${crypto.randomUUID().slice(0, 8)}`;
        const invNum = await generateNextInvoiceNumber(tx);
        const desc = `${targetCourse.code} ${targetCourse.title} Tuition (${targetBatch.name} · Course Transfer)`;

        const acadRow = await tx.academy.findFirst({ select: { currency: true } });
        await tx.invoice.create({
          data: {
            id: invId,
            invoiceNumber: invNum,
            studentId: enrollment.studentId,
            enrollmentId: newEnrollmentId,
            courseId: targetCourse.id,
            feeStructureId: feeStruct?.id ?? null,
            description: desc,
            subtotal: targetCourse.tuitionFee,
            amountDue: targetCourse.tuitionFee,
            amountPaid: '0.00',
            currency: acadRow?.currency || 'INR',
            status: 'Unpaid',
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            issuedByUserId: req.authUser!.id,
          },
        });

        await tx.invoiceItem.create({
          data: {
            id: `item-${crypto.randomUUID().slice(0, 8)}`,
            invoiceId: invId,
            itemType: 'Tuition',
            description: desc,
            quantity: 1,
            unitPrice: targetCourse.tuitionFee,
            lineTotal: targetCourse.tuitionFee,
          },
        });
      }

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: enrollment.studentId,
          kind: 'enrollment',
          title: `Course Transfer · ${targetCourse.code}`,
          message: `Your enrollment was transferred from ${enrollment.course.code} (${enrollment.cohort}) to ${targetCourse.title} (${targetBatch.name}). Reason: ${reason}`,
          relatedCourseId: targetCourse.id,
          read: false,
        },
      });

      await tx.deliveryLog.create({
        data: {
          id: `del-${crypto.randomUUID().slice(0, 8)}`,
          notificationId: notif.id,
          userId: enrollment.studentId,
          channel: 'in_app',
          recipient: enrollment.student.email,
          status: 'Delivered',
        },
      });
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COURSE_TRANSFERRED',
      entityType: 'enrollment',
      entityId: newEnrollmentId,
      summary: `Transferred ${enrollment.student.name} from ${enrollment.course.code} (${enrollment.cohort}) to ${targetCourse.code} (${targetBatch.name}).`,
      metadata: {
        previousEnrollmentId: enrollment.id,
        fromCourseId: enrollment.courseId,
        toCourseId: targetCourse.id,
        toBatchId: targetBatch.id,
        reason,
      },
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ newEnrollmentId, enrollmentId: newEnrollmentId, dashboard });
  } catch (err) {
    console.error('POST /api/enrollments/:enrollmentId/course-transfer error:', err);
    res.status(500).json({ error: 'Failed to transfer student course.' });
  }
});

adminMasterRouter.get('/enrollments/:enrollmentId/history', requireAuth, requireRoles('admin', 'instructor'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: req.params.enrollmentId },
      include: {
        course: { select: { code: true, title: true } },
        student: { select: { name: true, email: true, studentCode: true } },
        history: { orderBy: { changedAt: 'desc' } },
      },
    });
    if (!enrollment) {
      res.status(404).json({ error: 'Enrollment not found.' });
      return;
    }

    const batchIds = Array.from(
      new Set(
        enrollment.history
          .flatMap((h) => [h.previousBatchId, h.newBatchId])
          .filter((id): id is string => Boolean(id))
      )
    );
    const userIds = Array.from(
      new Set(
        enrollment.history
          .map((h) => h.changedByUserId)
          .filter((id): id is string => Boolean(id))
      )
    );

    const [batches, actors] = await Promise.all([
      batchIds.length > 0
        ? prisma.batch.findMany({ where: { id: { in: batchIds } }, select: { id: true, name: true } })
        : [],
      userIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [],
    ]);

    const batchMap = new Map(batches.map((b) => [b.id, b.name]));
    const actorMap = new Map(actors.map((u) => [u.id, u.name]));

    res.json({
      enrollment: {
        id: enrollment.id,
        studentId: enrollment.studentId,
        studentName: enrollment.student.name,
        studentCode: enrollment.student.studentCode,
        courseId: enrollment.courseId,
        courseCode: enrollment.course.code,
        courseTitle: enrollment.course.title,
        cohortId: enrollment.cohortId,
        cohort: enrollment.cohort,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
      },
      history: enrollment.history.map((h) => ({
        id: h.id,
        enrollmentId: h.enrollmentId,
        previousStatus: h.previousStatus,
        newStatus: h.newStatus,
        previousBatchId: h.previousBatchId,
        newBatchId: h.newBatchId,
        previousBatchName: h.previousBatchId ? batchMap.get(h.previousBatchId) ?? h.previousBatchId : null,
        newBatchName: h.newBatchId ? batchMap.get(h.newBatchId) ?? h.newBatchId : null,
        reason: h.reason,
        changedByUserId: h.changedByUserId,
        changedByName: h.changedByUserId ? actorMap.get(h.changedByUserId) ?? 'Staff' : 'System',
        changedAt: h.changedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('GET /api/enrollments/:enrollmentId/history error:', err);
    res.status(500).json({ error: 'Failed to load enrollment history.' });
  }
});

// 6. Academy Settings, Academic Years & Academic Terms
adminMasterRouter.get('/settings', ...adminGuard, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const payload = await getAcademySettingsPayload();
    res.json(payload);
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Failed to load academy settings.' });
  }
});

adminMasterRouter.put('/settings', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateAcademySettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid academy settings.' });
      return;
    }

    const input = parsed.data;
    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
    const academyId = academy?.id ?? 'acad-infocom';

    await prisma.$transaction(async (tx) => {
      await tx.academy.upsert({
        where: { id: academyId },
        update: {
          name: input.academy.name,
          legalName: input.academy.legalName,
          email: input.academy.email,
          phone: input.academy.phone,
          website: input.academy.website,
          address: input.academy.address,
          ...(input.academy.logoDataUrl !== undefined
            ? { logoDataUrl: input.academy.logoDataUrl }
            : {}),
          timezone: input.academy.timezone,
          currency: input.academy.currency.toUpperCase(),
        },
        create: {
          id: academyId,
          code: 'INFOCOM-MAIN',
          name: input.academy.name,
          legalName: input.academy.legalName,
          email: input.academy.email,
          phone: input.academy.phone,
          website: input.academy.website,
          address: input.academy.address,
          logoDataUrl: input.academy.logoDataUrl ?? '',
          timezone: input.academy.timezone,
          currency: input.academy.currency.toUpperCase(),
        },
      });

      const pairs: Array<{ key: string; value: string; valueType: string }> = [
        { key: 'academy.student_id_prefix', value: (input.policies.studentIdPrefix || 'IGS').toUpperCase(), valueType: 'string' },
        { key: 'academy.invoice_prefix', value: input.policies.invoicePrefix.toUpperCase(), valueType: 'string' },
        { key: 'academy.invoice_next_seq', value: String(input.policies.invoiceNextSeq), valueType: 'number' },
        { key: 'academy.fee_due_days', value: String(input.policies.feeDueDays), valueType: 'number' },
        { key: 'academy.late_fee_pct', value: String(input.policies.lateFeePct), valueType: 'number' },
        { key: 'grading.passing_score', value: String(input.policies.passingScore), valueType: 'number' },
        { key: 'grading.distinction_score', value: String(input.policies.distinctionScore), valueType: 'number' },
        { key: 'attendance.min_rate_pct', value: String(input.policies.minAttendanceRatePct), valueType: 'number' },
        { key: 'attendance.late_weight_pct', value: String(input.policies.lateWeightPct), valueType: 'number' },
        { key: 'session.reminder_window_hours', value: String(input.policies.reminderWindowHours), valueType: 'number' },
        { key: 'certificate.code_prefix', value: input.policies.certificateCodePrefix.toUpperCase(), valueType: 'string' },
        { key: 'certificate.min_completion_pct', value: String(input.policies.certificateMinCompletionPct), valueType: 'number' },
        { key: 'certificate.min_weighted_score', value: String(input.policies.certificateMinScore), valueType: 'number' },
        { key: 'certificate.min_attendance_pct', value: String(input.policies.certificateMinAttendancePct), valueType: 'number' },
        {
          key: 'admission.portal_activation_policy',
          value: input.policies.portalActivationPolicy || 'on_approval',
          valueType: 'string',
        },
      ];

      for (const p of pairs) {
        await tx.academySetting.upsert({
          where: { academyId_key: { academyId, key: p.key } },
          update: {
            value: p.value,
            valueType: p.valueType,
            updatedByUserId: req.authUser!.id,
          },
          create: {
            id: `set-${p.key.replace(/[^a-z0-9]/gi, '-')}`,
            academyId,
            key: p.key,
            value: p.value,
            valueType: p.valueType,
            updatedByUserId: req.authUser!.id,
          },
        });
      }

      if (input.certificateTemplate) {
        const tmpl = await tx.certificateTemplate.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (tmpl) {
          await tx.certificateTemplate.update({
            where: { id: tmpl.id },
            data: {
              name: input.certificateTemplate.name,
              titleFormat: input.certificateTemplate.titleFormat,
              signatoryName: input.certificateTemplate.signatoryName,
              signatoryTitle: input.certificateTemplate.signatoryTitle,
              minCompletionPct: input.policies.certificateMinCompletionPct,
              minScore: input.policies.certificateMinScore,
              minAttendancePct: input.policies.certificateMinAttendancePct,
            },
          });
        }
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ACADEMY_SETTINGS_UPDATED',
      entityType: 'academy',
      entityId: academyId,
      summary: `Updated academy configuration, grading/attendance policies, and invoice/certificate settings.`,
    });

    const [settings, dashboard] = await Promise.all([
      getAcademySettingsPayload(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ settings, dashboard });
  } catch (err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: 'Failed to save academy settings.' });
  }
});

adminMasterRouter.post('/academic-years', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = academicYearSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid academic year.' });
      return;
    }

    const input = parsed.data;
    const upperCode = input.code.toUpperCase();
    const dup = await prisma.academicYear.findUnique({ where: { code: upperCode } });
    if (dup) {
      res.status(409).json({ error: `Academic year ${upperCode} already exists.` });
      return;
    }

    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!academy) {
      res.status(400).json({ error: 'Academy record not found.' });
      return;
    }

    const id = `ay-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({ data: { isCurrent: false } });
      }
      await tx.academicYear.create({
        data: {
          id,
          academyId: academy.id,
          code: upperCode,
          name: input.name,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isCurrent: Boolean(input.isCurrent),
          status: input.status ?? 'Active',
        },
      });
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ACADEMIC_YEAR_CREATED',
      entityType: 'academic_year',
      entityId: id,
      summary: `Created academic year ${input.name} (${upperCode}).`,
    });

    const [settings, dashboard] = await Promise.all([
      getAcademySettingsPayload(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.status(201).json({ settings, dashboard });
  } catch (err) {
    console.error('POST /api/academic-years error:', err);
    res.status(500).json({ error: 'Failed to create academic year.' });
  }
});

adminMasterRouter.patch('/academic-years/:id', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateAcademicYearSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid academic year update.' });
      return;
    }
    const existing = await prisma.academicYear.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Academic year not found.' });
      return;
    }
    const input = parsed.data;
    await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({ data: { isCurrent: false } });
      }
      await tx.academicYear.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
          ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
    });

    const [settings, dashboard] = await Promise.all([
      getAcademySettingsPayload(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ settings, dashboard });
  } catch (err) {
    console.error('PATCH /api/academic-years/:id error:', err);
    res.status(500).json({ error: 'Failed to update academic year.' });
  }
});

adminMasterRouter.post('/academic-terms', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = academicTermSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid academic term.' });
      return;
    }

    const input = parsed.data;
    const upperCode = input.code.toUpperCase();
    const dup = await prisma.academicTerm.findUnique({ where: { code: upperCode } });
    if (dup) {
      res.status(409).json({ error: `Academic term ${upperCode} already exists.` });
      return;
    }

    const id = `term-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicTerm.updateMany({ data: { isCurrent: false } });
      }
      await tx.academicTerm.create({
        data: {
          id,
          academicYearId: input.academicYearId,
          code: upperCode,
          name: input.name,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isCurrent: Boolean(input.isCurrent),
          status: input.status ?? 'Active',
        },
      });
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ACADEMIC_TERM_CREATED',
      entityType: 'academic_term',
      entityId: id,
      summary: `Created academic term ${input.name} (${upperCode}).`,
    });

    const [settings, dashboard] = await Promise.all([
      getAcademySettingsPayload(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.status(201).json({ settings, dashboard });
  } catch (err) {
    console.error('POST /api/academic-terms error:', err);
    res.status(500).json({ error: 'Failed to create academic term.' });
  }
});

adminMasterRouter.patch('/academic-terms/:id', ...adminGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = updateAcademicTermSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid academic term update.' });
      return;
    }
    const existing = await prisma.academicTerm.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Academic term not found.' });
      return;
    }
    const input = parsed.data;
    await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicTerm.updateMany({ data: { isCurrent: false } });
      }
      await tx.academicTerm.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
          ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
          ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
    });

    const [settings, dashboard] = await Promise.all([
      getAcademySettingsPayload(),
      getUserDashboardById(req.authUser!.id),
    ]);
    res.json({ settings, dashboard });
  } catch (err) {
    console.error('PATCH /api/academic-terms/:id error:', err);
    res.status(500).json({ error: 'Failed to update academic term.' });
  }
});
