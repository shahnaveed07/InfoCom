import {
  isValidAdmissionTransition,
} from '../../src/shared/academic.ts';
import type { AdmissionStatus } from '../../src/shared/types.ts';
import {
  approveAdmissionSchema,
  createAdmissionSchema,
  updateAdmissionSchema,
  uploadAdmissionDocumentSchema,
  verifyAdmissionDocumentSchema,
} from '../../src/shared/validation.ts';
import {
  buildAdmissionDetailPayloadD1,
  generateUniqueApplicationNumberD1,
  getUserDashboardByIdD1,
  recordAuditLogD1,
} from '../d1/ams-service.ts';
import {
  d1All,
  d1First,
  d1Run,
  nowIso,
  randomId,
  sqlBool,
  sqlFixed,
} from '../d1/client.ts';
import {
  approveAdmissionWorkflowD1,
  notifyApplicantD1,
} from '../d1/workflows.ts';
import { storeWorkerR2Document, readWorkerR2Document } from '../worker-storage.ts';
import { isProductionEnv, resolveRequestOrigin, type WorkerRouteEntry } from '../worker-router.ts';

function normalizeOptionalIso(val: string | null | undefined): string | null {
  if (!val || !val.trim()) return null;
  const ms = Date.parse(val);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export const workerAdmissionsRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/admissions/public/catalog',
    auth: 'none',
    handler: async (c) => {
      const isProduction = isProductionEnv(c.env);
      const [academy, courses, batches, feePlans] = await Promise.all([
        d1First<{ name: string; currency: string }>(
          'SELECT name, currency FROM academies ORDER BY created_at ASC LIMIT 1',
          [],
          c.db
        ),
        d1All<Record<string, unknown>>(
          `SELECT id, code, slug, title, track, category, duration_weeks, tuition_fee, show_tuition_publicly
           FROM courses
           WHERE is_published = 1 AND is_archived = 0 ${isProduction ? 'AND is_demo = 0' : ''}
           ORDER BY code ASC`,
          [],
          c.db
        ),
        d1All<Record<string, unknown>>(
          "SELECT id, code, name, course_id, start_date, end_date, status FROM cohorts WHERE status IN ('Planned', 'Active') ORDER BY start_date ASC",
          [],
          c.db
        ),
        d1All<Record<string, unknown>>(
          'SELECT id, code, name, description, installment_count, currency FROM fee_plans WHERE is_active = 1 ORDER BY installment_count ASC',
          [],
          c.db
        ),
      ]);

      return c.json(200, {
        academyName: academy?.name ?? 'IGS — InfoCom Global Services',
        currency: academy?.currency ?? 'INR',
        courses: courses.map((crs) => {
          const showTuition = sqlBool(crs.show_tuition_publicly);
          return {
            id: String(crs.id),
            code: String(crs.code),
            slug: crs.slug ? String(crs.slug) : String(crs.id),
            title: String(crs.title),
            track: String(crs.track),
            category: String(crs.category ?? 'Technical Bootcamp'),
            durationWeeks: Number(crs.duration_weeks ?? 8),
            showTuitionPublicly: showTuition,
            tuitionFee: showTuition ? sqlFixed(crs.tuition_fee) : null,
          };
        }),
        batches: batches.map((b) => ({
          id: String(b.id),
          code: String(b.code),
          name: String(b.name),
          courseId: String(b.course_id),
          startDate: String(b.start_date),
          endDate: String(b.end_date),
          status: String(b.status),
        })),
        feePlans: feePlans.map((fp) => ({
          id: String(fp.id),
          code: String(fp.code),
          name: String(fp.name),
          description: String(fp.description ?? ''),
          installmentCount: Number(fp.installment_count ?? 1),
          currency: String(fp.currency ?? 'INR'),
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/admissions/public',
    auth: 'none',
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createAdmissionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid admission details.',
        });
      }

      const input = parsed.data;
      const isProduction = isProductionEnv(c.env);
      const course = await d1First<Record<string, unknown>>(
        `SELECT * FROM courses WHERE id = ? AND is_published = 1 AND is_archived = 0 ${isProduction ? 'AND is_demo = 0' : ''} LIMIT 1`,
        [input.targetCourseId],
        c.db
      );
      if (!course) {
        return c.json(400, {
          error: 'Selected target course is unavailable for public admissions.',
        });
      }

      let targetBatch: Record<string, unknown> | null = null;
      if (input.targetBatchId) {
        targetBatch = await d1First<Record<string, unknown>>(
          'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
          [input.targetBatchId],
          c.db
        );
        if (!targetBatch || String(targetBatch.course_id) !== String(course.id)) {
          return c.json(400, {
            error: 'Selected preferred batch does not match the chosen course.',
          });
        }
      }

      // Pre-upload documents to R2 before creating admission records
      const storedDocs: Array<{
        documentType: string;
        title: string;
        category: string;
        cleanFileName: string;
        mimeType: string;
        sizeBytes: number;
        storageProvider: string;
        storageKey: string;
        checksumSha256: string;
      }> = [];

      for (const doc of input.documents ?? []) {
        try {
          const stored = await storeWorkerR2Document({
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            contentBase64: doc.contentBase64,
          });
          storedDocs.push({
            documentType: doc.documentType,
            title: doc.title,
            category: doc.category,
            ...stored,
          });
        } catch (err) {
          return c.json(400, {
            error: err instanceof Error ? err.message : 'Invalid attached document.',
          });
        }
      }

      const admissionId = randomId('adm', 8);
      const applicationNumber = await generateUniqueApplicationNumberD1(c.db);
      const now = nowIso();
      const initialStatus = input.status ?? 'Submitted';
      const preferredCohort =
        input.preferredCohort || (targetBatch ? String(targetBatch.name) : 'Upcoming Intake');

      await d1Run(
        `INSERT INTO admissions (
          id, application_number, applicant_name, applicant_email, phone, date_of_birth,
          gender, nationality, address, city, postal_code,
          guardian_name, guardian_relationship, guardian_phone, guardian_email,
          previous_qualification, previous_institution, graduation_year, previous_score,
          target_course_id, target_batch_id, fee_plan_id, preferred_cohort, status,
          notes, applicant_remarks, submitted_at, draft_saved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          admissionId,
          applicationNumber,
          input.applicantName || 'Draft Applicant',
          (input.applicantEmail || '').toLowerCase(),
          input.phone,
          normalizeOptionalIso(input.dateOfBirth),
          input.gender,
          input.nationality,
          input.address,
          input.city,
          input.postalCode,
          input.guardianName,
          input.guardianRelationship,
          input.guardianPhone,
          input.guardianEmail.toLowerCase(),
          input.previousQualification,
          input.previousInstitution,
          input.graduationYear,
          input.previousScore,
          String(course.id),
          targetBatch ? String(targetBatch.id) : null,
          input.feePlanId || null,
          preferredCohort,
          initialStatus,
          input.notes,
          input.applicantRemarks,
          now,
          initialStatus === 'Draft' ? now : null,
          now,
        ],
        c.db
      );

      for (const sdoc of storedDocs) {
        const fileAssetId = randomId('doc', 8);
        await d1Run(
          `INSERT INTO documents (
            id, owner_user_id, course_id, title, category, file_name, mime_type,
            size_bytes, content_base64, storage_provider, storage_key, checksum_sha256,
            uploaded_by_user_id, is_archived, created_at
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL, 0, ?)`,
          [
            fileAssetId,
            String(course.id),
            sdoc.title,
            sdoc.category,
            sdoc.cleanFileName,
            sdoc.mimeType,
            sdoc.sizeBytes,
            sdoc.storageProvider,
            sdoc.storageKey,
            sdoc.checksumSha256,
            now,
          ],
          c.db
        );
        await d1Run(
          `INSERT INTO admission_documents (
            id, application_id, file_asset_id, document_type, verified_status, is_latest, created_at
          ) VALUES (?, ?, ?, ?, 'Pending', 1, ?)`,
          [randomId('admd', 8), admissionId, fileAssetId, sdoc.documentType, now],
          c.db
        );
      }

      await d1Run(
        `INSERT INTO admission_status_histories (
          id, application_id, previous_status, new_status, reason, actor_name, actor_role, changed_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'applicant', ?)`,
        [
          randomId('ash', 8),
          admissionId,
          initialStatus,
          initialStatus === 'Draft'
            ? 'Public application saved as draft'
            : 'Public admission application submitted',
          input.applicantName || 'Public Applicant',
          now,
        ],
        c.db
      );

      if (initialStatus === 'Submitted' && input.applicantEmail) {
        await notifyApplicantD1(
          {
            applicationId: admissionId,
            applicantEmail: input.applicantEmail,
            courseId: String(course.id),
            title: `Application Received · ${applicationNumber}`,
            message: `We received your application (${applicationNumber}) for ${String(course.title)} (${preferredCohort}).`,
          },
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: {
            id: '',
            email: (input.applicantEmail || 'draft@applicant.local').toLowerCase(),
            role: 'student',
          },
          action: initialStatus === 'Draft' ? 'ADMISSION_DRAFT_SAVED' : 'ADMISSION_SUBMITTED',
          entityType: 'admission',
          entityId: admissionId,
          ipAddress: c.ipAddress,
          summary: `Public admission ${applicationNumber} (${initialStatus}) for ${String(course.code)}.`,
        },
        c.db
      );

      return c.json(201, { admissionId, applicationNumber, status: initialStatus });
    },
  },
  {
    method: 'GET',
    pattern: '/api/admissions',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      const statusFilter = (c.query.get('status') ?? '').trim();
      const courseFilter = (c.query.get('courseId') ?? '').trim();
      const search = (c.query.get('search') ?? '').trim().toLowerCase();

      const filtered = dashboard.admissions.filter((a) => {
        if (statusFilter && statusFilter !== 'All' && a.status !== statusFilter) return false;
        if (courseFilter && courseFilter !== 'All' && a.targetCourseId !== courseFilter) return false;
        if (search) {
          const hay =
            `${a.applicationNumber ?? ''} ${a.applicantName} ${a.applicantEmail} ${a.preferredCohort} ${a.phone}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

      return c.json(200, {
        admissions: filtered,
        feePlans: dashboard.feePlans ?? [],
        total: filtered.length,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/admissions/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const detail = await buildAdmissionDetailPayloadD1(c.params.id, c.db);
      if (!detail) {
        return c.json(404, { error: 'Admission application not found.' });
      }
      return c.json(200, detail);
    },
  },
  {
    method: 'POST',
    pattern: '/api/admissions',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = createAdmissionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid admission details.',
        });
      }

      const input = parsed.data;
      const course = await d1First<Record<string, unknown>>(
        'SELECT * FROM courses WHERE id = ? LIMIT 1',
        [input.targetCourseId],
        c.db
      );
      if (!course) {
        return c.json(400, { error: 'Selected target course was not found.' });
      }

      let targetBatch: Record<string, unknown> | null = null;
      if (input.targetBatchId) {
        targetBatch = await d1First<Record<string, unknown>>(
          'SELECT * FROM cohorts WHERE id = ? LIMIT 1',
          [input.targetBatchId],
          c.db
        );
        if (!targetBatch || String(targetBatch.course_id) !== String(course.id)) {
          return c.json(400, {
            error: 'Selected preferred batch does not belong to the chosen course.',
          });
        }
      }

      const storedDocs: Array<{
        documentType: string;
        title: string;
        category: string;
        cleanFileName: string;
        mimeType: string;
        sizeBytes: number;
        storageProvider: string;
        storageKey: string;
        checksumSha256: string;
      }> = [];

      for (const doc of input.documents ?? []) {
        try {
          const stored = await storeWorkerR2Document({
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            contentBase64: doc.contentBase64,
          });
          storedDocs.push({
            documentType: doc.documentType,
            title: doc.title,
            category: doc.category,
            ...stored,
          });
        } catch (err) {
          return c.json(400, {
            error: err instanceof Error ? err.message : 'Invalid attached document.',
          });
        }
      }

      const admissionId = randomId('adm', 8);
      const applicationNumber = await generateUniqueApplicationNumberD1(c.db);
      const now = nowIso();
      const initialStatus = input.status ?? 'Submitted';
      const preferredCohort =
        input.preferredCohort || (targetBatch ? String(targetBatch.name) : 'Upcoming Intake');

      await d1Run(
        `INSERT INTO admissions (
          id, application_number, applicant_name, applicant_email, phone, date_of_birth,
          gender, nationality, address, city, postal_code,
          guardian_name, guardian_relationship, guardian_phone, guardian_email,
          previous_qualification, previous_institution, graduation_year, previous_score,
          target_course_id, target_batch_id, fee_plan_id, preferred_cohort, status,
          notes, applicant_remarks, submitted_at, draft_saved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          admissionId,
          applicationNumber,
          input.applicantName || 'Draft Applicant',
          (input.applicantEmail || '').toLowerCase(),
          input.phone,
          normalizeOptionalIso(input.dateOfBirth),
          input.gender,
          input.nationality,
          input.address,
          input.city,
          input.postalCode,
          input.guardianName,
          input.guardianRelationship,
          input.guardianPhone,
          input.guardianEmail.toLowerCase(),
          input.previousQualification,
          input.previousInstitution,
          input.graduationYear,
          input.previousScore,
          String(course.id),
          targetBatch ? String(targetBatch.id) : null,
          input.feePlanId || null,
          preferredCohort,
          initialStatus,
          input.notes,
          input.applicantRemarks,
          now,
          initialStatus === 'Draft' ? now : null,
          now,
        ],
        c.db
      );

      for (const sdoc of storedDocs) {
        const fileAssetId = randomId('doc', 8);
        await d1Run(
          `INSERT INTO documents (
            id, owner_user_id, course_id, title, category, file_name, mime_type,
            size_bytes, content_base64, storage_provider, storage_key, checksum_sha256,
            uploaded_by_user_id, is_archived, created_at
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?)`,
          [
            fileAssetId,
            String(course.id),
            sdoc.title,
            sdoc.category,
            sdoc.cleanFileName,
            sdoc.mimeType,
            sdoc.sizeBytes,
            sdoc.storageProvider,
            sdoc.storageKey,
            sdoc.checksumSha256,
            c.authUser!.id,
            now,
          ],
          c.db
        );
        await d1Run(
          `INSERT INTO admission_documents (
            id, application_id, file_asset_id, document_type, verified_status, is_latest, created_at
          ) VALUES (?, ?, ?, ?, 'Pending', 1, ?)`,
          [randomId('admd', 8), admissionId, fileAssetId, sdoc.documentType, now],
          c.db
        );
      }

      await d1Run(
        `INSERT INTO admission_status_histories (
          id, application_id, previous_status, new_status, reason,
          actor_user_id, actor_name, actor_role, changed_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          randomId('ash', 8),
          admissionId,
          initialStatus,
          initialStatus === 'Draft'
            ? 'Application saved as draft by administrator'
            : 'Admission application created by administrator',
          c.authUser!.id,
          c.authUser!.name,
          c.authUser!.role,
          now,
        ],
        c.db
      );

      if (initialStatus === 'Submitted' && input.applicantEmail) {
        await notifyApplicantD1(
          {
            applicationId: admissionId,
            applicantEmail: input.applicantEmail,
            courseId: String(course.id),
            title: `Application Logged · ${applicationNumber}`,
            message: `Your admission application (${applicationNumber}) for ${String(course.title)} has been logged for review.`,
          },
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: initialStatus === 'Draft' ? 'ADMISSION_DRAFT_SAVED' : 'ADMISSION_CREATED',
          entityType: 'admission',
          entityId: admissionId,
          ipAddress: c.ipAddress,
          summary: `Administrator logged admission ${applicationNumber} (${initialStatus}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { admissionId, applicationNumber, status: initialStatus, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/admissions/:id',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = updateAdmissionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid admission update.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        'SELECT * FROM admissions WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Admission application not found.' });
      }

      const input = parsed.data;
      if (input.convertToEnrollment) {
        let batchId = input.targetBatchId || (existing.target_batch_id ? String(existing.target_batch_id) : '');
        const courseId = input.targetCourseId || String(existing.target_course_id);
        if (!batchId) {
          const fallbackBatch = await d1First<{ id: string }>(
            "SELECT id FROM cohorts WHERE course_id = ? AND status IN ('Active', 'Planned') ORDER BY start_date ASC LIMIT 1",
            [courseId],
            c.db
          );
          if (!fallbackBatch) {
            return c.json(400, {
              error: 'No eligible active or planned batch exists for this course.',
            });
          }
          batchId = fallbackBatch.id;
        }

        const approvalResult = await approveAdmissionWorkflowD1(
          {
            admissionId: String(existing.id),
            actor: c.authUser!,
            targetCourseId: courseId,
            targetBatchId: batchId,
            feePlanId: input.feePlanId,
            waitlistIfFull: input.waitlistIfFull,
            reviewRemarks: input.reviewRemarks,
            appUrl: resolveRequestOrigin(c.request, c.env),
          },
          c.db
        );

        const [detail, dashboard] = await Promise.all([
          buildAdmissionDetailPayloadD1(String(existing.id), c.db),
          getUserDashboardByIdD1(c.authUser!.id, c.db),
        ]);
        return c.json(200, { detail, dashboard, ...approvalResult });
      }

      const currentStatus = String(existing.status) as AdmissionStatus;
      if (input.status && input.status !== currentStatus) {
        if (input.status === 'Approved') {
          return c.json(400, {
            error:
              'Use the dedicated admission approval action to approve, allocate a batch, and enroll the applicant.',
          });
        }
        if (!isValidAdmissionTransition(currentStatus, input.status)) {
          return c.json(400, {
            error: `Cannot transition admission from ${currentStatus} to ${input.status}.`,
          });
        }
        if (input.status === 'Rejected' && !(input.rejectionReason || input.reason)?.trim()) {
          return c.json(400, {
            error: 'A rejection reason is required when rejecting an admission application.',
          });
        }
      }

      const now = nowIso();
      const targetCourseId = input.targetCourseId ?? String(existing.target_course_id);
      if (input.targetCourseId) {
        const crs = await d1First<{ id: string }>(
          'SELECT id FROM courses WHERE id = ? LIMIT 1',
          [input.targetCourseId],
          c.db
        );
        if (!crs) {
          return c.json(400, { error: 'Selected course does not exist.' });
        }
      }

      let resolvedPreferredCohort = input.preferredCohort;
      if (input.targetBatchId) {
        const batch = await d1First<{ id: string; name: string; course_id: string }>(
          'SELECT id, name, course_id FROM cohorts WHERE id = ? LIMIT 1',
          [input.targetBatchId],
          c.db
        );
        if (!batch || batch.course_id !== targetCourseId) {
          return c.json(400, {
            error: 'Selected batch does not match the chosen course.',
          });
        }
        if (!resolvedPreferredCohort) {
          resolvedPreferredCohort = batch.name;
        }
      }

      const nextStatus = input.status ?? currentStatus;
      const sets: string[] = ['updated_at = ?'];
      const vals: unknown[] = [now];
      const pushSet = (col: string, val: unknown) => {
        sets.push(`${col} = ?`);
        vals.push(val);
      };

      if (input.applicantName !== undefined) pushSet('applicant_name', input.applicantName);
      if (input.applicantEmail !== undefined)
        pushSet('applicant_email', input.applicantEmail.toLowerCase());
      if (input.phone !== undefined) pushSet('phone', input.phone);
      if (input.dateOfBirth !== undefined)
        pushSet('date_of_birth', normalizeOptionalIso(input.dateOfBirth));
      if (input.gender !== undefined) pushSet('gender', input.gender);
      if (input.nationality !== undefined) pushSet('nationality', input.nationality);
      if (input.address !== undefined) pushSet('address', input.address);
      if (input.city !== undefined) pushSet('city', input.city);
      if (input.postalCode !== undefined) pushSet('postal_code', input.postalCode);
      if (input.guardianName !== undefined) pushSet('guardian_name', input.guardianName);
      if (input.guardianRelationship !== undefined)
        pushSet('guardian_relationship', input.guardianRelationship);
      if (input.guardianPhone !== undefined) pushSet('guardian_phone', input.guardianPhone);
      if (input.guardianEmail !== undefined)
        pushSet('guardian_email', input.guardianEmail.toLowerCase());
      if (input.previousQualification !== undefined)
        pushSet('previous_qualification', input.previousQualification);
      if (input.previousInstitution !== undefined)
        pushSet('previous_institution', input.previousInstitution);
      if (input.graduationYear !== undefined) pushSet('graduation_year', input.graduationYear);
      if (input.previousScore !== undefined) pushSet('previous_score', input.previousScore);
      if (input.targetCourseId !== undefined) pushSet('target_course_id', input.targetCourseId);
      if (input.targetBatchId !== undefined) pushSet('target_batch_id', input.targetBatchId || null);
      if (input.feePlanId !== undefined) pushSet('fee_plan_id', input.feePlanId || null);
      if (resolvedPreferredCohort !== undefined) pushSet('preferred_cohort', resolvedPreferredCohort);
      if (input.notes !== undefined) pushSet('notes', input.notes);
      if (input.applicantRemarks !== undefined)
        pushSet('applicant_remarks', input.applicantRemarks);
      if (input.reviewRemarks !== undefined) pushSet('review_remarks', input.reviewRemarks);
      if (input.rejectionReason !== undefined) pushSet('rejection_reason', input.rejectionReason);

      if (input.status !== undefined && input.status !== currentStatus) {
        pushSet('status', input.status);
        pushSet('reviewed_by_user_id', c.authUser!.id);
        pushSet('reviewed_at', now);
        if (input.status === 'Draft') pushSet('draft_saved_at', now);
        if (currentStatus === 'Draft' && input.status === 'Submitted') {
          pushSet('submitted_at', now);
        }
      }

      vals.push(String(existing.id));
      await d1Run(`UPDATE admissions SET ${sets.join(', ')} WHERE id = ?`, vals, c.db);

      if (input.status !== undefined && input.status !== currentStatus) {
        const reason =
          input.reason?.trim() ||
          input.rejectionReason?.trim() ||
          input.reviewRemarks?.trim() ||
          `Status changed to ${input.status}`;

        await d1Run(
          `INSERT INTO admission_status_histories (
            id, application_id, previous_status, new_status, reason,
            actor_user_id, actor_name, actor_role, changed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId('ash', 8),
            String(existing.id),
            currentStatus,
            input.status,
            reason,
            c.authUser!.id,
            c.authUser!.name,
            c.authUser!.role,
            now,
          ],
          c.db
        );

        const recipientEmail =
          (input.applicantEmail ?? String(existing.applicant_email ?? '')).trim();
        if (
          recipientEmail &&
          (input.status === 'Under Review' ||
            input.status === 'Accepted' ||
            input.status === 'Rejected' ||
            input.status === 'Submitted')
        ) {
          const appNum = String(existing.application_number || existing.id);
          await notifyApplicantD1(
            {
              applicationId: String(existing.id),
              applicantEmail: recipientEmail,
              userId: existing.converted_user_id ? String(existing.converted_user_id) : null,
              courseId: targetCourseId,
              title: `Admission Update · ${appNum} (${input.status})`,
              message:
                input.status === 'Rejected'
                  ? `Your admission application (${appNum}) was not approved at this time. Reason: ${input.rejectionReason || reason}`
                  : `Your admission application (${appNum}) status is now "${input.status}". ${reason}`,
            },
            c.db
          );
        }
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action:
            input.status === 'Rejected'
              ? 'ADMISSION_REJECTED'
              : input.status !== undefined
                ? 'ADMISSION_STATUS_UPDATED'
                : 'ADMISSION_UPDATED',
          entityType: 'admission',
          entityId: String(existing.id),
          ipAddress: c.ipAddress,
          summary: `Updated application ${String(existing.application_number || existing.id)} (${nextStatus}).`,
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayloadD1(String(existing.id), c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { detail, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/admissions/:id/documents',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = uploadAdmissionDocumentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid document payload.',
        });
      }

      const app = await d1First<Record<string, unknown>>(
        'SELECT * FROM admissions WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!app) {
        return c.json(404, { error: 'Admission application not found.' });
      }

      const input = parsed.data;
      let stored;
      try {
        stored = await storeWorkerR2Document({
          fileName: input.fileName,
          mimeType: input.mimeType,
          contentBase64: input.contentBase64,
        });
      } catch (err) {
        return c.json(400, {
          error: err instanceof Error ? err.message : 'Unable to store document in R2.',
        });
      }

      const now = nowIso();
      const fileAssetId = randomId('doc', 8);
      const admDocId = randomId('admd', 8);

      await d1Run(
        `UPDATE admission_documents
         SET is_latest = 0
         WHERE application_id = ? AND document_type = ? AND is_latest = 1`,
        [String(app.id), input.documentType],
        c.db
      );

      await d1Run(
        `INSERT INTO documents (
          id, owner_user_id, course_id, title, category, file_name, mime_type,
          size_bytes, content_base64, storage_provider, storage_key, checksum_sha256,
          uploaded_by_user_id, is_archived, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?)`,
        [
          fileAssetId,
          app.converted_user_id ? String(app.converted_user_id) : null,
          String(app.target_course_id),
          input.title,
          input.category,
          stored.cleanFileName,
          stored.mimeType,
          stored.sizeBytes,
          stored.storageProvider,
          stored.storageKey,
          stored.checksumSha256,
          c.authUser!.id,
          now,
        ],
        c.db
      );

      await d1Run(
        `INSERT INTO admission_documents (
          id, application_id, file_asset_id, document_type, verified_status, is_latest, created_at
        ) VALUES (?, ?, ?, ?, 'Pending', 1, ?)`,
        [admDocId, String(app.id), fileAssetId, input.documentType, now],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ADMISSION_DOCUMENT_UPLOADED',
          entityType: 'admission_document',
          entityId: admDocId,
          ipAddress: c.ipAddress,
          summary: `Uploaded ${input.documentType} (${stored.cleanFileName}) for application ${String(app.application_number || app.id)}.`,
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayloadD1(String(app.id), c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(201, { documentId: admDocId, detail, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/admissions/:id/documents/:docId',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = verifyAdmissionDocumentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid document verification payload.',
        });
      }

      const existing = await d1First<Record<string, unknown>>(
        `SELECT ad.*, d.title AS doc_title, a.applicant_email, a.converted_user_id, a.target_course_id, a.application_number
         FROM admission_documents ad
         INNER JOIN documents d ON d.id = ad.file_asset_id
         INNER JOIN admissions a ON a.id = ad.application_id
         WHERE ad.id = ? AND ad.application_id = ?
         LIMIT 1`,
        [c.params.docId, c.params.id],
        c.db
      );
      if (!existing) {
        return c.json(404, { error: 'Admission document record not found.' });
      }

      const input = parsed.data;
      if (input.status === 'Rejected' && !input.verificationRemarks.trim()) {
        return c.json(400, {
          error: 'Verification remarks are required when rejecting an uploaded document.',
        });
      }

      const now = nowIso();
      await d1Run(
        `UPDATE admission_documents
         SET verified_status = ?, verification_remarks = ?, verified_by_user_id = ?,
             verified_by_name = ?, verified_at = ?
         WHERE id = ?`,
        [
          input.status,
          input.verificationRemarks,
          c.authUser!.id,
          c.authUser!.name,
          now,
          c.params.docId,
        ],
        c.db
      );

      if (input.status === 'Replacement Required' || input.status === 'Rejected') {
        const email = String(existing.applicant_email ?? '').trim();
        if (email) {
          await notifyApplicantD1(
            {
              applicationId: c.params.id,
              applicantEmail: email,
              userId: existing.converted_user_id ? String(existing.converted_user_id) : null,
              courseId: String(existing.target_course_id),
              title: `Document Verification · ${String(existing.document_type)}`,
              message: `Document "${String(existing.doc_title)}" was marked "${input.status}". Remarks: ${input.verificationRemarks || 'Please submit a clear replacement.'}`,
            },
            c.db
          );
        }
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'ADMISSION_DOCUMENT_VERIFIED',
          entityType: 'admission_document',
          entityId: c.params.docId,
          ipAddress: c.ipAddress,
          summary: `Marked ${String(existing.document_type)} as ${input.status} for application ${String(existing.application_number || c.params.id)}.`,
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayloadD1(c.params.id, c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { detail, dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/admissions/:id/documents/:docId/download',
    auth: 'required',
    handler: async (c) => {
      const doc = await d1First<Record<string, unknown>>(
        `SELECT ad.id, a.converted_user_id, d.file_name, d.mime_type, d.storage_provider, d.storage_key, d.content_base64
         FROM admission_documents ad
         INNER JOIN admissions a ON a.id = ad.application_id
         INNER JOIN documents d ON d.id = ad.file_asset_id
         WHERE ad.id = ? AND ad.application_id = ? AND d.is_archived = 0
         LIMIT 1`,
        [c.params.docId, c.params.id],
        c.db
      );
      if (!doc) {
        return c.json(404, { error: 'Admission document not found.' });
      }

      const actor = c.authUser!;
      if (
        actor.role !== 'admin' &&
        (!doc.converted_user_id || String(doc.converted_user_id) !== actor.id)
      ) {
        return c.json(403, { error: 'Access denied to this admission document.' });
      }

      const bytes = await readWorkerR2Document({
        storageProvider: String(doc.storage_provider),
        storageKey: doc.storage_key ? String(doc.storage_key) : null,
        contentBase64: doc.content_base64 ? String(doc.content_base64) : null,
      });

      const fileName = String(doc.file_name || 'document').replace(/"/g, '');
      return c.binary(200, bytes, {
        'Content-Type': String(doc.mime_type || 'application/octet-stream'),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/admissions/:id/approve',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = approveAdmissionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid admission approval request.',
        });
      }

      const result = await approveAdmissionWorkflowD1(
        {
          admissionId: c.params.id,
          actor: c.authUser!,
          targetCourseId: parsed.data.targetCourseId,
          targetBatchId: parsed.data.targetBatchId,
          feePlanId: parsed.data.feePlanId,
          waitlistIfFull: parsed.data.waitlistIfFull,
          reviewRemarks: parsed.data.reviewRemarks,
          issueInvoice: parsed.data.issueInvoice,
          appUrl: resolveRequestOrigin(c.request, c.env),
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayloadD1(c.params.id, c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);

      return c.json(200, {
        ...result,
        detail,
        dashboard,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/admissions/:id/activate-portal',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const adm = await d1First<Record<string, unknown>>(
        'SELECT * FROM admissions WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!adm) {
        return c.json(404, { error: 'Admission application not found.' });
      }
      if (!adm.converted_user_id) {
        return c.json(400, {
          error: 'Approve the application first to provision a student account before activating portal access.',
        });
      }

      const studentId = String(adm.converted_user_id);
      const now = nowIso();
      await d1Run(
        "UPDATE users SET status = 'active', updated_at = ? WHERE id = ?",
        [now, studentId],
        c.db
      );
      await d1Run(
        'UPDATE admissions SET portal_activated = 1, portal_activated_at = COALESCE(portal_activated_at, ?), updated_at = ? WHERE id = ?',
        [now, now, String(adm.id)],
        c.db
      );

      const appNum = String(adm.application_number || adm.id);
      await notifyApplicantD1(
        {
          applicationId: String(adm.id),
          applicantEmail: String(adm.applicant_email),
          userId: studentId,
          courseId: String(adm.target_course_id),
          title: `Student Portal Activated · ${appNum}`,
          message:
            'Your IGS — InfoCom Global Services Student Portal is now active. Sign in with your registered email and setup link to view your schedule, fees, and coursework.',
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'STUDENT_PORTAL_ACTIVATED',
          entityType: 'admission',
          entityId: String(adm.id),
          ipAddress: c.ipAddress,
          summary: `Activated student portal access for ${appNum}.`,
        },
        c.db
      );

      const [detail, dashboard] = await Promise.all([
        buildAdmissionDetailPayloadD1(String(adm.id), c.db),
        getUserDashboardByIdD1(c.authUser!.id, c.db),
      ]);
      return c.json(200, { portalActivated: true, detail, dashboard });
    },
  },
];
