import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../src/db/index.ts';
import {
  classSessions,
  cohorts,
  courseModules,
  courses,
  enrollments,
  moduleGrades,
  notifications,
  progressRemarks,
  users,
} from '../../src/db/schema.ts';
import {
  createCohortSchema,
  createCourseSchema,
  createEnrollmentSchema,
  createSessionSchema,
  markAttendanceSchema,
  saveGradeSchema,
  saveRemarkSchema,
  toggleModuleSchema,
  updateEnrollmentStatusSchema,
} from '../../src/shared/validation.ts';
import {
  createEnrollmentWithOptionalInvoice,
  getUserDashboardById,
  markAttendanceAndNotify,
  recordAuditLog,
  runSessionReminderSweep,
} from '../ams-service.ts';
import {
  requireAuth,
  requireRoles,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { ensureDatabaseMigratedAndSeeded } from '../migrate.ts';

export const academicsRouter = Router();

const staffGuard = [requireAuth, requireRoles('admin', 'instructor')] as const;

academicsRouter.post('/courses', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureDatabaseMigratedAndSeeded();
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

    const [instructor] = await db
      .select()
      .from(users)
      .where(eq(users.id, input.instructorId))
      .limit(1);
    if (!instructor || (instructor.role !== 'instructor' && instructor.role !== 'admin')) {
      res.status(400).json({ error: 'Selected instructor account was not found.' });
      return;
    }

    const [duplicate] = await db
      .select()
      .from(courses)
      .where(eq(courses.code, input.code.toUpperCase()))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: `Course code ${input.code.toUpperCase()} already exists.` });
      return;
    }

    const courseId = `crs-${crypto.randomUUID().slice(0, 8)}`;
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({
        id: courseId,
        code: input.code.toUpperCase(),
        title: input.title,
        track: input.track,
        description: input.description,
        instructorId: instructor.id,
        durationWeeks: input.durationWeeks,
        tuitionFee: Number(input.tuitionFee).toFixed(2),
        isArchived: false,
      });

      for (let i = 0; i < input.modules.length; i += 1) {
        const mod = input.modules[i];
        await tx.insert(courseModules).values({
          id: `mod-${courseId}-${i + 1}-${crypto.randomUUID().slice(0, 4)}`,
          courseId,
          code: mod.code.toUpperCase(),
          title: mod.title,
          weight: mod.weight,
          labHours: mod.labHours,
          sortOrder: i + 1,
        });
      }
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COURSE_CREATED',
      entityType: 'course',
      entityId: courseId,
      summary: `Created course ${input.code.toUpperCase()} — ${input.title} with ${input.modules.length} modules.`,
    });

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.status(201).json({ courseId, dashboard });
  } catch (err) {
    console.error('POST /api/courses error:', err);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

academicsRouter.post('/cohorts', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureDatabaseMigratedAndSeeded();
    const parsed = createCohortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid cohort details.' });
      return;
    }

    const input = parsed.data;
    const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
    const [instructor] = await db.select().from(users).where(eq(users.id, input.instructorId)).limit(1);
    if (!course || !instructor) {
      res.status(400).json({ error: 'Valid course and instructor are required.' });
      return;
    }

    const [dup] = await db
      .select()
      .from(cohorts)
      .where(eq(cohorts.code, input.code.toUpperCase()))
      .limit(1);
    if (dup) {
      res.status(409).json({ error: `Cohort code ${input.code.toUpperCase()} already exists.` });
      return;
    }

    const cohortId = `coh-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(cohorts).values({
      id: cohortId,
      code: input.code.toUpperCase(),
      name: input.name,
      courseId: course.id,
      instructorId: instructor.id,
      capacity: input.capacity,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      status: input.status,
    });

    await recordAuditLog({
      actor: req.authUser!,
      action: 'COHORT_CREATED',
      entityType: 'cohort',
      entityId: cohortId,
      summary: `Created cohort ${input.name} (${input.code.toUpperCase()}) for ${course.code}.`,
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
    await ensureDatabaseMigratedAndSeeded();
    const parsed = updateEnrollmentStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid enrollment status.' });
      return;
    }

    const [updated] = await db
      .update(enrollments)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(enrollments.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Enrollment not found.' });
      return;
    }

    await recordAuditLog({
      actor: req.authUser!,
      action: 'ENROLLMENT_STATUS_UPDATED',
      entityType: 'enrollment',
      entityId: updated.id,
      summary: `Updated enrollment ${updated.id} status to ${parsed.data.status}.`,
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
    await ensureDatabaseMigratedAndSeeded();
    const parsed = toggleModuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid module completion payload.' });
      return;
    }

    const { enrollmentId, moduleId, completed } = parsed.data;
    const [enr] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);

    if (!enr) {
      res.status(404).json({ error: 'Enrollment not found.' });
      return;
    }

    const [mod] = await db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, enr.courseId)))
      .limit(1);
    if (!mod) {
      res.status(400).json({ error: 'Module does not belong to enrolled course.' });
      return;
    }

    const set = new Set(enr.completedModuleIds ?? []);
    if (completed) set.add(moduleId);
    else set.delete(moduleId);

    await db
      .update(enrollments)
      .set({ completedModuleIds: Array.from(set), updatedAt: new Date() })
      .where(eq(enrollments.id, enr.id));

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
    await ensureDatabaseMigratedAndSeeded();
    const parsed = saveGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid grade input.' });
      return;
    }

    const { studentId, courseId, moduleId, score, feedback } = parsed.data;
    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    const [mod] = await db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, courseId)))
      .limit(1);
    const [student] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, studentId), eq(users.role, 'student')))
      .limit(1);

    if (!course || !mod || !student) {
      res.status(400).json({ error: 'Valid student, course, and module are required.' });
      return;
    }

    const roundedScore = Math.round(score);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .insert(moduleGrades)
        .values({
          id: `grd-${crypto.randomUUID().slice(0, 8)}`,
          studentId,
          courseId,
          moduleId,
          score: roundedScore,
          feedback,
          gradedAt: now,
          gradedByUserId: req.authUser!.id,
          gradedBy: req.authUser!.name,
        })
        .onConflictDoUpdate({
          target: [moduleGrades.studentId, moduleGrades.courseId, moduleGrades.moduleId],
          set: {
            score: roundedScore,
            feedback,
            gradedAt: now,
            gradedByUserId: req.authUser!.id,
            gradedBy: req.authUser!.name,
          },
        });

      await tx.insert(notifications).values({
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: studentId,
        kind: 'grade',
        title: `Grade Posted · ${course.code} ${mod.code}`,
        message: `Score ${roundedScore}% recorded for "${mod.title}" by ${req.authUser!.name}.`,
        relatedCourseId: course.id,
        read: false,
        createdAt: now,
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

academicsRouter.put('/progress/remark', ...staffGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureDatabaseMigratedAndSeeded();
    const parsed = saveRemarkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Valid student, course, and remark are required.' });
      return;
    }

    const { studentId, courseId, summary } = parsed.data;
    const now = new Date();
    await db
      .insert(progressRemarks)
      .values({
        id: `rem-${crypto.randomUUID().slice(0, 8)}`,
        studentId,
        courseId,
        summary,
        updatedAt: now,
        updatedBy: req.authUser!.name,
      })
      .onConflictDoUpdate({
        target: [progressRemarks.studentId, progressRemarks.courseId],
        set: {
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
    await ensureDatabaseMigratedAndSeeded();
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid session details.' });
      return;
    }

    const input = parsed.data;
    const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
    if (!course) {
      res.status(400).json({ error: 'Valid course is required.' });
      return;
    }

    const startDate = new Date(input.startIso);
    const endDate = new Date(startDate.getTime() + Math.max(0.5, input.durationHours) * 60 * 60 * 1000);
    const sessionId = `ses-${crypto.randomUUID().slice(0, 8)}`;

    await db.insert(classSessions).values({
      id: sessionId,
      courseId: course.id,
      cohortId: input.cohortId ?? null,
      cohort: input.cohort,
      title: input.title,
      topic: input.topic || 'Instructor-led lab session',
      room: input.room,
      instructorId: req.authUser!.id,
      instructorName: req.authUser!.name,
      startIso: startDate,
      endIso: endDate,
      status: 'Scheduled',
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
    await ensureDatabaseMigratedAndSeeded();
    const schema = z.object({ status: z.enum(['Scheduled', 'Completed', 'Cancelled']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid session status.' });
      return;
    }

    const [updated] = await db
      .update(classSessions)
      .set({ status: parsed.data.status })
      .where(eq(classSessions.id, req.params.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

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
      res.status(404).json({ error: result.error });
      return;
    }

    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json({ dashboard });
  } catch (err) {
    console.error('POST /api/attendance error:', err);
    res.status(500).json({ error: 'Failed to record attendance.' });
  }
});
