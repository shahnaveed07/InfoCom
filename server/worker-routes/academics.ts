import { z } from 'zod';
import {
  isInactiveEnrollmentStatus,
  isTerminalEnrollmentStatus,
  isValidEnrollmentTransition,
  slugifyCourseTitle,
  toCents,
} from '../../src/shared/academic.ts';
import type { EnrollmentStatus } from '../../src/shared/types.ts';
import {
  assignStudentToCohortSchema,
  bulkAttendanceSchema,
  courseTransferSchema,
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
  transferEnrollmentSchema,
  updateAssessmentSchema,
  updateCohortSchema,
  updateCourseSchema,
  updateEnrollmentStatusSchema,
} from '../../src/shared/validation.ts';
import {
  generateNextInvoiceNumberD1,
  getUserDashboardByIdD1,
  recordAuditLogD1,
} from '../d1/ams-service.ts';
import {
  type D1PreparedStatementLike,
  d1All,
  d1Batch,
  d1First,
  d1Run,
  d1Stmt,
  inPlaceholders,
  nowIso,
  randomId,
  sqlFixed,
  sqlJson,
} from '../d1/client.ts';
import {
  canAccessCourseD1,
  canAccessStudentRecordD1,
  canInstructorAccessCourseD1,
  getInstructorScopeD1,
  hasInstructorPermissionD1,
} from '../d1/permissions.ts';
import {
  listEnrollmentsPaginatedD1,
  toPublicUserD1,
  type DbUserRow,
} from '../d1/repository.ts';
import {
  bulkMarkAttendanceAndNotifyD1,
  createEnrollmentWithOptionalInvoiceD1,
  listSessionAttendanceHistoryD1,
  markAttendanceAndNotifyD1,
} from '../d1/workflows.ts';
import { runD1SessionReminderSweep } from '../jobs/d1-worker.ts';
import type { WorkerRouteEntry } from '../worker-router.ts';

const updateSessionStatusSchema = z.object({
  status: z.enum(['Scheduled', 'Completed', 'Cancelled']),
});

export const workerAcademicRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/enrollments',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const requestedCourseId = (c.query.get('courseId') ?? '').trim() || undefined;
      const requestedStudentId = (c.query.get('studentId') ?? '').trim() || undefined;

      let scopedCourseIds: string[] | undefined;
      if (c.authUser!.role === 'instructor') {
        const scope = await getInstructorScopeD1(c.authUser!.id, c.db);
        if (requestedCourseId && !scope.courseIds.has(requestedCourseId)) {
          return c.json(403, {
            error: 'Access denied. You are not assigned to this course.',
          });
        }
        if (requestedStudentId && !scope.studentIds.has(requestedStudentId)) {
          return c.json(403, {
            error: 'Access denied. Student is not in your assigned courses.',
          });
        }
        scopedCourseIds = Array.from(scope.courseIds);
      }

      const result = await listEnrollmentsPaginatedD1(
        {
          page: Number(c.query.get('page')) || 1,
          pageSize: Number(c.query.get('pageSize')) || 20,
          courseId: requestedCourseId,
          courseIds: requestedCourseId ? undefined : scopedCourseIds,
          studentId: requestedStudentId,
          status: (c.query.get('status') ?? '').trim() || undefined,
        },
        c.db
      );
      return c.json(200, result);
    },
  },
  {
    method: 'GET',
    pattern: '/api/courses/:courseId',
    auth: 'required',
    handler: async (c) => {
      const course = await d1First<Record<string, unknown>>(
        `SELECT crs.*, u.name AS instructor_name
         FROM courses crs
         LEFT JOIN users u ON u.id = crs.instructor_id
         WHERE crs.id = ? LIMIT 1`,
        [c.params.courseId],
        c.db
      );
      if (!course) {
        return c.json(404, { error: 'Course not found.' });
      }

      const allowed = await canAccessCourseD1(c.authUser!, String(course.id), c.db);
      if (!allowed) {
        return c.json(403, {
          error: 'Access denied. You do not have access to this course.',
        });
      }

      const [modules, batches] = await Promise.all([
        d1All<Record<string, unknown>>(
          'SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC',
          [String(course.id)],
          c.db
        ),
        d1All<Record<string, unknown>>(
          'SELECT * FROM cohorts WHERE course_id = ? ORDER BY start_date ASC',
          [String(course.id)],
          c.db
        ),
      ]);

      return c.json(200, {
        course: {
          id: String(course.id),
          code: String(course.code),
          title: String(course.title),
          track: String(course.track),
          description: String(course.description || ''),
          instructorId: String(course.instructor_id),
          instructorName: course.instructor_name ? String(course.instructor_name) : 'Instructor',
          durationWeeks: Number(course.duration_weeks),
          tuitionFee: sqlFixed(course.tuition_fee),
          modules: modules.map((m) => ({
            id: String(m.id),
            courseId: String(m.course_id),
            code: String(m.code),
            title: String(m.title),
            weight: Number(m.weight),
            labHours: Number(m.lab_hours),
            sortOrder: Number(m.sort_order),
          })),
          cohorts: batches.map((b) => ({
            id: String(b.id),
            code: String(b.code),
            name: String(b.name),
            courseId: String(b.course_id),
            termId: b.term_id ? String(b.term_id) : null,
            instructorId: String(b.instructor_id),
            classroomId: b.classroom_id ? String(b.classroom_id) : null,
            capacity: Number(b.capacity),
            startDate: String(b.start_date),
            endDate: String(b.end_date),
            status: String(b.status),
          })),
        },
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/students/:studentId',
    auth: 'required',
    handler: async (c) => {
      const targetId = c.params.studentId;
      const allowed = await canAccessStudentRecordD1(c.authUser!, targetId, c.db);
      if (!allowed) {
        return c.json(403, { error: 'Access denied to student record.' });
      }

      const student = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
        [targetId],
        c.db
      );
      if (!student) {
        return c.json(404, { error: 'Student not found.' });
      }

      let courseFilterClause = '';
      const filterParams: unknown[] = [targetId];
      if (c.authUser!.role === 'instructor') {
        const scope = await getInstructorScopeD1(c.authUser!.id, c.db);
        const ids = Array.from(scope.courseIds);
        if (ids.length === 0) {
          return c.json(200, {
            student: toPublicUserD1(student),
            enrollments: [],
            grades: [],
            attendance: [],
          });
        }
        courseFilterClause = ` AND course_id IN (${inPlaceholders(ids.length)})`;
        filterParams.push(...ids);
      }

      const [enrollments, grades, attendance] = await Promise.all([
        d1All<Record<string, unknown>>(
          `SELECT * FROM enrollments WHERE student_id = ?${courseFilterClause} ORDER BY enrolled_at DESC`,
          filterParams,
          c.db
        ),
        d1All<Record<string, unknown>>(
          `SELECT * FROM module_grades WHERE student_id = ?${courseFilterClause}`,
          filterParams,
          c.db
        ),
        d1All<Record<string, unknown>>(
          `SELECT * FROM attendance_records WHERE student_id = ?${courseFilterClause}`,
          filterParams,
          c.db
        ),
      ]);

      return c.json(200, {
        student: toPublicUserD1(student),
        enrollments: enrollments.map((e) => ({
          id: String(e.id),
          studentId: String(e.student_id),
          courseId: String(e.course_id),
          cohortId: e.cohort_id ? String(e.cohort_id) : null,
          cohort: String(e.cohort),
          status: String(e.status),
          enrolledAt: String(e.enrolled_at),
          completedModuleIds: sqlJson<string[]>(e.completed_module_ids, []),
        })),
        grades: grades.map((g) => ({
          id: String(g.id),
          studentId: String(g.student_id),
          courseId: String(g.course_id),
          moduleId: g.module_id ? String(g.module_id) : null,
          assessmentId: String(g.assessment_id),
          score: Number(g.score),
          maxScore: Number(g.max_score),
          feedback: String(g.feedback || ''),
          gradedAt: String(g.graded_at),
          gradedBy: String(g.graded_by),
        })),
        attendance: attendance.map((a) => ({
          id: String(a.id),
          sessionId: String(a.session_id),
          courseId: String(a.course_id),
          studentId: String(a.student_id),
          status: String(a.status),
          note: String(a.note || ''),
          updatedAt: String(a.updated_at),
          updatedBy: String(a.updated_by),
        })),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/students/:studentId/finance',
    auth: 'required',
    handler: async (c) => {
      const targetId = c.params.studentId;
      if (c.authUser!.role === 'instructor') {
        return c.json(403, {
          error: 'Instructors do not have permission to view student financial records.',
        });
      }
      if (c.authUser!.role === 'student' && c.authUser!.id !== targetId) {
        return c.json(403, {
          error: "Access denied to another student's financial records.",
        });
      }

      const [invoices, payments] = await Promise.all([
        d1All<Record<string, unknown>>(
          'SELECT * FROM fee_invoices WHERE student_id = ? AND is_archived = 0 ORDER BY created_at DESC',
          [targetId],
          c.db
        ),
        d1All<Record<string, unknown>>(
          'SELECT * FROM payments WHERE student_id = ? ORDER BY paid_at DESC',
          [targetId],
          c.db
        ),
      ]);

      return c.json(200, {
        invoices: invoices.map((i) => ({
          id: String(i.id),
          invoiceNumber: String(i.invoice_number),
          studentId: String(i.student_id),
          enrollmentId: i.enrollment_id ? String(i.enrollment_id) : null,
          courseId: String(i.course_id),
          description: String(i.description),
          subtotal: sqlFixed(i.subtotal ?? i.amount_due),
          discountTotal: sqlFixed(i.discount_total),
          scholarshipTotal: sqlFixed(i.scholarship_total),
          amountDue: sqlFixed(i.amount_due),
          amountPaid: sqlFixed(i.amount_paid),
          currency: String(i.currency || 'INR'),
          status: String(i.status),
          dueDate: String(i.due_date),
          createdAt: String(i.created_at),
        })),
        payments: payments.map((p) => ({
          id: String(p.id),
          receiptNumber: String(p.receipt_number),
          invoiceId: String(p.invoice_id),
          studentId: String(p.student_id),
          amount: sqlFixed(p.amount),
          method: String(p.method),
          referenceCode: String(p.reference_code || ''),
          notes: String(p.notes || ''),
          paidAt: String(p.paid_at),
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/courses',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createCourseSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid course details.',
        });
      }

      const input = parsed.data;
      const totalWeight = input.modules.reduce((acc, m) => acc + m.weight, 0);
      if (totalWeight !== 100) {
        return c.json(400, {
          error: `Module weights must sum to 100% (currently ${totalWeight}%).`,
        });
      }

      const instructor = await d1First<{ id: string; role: string }>(
        'SELECT id, role FROM users WHERE id = ? LIMIT 1',
        [input.instructorId],
        c.db
      );
      if (!instructor || (instructor.role !== 'instructor' && instructor.role !== 'admin')) {
        return c.json(400, { error: 'Selected instructor account was not found.' });
      }

      const upperCode = input.code.toUpperCase();
      const duplicate = await d1First<{ id: string }>(
        'SELECT id FROM courses WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (duplicate) {
        return c.json(409, { error: `Course code ${upperCode} already exists.` });
      }

      const courseId = randomId('crs', 8);
      const tuitionStr = Number(input.tuitionFee).toFixed(2);
      const baseSlug = input.slug?.trim() || slugifyCourseTitle(input.title);
      const existingSlug = await d1First<{ id: string }>(
        'SELECT id FROM courses WHERE slug = ? LIMIT 1',
        [baseSlug],
        c.db
      );
      if (existingSlug && input.slug) {
        return c.json(409, { error: `Course slug "${baseSlug}" is already in use.` });
      }
      const finalSlug = existingSlug ? `${baseSlug}-${upperCode.toLowerCase()}` : baseSlug;
      const dupFinalSlug = existingSlug
        ? await d1First<{ id: string }>('SELECT id FROM courses WHERE slug = ? LIMIT 1', [finalSlug], c.db)
        : null;
      const resolvedSlug = dupFinalSlug ? `${baseSlug}-${courseId.slice(-6)}` : finalSlug;
      const now = nowIso();

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `INSERT INTO courses
             (id, code, slug, title, track, category, department_id, description, prerequisites,
              learning_objectives, passing_score, min_attendance_rate, grading_config, instructor_id,
              duration_weeks, tuition_fee, is_published, show_tuition_publicly, is_demo, is_archived,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          [
            courseId,
            upperCode,
            resolvedSlug,
            input.title,
            input.track,
            input.category || 'Technical Bootcamp',
            input.departmentId || null,
            input.description,
            input.prerequisites || '',
            JSON.stringify(input.learningObjectives || []),
            input.passingScore ?? 60,
            input.minAttendanceRate ?? 75,
            JSON.stringify(input.gradingConfig ?? {}),
            instructor.id,
            input.durationWeeks,
            tuitionStr,
            input.isPublished ? 1 : 0,
            input.showTuitionPublicly === false ? 0 : 1,
            now,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO fee_structures
             (id, course_id, tuition_amount, registration_fee, lab_fee, effective_from, is_active, created_at)
           VALUES (?, ?, ?, '0.00', '0.00', ?, 1, ?)`,
          [`fs-${courseId}`, courseId, tuitionStr, now, now],
          c.db
        ),
      ];

      for (let i = 0; i < input.modules.length; i += 1) {
        const mod = input.modules[i];
        const modId = `mod-${courseId}-${i + 1}-${crypto.randomUUID().slice(0, 4)}`;
        const upperModCode = mod.code.toUpperCase();
        stmts.push(
          d1Stmt(
            `INSERT INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [modId, courseId, upperModCode, mod.title, mod.weight, mod.labHours, i + 1],
            c.db
          ),
          d1Stmt(
            `INSERT INTO assessments
               (id, course_id, module_id, title, assessment_type, max_score, weight, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, 'Module Assessment', 100, ?, ?, ?)`,
            [
              `asmt-${modId}`,
              courseId,
              modId,
              `${upperModCode}: ${mod.title}`,
              mod.weight,
              c.authUser!.id,
              now,
            ],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'COURSE_CREATED',
          entityType: 'course',
          entityId: courseId,
          summary: `Created course ${upperCode} — ${input.title} with ${input.modules.length} modules.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { courseId, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/courses/:courseId',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateCourseSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid course update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM courses WHERE id = ? LIMIT 1',
        [c.params.courseId],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Course not found.' });
      }

      const input = parsed.data;
      if (input.slug !== undefined) {
        const conflict = await d1First<{ id: string; code: string }>(
          'SELECT id, code FROM courses WHERE slug = ? AND id != ? LIMIT 1',
          [input.slug, String(existing.id)],
          c.db
        );
        if (conflict) {
          return c.json(409, {
            error: `Course slug "${input.slug}" is already assigned to ${conflict.code}.`,
          });
        }
      }
      if (input.modules) {
        const totalWeight = input.modules.reduce((acc, m) => acc + m.weight, 0);
        if (totalWeight !== 100) {
          return c.json(400, {
            error: `Module weights must sum to 100% (currently ${totalWeight}%).`,
          });
        }
      }

      const existingModules = await d1All<Record<string, unknown>>(
        'SELECT * FROM course_modules WHERE course_id = ?',
        [String(existing.id)],
        c.db
      );

      const now = nowIso();
      const setClauses: string[] = ['updated_at = ?'];
      const binds: unknown[] = [now];
      if (input.slug !== undefined) { setClauses.push('slug = ?'); binds.push(input.slug); }
      if (input.title !== undefined) { setClauses.push('title = ?'); binds.push(input.title); }
      if (input.track !== undefined) { setClauses.push('track = ?'); binds.push(input.track); }
      if (input.category !== undefined) { setClauses.push('category = ?'); binds.push(input.category); }
      if (input.departmentId !== undefined) { setClauses.push('department_id = ?'); binds.push(input.departmentId || null); }
      if (input.description !== undefined) { setClauses.push('description = ?'); binds.push(input.description); }
      if (input.prerequisites !== undefined) { setClauses.push('prerequisites = ?'); binds.push(input.prerequisites); }
      if (input.learningObjectives !== undefined) { setClauses.push('learning_objectives = ?'); binds.push(JSON.stringify(input.learningObjectives)); }
      if (input.passingScore !== undefined) { setClauses.push('passing_score = ?'); binds.push(input.passingScore); }
      if (input.minAttendanceRate !== undefined) { setClauses.push('min_attendance_rate = ?'); binds.push(input.minAttendanceRate); }
      if (input.gradingConfig !== undefined) { setClauses.push('grading_config = ?'); binds.push(JSON.stringify(input.gradingConfig)); }
      if (input.instructorId !== undefined) { setClauses.push('instructor_id = ?'); binds.push(input.instructorId); }
      if (input.durationWeeks !== undefined) { setClauses.push('duration_weeks = ?'); binds.push(input.durationWeeks); }
      if (input.tuitionFee !== undefined) { setClauses.push('tuition_fee = ?'); binds.push(Number(input.tuitionFee).toFixed(2)); }
      if (input.isPublished !== undefined) { setClauses.push('is_published = ?'); binds.push(input.isPublished ? 1 : 0); }
      if (input.showTuitionPublicly !== undefined) { setClauses.push('show_tuition_publicly = ?'); binds.push(input.showTuitionPublicly ? 1 : 0); }
      if (input.isArchived !== undefined) { setClauses.push('is_archived = ?'); binds.push(input.isArchived ? 1 : 0); }

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `UPDATE courses SET ${setClauses.join(', ')} WHERE id = ?`,
          [...binds, String(existing.id)],
          c.db
        ),
      ];

      if (input.modules) {
        const existingById = new Map(existingModules.map((m) => [String(m.id), m]));
        const incomingIds = new Set(
          input.modules.map((m) => m.id).filter((id): id is string => Boolean(id))
        );

        for (const oldMod of existingModules) {
          const oldModId = String(oldMod.id);
          if (!incomingIds.has(oldModId)) {
            const cntRow = await d1First<{ cnt: number }>(
              'SELECT COUNT(*) AS cnt FROM module_grades WHERE module_id = ?',
              [oldModId],
              c.db
            );
            if (Number(cntRow?.cnt ?? 0) === 0) {
              stmts.push(
                d1Stmt('DELETE FROM course_modules WHERE id = ?', [oldModId], c.db)
              );
            }
          }
        }

        for (let i = 0; i < input.modules.length; i += 1) {
          const m = input.modules[i];
          const upperModCode = m.code.toUpperCase();
          if (m.id && existingById.has(m.id)) {
            stmts.push(
              d1Stmt(
                `UPDATE course_modules
                 SET code = ?, title = ?, weight = ?, lab_hours = ?, sort_order = ?
                 WHERE id = ?`,
                [upperModCode, m.title, m.weight, m.labHours, i + 1, m.id],
                c.db
              )
            );
          } else {
            const modId = `mod-${String(existing.id)}-${i + 1}-${crypto.randomUUID().slice(0, 4)}`;
            stmts.push(
              d1Stmt(
                `INSERT INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [modId, String(existing.id), upperModCode, m.title, m.weight, m.labHours, i + 1],
                c.db
              )
            );
          }
        }
      }

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action:
            input.isArchived === true
              ? 'COURSE_ARCHIVED'
              : input.isArchived === false
                ? 'COURSE_ACTIVATED'
                : 'COURSE_UPDATED',
          entityType: 'course',
          entityId: String(existing.id),
          summary: `Updated course master data for ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/cohorts',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createCohortSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid cohort details.',
        });
      }

      const input = parsed.data;
      const [course, instructor] = await Promise.all([
        d1First<{ id: string; code: string }>(
          'SELECT id, code FROM courses WHERE id = ? LIMIT 1',
          [input.courseId],
          c.db
        ),
        d1First<{ id: string }>(
          'SELECT id FROM users WHERE id = ? LIMIT 1',
          [input.instructorId],
          c.db
        ),
      ]);
      if (!course || !instructor) {
        return c.json(400, { error: 'Valid course and instructor are required.' });
      }

      const upperCode = input.code.toUpperCase();
      const dup = await d1First<{ id: string }>(
        'SELECT id FROM cohorts WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (dup) {
        return c.json(409, { error: `Cohort code ${upperCode} already exists.` });
      }

      const cohortId = randomId('coh', 8);
      const now = nowIso();
      await d1Batch(
        [
          d1Stmt(
            `INSERT INTO cohorts
               (id, code, name, course_id, term_id, instructor_id, classroom_id, capacity, start_date, end_date, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cohortId,
              upperCode,
              input.name,
              course.id,
              input.termId || null,
              instructor.id,
              input.classroomId || null,
              input.capacity,
              new Date(input.startDate).toISOString(),
              new Date(input.endDate).toISOString(),
              input.status,
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO instructor_assignments
               (id, instructor_id, batch_id, course_id, role, is_active, assigned_at)
             VALUES (?, ?, ?, ?, 'Lead', 1, ?)
             ON CONFLICT(instructor_id, batch_id) DO UPDATE SET is_active = 1, unassigned_at = NULL`,
            [randomId('ia', 8), instructor.id, cohortId, course.id, now],
            c.db
          ),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'COHORT_CREATED',
          entityType: 'cohort',
          entityId: cohortId,
          summary: `Created cohort ${input.name} (${upperCode}) for ${course.code}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { cohortId, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/cohorts/:cohortId',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateCohortSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid batch update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
        [c.params.cohortId],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Batch cohort not found.' });
      }

      const input = parsed.data;
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.termId !== undefined) { sets.push('term_id = ?'); binds.push(input.termId || null); }
      if (input.instructorId !== undefined) { sets.push('instructor_id = ?'); binds.push(input.instructorId); }
      if (input.classroomId !== undefined) { sets.push('classroom_id = ?'); binds.push(input.classroomId || null); }
      if (input.capacity !== undefined) { sets.push('capacity = ?'); binds.push(input.capacity); }
      if (input.startDate !== undefined) { sets.push('start_date = ?'); binds.push(new Date(input.startDate).toISOString()); }
      if (input.endDate !== undefined) { sets.push('end_date = ?'); binds.push(new Date(input.endDate).toISOString()); }
      if (input.status !== undefined) { sets.push('status = ?'); binds.push(input.status); }

      const stmts: D1PreparedStatementLike[] = [];
      if (sets.length > 0) {
        stmts.push(
          d1Stmt(
            `UPDATE cohorts SET ${sets.join(', ')} WHERE id = ?`,
            [...binds, String(existing.id)],
            c.db
          )
        );
      }

      const now = nowIso();
      if (input.name && input.name !== String(existing.name)) {
        stmts.push(
          d1Stmt(
            'UPDATE enrollments SET cohort = ?, batch_name_snapshot = ?, updated_at = ? WHERE cohort_id = ?',
            [input.name, input.name, now, String(existing.id)],
            c.db
          )
        );
      }

      if (input.instructorId && input.instructorId !== String(existing.instructor_id)) {
        stmts.push(
          d1Stmt(
            `INSERT INTO instructor_assignments
               (id, instructor_id, batch_id, course_id, role, is_active, assigned_at)
             VALUES (?, ?, ?, ?, 'Lead', 1, ?)
             ON CONFLICT(instructor_id, batch_id) DO UPDATE SET is_active = 1, unassigned_at = NULL`,
            [randomId('ia', 8), input.instructorId, String(existing.id), String(existing.course_id), now],
            c.db
          )
        );
      }

      if (stmts.length > 0) {
        await d1Batch(stmts, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'COHORT_UPDATED',
          entityType: 'cohort',
          entityId: String(existing.id),
          summary: `Updated batch ${String(existing.code)} (${Object.keys(input).join(', ')}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/cohorts/:cohortId/assign-student',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = assignStudentToCohortSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid student assignment.',
        });
      }

      const batch = await d1First<Record<string, unknown>>(
        'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
        [c.params.cohortId],
        c.db
      );
      if (!batch) {
        return c.json(404, { error: 'Batch cohort not found.' });
      }

      const capRow = await d1First<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM enrollments
         WHERE course_id = ? AND (cohort_id = ? OR cohort = ?)
           AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')`,
        [String(batch.course_id), String(batch.id), String(batch.name)],
        c.db
      );
      const activeInBatch = Number(capRow?.cnt ?? 0);
      if (parsed.data.status === 'Active' && activeInBatch >= Number(batch.capacity)) {
        return c.json(409, {
          error: `Batch ${String(batch.name)} is at full capacity (${activeInBatch}/${Number(batch.capacity)}). Increase capacity or waitlist the student.`,
        });
      }

      const result = await createEnrollmentWithOptionalInvoiceD1(
        {
          actor: c.authUser!,
          studentId: parsed.data.studentId,
          courseId: String(batch.course_id),
          cohortId: String(batch.id),
          cohort: String(batch.name),
          status: parsed.data.status,
          issueTuitionInvoice: parsed.data.issueTuitionInvoice,
        },
        c.db
      );

      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { enrollmentId: result.enrollmentId, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/enrollments',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'enrollments:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow managing enrollments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = createEnrollmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid enrollment payload.',
        });
      }

      const result = await createEnrollmentWithOptionalInvoiceD1(
        { actor: c.authUser!, ...parsed.data },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { enrollmentId: result.enrollmentId, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/enrollments/:id',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'enrollments:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow updating enrollments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = updateEnrollmentStatusSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, { error: 'Invalid enrollment status.' });
      }

      const existing = await d1First<Record<string, unknown>>(
        `SELECT e.*, crs.code AS course_code, crs.title AS course_title, u.email AS student_email
         FROM enrollments e
         INNER JOIN courses crs ON crs.id = e.course_id
         INNER JOIN users u ON u.id = e.student_id
         WHERE e.id = ? LIMIT 1`,
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Enrollment not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(existing.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to manage enrollments for this course.',
          });
        }
      }

      const currentStatus = String(existing.status) as EnrollmentStatus;
      const nextStatus = parsed.data.status;
      if (!isValidEnrollmentTransition(currentStatus, nextStatus)) {
        return c.json(400, {
          error: `Cannot transition enrollment from "${currentStatus}" to "${nextStatus}".`,
        });
      }

      const reasonText =
        parsed.data.reason?.trim() || `Status updated by ${c.authUser!.name}`;
      const now = nowIso();

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          'UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ?',
          [nextStatus, now, String(existing.id)],
          c.db
        ),
        d1Stmt(
          `INSERT INTO enrollment_histories
             (id, enrollment_id, previous_status, new_status, previous_batch_id, new_batch_id, reason, changed_by_user_id, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId('eh', 8),
            String(existing.id),
            currentStatus,
            nextStatus,
            existing.cohort_id ?? null,
            existing.cohort_id ?? null,
            reasonText,
            c.authUser!.id,
            now,
          ],
          c.db
        ),
      ];

      if (nextStatus !== currentStatus) {
        const notifId = randomId('not', 8);
        stmts.push(
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, read, created_at)
             VALUES (?, ?, 'enrollment', ?, ?, ?, 0, ?)`,
            [
              notifId,
              String(existing.student_id),
              `Enrollment ${nextStatus} · ${String(existing.course_code)}`,
              `Your enrollment in ${String(existing.course_title)} (${String(existing.cohort)}) changed from ${currentStatus} to ${nextStatus}. ${reasonText}`,
              String(existing.course_id),
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO delivery_logs
               (id, notification_id, user_id, channel, recipient, status, sent_at)
             VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
            [
              randomId('del', 8),
              notifId,
              String(existing.student_id),
              String(existing.student_email),
              now,
            ],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ENROLLMENT_STATUS_UPDATED',
          entityType: 'enrollment',
          entityId: String(existing.id),
          summary: `Updated enrollment ${String(existing.id)} status from ${currentStatus} to ${nextStatus}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/enrollments/:enrollmentId/transfer',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = transferEnrollmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid batch transfer request.',
        });
      }

      const enrollment = await d1First<Record<string, unknown>>(
        `SELECT e.*, u.name AS student_name, u.email AS student_email,
                crs.code AS course_code, crs.title AS course_title
         FROM enrollments e
         INNER JOIN users u ON u.id = e.student_id
         INNER JOIN courses crs ON crs.id = e.course_id
         WHERE e.id = ? LIMIT 1`,
        [c.params.enrollmentId],
        c.db
      );
      if (!enrollment) {
        return c.json(404, { error: 'Enrollment record not found.' });
      }
      if (isTerminalEnrollmentStatus(String(enrollment.status))) {
        return c.json(400, {
          error: `Cannot transfer a ${String(enrollment.status).toLowerCase()} enrollment.`,
        });
      }

      const targetBatch = await d1First<Record<string, unknown>>(
        `SELECT b.*, u.name AS instructor_name
         FROM cohorts b
         LEFT JOIN users u ON u.id = b.instructor_id
         WHERE b.id = ? LIMIT 1`,
        [parsed.data.toBatchId],
        c.db
      );
      if (!targetBatch) {
        return c.json(404, { error: 'Destination batch not found.' });
      }
      if (String(targetBatch.course_id) !== String(enrollment.course_id)) {
        return c.json(400, {
          error: 'Destination batch must belong to the same course program.',
        });
      }
      if (String(targetBatch.id) === String(enrollment.cohort_id ?? '')) {
        return c.json(400, { error: 'Student is already assigned to this batch.' });
      }

      const capRow = await d1First<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM enrollments
         WHERE course_id = ? AND (cohort_id = ? OR cohort = ?)
           AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')`,
        [String(targetBatch.course_id), String(targetBatch.id), String(targetBatch.name)],
        c.db
      );
      const targetCount = Number(capRow?.cnt ?? 0);
      if (targetCount >= Number(targetBatch.capacity)) {
        return c.json(409, {
          error: `Destination batch ${String(targetBatch.name)} is full (${targetCount}/${Number(targetBatch.capacity)}).`,
        });
      }

      const now = nowIso();
      const notifId = randomId('not', 8);

      await d1Batch(
        [
          d1Stmt(
            `UPDATE enrollments
             SET cohort_id = ?, cohort = ?, batch_name_snapshot = ?, instructor_name_snapshot = ?, updated_at = ?
             WHERE id = ?`,
            [
              String(targetBatch.id),
              String(targetBatch.name),
              String(targetBatch.name),
              targetBatch.instructor_name ? String(targetBatch.instructor_name) : null,
              now,
              String(enrollment.id),
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO enrollment_histories
               (id, enrollment_id, previous_status, new_status, previous_batch_id, new_batch_id, reason, changed_by_user_id, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              randomId('eh', 8),
              String(enrollment.id),
              String(enrollment.status),
              String(enrollment.status),
              enrollment.cohort_id ?? null,
              String(targetBatch.id),
              `Transferred from "${String(enrollment.cohort)}" to "${String(targetBatch.name)}": ${parsed.data.reason}`,
              c.authUser!.id,
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, read, created_at)
             VALUES (?, ?, 'enrollment', ?, ?, ?, 0, ?)`,
            [
              notifId,
              String(enrollment.student_id),
              `Batch Transfer · ${String(enrollment.course_code)}`,
              `Your cohort for ${String(enrollment.course_title)} has been transferred to ${String(targetBatch.name)}. Reason: ${parsed.data.reason}`,
              String(enrollment.course_id),
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO delivery_logs
               (id, notification_id, user_id, channel, recipient, status, sent_at)
             VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
            [
              randomId('del', 8),
              notifId,
              String(enrollment.student_id),
              String(enrollment.student_email),
              now,
            ],
            c.db
          ),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'BATCH_TRANSFERRED',
          entityType: 'enrollment',
          entityId: String(enrollment.id),
          summary: `Transferred ${String(enrollment.student_name)} from "${String(enrollment.cohort)}" to "${String(targetBatch.name)}".`,
          metadata: {
            fromBatchId: enrollment.cohort_id ?? null,
            toBatchId: String(targetBatch.id),
            reason: parsed.data.reason,
          },
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/enrollments/:enrollmentId/course-transfer',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = courseTransferSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid course transfer request.',
        });
      }

      const { toCourseId, toBatchId, reason, status, issueTuitionInvoice } = parsed.data;
      const enrollment = await d1First<Record<string, unknown>>(
        `SELECT e.*, u.name AS student_name, u.email AS student_email,
                crs.code AS course_code, crs.title AS course_title
         FROM enrollments e
         INNER JOIN users u ON u.id = e.student_id
         INNER JOIN courses crs ON crs.id = e.course_id
         WHERE e.id = ? LIMIT 1`,
        [c.params.enrollmentId],
        c.db
      );
      if (!enrollment) {
        return c.json(404, { error: 'Enrollment record not found.' });
      }
      if (isTerminalEnrollmentStatus(String(enrollment.status))) {
        return c.json(400, {
          error: `Cannot perform course transfer on a ${String(enrollment.status).toLowerCase()} enrollment.`,
        });
      }
      if (toCourseId === String(enrollment.course_id)) {
        return c.json(400, {
          error: 'Destination course matches current course. Use batch transfer instead.',
        });
      }

      const [targetCourse, targetBatch] = await Promise.all([
        d1First<Record<string, unknown>>(
          `SELECT crs.*, u.name AS instructor_name
           FROM courses crs
           LEFT JOIN users u ON u.id = crs.instructor_id
           WHERE crs.id = ? LIMIT 1`,
          [toCourseId],
          c.db
        ),
        d1First<Record<string, unknown>>(
          `SELECT b.*, u.name AS instructor_name
           FROM cohorts b
           LEFT JOIN users u ON u.id = b.instructor_id
           WHERE b.id = ? LIMIT 1`,
          [toBatchId],
          c.db
        ),
      ]);

      if (!targetCourse) {
        return c.json(404, { error: 'Destination course not found.' });
      }
      if (!targetBatch || String(targetBatch.course_id) !== String(targetCourse.id)) {
        return c.json(400, {
          error: 'Destination batch does not exist or does not belong to the destination course.',
        });
      }

      const existingTargetEnrollment = await d1First<{ status: string }>(
        `SELECT status FROM enrollments
         WHERE student_id = ? AND course_id = ?
           AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')
         LIMIT 1`,
        [String(enrollment.student_id), String(targetCourse.id)],
        c.db
      );
      if (existingTargetEnrollment) {
        return c.json(409, {
          error: `${String(enrollment.student_name)} already has a ${existingTargetEnrollment.status.toLowerCase()} enrollment in ${String(targetCourse.code)}.`,
        });
      }

      const capRow = await d1First<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM enrollments
         WHERE course_id = ? AND (cohort_id = ? OR cohort = ?)
           AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn')`,
        [String(targetBatch.course_id), String(targetBatch.id), String(targetBatch.name)],
        c.db
      );
      const targetCount = Number(capRow?.cnt ?? 0);
      if (status === 'Active' && targetCount >= Number(targetBatch.capacity)) {
        return c.json(409, {
          error: `Destination batch ${String(targetBatch.name)} is full (${targetCount}/${Number(targetBatch.capacity)}).`,
        });
      }

      const newEnrollmentId = randomId('enr', 8);
      const now = nowIso();
      const targetTuition = sqlFixed(targetCourse.tuition_fee, '0.00');
      const notifId = randomId('not', 8);

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          "UPDATE enrollments SET status = 'Withdrawn', updated_at = ? WHERE id = ?",
          [now, String(enrollment.id)],
          c.db
        ),
        d1Stmt(
          `INSERT INTO enrollment_histories
             (id, enrollment_id, previous_status, new_status, previous_batch_id, new_batch_id, reason, changed_by_user_id, changed_at)
           VALUES (?, ?, ?, 'Withdrawn', ?, ?, ?, ?, ?)`,
          [
            randomId('eh', 8),
            String(enrollment.id),
            String(enrollment.status),
            enrollment.cohort_id ?? null,
            String(targetBatch.id),
            `Transferred out to ${String(targetCourse.code)} (${String(targetBatch.name)}): ${reason}`,
            c.authUser!.id,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO enrollments
             (id, student_id, course_id, cohort_id, cohort, status, enrolled_at, completed_module_ids,
              tuition_snapshot, batch_name_snapshot, instructor_name_snapshot, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
          [
            newEnrollmentId,
            String(enrollment.student_id),
            String(targetCourse.id),
            String(targetBatch.id),
            String(targetBatch.name),
            status,
            now,
            targetTuition,
            String(targetBatch.name),
            targetBatch.instructor_name
              ? String(targetBatch.instructor_name)
              : targetCourse.instructor_name
                ? String(targetCourse.instructor_name)
                : null,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO enrollment_histories
             (id, enrollment_id, previous_status, new_status, previous_batch_id, new_batch_id, reason, changed_by_user_id, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId('eh', 8),
            newEnrollmentId,
            String(enrollment.status),
            status,
            enrollment.cohort_id ?? null,
            String(targetBatch.id),
            `Course transfer from ${String(enrollment.course_code)} (${String(enrollment.cohort)}) to ${String(targetCourse.code)} (${String(targetBatch.name)}): ${reason}`,
            c.authUser!.id,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO notifications
             (id, user_id, kind, title, message, related_course_id, read, created_at)
           VALUES (?, ?, 'enrollment', ?, ?, ?, 0, ?)`,
          [
            notifId,
            String(enrollment.student_id),
            `Course Transfer · ${String(targetCourse.code)}`,
            `Your enrollment was transferred from ${String(enrollment.course_code)} (${String(enrollment.cohort)}) to ${String(targetCourse.title)} (${String(targetBatch.name)}). Reason: ${reason}`,
            String(targetCourse.id),
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO delivery_logs
             (id, notification_id, user_id, channel, recipient, status, sent_at)
           VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
          [
            randomId('del', 8),
            notifId,
            String(enrollment.student_id),
            String(enrollment.student_email),
            now,
          ],
          c.db
        ),
      ];

      if (issueTuitionInvoice && toCents(targetTuition) > 0) {
        const [feeStruct, acadRow, invNum] = await Promise.all([
          d1First<{ id: string }>(
            'SELECT id FROM fee_structures WHERE course_id = ? AND is_active = 1 LIMIT 1',
            [String(targetCourse.id)],
            c.db
          ),
          d1First<{ currency: string }>(
            'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
            [],
            c.db
          ),
          generateNextInvoiceNumberD1(c.db),
        ]);
        const invId = randomId('inv', 8);
        const desc = `${String(targetCourse.code)} ${String(targetCourse.title)} Tuition (${String(targetBatch.name)} · Course Transfer)`;
        const dueIso = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        stmts.push(
          d1Stmt(
            `INSERT INTO fee_invoices
               (id, invoice_number, student_id, enrollment_id, course_id, fee_structure_id, description,
                subtotal, discount_total, scholarship_total, amount_due, amount_paid, currency, status,
                due_date, issued_by_user_id, is_archived, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0.00', '0.00', ?, '0.00', ?, 'Unpaid', ?, ?, 0, ?, ?)`,
            [
              invId,
              invNum,
              String(enrollment.student_id),
              newEnrollmentId,
              String(targetCourse.id),
              feeStruct?.id ?? null,
              desc,
              targetTuition,
              targetTuition,
              acadRow?.currency || 'INR',
              dueIso,
              c.authUser!.id,
              now,
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO invoice_items (id, invoice_id, item_type, description, quantity, unit_price, line_total, created_at)
             VALUES (?, ?, 'Tuition', ?, 1, ?, ?, ?)`,
            [randomId('item', 8), invId, desc, targetTuition, targetTuition, now],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'COURSE_TRANSFERRED',
          entityType: 'enrollment',
          entityId: newEnrollmentId,
          summary: `Transferred ${String(enrollment.student_name)} from ${String(enrollment.course_code)} (${String(enrollment.cohort)}) to ${String(targetCourse.code)} (${String(targetBatch.name)}).`,
          metadata: {
            previousEnrollmentId: String(enrollment.id),
            fromCourseId: String(enrollment.course_id),
            toCourseId: String(targetCourse.id),
            toBatchId: String(targetBatch.id),
            reason,
          },
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { newEnrollmentId, enrollmentId: newEnrollmentId, dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/enrollments/:enrollmentId/history',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const enrollment = await d1First<Record<string, unknown>>(
        `SELECT e.*, crs.code AS course_code, crs.title AS course_title,
                u.name AS student_name, u.email AS student_email, u.student_code AS student_code
         FROM enrollments e
         INNER JOIN courses crs ON crs.id = e.course_id
         INNER JOIN users u ON u.id = e.student_id
         WHERE e.id = ? LIMIT 1`,
        [c.params.enrollmentId],
        c.db
      );
      if (!enrollment) {
        return c.json(404, { error: 'Enrollment not found.' });
      }
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(enrollment.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, { error: 'Access denied to enrollment history outside your courses.' });
        }
      }

      const history = await d1All<Record<string, unknown>>(
        'SELECT * FROM enrollment_histories WHERE enrollment_id = ? ORDER BY changed_at DESC',
        [String(enrollment.id)],
        c.db
      );

      const batchIds = Array.from(
        new Set(
          history
            .flatMap((h) => [
              h.previous_batch_id ? String(h.previous_batch_id) : null,
              h.new_batch_id ? String(h.new_batch_id) : null,
            ])
            .filter((id): id is string => Boolean(id))
        )
      );
      const userIds = Array.from(
        new Set(
          history
            .map((h) => (h.changed_by_user_id ? String(h.changed_by_user_id) : null))
            .filter((id): id is string => Boolean(id))
        )
      );

      const [batches, actors] = await Promise.all([
        batchIds.length > 0
          ? d1All<{ id: string; name: string }>(
              `SELECT id, name FROM cohorts WHERE id IN (${inPlaceholders(batchIds.length)})`,
              batchIds,
              c.db
            )
          : Promise.resolve([]),
        userIds.length > 0
          ? d1All<{ id: string; name: string }>(
              `SELECT id, name FROM users WHERE id IN (${inPlaceholders(userIds.length)})`,
              userIds,
              c.db
            )
          : Promise.resolve([]),
      ]);

      const batchMap = new Map(batches.map((b) => [b.id, b.name]));
      const actorMap = new Map(actors.map((u) => [u.id, u.name]));

      return c.json(200, {
        enrollment: {
          id: String(enrollment.id),
          studentId: String(enrollment.student_id),
          studentName: String(enrollment.student_name),
          studentCode: enrollment.student_code ? String(enrollment.student_code) : null,
          courseId: String(enrollment.course_id),
          courseCode: String(enrollment.course_code),
          courseTitle: String(enrollment.course_title),
          cohortId: enrollment.cohort_id ? String(enrollment.cohort_id) : null,
          cohort: String(enrollment.cohort),
          status: String(enrollment.status),
          enrolledAt: String(enrollment.enrolled_at),
        },
        history: history.map((h) => {
          const prevId = h.previous_batch_id ? String(h.previous_batch_id) : null;
          const nextId = h.new_batch_id ? String(h.new_batch_id) : null;
          const actorId = h.changed_by_user_id ? String(h.changed_by_user_id) : null;
          return {
            id: String(h.id),
            enrollmentId: String(h.enrollment_id),
            previousStatus: h.previous_status ? String(h.previous_status) : null,
            newStatus: String(h.new_status),
            previousBatchId: prevId,
            newBatchId: nextId,
            previousBatchName: prevId ? batchMap.get(prevId) ?? prevId : null,
            newBatchName: nextId ? batchMap.get(nextId) ?? nextId : null,
            reason: String(h.reason || ''),
            changedByUserId: actorId,
            changedByName: actorId ? actorMap.get(actorId) ?? 'Staff' : 'System',
            changedAt: String(h.changed_at),
          };
        }),
      });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/progress/module-completion',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'progress:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow updating module progress.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = toggleModuleSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, { error: 'Invalid module completion payload.' });
      }

      const { enrollmentId, moduleId, completed } = parsed.data;
      const enr = await d1First<Record<string, unknown>>(
        'SELECT * FROM enrollments WHERE id = ? LIMIT 1',
        [enrollmentId],
        c.db
      );
      if (!enr) {
        return c.json(404, { error: 'Enrollment not found.' });
      }
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(enr.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to update module progress for this course.',
          });
        }
      }
      if (isInactiveEnrollmentStatus(String(enr.status))) {
        return c.json(400, {
          error: `Cannot update module completion for a ${String(enr.status).toLowerCase()} enrollment.`,
        });
      }

      const mod = await d1First<{ id: string; code: string }>(
        'SELECT id, code FROM course_modules WHERE id = ? AND course_id = ? LIMIT 1',
        [moduleId, String(enr.course_id)],
        c.db
      );
      if (!mod) {
        return c.json(400, { error: 'Module does not belong to enrolled course.' });
      }

      const set = new Set(sqlJson<string[]>(enr.completed_module_ids, []));
      if (completed) set.add(moduleId);
      else set.delete(moduleId);

      await d1Run(
        'UPDATE enrollments SET completed_module_ids = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(Array.from(set)), nowIso(), String(enr.id)],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'MODULE_COMPLETION_UPDATED',
          entityType: 'enrollment',
          entityId: String(enr.id),
          summary: `Marked module ${mod.code} as ${completed ? 'completed' : 'in progress'} for enrollment ${String(enr.id)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/grades',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(c.authUser!, 'grades:manage', c.db);
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow grading assessments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = saveGradeSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid grade input.',
        });
      }

      const { studentId, courseId, moduleId, score, feedback } = parsed.data;
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(c.authUser!.id, courseId, c.db);
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to grade assessments for this course.',
          });
        }
      }

      const [course, mod, student] = await Promise.all([
        d1First<{ id: string; code: string }>('SELECT id, code FROM courses WHERE id = ? LIMIT 1', [courseId], c.db),
        d1First<{ id: string; code: string; title: string; weight: number }>(
          'SELECT id, code, title, weight FROM course_modules WHERE id = ? AND course_id = ? LIMIT 1',
          [moduleId, courseId],
          c.db
        ),
        d1First<{ id: string; name: string; email: string }>(
          "SELECT id, name, email FROM users WHERE id = ? AND role = 'student' LIMIT 1",
          [studentId],
          c.db
        ),
      ]);
      if (!course || !mod || !student) {
        return c.json(400, { error: 'Valid student, course, and module are required.' });
      }

      const activeEnrollment = await d1First<{ id: string }>(
        `SELECT id FROM enrollments
         WHERE student_id = ? AND course_id = ? AND status IN ('Active', 'Completed', 'Waitlisted')
         LIMIT 1`,
        [studentId, courseId],
        c.db
      );
      if (!activeEnrollment) {
        return c.json(400, {
          error: 'Student must have a non-dropped enrollment in this course before recording a grade.',
        });
      }

      const roundedScore = Math.round(score);
      const now = nowIso();
      let assessment = await d1First<{ id: string; max_score: number }>(
        "SELECT id, max_score FROM assessments WHERE course_id = ? AND module_id = ? AND assessment_type = 'Module Assessment' LIMIT 1",
        [courseId, moduleId],
        c.db
      );

      const stmts: D1PreparedStatementLike[] = [];
      let assessmentId = assessment?.id ?? `asmt-${mod.id}`;
      let maxScore = assessment ? Number(assessment.max_score) : 100;

      if (!assessment) {
        stmts.push(
          d1Stmt(
            `INSERT INTO assessments
               (id, course_id, module_id, title, assessment_type, max_score, weight, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, 'Module Assessment', 100, ?, ?, ?)`,
            [assessmentId, courseId, mod.id, `${mod.code}: ${mod.title}`, mod.weight, c.authUser!.id, now],
            c.db
          )
        );
      }

      const notifId = randomId('not', 8);
      stmts.push(
        d1Stmt(
          `INSERT INTO module_grades
             (id, student_id, course_id, module_id, enrollment_id, assessment_id, score, max_score, feedback, graded_at, graded_by_user_id, graded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, assessment_id) DO UPDATE SET
             score = excluded.score,
             feedback = excluded.feedback,
             module_id = excluded.module_id,
             enrollment_id = excluded.enrollment_id,
             graded_at = excluded.graded_at,
             graded_by_user_id = excluded.graded_by_user_id,
             graded_by = excluded.graded_by`,
          [
            randomId('grd', 8),
            studentId,
            courseId,
            mod.id,
            activeEnrollment.id,
            assessmentId,
            roundedScore,
            maxScore,
            feedback,
            now,
            c.authUser!.id,
            c.authUser!.name,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO notifications
             (id, user_id, kind, title, message, related_course_id, read, created_at)
           VALUES (?, ?, 'grade', ?, ?, ?, 0, ?)`,
          [
            notifId,
            studentId,
            `Grade Posted · ${course.code} ${mod.code}`,
            `Score ${roundedScore}% recorded for "${mod.title}" by ${c.authUser!.name}.`,
            course.id,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO delivery_logs
             (id, notification_id, user_id, channel, recipient, status, sent_at)
           VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
          [randomId('del', 8), notifId, student.id, student.email, now],
          c.db
        )
      );

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'GRADE_RECORDED',
          entityType: 'grade',
          entityId: `${studentId}:${courseId}:${moduleId}`,
          summary: `Recorded ${roundedScore}% for ${student.name} on ${course.code} ${mod.code}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/assessments',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const courseId = (c.query.get('courseId') ?? '').trim() || undefined;
      let scopedCourseIds: string[] | undefined;

      if (c.authUser!.role === 'instructor') {
        const scope = await getInstructorScopeD1(c.authUser!.id, c.db);
        if (courseId && !scope.courseIds.has(courseId)) {
          return c.json(403, {
            error: 'Access denied. You are not assigned to this course.',
          });
        }
        scopedCourseIds = Array.from(scope.courseIds);
      }

      let whereSql = '';
      let binds: unknown[] = [];
      if (courseId) {
        whereSql = 'WHERE course_id = ?';
        binds = [courseId];
      } else if (scopedCourseIds) {
        if (scopedCourseIds.length === 0) {
          return c.json(200, { assessments: [] });
        }
        whereSql = `WHERE course_id IN (${inPlaceholders(scopedCourseIds.length)})`;
        binds = scopedCourseIds;
      }

      const rows = await d1All<Record<string, unknown>>(
        `SELECT * FROM assessments ${whereSql} ORDER BY created_at ASC`,
        binds,
        c.db
      );

      return c.json(200, {
        assessments: rows.map((a) => ({
          id: String(a.id),
          courseId: String(a.course_id),
          moduleId: a.module_id ? String(a.module_id) : null,
          batchId: a.batch_id ? String(a.batch_id) : null,
          title: String(a.title),
          assessmentType: String(a.assessment_type),
          maxScore: Number(a.max_score),
          weight: Number(a.weight),
          dueDate: a.due_date ? String(a.due_date) : null,
          createdAt: String(a.created_at),
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/assessments',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(c.authUser!, 'grades:manage', c.db);
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow creating assessments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = createAssessmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid assessment input.',
        });
      }

      const input = parsed.data;
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(c.authUser!.id, input.courseId, c.db);
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to manage assessments for this course.',
          });
        }
      }

      const course = await d1First<{ id: string; code: string }>(
        'SELECT id, code FROM courses WHERE id = ? LIMIT 1',
        [input.courseId],
        c.db
      );
      if (!course) {
        return c.json(404, { error: 'Course not found.' });
      }

      if (input.moduleId) {
        const mod = await d1First<{ id: string }>(
          'SELECT id FROM course_modules WHERE id = ? AND course_id = ? LIMIT 1',
          [input.moduleId, course.id],
          c.db
        );
        if (!mod) {
          return c.json(400, { error: 'Selected module does not belong to this course.' });
        }
      }

      if (input.batchId) {
        const batch = await d1First<{ id: string }>(
          'SELECT id FROM cohorts WHERE id = ? AND course_id = ? LIMIT 1',
          [input.batchId, course.id],
          c.db
        );
        if (!batch) {
          return c.json(400, { error: 'Selected batch does not belong to this course.' });
        }
      }

      const assessmentId = randomId('asmt', 8);
      await d1Run(
        `INSERT INTO assessments
           (id, course_id, module_id, batch_id, title, assessment_type, max_score, weight, due_date, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assessmentId,
          course.id,
          input.moduleId || null,
          input.batchId || null,
          input.title,
          input.assessmentType,
          input.maxScore,
          input.weight,
          input.dueDate ? new Date(input.dueDate).toISOString() : null,
          c.authUser!.id,
          nowIso(),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ASSESSMENT_CREATED',
          entityType: 'assessment',
          entityId: assessmentId,
          summary: `Created ${input.assessmentType} "${input.title}" (max ${input.maxScore}, weight ${input.weight}%) for ${course.code}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { assessmentId, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/assessments/:id',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(c.authUser!, 'grades:manage', c.db);
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow updating assessments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = updateAssessmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid assessment update payload.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM assessments WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Assessment not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(existing.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to update assessments for this course.',
          });
        }
      }

      const input = parsed.data;
      if (input.moduleId) {
        const mod = await d1First<{ id: string }>(
          'SELECT id FROM course_modules WHERE id = ? AND course_id = ? LIMIT 1',
          [input.moduleId, String(existing.course_id)],
          c.db
        );
        if (!mod) {
          return c.json(400, { error: 'Selected module does not belong to this course.' });
        }
      }
      if (input.batchId) {
        const batch = await d1First<{ id: string }>(
          'SELECT id FROM cohorts WHERE id = ? AND course_id = ? LIMIT 1',
          [input.batchId, String(existing.course_id)],
          c.db
        );
        if (!batch) {
          return c.json(400, { error: 'Selected batch does not belong to this course.' });
        }
      }

      const sets: string[] = [];
      const binds: unknown[] = [];
      if (input.title !== undefined) { sets.push('title = ?'); binds.push(input.title); }
      if (input.assessmentType !== undefined) { sets.push('assessment_type = ?'); binds.push(input.assessmentType); }
      if (input.moduleId !== undefined) { sets.push('module_id = ?'); binds.push(input.moduleId || null); }
      if (input.batchId !== undefined) { sets.push('batch_id = ?'); binds.push(input.batchId || null); }
      if (input.maxScore !== undefined) { sets.push('max_score = ?'); binds.push(input.maxScore); }
      if (input.weight !== undefined) { sets.push('weight = ?'); binds.push(input.weight); }
      if (input.dueDate !== undefined) {
        sets.push('due_date = ?');
        binds.push(input.dueDate ? new Date(input.dueDate).toISOString() : null);
      }

      if (sets.length > 0) {
        await d1Run(
          `UPDATE assessments SET ${sets.join(', ')} WHERE id = ?`,
          [...binds, String(existing.id)],
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ASSESSMENT_UPDATED',
          entityType: 'assessment',
          entityId: String(existing.id),
          summary: `Updated assessment "${input.title ?? String(existing.title)}".`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/assessments/:id',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(c.authUser!, 'grades:manage', c.db);
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow removing assessments.',
          });
        }
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM assessments WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Assessment not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(existing.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to delete assessments for this course.',
          });
        }
      }

      if (String(existing.assessment_type) === 'Module Assessment') {
        return c.json(400, { error: 'Primary module assessments cannot be deleted directly.' });
      }

      const gradeCountRow = await d1First<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM module_grades WHERE assessment_id = ?',
        [String(existing.id)],
        c.db
      );
      const gradeCount = Number(gradeCountRow?.cnt ?? 0);
      if (gradeCount > 0) {
        return c.json(409, {
          error: `Cannot delete "${String(existing.title)}" because ${gradeCount} grade record(s) already exist.`,
        });
      }

      await d1Run('DELETE FROM assessments WHERE id = ?', [String(existing.id)], c.db);
      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ASSESSMENT_DELETED',
          entityType: 'assessment',
          entityId: String(existing.id),
          summary: `Deleted assessment "${String(existing.title)}".`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/assessments/:id/grades',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(c.authUser!, 'grades:manage', c.db);
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow grading assessments.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = saveAssessmentGradeSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid assessment grade.',
        });
      }

      const assessment = await d1First<Record<string, unknown>>(
        `SELECT a.*, crs.code AS course_code
         FROM assessments a
         INNER JOIN courses crs ON crs.id = a.course_id
         WHERE a.id = ? LIMIT 1`,
        [c.params.id],
        c.db
      );
      if (!assessment) {
        return c.json(404, { error: 'Assessment not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(assessment.course_id),
          c.db
        );
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to grade assessments for this course.',
          });
        }
      }

      const { studentId, score, feedback } = parsed.data;
      const maxScore = Number(assessment.max_score);
      if (score > maxScore) {
        return c.json(400, {
          error: `Score (${score}) cannot exceed assessment max score (${maxScore}).`,
        });
      }

      const student = await d1First<{ id: string; name: string; email: string }>(
        "SELECT id, name, email FROM users WHERE id = ? AND role = 'student' LIMIT 1",
        [studentId],
        c.db
      );
      if (!student) {
        return c.json(404, { error: 'Student not found.' });
      }

      const enrClauses = [
        'student_id = ?',
        'course_id = ?',
        "status IN ('Active', 'Completed', 'Waitlisted')",
      ];
      const enrBinds: unknown[] = [studentId, String(assessment.course_id)];
      if (assessment.batch_id) {
        enrClauses.push('cohort_id = ?');
        enrBinds.push(String(assessment.batch_id));
      }
      const activeEnrollment = await d1First<{ id: string }>(
        `SELECT id FROM enrollments WHERE ${enrClauses.join(' AND ')} LIMIT 1`,
        enrBinds,
        c.db
      );
      if (!activeEnrollment) {
        return c.json(400, {
          error: 'Student does not have an eligible enrollment for this assessment.',
        });
      }

      const roundedScore = Math.round(score);
      const pct = Math.round((roundedScore / Math.max(1, maxScore)) * 1000) / 10;
      const now = nowIso();
      const notifId = randomId('not', 8);

      await d1Batch(
        [
          d1Stmt(
            `INSERT INTO module_grades
               (id, student_id, course_id, module_id, enrollment_id, assessment_id, score, max_score, feedback, graded_at, graded_by_user_id, graded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(student_id, assessment_id) DO UPDATE SET
               score = excluded.score,
               max_score = excluded.max_score,
               feedback = excluded.feedback,
               module_id = excluded.module_id,
               enrollment_id = excluded.enrollment_id,
               graded_at = excluded.graded_at,
               graded_by_user_id = excluded.graded_by_user_id,
               graded_by = excluded.graded_by`,
            [
              randomId('grd', 8),
              studentId,
              String(assessment.course_id),
              assessment.module_id ?? null,
              activeEnrollment.id,
              String(assessment.id),
              roundedScore,
              maxScore,
              feedback,
              now,
              c.authUser!.id,
              c.authUser!.name,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, read, created_at)
             VALUES (?, ?, 'grade', ?, ?, ?, 0, ?)`,
            [
              notifId,
              studentId,
              `${String(assessment.assessment_type)} Graded · ${String(assessment.course_code)}`,
              `Score ${roundedScore}/${maxScore} (${pct}%) recorded for "${String(assessment.title)}" by ${c.authUser!.name}.`,
              String(assessment.course_id),
              now,
            ],
            c.db
          ),
          d1Stmt(
            `INSERT INTO delivery_logs
               (id, notification_id, user_id, channel, recipient, status, sent_at)
             VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
            [randomId('del', 8), notifId, student.id, student.email, now],
            c.db
          ),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ASSESSMENT_GRADE_RECORDED',
          entityType: 'grade',
          entityId: `${studentId}:${String(assessment.id)}`,
          summary: `Recorded ${roundedScore}/${maxScore} (${pct}%) for ${student.name} on "${String(assessment.title)}".`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/progress/remark',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'progress:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow writing progress remarks.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = saveRemarkSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Valid student, course, and remark are required.',
        });
      }

      const { studentId, courseId, summary } = parsed.data;
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(c.authUser!.id, courseId, c.db);
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to write progress remarks for this course.',
          });
        }
      }

      const [student, course] = await Promise.all([
        d1First<{ id: string }>(
          "SELECT id FROM users WHERE id = ? AND role = 'student' LIMIT 1",
          [studentId],
          c.db
        ),
        d1First<{ id: string }>('SELECT id FROM courses WHERE id = ? LIMIT 1', [courseId], c.db),
      ]);
      if (!student || !course) {
        return c.json(400, { error: 'Valid student and course are required.' });
      }

      const activeEnrollment = await d1First<{ id: string }>(
        `SELECT id FROM enrollments
         WHERE student_id = ? AND course_id = ? AND status IN ('Active', 'Completed', 'Waitlisted')
         LIMIT 1`,
        [studentId, courseId],
        c.db
      );
      if (!activeEnrollment) {
        return c.json(400, {
          error: 'Student must be enrolled in this course before recording an instructor remark.',
        });
      }

      const now = nowIso();
      await d1Run(
        `INSERT INTO progress_remarks
           (id, student_id, course_id, enrollment_id, summary, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, course_id) DO UPDATE SET
           summary = excluded.summary,
           enrollment_id = excluded.enrollment_id,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        [randomId('rem', 8), studentId, courseId, activeEnrollment.id, summary, now, c.authUser!.name],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'REMARK_UPDATED',
          entityType: 'progress_remark',
          entityId: `${studentId}:${courseId}`,
          summary: `Updated instructor evaluation remark for student ${studentId} in course ${courseId}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sessions',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'sessions:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow scheduling sessions.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = createSessionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid session details.',
        });
      }

      const input = parsed.data;
      const course = await d1First<{ id: string; code: string }>(
        'SELECT id, code FROM courses WHERE id = ? LIMIT 1',
        [input.courseId],
        c.db
      );
      if (!course) {
        return c.json(400, { error: 'Valid course is required.' });
      }
      if (c.authUser!.role === 'instructor') {
        const allowed = await canInstructorAccessCourseD1(c.authUser!.id, course.id, c.db);
        if (!allowed) {
          return c.json(403, {
            error: 'You are not assigned to schedule sessions for this course.',
          });
        }
      }

      const matchedBatch = input.cohortId
        ? await d1First<{ id: string }>('SELECT id FROM cohorts WHERE id = ? LIMIT 1', [input.cohortId], c.db)
        : await d1First<{ id: string }>(
            'SELECT id FROM cohorts WHERE course_id = ? AND name = ? LIMIT 1',
            [course.id, input.cohort],
            c.db
          );

      const startDate = new Date(input.startIso);
      const endDate = new Date(
        startDate.getTime() + Math.max(0.5, input.durationHours) * 60 * 60 * 1000
      );
      const sessionId = randomId('ses', 8);

      await d1Run(
        `INSERT INTO class_sessions
           (id, course_id, cohort_id, cohort, title, topic, room, instructor_id, instructor_name, start_at, end_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?)`,
        [
          sessionId,
          course.id,
          matchedBatch?.id ?? input.cohortId ?? null,
          input.cohort,
          input.title,
          input.topic || 'Instructor-led lab session',
          input.room,
          c.authUser!.id,
          c.authUser!.name,
          startDate.toISOString(),
          endDate.toISOString(),
          nowIso(),
        ],
        c.db
      );

      const remindersCreatedCount = await runD1SessionReminderSweep(c.db);
      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'SESSION_SCHEDULED',
          entityType: 'class_session',
          entityId: sessionId,
          summary: `Scheduled "${input.title}" for ${course.code} (${input.cohort}) in ${input.room}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, {
        sessionId,
        remindersCreatedCount,
        dashboard,
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/sessions/:id/status',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'sessions:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow updating session status.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = updateSessionStatusSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, { error: 'Invalid session status.' });
      }

      const existing = await d1First<{
        id: string;
        course_id: string;
        instructor_id: string | null;
        title: string;
      }>('SELECT id, course_id, instructor_id, title FROM class_sessions WHERE id = ? LIMIT 1', [c.params.id], c.db);
      if (!existing) {
        return c.json(404, { error: 'Session not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed =
          existing.instructor_id === c.authUser!.id ||
          (await canInstructorAccessCourseD1(c.authUser!.id, existing.course_id, c.db));
        if (!allowed) {
          return c.json(403, {
            error: 'You are not authorized to manage this class session.',
          });
        }
      }

      await d1Run(
        'UPDATE class_sessions SET status = ? WHERE id = ?',
        [parsed.data.status, existing.id],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'SESSION_STATUS_UPDATED',
          entityType: 'class_session',
          entityId: existing.id,
          summary: `Updated session "${existing.title}" status to ${parsed.data.status}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/attendance',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'attendance:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow marking attendance.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = markAttendanceSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid attendance payload.',
        });
      }

      const result = await markAttendanceAndNotifyD1(
        { actor: c.authUser!, ...parsed.data },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status ?? 404, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/attendance/bulk',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'attendance:manage',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow marking attendance.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = bulkAttendanceSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid bulk attendance payload.',
        });
      }

      const result = await bulkMarkAttendanceAndNotifyD1(
        { actor: c.authUser!, ...parsed.data },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status ?? 400, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { updatedCount: result.updatedCount, dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/attendance/history',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const sessionId = (c.query.get('sessionId') ?? '').trim();
      if (!sessionId) {
        return c.json(400, { error: 'sessionId query parameter is required.' });
      }

      const session = await d1First<{
        id: string;
        course_id: string;
        instructor_id: string | null;
      }>('SELECT id, course_id, instructor_id FROM class_sessions WHERE id = ? LIMIT 1', [sessionId], c.db);
      if (!session) {
        return c.json(404, { error: 'Session not found.' });
      }

      if (c.authUser!.role === 'instructor') {
        const allowed =
          session.instructor_id === c.authUser!.id ||
          (await canInstructorAccessCourseD1(c.authUser!.id, session.course_id, c.db));
        if (!allowed) {
          return c.json(403, { error: 'Access denied to session attendance history.' });
        }
      }

      const entries = await listSessionAttendanceHistoryD1(sessionId, c.db);
      return c.json(200, { entries });
    },
  },
];
