import type { AnalyticsPreset } from '../../src/shared/types.ts';
import {
  academicTermSchema,
  academicYearSchema,
  assignInstructorCoursesSchema,
  createClassroomSchema,
  createDepartmentSchema,
  createInstructorSchema,
  createStudentSchema,
  createUserSchema,
  updateAcademicTermSchema,
  updateAcademicYearSchema,
  updateAcademySettingsSchema,
  updateClassroomSchema,
  updateDepartmentSchema,
  updateInstructorPermissionsSchema,
  updateInstructorSchema,
  updateStudentSchema,
  updateUserSchema,
} from '../../src/shared/validation.ts';
import {
  computeAdminAnalyticsSummaryD1,
  generateUniqueStaffCodeD1,
  generateUniqueStudentCodeD1,
  getAcademySettingsPayloadD1,
  getInstructorDetailD1,
  getStudentDetailD1,
  getUserDashboardByIdD1,
  issueAccountSetupTokenD1,
  listInstructorsWithMetricsD1,
  recordAuditLogD1,
  revokeActiveOnboardingTokensD1,
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
  sqlBool,
} from '../d1/client.ts';
import {
  listStudentsPaginatedD1,
  revokeAllUserSessionsD1,
  toPublicUserD1,
  type DbUserRow,
} from '../d1/repository.ts';
import { createEnrollmentWithOptionalInvoiceD1 } from '../d1/workflows.ts';
import { queueD1TransactionalEmail } from '../jobs/d1-worker.ts';
import { resolveRequestOrigin, type WorkerRouteEntry } from '../worker-router.ts';

export const workerAdminRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/admin/analytics',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const rawPreset = c.query.get('preset') ?? '30d';
      const preset: AnalyticsPreset =
        rawPreset === '7d' ||
        rawPreset === '30d' ||
        rawPreset === '90d' ||
        rawPreset === 'all' ||
        rawPreset === 'custom'
          ? rawPreset
          : '30d';
      const from = c.query.get('from') ?? undefined;
      const to = c.query.get('to') ?? undefined;

      const summary = await computeAdminAnalyticsSummaryD1({ preset, from, to }, c.db);
      return c.json(200, summary);
    },
  },
  {
    method: 'GET',
    pattern: '/api/students',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const rawSortBy = c.query.get('sortBy');
      const sortBy =
        rawSortBy === 'name' || rawSortBy === 'studentCode' ? rawSortBy : 'createdAt';
      const sortDir = c.query.get('sortDir') === 'asc' ? 'asc' : 'desc';

      const result = await listStudentsPaginatedD1(
        {
          page: Number(c.query.get('page')) || 1,
          pageSize: Number(c.query.get('pageSize')) || 15,
          search: c.query.get('search') ?? undefined,
          status: c.query.get('status') ?? undefined,
          courseId: c.query.get('courseId') ?? undefined,
          sortBy,
          sortDir,
        },
        c.db
      );
      return c.json(200, result);
    },
  },
  {
    method: 'POST',
    pattern: '/api/students',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createStudentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid student details.',
        });
      }

      const input = parsed.data;
      const normalizedEmail = input.email.toLowerCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
        [normalizedEmail],
        c.db
      );
      if (existing) {
        return c.json(409, { error: 'An account with this email already exists.' });
      }

      const studentId = randomId('stu', 8);
      // Cloudflare Workers Free uses first-party WebAuthn passkeys; never run slow password KDFs in Worker.
      const pwHash: string | null = null;
      const mustChangePassword = false;

      const studentCode = await generateUniqueStudentCodeD1(c.db);
      let departmentName: string | null = null;
      if (input.departmentId) {
        const dept = await d1First<{ name: string }>(
          'SELECT name FROM departments WHERE id = ? LIMIT 1',
          [input.departmentId],
          c.db
        );
        departmentName = dept?.name ?? null;
      }

      const now = nowIso();
      const roleRow = await d1First<{ id: string }>(
        "SELECT id FROM roles WHERE code = 'student' LIMIT 1",
        [],
        c.db
      );

      const dobIso =
        input.dateOfBirth && !Number.isNaN(Date.parse(input.dateOfBirth))
          ? new Date(input.dateOfBirth).toISOString()
          : null;

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `INSERT INTO users
             (id, name, email, role, status, student_code, department, phone, password_hash, password_updated_at, must_change_password, session_version, created_at, updated_at)
           VALUES (?, ?, ?, 'student', 'active', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            studentId,
            input.name,
            normalizedEmail,
            studentCode,
            departmentName,
            input.phone || null,
            pwHash,
            null,
            mustChangePassword ? 1 : 0,
            now,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO student_profiles
             (id, user_id, student_code, department_id, date_of_birth, address, emergency_contact, academic_standing, enrollment_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `sp-${studentId}`,
            studentId,
            studentCode,
            input.departmentId || null,
            dobIso,
            input.address,
            input.emergencyContact,
            input.academicStanding || 'Good Standing',
            now,
            now,
            now,
          ],
          c.db
        ),
      ];

      if (roleRow) {
        stmts.push(
          d1Stmt(
            `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_by_user_id, assigned_at)
             VALUES (?, ?, ?, ?, ?)`,
            [`ur-${studentId}-student`, studentId, roleRow.id, c.authUser!.id, now],
            c.db
          )
        );
      }

      if (input.guardianName?.trim()) {
        stmts.push(
          d1Stmt(
            `INSERT INTO guardians
               (id, student_profile_id, full_name, relationship, email, phone, is_primary, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', ?, 1, ?, ?)`,
            [
              randomId('grd', 8),
              `sp-${studentId}`,
              input.guardianName.trim(),
              input.guardianRelationship?.trim() || 'Parent / Guardian',
              input.guardianPhone?.trim() || '',
              now,
              now,
            ],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      const tok = await issueAccountSetupTokenD1(
        { userId: studentId, createdByUserId: c.authUser!.id, expiresInHours: 72 },
        c.db
      );
      const onboarding = {
        rawToken: tok.rawToken,
        onboardingPath: `/?enrollToken=${encodeURIComponent(tok.rawToken)}`,
        expiresAt: tok.expiresAtIso,
      };
      const origin = resolveRequestOrigin(c.request, c.env);
      await queueD1TransactionalEmail(
        {
          userId: studentId,
          kind: 'account_setup',
          recipientEmail: normalizedEmail,
          subject: 'Enroll Your Student Portal Passkey — IGS — InfoCom Global Services',
          bodyText: `Hello ${input.name},\n\nYour IGS — InfoCom Global Services student account (${studentCode}) has been created. Register your passkey using the single-use enrollment link below (valid for 72 hours):\n${origin}${onboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        },
        c.db
      );

      if (input.initialCourseId) {
        const batch = input.initialCohortId
          ? await d1First<{ id: string; name: string }>(
              'SELECT id, name FROM cohorts WHERE id = ? LIMIT 1',
              [input.initialCohortId],
              c.db
            )
          : await d1First<{ id: string; name: string }>(
              "SELECT id, name FROM cohorts WHERE course_id = ? AND status = 'Active' LIMIT 1",
              [input.initialCourseId],
              c.db
            );
        await createEnrollmentWithOptionalInvoiceD1(
          {
            actor: c.authUser!,
            studentId,
            courseId: input.initialCourseId,
            cohortId: batch?.id,
            cohort: batch?.name ?? 'Cohort A · Autumn',
            status: input.enrollmentStatus ?? 'Active',
            issueTuitionInvoice: input.issueTuitionInvoice ?? true,
          },
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'STUDENT_CREATED',
          entityType: 'user',
          entityId: studentId,
          summary: onboarding
            ? `Created student ${input.name} (${studentCode}) with single-use 72h setup token.`
            : `Created student ${input.name} (${studentCode}).`,
        },
        c.db
      );

      const createdUser = (await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [studentId],
        c.db
      ))!;
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, {
        student: toPublicUserD1(createdUser),
        ...(onboarding
          ? {
              onboardingToken: onboarding.rawToken,
              onboardingPath: onboarding.onboardingPath,
              onboardingExpiresAt: onboarding.expiresAt,
            }
          : {}),
        dashboard,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/students/:studentId/detail',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const detail = await getStudentDetailD1(c.params.studentId, c.db);
      if (!detail) {
        return c.json(404, { error: 'Student profile not found.' });
      }
      return c.json(200, detail);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/students/:studentId',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateStudentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid student update.',
        });
      }

      const existing = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
        [c.params.studentId],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Student not found.' });
      }

      const input = parsed.data;
      if (input.email && input.email.toLowerCase() !== existing.email.toLowerCase()) {
        const conflict = await d1First<{ id: string }>(
          'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
          [input.email.toLowerCase()],
          c.db
        );
        if (conflict) {
          return c.json(409, { error: 'Another account already uses this email.' });
        }
      }

      let departmentName: string | undefined;
      if (input.departmentId !== undefined) {
        if (input.departmentId) {
          const dept = await d1First<{ name: string }>(
            'SELECT name FROM departments WHERE id = ? LIMIT 1',
            [input.departmentId],
            c.db
          );
          departmentName = dept?.name ?? '';
        } else {
          departmentName = '';
        }
      }

      const deactivated = Boolean(input.status && input.status !== 'active');
      const now = nowIso();
      const userSets: string[] = ['updated_at = ?'];
      const userBinds: unknown[] = [now];
      if (input.name !== undefined) { userSets.push('name = ?'); userBinds.push(input.name); }
      if (input.email !== undefined) { userSets.push('email = ?'); userBinds.push(input.email.toLowerCase()); }
      if (input.phone !== undefined) { userSets.push('phone = ?'); userBinds.push(input.phone || null); }
      if (input.status !== undefined) { userSets.push('status = ?'); userBinds.push(input.status); }
      if (departmentName !== undefined) { userSets.push('department = ?'); userBinds.push(departmentName || null); }
      if (deactivated) { userSets.push('session_version = session_version + 1'); }

      const dobVal =
        input.dateOfBirth === null || input.dateOfBirth === ''
          ? null
          : input.dateOfBirth && !Number.isNaN(Date.parse(input.dateOfBirth))
            ? new Date(input.dateOfBirth).toISOString()
            : undefined;

      const existingProf = await d1First<{ id: string }>(
        'SELECT id FROM student_profiles WHERE user_id = ? LIMIT 1',
        [existing.id],
        c.db
      );

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `UPDATE users SET ${userSets.join(', ')} WHERE id = ?`,
          [...userBinds, existing.id],
          c.db
        ),
      ];

      if (existingProf) {
        const spSets: string[] = ['updated_at = ?'];
        const spBinds: unknown[] = [now];
        if (input.departmentId !== undefined) { spSets.push('department_id = ?'); spBinds.push(input.departmentId || null); }
        if (dobVal !== undefined) { spSets.push('date_of_birth = ?'); spBinds.push(dobVal); }
        if (input.address !== undefined) { spSets.push('address = ?'); spBinds.push(input.address); }
        if (input.emergencyContact !== undefined) { spSets.push('emergency_contact = ?'); spBinds.push(input.emergencyContact); }
        if (input.academicStanding !== undefined) { spSets.push('academic_standing = ?'); spBinds.push(input.academicStanding); }
        stmts.push(
          d1Stmt(
            `UPDATE student_profiles SET ${spSets.join(', ')} WHERE user_id = ?`,
            [...spBinds, existing.id],
            c.db
          )
        );
      } else {
        const code = existing.student_code ?? (await generateUniqueStudentCodeD1(c.db));
        stmts.push(
          d1Stmt(
            `INSERT INTO student_profiles
               (id, user_id, student_code, department_id, date_of_birth, address, emergency_contact, academic_standing, enrollment_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `sp-${existing.id}`,
              existing.id,
              code,
              input.departmentId || null,
              dobVal ?? null,
              input.address ?? '',
              input.emergencyContact ?? '',
              input.academicStanding ?? 'Good Standing',
              now,
              now,
              now,
            ],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      if (deactivated) {
        await revokeAllUserSessionsD1(existing.id, `student_status_${input.status}`, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: input.status === 'archived' ? 'STUDENT_ARCHIVED' : 'STUDENT_UPDATED',
          entityType: 'user',
          entityId: existing.id,
          summary: `Updated student ${existing.name} (${Object.keys(input).join(', ')}).`,
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        getStudentDetailD1(existing.id, c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { detail, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/students/:studentId/reset-password',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
        [c.params.studentId],
        c.db
      );
      if (!target) {
        return c.json(404, { error: 'Student account not found.' });
      }
      if (target.status === 'suspended' || target.status === 'archived') {
        return c.json(400, {
          error: `Cannot issue password reset link for a ${target.status} student account.`,
        });
      }

      const tok = await issueAccountSetupTokenD1(
        { userId: target.id, createdByUserId: c.authUser!.id, expiresInHours: 72 },
        c.db
      );
      const onboardingPath = `/?enrollToken=${encodeURIComponent(tok.rawToken)}`;
      const now = nowIso();

      await d1Run(
        `INSERT INTO delivery_logs (id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, 'in_app', ?, 'Delivered', ?)`,
        [randomId('del', 8), target.id, target.email, now],
        c.db
      );

      const origin = resolveRequestOrigin(c.request, c.env);
      await queueD1TransactionalEmail(
        {
          userId: target.id,
          kind: 'password_reset',
          recipientEmail: target.email,
          subject: 'Student Portal Passkey Enrollment Link — IGS — InfoCom Global Services',
          bodyText: `Hello ${target.name},\n\nAn administrator issued a single-use passkey enrollment/recovery link for your student portal (${target.student_code ?? target.email}), valid for 72 hours:\n${origin}${onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'WEBAUTHN_ENROLLMENT_ISSUED',
          entityType: 'user',
          entityId: target.id,
          ipAddress: c.ipAddress,
          summary: `Issued single-use 72h passkey enrollment/recovery link for student ${target.email}.`,
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        onboardingToken: tok.rawToken,
        onboardingPath,
        onboardingExpiresAt: tok.expiresAtIso,
        user: toPublicUserD1(target),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/students/:studentId/revoke-reset-tokens',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'student' LIMIT 1",
        [c.params.studentId],
        c.db
      );
      if (!target) {
        return c.json(404, { error: 'Student account not found.' });
      }

      const revokedCount = await revokeActiveOnboardingTokensD1(target.id, c.db);
      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'STUDENT_ONBOARDING_TOKENS_REVOKED',
          entityType: 'user',
          entityId: target.id,
          ipAddress: c.ipAddress,
          summary: `Revoked ${revokedCount} active onboarding/reset token(s) for student ${target.email}.`,
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        revokedCount,
        user: toPublicUserD1(target),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/instructors',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const items = await listInstructorsWithMetricsD1(c.db);
      return c.json(200, { items });
    },
  },
  {
    method: 'POST',
    pattern: '/api/instructors',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createInstructorSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid instructor details.',
        });
      }

      const input = parsed.data;
      const normalizedEmail = input.email.toLowerCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
        [normalizedEmail],
        c.db
      );
      if (existing) {
        return c.json(409, { error: 'An account with this email already exists.' });
      }

      const instructorId = randomId('ins', 8);
      const pwHash: string | null = null;
      const mustChangePassword = false;

      const staffCode = await generateUniqueStaffCodeD1(c.db);
      let departmentName = 'Academic Faculty';
      if (input.departmentId) {
        const dept = await d1First<{ name: string }>(
          'SELECT name FROM departments WHERE id = ? LIMIT 1',
          [input.departmentId],
          c.db
        );
        if (dept) departmentName = dept.name;
      }

      const now = nowIso();
      const hireDate =
        input.hireDate && !Number.isNaN(Date.parse(input.hireDate))
          ? new Date(input.hireDate).toISOString()
          : now;
      const roleRow = await d1First<{ id: string }>(
        "SELECT id FROM roles WHERE code = 'instructor' LIMIT 1",
        [],
        c.db
      );

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `INSERT INTO users
             (id, name, email, role, status, staff_code, department, phone, password_hash, password_updated_at, must_change_password, session_version, created_at, updated_at)
           VALUES (?, ?, ?, 'instructor', 'active', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            instructorId,
            input.name,
            normalizedEmail,
            staffCode,
            departmentName,
            input.phone || null,
            pwHash,
            null,
            mustChangePassword ? 1 : 0,
            now,
            now,
          ],
          c.db
        ),
        d1Stmt(
          `INSERT INTO instructor_profiles
             (id, user_id, staff_code, department_id, specialization, qualification, bio, permissions_configured, permissions, hire_date, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [
            `ip-${instructorId}`,
            instructorId,
            staffCode,
            input.departmentId || null,
            input.specialization,
            input.qualification,
            input.bio,
            Array.isArray(input.permissions) ? 1 : 0,
            JSON.stringify(input.permissions ?? []),
            hireDate,
            now,
            now,
          ],
          c.db
        ),
      ];

      if (roleRow) {
        stmts.push(
          d1Stmt(
            `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_by_user_id, assigned_at)
             VALUES (?, ?, ?, ?, ?)`,
            [`ur-${instructorId}-instructor`, instructorId, roleRow.id, c.authUser!.id, now],
            c.db
          )
        );
      }

      if (input.courseIds.length > 0) {
        stmts.push(
          d1Stmt(
            `UPDATE courses SET instructor_id = ?, updated_at = ? WHERE id IN (${inPlaceholders(input.courseIds.length)})`,
            [instructorId, now, ...input.courseIds],
            c.db
          )
        );
      }

      if (input.batchIds.length > 0) {
        const batches = await d1All<{ id: string; course_id: string }>(
          `SELECT id, course_id FROM cohorts WHERE id IN (${inPlaceholders(input.batchIds.length)})`,
          input.batchIds,
          c.db
        );
        for (const batch of batches) {
          stmts.push(
            d1Stmt('UPDATE cohorts SET instructor_id = ? WHERE id = ?', [instructorId, batch.id], c.db),
            d1Stmt(
              `INSERT INTO instructor_assignments
                 (id, instructor_id, batch_id, course_id, role, is_active, assigned_at)
               VALUES (?, ?, ?, ?, 'Lead', 1, ?)
               ON CONFLICT(instructor_id, batch_id) DO UPDATE SET is_active = 1, unassigned_at = NULL`,
              [randomId('ia', 8), instructorId, batch.id, batch.course_id, now],
              c.db
            )
          );
        }
      }

      await d1Batch(stmts, c.db);

      const tok = await issueAccountSetupTokenD1(
        { userId: instructorId, createdByUserId: c.authUser!.id, expiresInHours: 72 },
        c.db
      );
      const onboarding = {
        rawToken: tok.rawToken,
        onboardingPath: `/?enrollToken=${encodeURIComponent(tok.rawToken)}`,
        expiresAt: tok.expiresAtIso,
      };
      const origin = resolveRequestOrigin(c.request, c.env);
      await queueD1TransactionalEmail(
        {
          userId: instructorId,
          kind: 'account_setup',
          recipientEmail: normalizedEmail,
          subject: 'Enroll Your Instructor Portal Passkey — IGS — InfoCom Global Services',
          bodyText: `Hello ${input.name},\n\nYour IGS — InfoCom Global Services instructor account (${staffCode}) has been provisioned. Register your passkey using the single-use link below (valid for 72 hours):\n${origin}${onboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'INSTRUCTOR_CREATED',
          entityType: 'user',
          entityId: instructorId,
          summary: onboarding
            ? `Created instructor ${input.name} (${staffCode}) with single-use 72h setup token.`
            : `Created instructor ${input.name} (${staffCode}).`,
        },
        c.db
      );

      const [createdUser, items, dashboard] = await Promise.all([
        d1First<DbUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [instructorId], c.db),
        listInstructorsWithMetricsD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(201, {
        instructor: toPublicUserD1(createdUser!),
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
    },
  },
  {
    method: 'GET',
    pattern: '/api/instructors/:instructorId/detail',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const detail = await getInstructorDetailD1(c.params.instructorId, c.db);
      if (!detail) {
        return c.json(404, { error: 'Instructor not found.' });
      }
      return c.json(200, detail);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/instructors/:instructorId',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateInstructorSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid instructor update.',
        });
      }

      const existing = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'instructor' LIMIT 1",
        [c.params.instructorId],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Instructor not found.' });
      }

      const input = parsed.data;
      if (input.email && input.email.toLowerCase() !== existing.email.toLowerCase()) {
        const conflict = await d1First<{ id: string }>(
          'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
          [input.email.toLowerCase()],
          c.db
        );
        if (conflict) {
          return c.json(409, { error: 'Another account already uses this email.' });
        }
      }

      let deptName: string | undefined;
      if (input.departmentId !== undefined) {
        if (input.departmentId) {
          const d = await d1First<{ name: string }>(
            'SELECT name FROM departments WHERE id = ? LIMIT 1',
            [input.departmentId],
            c.db
          );
          deptName = d?.name ?? 'Academic Faculty';
        } else {
          deptName = 'Academic Faculty';
        }
      }

      const deactivated = Boolean(input.status && input.status !== 'active');
      const now = nowIso();
      const userSets: string[] = ['updated_at = ?'];
      const userBinds: unknown[] = [now];
      if (input.name !== undefined) { userSets.push('name = ?'); userBinds.push(input.name); }
      if (input.email !== undefined) { userSets.push('email = ?'); userBinds.push(input.email.toLowerCase()); }
      if (input.phone !== undefined) { userSets.push('phone = ?'); userBinds.push(input.phone || null); }
      if (input.status !== undefined) { userSets.push('status = ?'); userBinds.push(input.status); }
      if (deptName !== undefined) { userSets.push('department = ?'); userBinds.push(deptName); }
      if (deactivated) { userSets.push('session_version = session_version + 1'); }

      const hireDate =
        input.hireDate === null || input.hireDate === ''
          ? null
          : input.hireDate && !Number.isNaN(Date.parse(input.hireDate))
            ? new Date(input.hireDate).toISOString()
            : undefined;

      const existingProf = await d1First<{ id: string }>(
        'SELECT id FROM instructor_profiles WHERE user_id = ? LIMIT 1',
        [existing.id],
        c.db
      );

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `UPDATE users SET ${userSets.join(', ')} WHERE id = ?`,
          [...userBinds, existing.id],
          c.db
        ),
      ];

      if (existingProf) {
        const ipSets: string[] = ['updated_at = ?'];
        const ipBinds: unknown[] = [now];
        if (input.departmentId !== undefined) { ipSets.push('department_id = ?'); ipBinds.push(input.departmentId || null); }
        if (input.specialization !== undefined) { ipSets.push('specialization = ?'); ipBinds.push(input.specialization); }
        if (input.qualification !== undefined) { ipSets.push('qualification = ?'); ipBinds.push(input.qualification); }
        if (input.bio !== undefined) { ipSets.push('bio = ?'); ipBinds.push(input.bio); }
        if (hireDate !== undefined) { ipSets.push('hire_date = ?'); ipBinds.push(hireDate); }
        if (input.status !== undefined) { ipSets.push('status = ?'); ipBinds.push(input.status); }
        stmts.push(
          d1Stmt(
            `UPDATE instructor_profiles SET ${ipSets.join(', ')} WHERE user_id = ?`,
            [...ipBinds, existing.id],
            c.db
          )
        );
      } else {
        const code = existing.staff_code ?? (await generateUniqueStaffCodeD1(c.db));
        stmts.push(
          d1Stmt(
            `INSERT INTO instructor_profiles
               (id, user_id, staff_code, department_id, specialization, qualification, bio, permissions_configured, permissions, hire_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, ?, ?)`,
            [
              `ip-${existing.id}`,
              existing.id,
              code,
              input.departmentId || null,
              input.specialization ?? '',
              input.qualification ?? '',
              input.bio ?? '',
              hireDate ?? now,
              input.status ?? existing.status,
              now,
              now,
            ],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      if (deactivated) {
        await revokeAllUserSessionsD1(existing.id, `instructor_status_${input.status}`, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'INSTRUCTOR_UPDATED',
          entityType: 'user',
          entityId: existing.id,
          summary: `Updated instructor ${existing.name} (${Object.keys(input).join(', ')}).`,
        },
        c.db
      );

      const [detail, items, dashboard] = await Promise.all([
        getInstructorDetailD1(existing.id, c.db),
        listInstructorsWithMetricsD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { detail, items, dashboard });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/instructors/:instructorId/assignments',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = assignInstructorCoursesSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid assignment payload.',
        });
      }

      const instructor = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'instructor' LIMIT 1",
        [c.params.instructorId],
        c.db
      );
      if (!instructor) {
        return c.json(404, { error: 'Instructor not found.' });
      }

      const { courseIds, batchIds } = parsed.data;
      const fallbackLead = await d1First<{ id: string }>(
        "SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1",
        [],
        c.db
      );
      const now = nowIso();
      const stmts: D1PreparedStatementLike[] = [];

      if (courseIds.length > 0) {
        stmts.push(
          d1Stmt(
            `UPDATE courses SET instructor_id = ?, updated_at = ? WHERE id IN (${inPlaceholders(courseIds.length)})`,
            [instructor.id, now, ...courseIds],
            c.db
          )
        );
      }
      if (fallbackLead) {
        if (courseIds.length > 0) {
          stmts.push(
            d1Stmt(
              `UPDATE courses SET instructor_id = ?, updated_at = ? WHERE instructor_id = ? AND id NOT IN (${inPlaceholders(courseIds.length)})`,
              [fallbackLead.id, now, instructor.id, ...courseIds],
              c.db
            )
          );
        } else {
          stmts.push(
            d1Stmt(
              'UPDATE courses SET instructor_id = ?, updated_at = ? WHERE instructor_id = ?',
              [fallbackLead.id, now, instructor.id],
              c.db
            )
          );
        }
      }

      if (batchIds.length > 0) {
        stmts.push(
          d1Stmt(
            `UPDATE instructor_assignments SET is_active = 0, unassigned_at = ?
             WHERE instructor_id = ? AND is_active = 1 AND batch_id NOT IN (${inPlaceholders(batchIds.length)})`,
            [now, instructor.id, ...batchIds],
            c.db
          )
        );
      } else {
        stmts.push(
          d1Stmt(
            'UPDATE instructor_assignments SET is_active = 0, unassigned_at = ? WHERE instructor_id = ? AND is_active = 1',
            [now, instructor.id],
            c.db
          )
        );
      }

      if (fallbackLead) {
        if (batchIds.length > 0) {
          stmts.push(
            d1Stmt(
              `UPDATE cohorts SET instructor_id = ? WHERE instructor_id = ? AND id NOT IN (${inPlaceholders(batchIds.length)})`,
              [fallbackLead.id, instructor.id, ...batchIds],
              c.db
            )
          );
        } else {
          stmts.push(
            d1Stmt(
              'UPDATE cohorts SET instructor_id = ? WHERE instructor_id = ?',
              [fallbackLead.id, instructor.id],
              c.db
            )
          );
        }
      }

      if (batchIds.length > 0) {
        const batches = await d1All<{ id: string; course_id: string }>(
          `SELECT id, course_id FROM cohorts WHERE id IN (${inPlaceholders(batchIds.length)})`,
          batchIds,
          c.db
        );
        for (const batch of batches) {
          stmts.push(
            d1Stmt(
              'UPDATE cohorts SET instructor_id = ? WHERE id = ?',
              [instructor.id, batch.id],
              c.db
            ),
            d1Stmt(
              `INSERT INTO instructor_assignments
                 (id, instructor_id, batch_id, course_id, role, is_active, assigned_at)
               VALUES (?, ?, ?, ?, 'Lead', 1, ?)
               ON CONFLICT(instructor_id, batch_id) DO UPDATE SET is_active = 1, unassigned_at = NULL`,
              [randomId('ia', 8), instructor.id, batch.id, batch.course_id, now],
              c.db
            )
          );
        }
      }

      if (stmts.length > 0) {
        await d1Batch(stmts, c.db);
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'INSTRUCTOR_ASSIGNMENTS_UPDATED',
          entityType: 'user',
          entityId: instructor.id,
          summary: `Assigned ${courseIds.length} courses and ${batchIds.length} batches to ${instructor.name}.`,
        },
        c.db
      );

      const [detail, items, dashboard] = await Promise.all([
        getInstructorDetailD1(instructor.id, c.db),
        listInstructorsWithMetricsD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { detail, items, dashboard });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/instructors/:instructorId/permissions',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateInstructorPermissionsSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid permissions payload.',
        });
      }

      const instructor = await d1First<DbUserRow>(
        "SELECT * FROM users WHERE id = ? AND role = 'instructor' LIMIT 1",
        [c.params.instructorId],
        c.db
      );
      if (!instructor) {
        return c.json(404, { error: 'Instructor not found.' });
      }

      const uniquePerms = Array.from(new Set(parsed.data.permissions));
      const now = nowIso();
      const existingProf = await d1First<{ id: string }>(
        'SELECT id FROM instructor_profiles WHERE user_id = ? LIMIT 1',
        [instructor.id],
        c.db
      );
      if (existingProf) {
        await d1Run(
          'UPDATE instructor_profiles SET permissions_configured = 1, permissions = ?, updated_at = ? WHERE user_id = ?',
          [JSON.stringify(uniquePerms), now, instructor.id],
          c.db
        );
      } else {
        const staffCode = instructor.staff_code ?? (await generateUniqueStaffCodeD1(c.db));
        await d1Run(
          `INSERT INTO instructor_profiles
             (id, user_id, staff_code, permissions_configured, permissions, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
          [`ip-${instructor.id}`, instructor.id, staffCode, JSON.stringify(uniquePerms), now, now],
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'INSTRUCTOR_PERMISSIONS_UPDATED',
          entityType: 'user',
          entityId: instructor.id,
          summary: `Updated granular permissions for ${instructor.name} (${uniquePerms.length} enabled).`,
          metadata: { permissions: uniquePerms },
        },
        c.db
      );

      const [detail, items] = await Promise.all([
        getInstructorDetailD1(instructor.id, c.db),
        listInstructorsWithMetricsD1(c.db),
      ]);
      return c.json(200, { detail, items });
    },
  },
  {
    method: 'POST',
    pattern: '/api/users',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createUserSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid user details.',
        });
      }

      const input = parsed.data;
      const normalizedEmail = input.email.toLowerCase();
      const existing = await d1First<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
        [normalizedEmail],
        c.db
      );
      if (existing) {
        return c.json(409, { error: 'An account with this email already exists.' });
      }

      const prefix =
        input.role === 'admin' ? 'adm' : input.role === 'instructor' ? 'ins' : 'stu';
      const id = randomId(prefix, 8);
      const newUserHash: string | null = null;
      const mustChangePassword = false;

      const studentCode =
        input.role === 'student' ? await generateUniqueStudentCodeD1(c.db) : null;
      const staffCode =
        input.role !== 'student' ? await generateUniqueStaffCodeD1(c.db) : null;
      const dept =
        input.department ||
        (input.role === 'admin'
          ? 'Administration'
          : input.role === 'instructor'
            ? 'Academic Faculty'
            : null);

      const now = nowIso();
      const roleRow = await d1First<{ id: string }>(
        'SELECT id FROM roles WHERE code = ? LIMIT 1',
        [input.role],
        c.db
      );

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `INSERT INTO users
             (id, name, email, role, status, student_code, staff_code, department, phone, password_hash, password_updated_at, must_change_password, session_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            input.name,
            normalizedEmail,
            input.role,
            studentCode,
            staffCode,
            dept,
            input.phone || null,
            newUserHash,
            null,
            mustChangePassword ? 1 : 0,
            now,
            now,
          ],
          c.db
        ),
      ];

      if (roleRow) {
        stmts.push(
          d1Stmt(
            `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_by_user_id, assigned_at)
             VALUES (?, ?, ?, ?, ?)`,
            [`ur-${id}-${input.role}`, id, roleRow.id, c.authUser!.id, now],
            c.db
          )
        );
      }

      if (input.role === 'student' && studentCode) {
        stmts.push(
          d1Stmt(
            `INSERT INTO student_profiles (id, user_id, student_code, enrollment_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [`sp-${id}`, id, studentCode, now, now, now],
            c.db
          )
        );
      } else if (input.role === 'instructor' && staffCode) {
        stmts.push(
          d1Stmt(
            `INSERT INTO instructor_profiles (id, user_id, staff_code, specialization, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [`ip-${id}`, id, staffCode, dept ?? '', now, now],
            c.db
          )
        );
      }

      await d1Batch(stmts, c.db);

      const tok = await issueAccountSetupTokenD1(
        { userId: id, createdByUserId: c.authUser!.id, expiresInHours: 72 },
        c.db
      );
      const onboarding = {
        rawToken: tok.rawToken,
        onboardingPath: `/?enrollToken=${encodeURIComponent(tok.rawToken)}`,
        expiresAt: tok.expiresAtIso,
      };
      await d1Run(
        `INSERT INTO delivery_logs (id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, 'in_app', ?, 'Delivered', ?)`,
        [randomId('del', 8), id, normalizedEmail, now],
        c.db
      );
      const origin = resolveRequestOrigin(c.request, c.env);
      await queueD1TransactionalEmail(
        {
          userId: id,
          kind: 'account_setup',
          recipientEmail: normalizedEmail,
          subject: 'Enroll Your Portal Passkey — IGS — InfoCom Global Services',
          bodyText: `Hello ${input.name},\n\nYour IGS — InfoCom Global Services ${input.role} account has been created. Register your passkey using the single-use enrollment link below (valid for 72 hours):\n${origin}${onboarding.onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: onboarding ? 'ONBOARDING_TOKEN_ISSUED' : 'USER_CREATED',
          entityType: 'user',
          entityId: id,
          summary: onboarding
            ? `Created ${input.role} account for ${input.name} (${normalizedEmail}) with single-use 72h setup token.`
            : `Created ${input.role} account for ${input.name} (${normalizedEmail}).`,
        },
        c.db
      );

      const created = (await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [id],
        c.db
      ))!;
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, {
        user: toPublicUserD1(created),
        ...(onboarding
          ? {
              onboardingToken: onboarding.rawToken,
              onboardingPath: onboarding.onboardingPath,
              onboardingExpiresAt: onboarding.expiresAt,
            }
          : {}),
        dashboard,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/reset-token',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!target) {
        return c.json(404, { error: 'User account not found.' });
      }
      if (target.status === 'suspended' || target.status === 'archived') {
        return c.json(400, {
          error: `Cannot issue setup/reset link for a ${target.status} account.`,
        });
      }

      const tok = await issueAccountSetupTokenD1(
        { userId: target.id, createdByUserId: c.authUser!.id, expiresInHours: 72 },
        c.db
      );
      const onboardingPath = `/?enrollToken=${encodeURIComponent(tok.rawToken)}`;
      const now = nowIso();

      await d1Run(
        `INSERT INTO delivery_logs (id, user_id, channel, recipient, status, sent_at)
         VALUES (?, ?, 'in_app', ?, 'Delivered', ?)`,
        [randomId('del', 8), target.id, target.email, now],
        c.db
      );

      const origin = resolveRequestOrigin(c.request, c.env);
      await queueD1TransactionalEmail(
        {
          userId: target.id,
          kind: 'password_reset',
          recipientEmail: target.email,
          subject: 'Passkey Enrollment & Recovery Link — IGS — InfoCom Global Services',
          bodyText: `Hello ${target.name},\n\nAn administrator issued a single-use passkey enrollment/recovery link for your account (${target.email}), valid for 72 hours:\n${origin}${onboardingPath}\n\n— IGS — InfoCom Global Services`,
          bypassPreferences: true,
          redactSensitive: true,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'WEBAUTHN_ENROLLMENT_ISSUED',
          entityType: 'user',
          entityId: target.id,
          ipAddress: c.ipAddress,
          summary: `Issued single-use 72h passkey enrollment/recovery link for ${target.email}.`,
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        onboardingToken: tok.rawToken,
        onboardingPath,
        onboardingExpiresAt: tok.expiresAtIso,
        user: toPublicUserD1(target),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/revoke-reset-tokens',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!target) {
        return c.json(404, { error: 'User account not found.' });
      }

      const revokedCount = await revokeActiveOnboardingTokensD1(target.id, c.db);
      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ONBOARDING_TOKENS_REVOKED',
          entityType: 'user',
          entityId: target.id,
          ipAddress: c.ipAddress,
          summary: `Revoked ${revokedCount} active onboarding/reset token(s) for ${target.email}.`,
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        revokedCount,
        user: toPublicUserD1(target),
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/users/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateUserSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid user update.',
        });
      }

      const targetId = c.params.id;
      const input = parsed.data;
      if (targetId === c.authUser!.id && input.status && input.status !== 'active') {
        return c.json(400, {
          error: 'You cannot deactivate or archive your own active admin account.',
        });
      }
      if (targetId === c.authUser!.id && input.role && input.role !== 'admin') {
        return c.json(400, { error: 'You cannot downgrade your own admin role.' });
      }

      const existing = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [targetId],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'User account not found.' });
      }

      const roleChanged = Boolean(input.role && input.role !== existing.role);
      const deactivated = Boolean(input.status && input.status !== 'active');
      const now = nowIso();
      const sets: string[] = ['updated_at = ?'];
      const binds: unknown[] = [now];
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.role !== undefined) { sets.push('role = ?'); binds.push(input.role); }
      if (input.status !== undefined) { sets.push('status = ?'); binds.push(input.status); }
      if (input.department !== undefined) { sets.push('department = ?'); binds.push(input.department); }
      if (input.phone !== undefined) { sets.push('phone = ?'); binds.push(input.phone); }
      if (roleChanged || deactivated) { sets.push('session_version = session_version + 1'); }

      const stmts: D1PreparedStatementLike[] = [
        d1Stmt(
          `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
          [...binds, targetId],
          c.db
        ),
      ];

      if (roleChanged && input.role) {
        const newRoleRow = await d1First<{ id: string }>(
          'SELECT id FROM roles WHERE code = ? LIMIT 1',
          [input.role],
          c.db
        );
        if (newRoleRow) {
          stmts.push(
            d1Stmt(
              `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_by_user_id, assigned_at)
               VALUES (?, ?, ?, ?, ?)`,
              [`ur-${targetId}-${input.role}`, targetId, newRoleRow.id, c.authUser!.id, now],
              c.db
            )
          );
        }
      }

      await d1Batch(stmts, c.db);

      if (roleChanged || deactivated) {
        await revokeAllUserSessionsD1(
          targetId,
          deactivated ? 'account_deactivated' : 'role_changed',
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: targetId,
          summary: `Updated account ${existing.email} (${Object.keys(input).join(', ')}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/departments',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const [departments, courses] = await Promise.all([
        d1All<Record<string, unknown>>('SELECT * FROM departments ORDER BY name ASC', [], c.db),
        d1All<{ department_id: string | null }>('SELECT department_id FROM courses', [], c.db),
      ]);
      return c.json(200, {
        items: departments.map((d) => ({
          id: String(d.id),
          code: String(d.code),
          name: String(d.name),
          headUserId: d.head_user_id ? String(d.head_user_id) : null,
          status: String(d.status),
          courseCount: courses.filter((crs) => crs.department_id === String(d.id)).length,
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/departments',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createDepartmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid department details.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const dup = await d1First<{ id: string }>(
        'SELECT id FROM departments WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (dup) {
        return c.json(409, { error: `Department code ${upperCode} already exists.` });
      }

      const academy = await d1First<{ id: string }>(
        'SELECT id FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      if (!academy) {
        return c.json(400, { error: 'Academy record must be initialized first.' });
      }

      const id = randomId('dept', 8);
      const now = nowIso();
      await d1Run(
        `INSERT INTO departments (id, academy_id, code, name, head_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, academy.id, upperCode, input.name, input.headUserId || null, input.status, now, now],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DEPARTMENT_CREATED',
          entityType: 'department',
          entityId: id,
          summary: `Created department ${input.name} (${upperCode}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { departmentId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/departments/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateDepartmentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid department update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM departments WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Department not found.' });
      }

      const input = parsed.data;
      const sets: string[] = ['updated_at = ?'];
      const binds: unknown[] = [nowIso()];
      if (input.code !== undefined) { sets.push('code = ?'); binds.push(input.code.toUpperCase()); }
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.headUserId !== undefined) { sets.push('head_user_id = ?'); binds.push(input.headUserId || null); }
      if (input.status !== undefined) { sets.push('status = ?'); binds.push(input.status); }

      await d1Run(
        `UPDATE departments SET ${sets.join(', ')} WHERE id = ?`,
        [...binds, String(existing.id)],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DEPARTMENT_UPDATED',
          entityType: 'department',
          entityId: String(existing.id),
          summary: `Updated department ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/classrooms',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const rows = await d1All<Record<string, unknown>>(
        'SELECT * FROM classrooms ORDER BY code ASC',
        [],
        c.db
      );
      return c.json(200, {
        items: rows.map((r) => ({
          id: String(r.id),
          academyId: String(r.academy_id),
          code: String(r.code),
          name: String(r.name),
          building: String(r.building),
          capacity: Number(r.capacity),
          equipment: String(r.equipment || ''),
          isActive: sqlBool(r.is_active),
          createdAt: String(r.created_at),
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/classrooms',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createClassroomSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid classroom details.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const dup = await d1First<{ id: string }>(
        'SELECT id FROM classrooms WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (dup) {
        return c.json(409, { error: `Classroom code ${upperCode} already exists.` });
      }

      const academy = await d1First<{ id: string }>(
        'SELECT id FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      if (!academy) {
        return c.json(400, { error: 'Academy record not found.' });
      }

      const id = randomId('room', 8);
      await d1Run(
        `INSERT INTO classrooms (id, academy_id, code, name, building, capacity, equipment, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          academy.id,
          upperCode,
          input.name,
          input.building,
          input.capacity,
          input.equipment,
          input.isActive ? 1 : 0,
          nowIso(),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'CLASSROOM_CREATED',
          entityType: 'classroom',
          entityId: id,
          summary: `Added classroom ${input.name} (${upperCode}, cap ${input.capacity}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { classroomId: id, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/classrooms/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateClassroomSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid classroom update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM classrooms WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Classroom not found.' });
      }

      const input = parsed.data;
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (input.code !== undefined) { sets.push('code = ?'); binds.push(input.code.toUpperCase()); }
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.building !== undefined) { sets.push('building = ?'); binds.push(input.building); }
      if (input.capacity !== undefined) { sets.push('capacity = ?'); binds.push(input.capacity); }
      if (input.equipment !== undefined) { sets.push('equipment = ?'); binds.push(input.equipment); }
      if (input.isActive !== undefined) { sets.push('is_active = ?'); binds.push(input.isActive ? 1 : 0); }

      if (sets.length > 0) {
        await d1Run(
          `UPDATE classrooms SET ${sets.join(', ')} WHERE id = ?`,
          [...binds, String(existing.id)],
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'CLASSROOM_UPDATED',
          entityType: 'classroom',
          entityId: String(existing.id),
          summary: `Updated classroom ${String(existing.code)}.`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/settings',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const payload = await getAcademySettingsPayloadD1(c.db);
      return c.json(200, payload);
    },
  },
  {
    method: 'PUT',
    pattern: '/api/settings',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateAcademySettingsSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid academy settings.',
        });
      }

      const input = parsed.data;
      const academy = await d1First<{ id: string }>(
        'SELECT id FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      const academyId = academy?.id ?? 'acad-infocom';
      const now = nowIso();
      const stmts: D1PreparedStatementLike[] = [];

      if (academy) {
        const sets = [
          'name = ?',
          'legal_name = ?',
          'email = ?',
          'phone = ?',
          'website = ?',
          'address = ?',
          'timezone = ?',
          'currency = ?',
          'updated_at = ?',
        ];
        const binds: unknown[] = [
          input.academy.name,
          input.academy.legalName,
          input.academy.email,
          input.academy.phone,
          input.academy.website,
          input.academy.address,
          input.academy.timezone,
          input.academy.currency.toUpperCase(),
          now,
        ];
        if (input.academy.logoDataUrl !== undefined) {
          sets.push('logo_data_url = ?');
          binds.push(input.academy.logoDataUrl);
        }
        stmts.push(
          d1Stmt(`UPDATE academies SET ${sets.join(', ')} WHERE id = ?`, [...binds, academyId], c.db)
        );
      } else {
        stmts.push(
          d1Stmt(
            `INSERT INTO academies
               (id, code, name, legal_name, email, phone, website, address, logo_data_url, timezone, currency, created_at, updated_at)
             VALUES (?, 'INFOCOM-MAIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              academyId,
              input.academy.name,
              input.academy.legalName,
              input.academy.email,
              input.academy.phone,
              input.academy.website,
              input.academy.address,
              input.academy.logoDataUrl ?? '',
              input.academy.timezone,
              input.academy.currency.toUpperCase(),
              now,
              now,
            ],
            c.db
          )
        );
      }

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
        stmts.push(
          d1Stmt(
            `INSERT INTO academy_settings (id, academy_id, key, value, value_type, updated_by_user_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(academy_id, key) DO UPDATE SET
               value = excluded.value,
               value_type = excluded.value_type,
               updated_by_user_id = excluded.updated_by_user_id,
               updated_at = excluded.updated_at`,
            [
              `set-${p.key.replace(/[^a-z0-9]/gi, '-')}`,
              academyId,
              p.key,
              p.value,
              p.valueType,
              c.authUser!.id,
              now,
            ],
            c.db
          )
        );
      }

      if (input.certificateTemplate) {
        const tmpl = await d1First<{ id: string }>(
          'SELECT id FROM certificate_templates WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1',
          [],
          c.db
        );
        if (tmpl) {
          stmts.push(
            d1Stmt(
              `UPDATE certificate_templates
               SET name = ?, title_format = ?, signatory_name = ?, signatory_title = ?,
                   min_completion_pct = ?, min_score = ?, min_attendance_pct = ?, updated_at = ?
               WHERE id = ?`,
              [
                input.certificateTemplate.name,
                input.certificateTemplate.titleFormat,
                input.certificateTemplate.signatoryName,
                input.certificateTemplate.signatoryTitle,
                input.policies.certificateMinCompletionPct,
                input.policies.certificateMinScore,
                input.policies.certificateMinAttendancePct,
                now,
                tmpl.id,
              ],
              c.db
            )
          );
        }
      }

      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ACADEMY_SETTINGS_UPDATED',
          entityType: 'academy',
          entityId: academyId,
          summary:
            'Updated academy configuration, grading/attendance policies, and invoice/certificate settings.',
        },
        c.db
      );

      const [settings, dashboard] = await Promise.all([
        getAcademySettingsPayloadD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { settings, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/academic-years',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = academicYearSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid academic year.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const dup = await d1First<{ id: string }>(
        'SELECT id FROM academic_years WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (dup) {
        return c.json(409, { error: `Academic year ${upperCode} already exists.` });
      }

      const academy = await d1First<{ id: string }>(
        'SELECT id FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      if (!academy) {
        return c.json(400, { error: 'Academy record not found.' });
      }

      const id = randomId('ay', 8);
      const stmts: D1PreparedStatementLike[] = [];
      if (input.isCurrent) {
        stmts.push(d1Stmt('UPDATE academic_years SET is_current = 0', [], c.db));
      }
      stmts.push(
        d1Stmt(
          `INSERT INTO academic_years (id, academy_id, code, name, start_date, end_date, is_current, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            academy.id,
            upperCode,
            input.name,
            new Date(input.startDate).toISOString(),
            new Date(input.endDate).toISOString(),
            input.isCurrent ? 1 : 0,
            input.status ?? 'Active',
            nowIso(),
          ],
          c.db
        )
      );
      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ACADEMIC_YEAR_CREATED',
          entityType: 'academic_year',
          entityId: id,
          summary: `Created academic year ${input.name} (${upperCode}).`,
        },
        c.db
      );

      const [settings, dashboard] = await Promise.all([
        getAcademySettingsPayloadD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(201, { settings, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/academic-years/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateAcademicYearSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid academic year update.',
        });
      }

      const existing = await d1First<{ id: string }>(
        'SELECT id FROM academic_years WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Academic year not found.' });
      }

      const input = parsed.data;
      const stmts: D1PreparedStatementLike[] = [];
      if (input.isCurrent) {
        stmts.push(d1Stmt('UPDATE academic_years SET is_current = 0', [], c.db));
      }
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.startDate !== undefined) { sets.push('start_date = ?'); binds.push(new Date(input.startDate).toISOString()); }
      if (input.endDate !== undefined) { sets.push('end_date = ?'); binds.push(new Date(input.endDate).toISOString()); }
      if (input.isCurrent !== undefined) { sets.push('is_current = ?'); binds.push(input.isCurrent ? 1 : 0); }
      if (input.status !== undefined) { sets.push('status = ?'); binds.push(input.status); }
      if (sets.length > 0) {
        stmts.push(
          d1Stmt(`UPDATE academic_years SET ${sets.join(', ')} WHERE id = ?`, [...binds, existing.id], c.db)
        );
      }
      if (stmts.length > 0) {
        await d1Batch(stmts, c.db);
      }

      const [settings, dashboard] = await Promise.all([
        getAcademySettingsPayloadD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { settings, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/academic-terms',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = academicTermSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid academic term.',
        });
      }

      const input = parsed.data;
      const upperCode = input.code.toUpperCase();
      const dup = await d1First<{ id: string }>(
        'SELECT id FROM academic_terms WHERE code = ? LIMIT 1',
        [upperCode],
        c.db
      );
      if (dup) {
        return c.json(409, { error: `Academic term ${upperCode} already exists.` });
      }

      const id = randomId('term', 8);
      const stmts: D1PreparedStatementLike[] = [];
      if (input.isCurrent) {
        stmts.push(d1Stmt('UPDATE academic_terms SET is_current = 0', [], c.db));
      }
      stmts.push(
        d1Stmt(
          `INSERT INTO academic_terms (id, academic_year_id, code, name, start_date, end_date, is_current, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.academicYearId,
            upperCode,
            input.name,
            new Date(input.startDate).toISOString(),
            new Date(input.endDate).toISOString(),
            input.isCurrent ? 1 : 0,
            input.status ?? 'Active',
            nowIso(),
          ],
          c.db
        )
      );
      await d1Batch(stmts, c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ACADEMIC_TERM_CREATED',
          entityType: 'academic_term',
          entityId: id,
          summary: `Created academic term ${input.name} (${upperCode}).`,
        },
        c.db
      );

      const [settings, dashboard] = await Promise.all([
        getAcademySettingsPayloadD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(201, { settings, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/academic-terms/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateAcademicTermSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid academic term update.',
        });
      }

      const existing = await d1First<{ id: string }>(
        'SELECT id FROM academic_terms WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Academic term not found.' });
      }

      const input = parsed.data;
      const stmts: D1PreparedStatementLike[] = [];
      if (input.isCurrent) {
        stmts.push(d1Stmt('UPDATE academic_terms SET is_current = 0', [], c.db));
      }
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
      if (input.startDate !== undefined) { sets.push('start_date = ?'); binds.push(new Date(input.startDate).toISOString()); }
      if (input.endDate !== undefined) { sets.push('end_date = ?'); binds.push(new Date(input.endDate).toISOString()); }
      if (input.isCurrent !== undefined) { sets.push('is_current = ?'); binds.push(input.isCurrent ? 1 : 0); }
      if (input.status !== undefined) { sets.push('status = ?'); binds.push(input.status); }
      if (sets.length > 0) {
        stmts.push(
          d1Stmt(`UPDATE academic_terms SET ${sets.join(', ')} WHERE id = ?`, [...binds, existing.id], c.db)
        );
      }
      if (stmts.length > 0) {
        await d1Batch(stmts, c.db);
      }

      const [settings, dashboard] = await Promise.all([
        getAcademySettingsPayloadD1(c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { settings, dashboard });
    },
  },
];
