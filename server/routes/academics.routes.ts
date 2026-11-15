import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  isInactiveEnrollmentStatus,
  isValidEnrollmentTransition,
} from '../../src/shared/academic.ts';
import type { EnrollmentStatus } from '../../src/shared/types.ts';
import {
  bulkAttendanceSchema,
  createAssessmentSchema,
  createCohortSchema,
  createCourseSchema,
  createEnrollmentSchema,
  createSessionSchema,
  markAttendanceSchema,
  saveAssessmentGradeSchema,
  saveGradeSchema,
  saveRemarkSchema,
  toggleModuleSchema,
  updateAssessmentSchema,
  updateEnrollmentStatusSchema,
} from '../../src/shared/validation.ts';
import {
  bulkMarkAttendanceAndNotify,
  createEnrollmentWithOptionalInvoice,
  getUserDashboardById,
  listSessionAttendanceHistory,
  markAttendanceAndNotify,
  recordAuditLog,
  runSessionReminderSweep,
  toPublicUser,
} from '../ams-service.ts';
import { prisma } from '../db/prisma.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { listEnrollmentsPaginated } from '../repositories/ams.repository.ts';
import {
  canAccessCourse,
  canAccessStudentRecord,
  canInstructorAccessCourse,
  getInstructorScope,
  hasInstructorPermission,
} from '../security/permissions.ts';

export const academicsRouter = Router();

const staffGuard = [requireAuth, requireRoles('admin', 'instructor')] as const;

academicsRouter.get('/enrollments', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestedCourseId =
      typeof req.query.courseId === 'string' && req.query.courseId.trim()
        ? req.query.courseId.trim()
        : undefined;
    const requestedStudentId =
      typeof req.query.studentId === 'string' && req.query.studentId.trim()
        ? req.query.studentId.trim()
        : undefined;

    let scopedCourseIds: string[] | undefined;
    if (req.authUser!.role === 'instructor') {
      const scope = await getInstructorScope(req.authUser!.id);
      if (requestedCourseId && !scope.courseIds.has(requestedCourseId)) {
        res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
        return;
      }
      if (requestedStudentId && !scope.studentIds.has(requestedStudentId)) {
        res.status(403).json({ error: 'Access denied. Student is not in your assigned courses.' });
        return;
      }
      scopedCourseIds = Array.from(scope.courseIds);
    }

    const result = await listEnrollmentsPaginated({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      courseId: requestedCourseId,
      courseIds: requestedCourseId ? undefined : scopedCourseIds,
      studentId: requestedStudentId,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/enrollments error:', err);
    res.status(500).json({ error: 'Failed to load enrollments.' });
  }
});

academicsRouter.get('/courses/:courseId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.courseId },
      include: {
        modules: { orderBy: { sortOrder: 'asc' } },
        batches: true,
        instructor: { select: { id: true, name: true } },
      },
    });
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const allowed = await canAccessCourse(req.authUser!, course.id);
    if (!allowed) {
      res.status(403).json({ error: 'Access denied. You do not have access to this course.' });
      return;
    }

    res.json({
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        track: course.track,
        description: course.description,
        instructorId: course.instructorId,
        instructorName: course.instructor?.name ?? 'Instructor',
        durationWeeks: course.durationWeeks,
        tuitionFee: course.tuitionFee.toFixed(2),
        modules: course.modules,
        cohorts: course.batches,
      },
    });
  } catch (err) {
    console.error('GET /api/courses/:courseId error:', err);
    res.status(500).json({ error: 'Failed to load course details.' });
  }
});

academicsRouter.get('/students/:studentId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetId = req.params.studentId;
    const allowed = await canAccessStudentRecord(req.authUser!, targetId);
    if (!allowed) {
      res.status(403).json({ error: 'Access denied to student record.' });
      return;
    }

    const student = await prisma.user.findFirst({
      where: { id: targetId, role: 'student' },
    });
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    let courseFilter: string[] | undefined;
    if (req.authUser!.role === 'instructor') {
      const scope = await getInstructorScope(req.authUser!.id);
      courseFilter = Array.from(scope.courseIds);
    }

    const [enrollments, grades, attendance] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          studentId: targetId,
          ...(courseFilter ? { courseId: { in: courseFilter } } : {}),
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      prisma.grade.findMany({
        where: {
          studentId: targetId,
          ...(courseFilter ? { courseId: { in: courseFilter } } : {}),
        },
      }),
      prisma.attendance.findMany({
        where: {
          studentId: targetId,
          ...(courseFilter ? { courseId: { in: courseFilter } } : {}),
        },
      }),
    ]);

    res.json({
      student: toPublicUser(student),
      enrollments,
      grades,
      attendance,
    });
  } catch (err) {
    console.error('GET /api/students/:studentId error:', err);
    res.status(500).json({ error: 'Failed to load student record.' });
  }
});

academicsRouter.get('/students/:studentId/finance', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetId = req.params.studentId;
    if (req.authUser!.role === 'instructor') {
      res.status(403).json({ error: 'Instructors do not have permission to view student financial records.' });
      return;
    }
    if (req.authUser!.role === 'student' && req.authUser!.id !== targetId) {
      res.status(403).json({ error: 'Access denied to another student\'s financial records.' });
      return;
    }

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: { studentId: targetId, isArchived: false },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: { studentId: targetId },
        orderBy: { paidAt: 'desc' },
      }),
    ]);

    res.json({
      invoices: invoices.map((i) => ({
        ...i,
        subtotal: (i.subtotal ?? i.amountDue).toFixed(2),
        amountDue: i.amountDue.toFixed(2),
        amountPaid: i.amountPaid.toFixed(2),
      })),
      payments: payments.map((p) => ({
        ...p,
        amount: p.amount.toFixed(2),
      })),
    });
  } catch (err) {
    console.error('GET /api/students/:studentId/finance error:', err);
    res.status(500).json({ error: 'Failed to load financial records.' });
  }
});

academicsRouter.post('/courses', requireAuth, requireRoles('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createCourseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid course details.' });
      return;
    }

    const input = parsed.data;
    const totalWeight = input.modules.reduce((acc, m) => acc + m.weight, 0);
    if (totalWeight !== 100) {
      res.status(400).json({ error: `Module weights must sum to 100% (currently ${totalWeight}%).` });
      return;
    }

    const instructor = await prisma.user.findUnique({ where: { id: input.instructorId } });
    if (!instructor || (instructor.role !== 'instructor' && instructor.role !== 'admin')) {
      res.status(400).json({ error: 'Selected instructor account was not found.' });
      return;
    }

    const upperCode = input.code.toUpperCase();
    const duplicate = await prisma.course.findUnique({ where: { code: upperCode } });
    if (duplicate) {
      res.status(409).json({ error: `Course code ${upperCode} already exists.` });
      return;
    }

    const courseId = `crs-${crypto.randomUUID().slice(0, 8)}`;
    const tuitionStr = Number(input.tuitionFee).toFixed(2);

    await prisma.$transaction(async (tx) => {
      await tx.course.create({
        data: {
          id: courseId,
          code: upperCode,
          title: input.title,
          track: input.track,
          category: input.category || 'Technical Bootcamp',
          departmentId: input.departmentId || null,
          description: input.description,
          prerequisites: input.prerequisites || '',
          learningObjectives: input.learningObjectives || [],
          passingScore: input.passingScore ?? 60,
          minAttendanceRate: input.minAttendanceRate ?? 75,
          gradingConfig: input.gradingConfig ?? {},
          instructorId: instructor.id,
          durationWeeks: input.durationWeeks,
          tuitionFee: tuitionStr,
          isArchived: false,
        },
      });

      await tx.feeStructure.create({
        data: {
          id: `fs-${courseId}`,
          courseId,
          tuitionAmount: tuitionStr,
          isActive: true,
        },
      });

      for (let i = 0; i < input.modules.length; i += 1) {
        const mod = input.modules[i];
        const modId = `mod-${courseId}-${i + 1}-${crypto.randomUUID().slice(0, 4)}`;
        await tx.courseModule.create({
          data: {
            id: modId,
            courseId,
            code: mod.code.toUpperCase(),
            title: mod.title,
            weight: mod.weight,
            labHours: mod.labHours,
            sortOrder: i + 1,
          },
        });

        await tx.assessment.create({
          data: {
            id: `asmt-${modId}`,
            courseId,
            moduleId: modId,
            title: `${mod.code.toUpperCase()}: ${mod.title}`,
            assessmentType: 'Module Assessment',
            maxScore: 100,
            weight: mod.weight,
            createdByUserId: req.authUser!.id,
          },
        });
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COURSE_CREATED',
      entityType: 'course',
      entityId: courseId,
      summary: `Created course ${upperCode} — ${input.title} with ${input.modules.length} modules.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ courseId, dashboard });
  } catch (err) {
    console.error('POST /api/courses error:', err);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

academicsRouter.post('/cohorts', requireAuth, requireRoles('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createCohortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid cohort details.' });
      return;
    }

    const input = parsed.data;
    const [course, instructor] = await Promise.all([
      prisma.course.findUnique({ where: { id: input.courseId } }),
      prisma.user.findUnique({ where: { id: input.instructorId } }),
    ]);
    if (!course || !instructor) {
      res.status(400).json({ error: 'Valid course and instructor are required.' });
      return;
    }

    const upperCode = input.code.toUpperCase();
    const dup = await prisma.batch.findUnique({ where: { code: upperCode } });
    if (dup) {
      res.status(409).json({ error: `Cohort code ${upperCode} already exists.` });
      return;
    }

    const cohortId = `coh-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.$transaction(async (tx) => {
      await tx.batch.create({
        data: {
          id: cohortId,
          code: upperCode,
          name: input.name,
          courseId: course.id,
          termId: input.termId || null,
          instructorId: instructor.id,
          classroomId: input.classroomId || null,
          capacity: input.capacity,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          status: input.status,
        },
      });

      await tx.instructorAssignment.upsert({
        where: {
          instructorId_batchId: { instructorId: instructor.id, batchId: cohortId },
        },
        update: { isActive: true },
        create: {
          id: `ia-${crypto.randomUUID().slice(0, 8)}`,
          instructorId: instructor.id,
          batchId: cohortId,
          courseId: course.id,
          role: 'Lead',
          isActive: true,
        },
      });
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COHORT_CREATED',
      entityType: 'cohort',
      entityId: cohortId,
      summary: `Created cohort ${input.name} (${upperCode}) for ${course.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ cohortId, dashboard });
  } catch (err) {
    console.error('POST /api/cohorts error:', err);
    res.status(500).json({ error: 'Failed to create cohort.' });
  }
});

academicsRouter.post('/enrollments', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'enrollments:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow managing enrollments.' });
        return;
      }
    }
    const parsed = createEnrollmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid enrollment payload.' });
      return;
    }

    const result = await createEnrollmentWithOptionalInvoice({
      actor: req.authUser!,
      ...parsed.data,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ enrollmentId: result.enrollmentId, dashboard });
  } catch (err) {
    console.error('POST /api/enrollments error:', err);
    res.status(500).json({ error: 'Failed to create enrollment.' });
  }
});

academicsRouter.patch('/enrollments/:id', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'enrollments:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow updating enrollments.' });
        return;
      }
    }
    const parsed = updateEnrollmentStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid enrollment status.' });
      return;
    }

    const existing = await prisma.enrollment.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { code: true, title: true } },
        student: { select: { email: true } },
      },
    });
    if (!existing) {
      res.status(404).json({ error: 'Enrollment not found.' });
      return;
    }

    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, existing.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to manage enrollments for this course.' });
        return;
      }
    }

    const currentStatus = existing.status as EnrollmentStatus;
    const nextStatus = parsed.data.status;
    if (!isValidEnrollmentTransition(currentStatus, nextStatus)) {
      res.status(400).json({
        error: `Cannot transition enrollment from "${currentStatus}" to "${nextStatus}".`,
      });
      return;
    }

    const reasonText =
      parsed.data.reason?.trim() || `Status updated by ${req.authUser!.name}`;

    await prisma.$transaction(async (tx) => {
      await tx.enrollment.update({
        where: { id: existing.id },
        data: { status: nextStatus },
      });

      await tx.enrollmentHistory.create({
        data: {
          id: `eh-${crypto.randomUUID().slice(0, 8)}`,
          enrollmentId: existing.id,
          previousStatus: existing.status,
          newStatus: nextStatus,
          previousBatchId: existing.cohortId,
          newBatchId: existing.cohortId,
          reason: reasonText,
          changedByUserId: req.authUser!.id,
        },
      });

      if (nextStatus !== currentStatus) {
        const notif = await tx.notification.create({
          data: {
            id: `not-${crypto.randomUUID().slice(0, 8)}`,
            userId: existing.studentId,
            kind: 'enrollment',
            title: `Enrollment ${nextStatus} · ${existing.course.code}`,
            message: `Your enrollment in ${existing.course.title} (${existing.cohort}) changed from ${currentStatus} to ${nextStatus}. ${reasonText}`,
            relatedCourseId: existing.courseId,
            read: false,
          },
        });

        await tx.deliveryLog.create({
          data: {
            id: `del-${crypto.randomUUID().slice(0, 8)}`,
            notificationId: notif.id,
            userId: existing.studentId,
            channel: 'in_app',
            recipient: existing.student.email,
            status: 'Delivered',
          },
        });
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ENROLLMENT_STATUS_UPDATED',
      entityType: 'enrollment',
      entityId: existing.id,
      summary: `Updated enrollment ${existing.id} status from ${existing.status} to ${nextStatus}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/enrollments/:id error:', err);
    res.status(500).json({ error: 'Failed to update enrollment status.' });
  }
});

academicsRouter.put('/progress/module-completion', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'progress:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow updating module progress.' });
        return;
      }
    }
    const parsed = toggleModuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid module completion payload.' });
      return;
    }

    const { enrollmentId, moduleId, completed } = parsed.data;
    const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });

    if (!enr) {
      res.status(404).json({ error: 'Enrollment not found.' });
      return;
    }
    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, enr.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to update module progress for this course.' });
        return;
      }
    }
    if (isInactiveEnrollmentStatus(enr.status)) {
      res.status(400).json({ error: `Cannot update module completion for a ${enr.status.toLowerCase()} enrollment.` });
      return;
    }

    const mod = await prisma.courseModule.findFirst({
      where: { id: moduleId, courseId: enr.courseId },
    });
    if (!mod) {
      res.status(400).json({ error: 'Module does not belong to enrolled course.' });
      return;
    }

    const currentIds = Array.isArray(enr.completedModuleIds)
      ? (enr.completedModuleIds as string[])
      : [];
    const set = new Set(currentIds);
    if (completed) set.add(moduleId);
    else set.delete(moduleId);

    await prisma.enrollment.update({
      where: { id: enr.id },
      data: { completedModuleIds: Array.from(set) },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'MODULE_COMPLETION_UPDATED',
      entityType: 'enrollment',
      entityId: enr.id,
      summary: `Marked module ${mod.code} as ${completed ? 'completed' : 'in progress'} for enrollment ${enr.id}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PUT /api/progress/module-completion error:', err);
    res.status(500).json({ error: 'Failed to update module completion.' });
  }
});

academicsRouter.put('/grades', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'grades:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow grading assessments.' });
        return;
      }
    }
    const parsed = saveGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid grade input.' });
      return;
    }

    const { studentId, courseId, moduleId, score, feedback } = parsed.data;
    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to grade assessments for this course.' });
        return;
      }
    }

    const [course, mod, student] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseId } }),
      prisma.courseModule.findFirst({ where: { id: moduleId, courseId } }),
      prisma.user.findFirst({ where: { id: studentId, role: 'student' } }),
    ]);

    if (!course || !mod || !student) {
      res.status(400).json({ error: 'Valid student, course, and module are required.' });
      return;
    }

    const activeEnrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        status: { in: ['Active', 'Completed', 'Waitlisted'] },
      },
    });

    if (!activeEnrollment) {
      res.status(400).json({
        error: 'Student must have a non-dropped enrollment in this course before recording a grade.',
      });
      return;
    }

    const roundedScore = Math.round(score);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      let assessment = await tx.assessment.findFirst({
        where: { courseId, moduleId, assessmentType: 'Module Assessment' },
      });
      if (!assessment) {
        assessment = await tx.assessment.create({
          data: {
            id: `asmt-${mod.id}`,
            courseId,
            moduleId: mod.id,
            title: `${mod.code}: ${mod.title}`,
            assessmentType: 'Module Assessment',
            maxScore: 100,
            weight: mod.weight,
            createdByUserId: req.authUser!.id,
          },
        });
      }

      await tx.grade.upsert({
        where: {
          studentId_assessmentId: { studentId, assessmentId: assessment.id },
        },
        update: {
          score: roundedScore,
          feedback,
          moduleId: mod.id,
          enrollmentId: activeEnrollment.id,
          gradedAt: now,
          gradedByUserId: req.authUser!.id,
          gradedBy: req.authUser!.name,
        },
        create: {
          id: `grd-${crypto.randomUUID().slice(0, 8)}`,
          studentId,
          courseId,
          moduleId: mod.id,
          enrollmentId: activeEnrollment.id,
          assessmentId: assessment.id,
          score: roundedScore,
          maxScore: assessment.maxScore,
          feedback,
          gradedAt: now,
          gradedByUserId: req.authUser!.id,
          gradedBy: req.authUser!.name,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: studentId,
          kind: 'grade',
          title: `Grade Posted · ${course.code} ${mod.code}`,
          message: `Score ${roundedScore}% recorded for "${mod.title}" by ${req.authUser!.name}.`,
          relatedCourseId: course.id,
          read: false,
          createdAt: now,
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
      action: 'GRADE_RECORDED',
      entityType: 'grade',
      entityId: `${studentId}:${courseId}:${moduleId}`,
      summary: `Recorded ${roundedScore}% for ${student.name} on ${course.code} ${mod.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PUT /api/grades error:', err);
    res.status(500).json({ error: 'Failed to save module grade.' });
  }
});

academicsRouter.get('/assessments', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const courseId =
      typeof req.query.courseId === 'string' && req.query.courseId.trim()
        ? req.query.courseId.trim()
        : undefined;

    let scopedCourseIds: string[] | undefined;
    if (req.authUser!.role === 'instructor') {
      const scope = await getInstructorScope(req.authUser!.id);
      if (courseId && !scope.courseIds.has(courseId)) {
        res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
        return;
      }
      scopedCourseIds = Array.from(scope.courseIds);
    }

    const rows = await prisma.assessment.findMany({
      where: courseId
        ? { courseId }
        : scopedCourseIds
          ? { courseId: { in: scopedCourseIds } }
          : undefined,
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      assessments: rows.map((a) => ({
        id: a.id,
        courseId: a.courseId,
        moduleId: a.moduleId,
        batchId: a.batchId,
        title: a.title,
        assessmentType: a.assessmentType,
        maxScore: a.maxScore,
        weight: a.weight,
        dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('GET /api/assessments error:', err);
    res.status(500).json({ error: 'Failed to load assessments.' });
  }
});

academicsRouter.post('/assessments', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'grades:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow creating assessments.' });
        return;
      }
    }

    const parsed = createAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assessment input.' });
      return;
    }

    const input = parsed.data;
    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, input.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to manage assessments for this course.' });
        return;
      }
    }

    const course = await prisma.course.findUnique({ where: { id: input.courseId } });
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    if (input.moduleId) {
      const mod = await prisma.courseModule.findFirst({
        where: { id: input.moduleId, courseId: course.id },
        select: { id: true },
      });
      if (!mod) {
        res.status(400).json({ error: 'Selected module does not belong to this course.' });
        return;
      }
    }

    if (input.batchId) {
      const batch = await prisma.batch.findFirst({
        where: { id: input.batchId, courseId: course.id },
        select: { id: true },
      });
      if (!batch) {
        res.status(400).json({ error: 'Selected batch does not belong to this course.' });
        return;
      }
    }

    const assessmentId = `asmt-${crypto.randomUUID().slice(0, 8)}`;
    await prisma.assessment.create({
      data: {
        id: assessmentId,
        courseId: course.id,
        moduleId: input.moduleId || null,
        batchId: input.batchId || null,
        title: input.title,
        assessmentType: input.assessmentType,
        maxScore: input.maxScore,
        weight: input.weight,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdByUserId: req.authUser!.id,
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ASSESSMENT_CREATED',
      entityType: 'assessment',
      entityId: assessmentId,
      summary: `Created ${input.assessmentType} "${input.title}" (max ${input.maxScore}, weight ${input.weight}%) for ${course.code}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ assessmentId, dashboard });
  } catch (err) {
    console.error('POST /api/assessments error:', err);
    res.status(500).json({ error: 'Failed to create assessment.' });
  }
});

academicsRouter.patch('/assessments/:id', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'grades:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow updating assessments.' });
        return;
      }
    }

    const parsed = updateAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assessment update payload.' });
      return;
    }

    const existing = await prisma.assessment.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, existing.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to update assessments for this course.' });
        return;
      }
    }

    const input = parsed.data;
    if (input.moduleId) {
      const mod = await prisma.courseModule.findFirst({
        where: { id: input.moduleId, courseId: existing.courseId },
        select: { id: true },
      });
      if (!mod) {
        res.status(400).json({ error: 'Selected module does not belong to this course.' });
        return;
      }
    }
    if (input.batchId) {
      const batch = await prisma.batch.findFirst({
        where: { id: input.batchId, courseId: existing.courseId },
        select: { id: true },
      });
      if (!batch) {
        res.status(400).json({ error: 'Selected batch does not belong to this course.' });
        return;
      }
    }

    await prisma.assessment.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.assessmentType !== undefined ? { assessmentType: input.assessmentType } : {}),
        ...(input.moduleId !== undefined ? { moduleId: input.moduleId || null } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId || null } : {}),
        ...(input.maxScore !== undefined ? { maxScore: input.maxScore } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ASSESSMENT_UPDATED',
      entityType: 'assessment',
      entityId: existing.id,
      summary: `Updated assessment "${input.title ?? existing.title}".`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/assessments/:id error:', err);
    res.status(500).json({ error: 'Failed to update assessment.' });
  }
});

academicsRouter.delete('/assessments/:id', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'grades:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow removing assessments.' });
        return;
      }
    }

    const existing = await prisma.assessment.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { grades: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, existing.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to delete assessments for this course.' });
        return;
      }
    }

    if (existing.assessmentType === 'Module Assessment') {
      res.status(400).json({ error: 'Primary module assessments cannot be deleted directly.' });
      return;
    }

    if (existing._count.grades > 0) {
      res.status(409).json({
        error: `Cannot delete "${existing.title}" because ${existing._count.grades} grade record(s) already exist.`,
      });
      return;
    }

    await prisma.assessment.delete({ where: { id: existing.id } });
    await recordAuditLog({
      actor: req.authUser!,
      action: 'ASSESSMENT_DELETED',
      entityType: 'assessment',
      entityId: existing.id,
      summary: `Deleted assessment "${existing.title}".`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('DELETE /api/assessments/:id error:', err);
    res.status(500).json({ error: 'Failed to delete assessment.' });
  }
});

academicsRouter.put('/assessments/:id/grades', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'grades:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow grading assessments.' });
        return;
      }
    }

    const parsed = saveAssessmentGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assessment grade.' });
      return;
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: req.params.id },
      include: { course: true },
    });
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' });
      return;
    }

    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, assessment.courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to grade assessments for this course.' });
        return;
      }
    }

    const { studentId, score, feedback } = parsed.data;
    if (score > assessment.maxScore) {
      res.status(400).json({
        error: `Score (${score}) cannot exceed assessment max score (${assessment.maxScore}).`,
      });
      return;
    }

    const student = await prisma.user.findFirst({ where: { id: studentId, role: 'student' } });
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const activeEnrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId: assessment.courseId,
        status: { in: ['Active', 'Completed', 'Waitlisted'] },
        ...(assessment.batchId ? { cohortId: assessment.batchId } : {}),
      },
    });
    if (!activeEnrollment) {
      res.status(400).json({
        error: 'Student does not have an eligible enrollment for this assessment.',
      });
      return;
    }

    const roundedScore = Math.round(score);
    const pct = Math.round((roundedScore / Math.max(1, assessment.maxScore)) * 1000) / 10;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.grade.upsert({
        where: {
          studentId_assessmentId: { studentId, assessmentId: assessment.id },
        },
        update: {
          score: roundedScore,
          maxScore: assessment.maxScore,
          feedback,
          moduleId: assessment.moduleId,
          enrollmentId: activeEnrollment.id,
          gradedAt: now,
          gradedByUserId: req.authUser!.id,
          gradedBy: req.authUser!.name,
        },
        create: {
          id: `grd-${crypto.randomUUID().slice(0, 8)}`,
          studentId,
          courseId: assessment.courseId,
          moduleId: assessment.moduleId,
          enrollmentId: activeEnrollment.id,
          assessmentId: assessment.id,
          score: roundedScore,
          maxScore: assessment.maxScore,
          feedback,
          gradedAt: now,
          gradedByUserId: req.authUser!.id,
          gradedBy: req.authUser!.name,
        },
      });

      const notif = await tx.notification.create({
        data: {
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: studentId,
          kind: 'grade',
          title: `${assessment.assessmentType} Graded · ${assessment.course.code}`,
          message: `Score ${roundedScore}/${assessment.maxScore} (${pct}%) recorded for "${assessment.title}" by ${req.authUser!.name}.`,
          relatedCourseId: assessment.courseId,
          read: false,
          createdAt: now,
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
      action: 'ASSESSMENT_GRADE_RECORDED',
      entityType: 'grade',
      entityId: `${studentId}:${assessment.id}`,
      summary: `Recorded ${roundedScore}/${assessment.maxScore} (${pct}%) for ${student.name} on "${assessment.title}".`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PUT /api/assessments/:id/grades error:', err);
    res.status(500).json({ error: 'Failed to save assessment grade.' });
  }
});

academicsRouter.put('/progress/remark', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'progress:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow writing progress remarks.' });
        return;
      }
    }
    const parsed = saveRemarkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Valid student, course, and remark are required.',
      });
      return;
    }

    const { studentId, courseId, summary } = parsed.data;
    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, courseId);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to write progress remarks for this course.' });
        return;
      }
    }

    const [student, course] = await Promise.all([
      prisma.user.findFirst({ where: { id: studentId, role: 'student' } }),
      prisma.course.findUnique({ where: { id: courseId } }),
    ]);

    if (!student || !course) {
      res.status(400).json({ error: 'Valid student and course are required.' });
      return;
    }

    const activeEnrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        status: { in: ['Active', 'Completed', 'Waitlisted'] },
      },
    });

    if (!activeEnrollment) {
      res.status(400).json({
        error: 'Student must be enrolled in this course before recording an instructor remark.',
      });
      return;
    }

    const now = new Date();
    await prisma.progressRemark.upsert({
      where: {
        studentId_courseId: { studentId, courseId },
      },
      update: {
        summary,
        enrollmentId: activeEnrollment.id,
        updatedAt: now,
        updatedBy: req.authUser!.name,
      },
      create: {
        id: `rem-${crypto.randomUUID().slice(0, 8)}`,
        studentId,
        courseId,
        enrollmentId: activeEnrollment.id,
        summary,
        updatedAt: now,
        updatedBy: req.authUser!.name,
      },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'REMARK_UPDATED',
      entityType: 'progress_remark',
      entityId: `${studentId}:${courseId}`,
      summary: `Updated instructor evaluation remark for student ${studentId} in course ${courseId}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PUT /api/progress/remark error:', err);
    res.status(500).json({ error: 'Failed to save progress remark.' });
  }
});

academicsRouter.post('/sessions', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'sessions:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow scheduling sessions.' });
        return;
      }
    }
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid session details.' });
      return;
    }

    const input = parsed.data;
    const course = await prisma.course.findUnique({ where: { id: input.courseId } });
    if (!course) {
      res.status(400).json({ error: 'Valid course is required.' });
      return;
    }
    if (req.authUser!.role === 'instructor') {
      const allowed = await canInstructorAccessCourse(req.authUser!.id, course.id);
      if (!allowed) {
        res.status(403).json({ error: 'You are not assigned to schedule sessions for this course.' });
        return;
      }
    }

    const matchedBatch = input.cohortId
      ? await prisma.batch.findUnique({ where: { id: input.cohortId } })
      : await prisma.batch.findFirst({ where: { courseId: course.id, name: input.cohort } });

    const startDate = new Date(input.startIso);
    const endDate = new Date(startDate.getTime() + Math.max(0.5, input.durationHours) * 60 * 60 * 1000);
    const sessionId = `ses-${crypto.randomUUID().slice(0, 8)}`;

    await prisma.classSession.create({
      data: {
        id: sessionId,
        courseId: course.id,
        cohortId: matchedBatch?.id ?? input.cohortId ?? null,
        cohort: input.cohort,
        title: input.title,
        topic: input.topic || 'Instructor-led lab session',
        room: input.room,
        instructorId: req.authUser!.id,
        instructorName: req.authUser!.name,
        startIso: startDate,
        endIso: endDate,
        status: 'Scheduled',
      },
    });

    const remindersCreated = await runSessionReminderSweep();
    await recordAuditLog({
      actor: req.authUser!,
      action: 'SESSION_SCHEDULED',
      entityType: 'class_session',
      entityId: sessionId,
      summary: `Scheduled "${input.title}" for ${course.code} (${input.cohort}) in ${input.room}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({
      sessionId,
      remindersCreatedCount: remindersCreated.length,
      dashboard,
    });
  } catch (err) {
    console.error('POST /api/sessions error:', err);
    res.status(500).json({ error: 'Failed to schedule class session.' });
  }
});

academicsRouter.patch('/sessions/:id/status', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'sessions:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow updating session status.' });
        return;
      }
    }
    const schema = z.object({ status: z.enum(['Scheduled', 'Completed', 'Cancelled']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid session status.' });
      return;
    }

    const existing = await prisma.classSession.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    if (req.authUser!.role === 'instructor') {
      const allowed =
        existing.instructorId === req.authUser!.id ||
        (await canInstructorAccessCourse(req.authUser!.id, existing.courseId));
      if (!allowed) {
        res.status(403).json({ error: 'You are not authorized to manage this class session.' });
        return;
      }
    }

    const updated = await prisma.classSession.update({
      where: { id: existing.id },
      data: { status: parsed.data.status },
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'SESSION_STATUS_UPDATED',
      entityType: 'class_session',
      entityId: updated.id,
      summary: `Updated session "${updated.title}" status to ${parsed.data.status}.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('PATCH /api/sessions/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update session status.' });
  }
});

academicsRouter.post('/attendance', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'attendance:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow marking attendance.' });
        return;
      }
    }
    const parsed = markAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid attendance payload.' });
      return;
    }

    const result = await markAttendanceAndNotify({
      actor: req.authUser!,
      ...parsed.data,
    });
    if (!result.ok) {
      res.status(result.status ?? 404).json({ error: result.error });
      return;
    }

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('POST /api/attendance error:', err);
    res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

academicsRouter.post('/attendance/bulk', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.authUser!.role === 'instructor') {
      const permitted = await hasInstructorPermission(req.authUser!, 'attendance:manage');
      if (!permitted) {
        res.status(403).json({ error: 'Your instructor permissions do not allow marking attendance.' });
        return;
      }
    }

    const parsed = bulkAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid bulk attendance payload.' });
      return;
    }

    const result = await bulkMarkAttendanceAndNotify({
      actor: req.authUser!,
      ...parsed.data,
    });
    if (!result.ok) {
      res.status(result.status ?? 400).json({ error: result.error });
      return;
    }

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ updatedCount: result.updatedCount, dashboard });
  } catch (err) {
    console.error('POST /api/attendance/bulk error:', err);
    res.status(500).json({ error: 'Failed to record bulk attendance.' });
  }
});

academicsRouter.get('/attendance/history', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId =
      typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId query parameter is required.' });
      return;
    }

    const session = await prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    if (req.authUser!.role === 'instructor') {
      const allowed =
        session.instructorId === req.authUser!.id ||
        (await canInstructorAccessCourse(req.authUser!.id, session.courseId));
      if (!allowed) {
        res.status(403).json({ error: 'Access denied to session attendance history.' });
        return;
      }
    }

    const entries = await listSessionAttendanceHistory(sessionId);
    res.json({ entries });
  } catch (err) {
    console.error('GET /api/attendance/history error:', err);
    res.status(500).json({ error: 'Failed to load attendance history.' });
  }
});
