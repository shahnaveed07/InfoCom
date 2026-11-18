import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  fromCents,
  toCents,
} from '../../src/shared/academic.ts';
import type { AttendanceStatus } from '../../src/shared/types.ts';
import {
  issueCertificateSchema,
  notificationPreferencesUpdateSchema,
  revokeCertificateSchema,
  uploadDocumentSchema,
} from '../../src/shared/validation.ts';
import {
  getActiveDocumentContentD1,
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
  sqlBool,
  sqlFixed,
  sqlJson,
} from '../d1/client.ts';
import {
  canInstructorAccessCourseD1,
  canInstructorAccessStudentD1,
  getInstructorScopeD1,
  hasInstructorPermissionD1,
} from '../d1/permissions.ts';
import {
  listAuditLogsPaginatedD1,
  listNotificationsPaginatedD1,
} from '../d1/repository.ts';
import { issueVerifiedCertificateD1 } from '../d1/workflows.ts';
import {
  extractWorkerEmailEnv,
  getD1WorkerTelemetry,
  isWorkerEmailConfigured,
  runD1SessionReminderSweep,
  verifyWorkerEmailTransport,
} from '../jobs/d1-worker.ts';
import { generateCertificatePdfBytes } from '../pdf/certificate-pdf.ts';
import { toCsv } from '../pdf/csv.ts';
import { generateTablePdfBytes } from '../pdf/report-pdf.ts';
import { resolveRequestOrigin, type WorkerRouteEntry } from '../worker-router.ts';
import { storeWorkerR2Document } from '../worker-storage.ts';

export const workerOpsReportsRoutes: WorkerRouteEntry[] = [
  {
    method: 'POST',
    pattern: '/api/certificates',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'certificates:issue',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow issuing certificates.',
          });
        }
      }

      const body = await c.readJson();
      const parsed = issueCertificateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid certificate request.',
        });
      }

      const result = await issueVerifiedCertificateD1(
        { actor: c.authUser!, ...parsed.data },
        c.db
      );
      if (!result.ok) {
        return c.json(result.status, { error: result.error });
      }

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { certificateCode: result.certificateCode, dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/certificates/:id/revoke',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = revokeCertificateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Revocation reason is required.',
        });
      }

      const cert = await d1First<Record<string, unknown>>(
        'SELECT * FROM certificates WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!cert) {
        return c.json(404, { error: 'Certificate not found.' });
      }

      const now = nowIso();
      await d1Batch(
        [
          d1Stmt(
            "UPDATE certificates SET status = 'Revoked', revoked_reason = ? WHERE id = ?",
            [parsed.data.reason, String(cert.id)],
            c.db
          ),
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, read, created_at)
             VALUES (?, ?, 'certificate', ?, ?, ?, 0, ?)`,
            [
              randomId('not', 8),
              String(cert.student_id),
              `Certificate Revoked · ${String(cert.certificate_code)}`,
              `Certificate ${String(cert.certificate_code)} has been revoked: ${parsed.data.reason}`,
              String(cert.course_id),
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
          action: 'CERTIFICATE_REVOKED',
          entityType: 'certificate',
          entityId: String(cert.id),
          summary: `Revoked certificate ${String(cert.certificate_code)}: ${parsed.data.reason}`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/certificates/:id/download',
    auth: 'required',
    handler: async (c) => {
      const cert = await d1First<Record<string, unknown>>(
        `SELECT cert.*, u.name AS student_name, u.student_code AS student_code,
                crs.code AS course_code, crs.title AS course_title,
                tmpl.title_format AS tmpl_title_format, tmpl.signatory_name AS tmpl_signatory_name,
                tmpl.signatory_title AS tmpl_signatory_title
         FROM certificates cert
         INNER JOIN users u ON u.id = cert.student_id
         INNER JOIN courses crs ON crs.id = cert.course_id
         LEFT JOIN certificate_templates tmpl ON tmpl.id = cert.template_id
         WHERE cert.id = ? LIMIT 1`,
        [c.params.id],
        c.db
      );
      if (!cert) {
        return c.json(404, { error: 'Certificate not found.' });
      }

      if (c.authUser!.role === 'student' && String(cert.student_id) !== c.authUser!.id) {
        return c.json(403, { error: "Access denied to another student's certificate." });
      }
      if (c.authUser!.role === 'instructor') {
        const assigned = await canInstructorAccessCourseD1(
          c.authUser!.id,
          String(cert.course_id),
          c.db
        );
        if (!assigned) {
          return c.json(403, {
            error: 'Access denied to certificate outside your assigned courses.',
          });
        }
      }

      const academy = await d1First<{
        name: string;
        legal_name: string;
        address: string;
        logo_data_url: string;
      }>(
        'SELECT name, legal_name, address, logo_data_url FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );

      const academyName = academy?.name || 'IGS — InfoCom Global Services';
      const academySubtitle = academy?.legal_name || 'Computer Institute · Downtown Sopore';
      const academyAddress =
        academy?.address ||
        'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

      const certCode = String(cert.certificate_code);
      const origin = resolveRequestOrigin(c.request, c.env);
      const verifyUrl = `${origin}/verify-certificate?verifyCert=${encodeURIComponent(certCode)}`;

      const pdfBytes = await generateCertificatePdfBytes({
        certificateCode: certCode,
        verificationHash: String(cert.verification_hash),
        verifyUrl,
        academyName,
        academySubtitle,
        academyAddress,
        titleFormat: cert.tmpl_title_format
          ? String(cert.tmpl_title_format)
          : 'VERIFIED CERTIFICATE OF COMPLETION',
        studentName: String(cert.student_name || 'Student'),
        studentCode: cert.student_code ? String(cert.student_code) : null,
        courseCode: cert.course_code ? String(cert.course_code) : null,
        courseTitle: String(cert.course_title_snapshot || cert.course_title || ''),
        finalScore: sqlFixed(cert.final_score),
        letterGrade: String(cert.letter_grade),
        attendanceRate: Number(cert.attendance_rate),
        status: String(cert.status),
        revokedReason: cert.revoked_reason ? String(cert.revoked_reason) : null,
        signatoryName: cert.tmpl_signatory_name
          ? String(cert.tmpl_signatory_name)
          : String(cert.issued_by_name),
        signatoryTitle: cert.tmpl_signatory_title ? String(cert.tmpl_signatory_title) : academyName,
        issuedAtIso: String(cert.issued_at),
        customLogoDataUrl: academy?.logo_data_url || null,
      });

      return c.binary(200, pdfBytes, {
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${certCode.replace(/["\r\n]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/notifications',
    auth: 'required',
    handler: async (c) => {
      const result = await listNotificationsPaginatedD1(
        {
          userId: c.authUser!.id,
          page: Number(c.query.get('page')) || 1,
          pageSize: Number(c.query.get('pageSize')) || 25,
          unreadOnly: c.query.get('unreadOnly') === 'true',
        },
        c.db
      );
      return c.json(200, result);
    },
  },
  {
    method: 'POST',
    pattern: '/api/notifications/run-reminders',
    auth: 'required',
    roles: ['admin', 'instructor'],
    handler: async (c) => {
      const createdCount = await runD1SessionReminderSweep(c.db);
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { createdCount, dashboard });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/notifications/:id/read',
    auth: 'required',
    handler: async (c) => {
      const notif = await d1First<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM notifications WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!notif) {
        return c.json(404, { error: 'Notification not found.' });
      }
      if (notif.user_id !== c.authUser!.id) {
        return c.json(403, { error: 'Access denied.' });
      }

      await d1Run('UPDATE notifications SET read = 1 WHERE id = ?', [notif.id], c.db);
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'POST',
    pattern: '/api/notifications/read-all',
    auth: 'required',
    handler: async (c) => {
      await d1Run('UPDATE notifications SET read = 1 WHERE user_id = ?', [c.authUser!.id], c.db);
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/notifications/preferences',
    auth: 'required',
    handler: async (c) => {
      const saved = await d1All<{ channel: string; kind: string; enabled: number }>(
        'SELECT channel, kind, enabled FROM notification_preferences WHERE user_id = ?',
        [c.authUser!.id],
        c.db
      );
      const defaultKinds = [
        'all',
        'attendance',
        'reminder',
        'grade',
        'enrollment',
        'finance',
        'certificate',
      ];
      const channels: Array<'in_app' | 'email'> = ['in_app', 'email'];
      const savedMap = new Map(saved.map((s) => [`${s.channel}:${s.kind}`, sqlBool(s.enabled)]));

      const preferences = channels.flatMap((channel) =>
        defaultKinds.map((kind) => ({
          channel,
          kind,
          enabled: savedMap.get(`${channel}:${kind}`) ?? true,
        }))
      );
      return c.json(200, { preferences });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/notifications/preferences',
    auth: 'required',
    handler: async (c) => {
      const body = await c.readJson();
      const parsed = notificationPreferencesUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid preference settings.',
        });
      }

      const now = nowIso();
      const stmts: D1PreparedStatementLike[] = parsed.data.preferences.map((pref) =>
        d1Stmt(
          `INSERT INTO notification_preferences (id, user_id, channel, kind, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, channel, kind) DO UPDATE SET
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
          [randomId('np', 8), c.authUser!.id, pref.channel, pref.kind, pref.enabled ? 1 : 0, now],
          c.db
        )
      );
      if (stmts.length > 0) {
        await d1Batch(stmts, c.db);
      }
      return c.json(200, { ok: true, preferences: parsed.data.preferences });
    },
  },
  {
    method: 'POST',
    pattern: '/api/documents',
    auth: 'required',
    handler: async (c) => {
      const body = await c.readJson(4 * 1024 * 1024);
      const parsed = uploadDocumentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid document payload.',
        });
      }

      const input = parsed.data;
      const isStudent = c.authUser!.role === 'student';
      const studentAllowedCategories = new Set(['ID Verification', 'Assignment', 'Other']);
      if (isStudent && !studentAllowedCategories.has(input.category)) {
        return c.json(403, {
          error: 'Students may only upload ID Verification, Assignment, or Other documents.',
        });
      }

      const ownerUserId = isStudent ? c.authUser!.id : input.ownerUserId || c.authUser!.id;

      if (c.authUser!.role === 'instructor') {
        const permitted = await hasInstructorPermissionD1(
          c.authUser!,
          'documents:upload',
          c.db
        );
        if (!permitted) {
          return c.json(403, {
            error: 'Your instructor permissions do not allow uploading documents.',
          });
        }
        if (input.category === 'Receipt') {
          return c.json(403, {
            error: 'Instructors cannot upload financial receipt documents.',
          });
        }
        if (input.courseId) {
          const allowedCourse = await canInstructorAccessCourseD1(
            c.authUser!.id,
            input.courseId,
            c.db
          );
          if (!allowedCourse) {
            return c.json(403, {
              error: 'You are not assigned to upload documents for this course.',
            });
          }
        }
        if (ownerUserId !== c.authUser!.id) {
          const allowedStudent = await canInstructorAccessStudentD1(
            c.authUser!.id,
            ownerUserId,
            c.db
          );
          if (!allowedStudent) {
            return c.json(403, {
              error: 'You cannot upload documents for a student outside your assigned courses.',
            });
          }
        }
      }

      const ownerRow = await d1First<{ id: string }>(
        'SELECT id FROM users WHERE id = ? LIMIT 1',
        [ownerUserId],
        c.db
      );
      if (!ownerRow) {
        return c.json(400, { error: 'Document owner account not found.' });
      }

      let stored;
      try {
        stored = await storeWorkerR2Document({
          fileName: input.fileName,
          mimeType: input.mimeType,
          contentBase64: input.contentBase64,
        });
      } catch (storageErr) {
        return c.json(400, {
          error: storageErr instanceof Error ? storageErr.message : 'Invalid file attachment.',
        });
      }

      const docId = randomId('doc', 8);
      await d1Run(
        `INSERT INTO documents
           (id, owner_user_id, course_id, title, category, file_name, mime_type, size_bytes,
            content_base64, storage_provider, storage_key, checksum_sha256, uploaded_by_user_id, is_archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?)`,
        [
          docId,
          ownerUserId,
          input.courseId || null,
          input.title,
          input.category,
          stored.cleanFileName,
          stored.mimeType,
          stored.sizeBytes,
          stored.storageProvider,
          stored.storageKey,
          stored.checksumSha256,
          c.authUser!.id,
          nowIso(),
        ],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DOCUMENT_UPLOADED',
          entityType: 'document',
          entityId: docId,
          summary: `Uploaded "${input.title}" (${input.category}, ${stored.sizeBytes} bytes, ${stored.storageProvider}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(201, { documentId: docId, dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/documents/:id/download',
    auth: 'required',
    handler: async (c) => {
      const result = await getActiveDocumentContentD1(c.params.id, c.authUser!, c.db);
      if (!result) {
        return c.json(404, { error: 'Document not found or archived.' });
      }
      if (result === 'FORBIDDEN') {
        return c.json(403, { error: 'You do not have access to download this document.' });
      }

      return c.binary(200, result.bytes, {
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': result.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${result.fileName.replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'private, no-store',
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/documents/:id/archive',
    auth: 'required',
    handler: async (c) => {
      const doc = await d1First<Record<string, unknown>>(
        'SELECT * FROM documents WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!doc) {
        return c.json(404, { error: 'Document not found.' });
      }

      const canArchive =
        c.authUser!.role === 'admin' ||
        String(doc.owner_user_id ?? '') === c.authUser!.id ||
        String(doc.uploaded_by_user_id ?? '') === c.authUser!.id;
      if (!canArchive) {
        return c.json(403, {
          error: 'Only an administrator or document owner can archive this record.',
        });
      }

      await d1Run('UPDATE documents SET is_archived = 1 WHERE id = ?', [String(doc.id)], c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'DOCUMENT_ARCHIVED',
          entityType: 'document',
          entityId: String(doc.id),
          summary: `Archived document "${String(doc.title)}" (${String(doc.file_name)}).`,
        },
        c.db
      );

      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, { dashboard });
    },
  },
  {
    method: 'GET',
    pattern: '/api/audit-logs',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const result = await listAuditLogsPaginatedD1(
        {
          page: Number(c.query.get('page')) || 1,
          pageSize: Number(c.query.get('pageSize')) || 25,
          action: (c.query.get('action') ?? '').trim() || undefined,
          entityType: (c.query.get('entityType') ?? '').trim() || undefined,
        },
        c.db
      );
      return c.json(200, result);
    },
  },
  {
    method: 'GET',
    pattern: '/api/admin/email-delivery',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const verify = c.query.get('verify') === 'true';
      const emailEnv = extractWorkerEmailEnv(c.env);

      const [verification, groupedCounts, recentDeliveries, recentJobs, workerTelemetry] =
        await Promise.all([
          verify ? verifyWorkerEmailTransport(emailEnv) : Promise.resolve(null),
          d1All<{ status: string; cnt: number }>(
            "SELECT status, COUNT(*) AS cnt FROM delivery_logs WHERE channel = 'email' GROUP BY status",
            [],
            c.db
          ),
          d1All<Record<string, unknown>>(
            `SELECT id, notification_id, user_id, application_id, recipient, status, provider_message_id, error_message, sent_at
             FROM delivery_logs
             WHERE channel = 'email'
             ORDER BY sent_at DESC LIMIT 25`,
            [],
            c.db
          ),
          d1All<Record<string, unknown>>(
            `SELECT id, status, attempts, max_attempts, last_error, duration_ms, run_after, completed_at, created_at
             FROM background_jobs
             WHERE job_type = 'notification_email'
             ORDER BY created_at DESC LIMIT 20`,
            [],
            c.db
          ),
          getD1WorkerTelemetry(c.db),
        ]);

      const countsByStatus: Record<string, number> = {
        Queued: 0,
        Delivered: 0,
        Skipped: 0,
        Failed: 0,
      };
      for (const row of groupedCounts) {
        countsByStatus[row.status] = Number(row.cnt);
      }

      return c.json(200, {
        smtpConfigured: isWorkerEmailConfigured(emailEnv),
        verification,
        countsByStatus,
        workerTelemetry,
        recentDeliveries: recentDeliveries.map((d) => ({
          id: String(d.id),
          notificationId: d.notification_id ? String(d.notification_id) : null,
          userId: d.user_id ? String(d.user_id) : null,
          applicationId: d.application_id ? String(d.application_id) : null,
          recipient: String(d.recipient),
          status: String(d.status),
          providerMessageId: d.provider_message_id ? String(d.provider_message_id) : null,
          errorMessage: d.error_message ? String(d.error_message) : null,
          sentAt: String(d.sent_at),
        })),
        recentJobs: recentJobs.map((j) => ({
          id: String(j.id),
          status: String(j.status),
          attempts: Number(j.attempts),
          maxAttempts: Number(j.max_attempts),
          lastError: j.last_error ? String(j.last_error) : null,
          durationMs: j.duration_ms !== null ? Number(j.duration_ms) : null,
          runAfter: String(j.run_after),
          completedAt: j.completed_at ? String(j.completed_at) : null,
          createdAt: String(j.created_at),
        })),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/admin/worker-status',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const telemetry = await getD1WorkerTelemetry(c.db);
      return c.json(200, telemetry);
    },
  },
  {
    method: 'GET',
    pattern: '/api/reports/:kind',
    auth: 'required',
    handler: async (c) => {
      const actor = c.authUser!;
      const kind = String(c.params.kind || '').trim().toLowerCase();
      const format = String(c.query.get('format') || 'json').trim().toLowerCase();

      if (!['csv', 'pdf', 'json'].includes(format)) {
        return c.json(400, { error: 'Unsupported report format. Use csv, pdf, or json.' });
      }

      const academy = await d1First<{ name: string; address: string; currency: string }>(
        'SELECT name, address, currency FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      const academyName = academy?.name || 'IGS — InfoCom Global Services';
      const academyAddress =
        academy?.address ||
        'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

      let title = '';
      let subtitle = '';
      let headers: string[] = [];
      let rows: Array<Array<string | number>> = [];

      if (kind === 'academic-progress') {
        title = 'Academic Progress Report';
        subtitle = `Scoped for ${actor.name} (${actor.role.toUpperCase()})`;

        let scopedCourseIds: string[] | undefined;
        if (actor.role === 'instructor') {
          const scope = await getInstructorScopeD1(actor.id, c.db);
          scopedCourseIds = Array.from(scope.courseIds);
        }

        let enrRows: Array<Record<string, unknown>> = [];
        if (actor.role === 'student') {
          enrRows = await d1All<Record<string, unknown>>(
            `SELECT e.*, u.name AS student_name, u.student_code AS student_code,
                    crs.code AS course_code, crs.title AS course_title
             FROM enrollments e
             INNER JOIN users u ON u.id = e.student_id
             INNER JOIN courses crs ON crs.id = e.course_id
             WHERE e.student_id = ?
             ORDER BY e.enrolled_at DESC`,
            [actor.id],
            c.db
          );
        } else if (scopedCourseIds) {
          if (scopedCourseIds.length > 0) {
            enrRows = await d1All<Record<string, unknown>>(
              `SELECT e.*, u.name AS student_name, u.student_code AS student_code,
                      crs.code AS course_code, crs.title AS course_title
               FROM enrollments e
               INNER JOIN users u ON u.id = e.student_id
               INNER JOIN courses crs ON crs.id = e.course_id
               WHERE e.course_id IN (${inPlaceholders(scopedCourseIds.length)})
               ORDER BY e.enrolled_at DESC`,
              scopedCourseIds,
              c.db
            );
          }
        } else {
          enrRows = await d1All<Record<string, unknown>>(
            `SELECT e.*, u.name AS student_name, u.student_code AS student_code,
                    crs.code AS course_code, crs.title AS course_title
             FROM enrollments e
             INNER JOIN users u ON u.id = e.student_id
             INNER JOIN courses crs ON crs.id = e.course_id
             ORDER BY e.enrolled_at DESC`,
            [],
            c.db
          );
        }

        const [modRows, gradeRows, attRows] = await Promise.all([
          d1All<{ id: string; course_id: string }>('SELECT id, course_id FROM course_modules', [], c.db),
          d1All<{
            student_id: string;
            course_id: string;
            score: number;
            max_score: number;
            assessment_weight: number | null;
          }>(
            `SELECT mg.student_id, mg.course_id, mg.score, mg.max_score, a.weight AS assessment_weight
             FROM module_grades mg
             LEFT JOIN assessments a ON a.id = mg.assessment_id
             ${actor.role === 'student' ? 'WHERE mg.student_id = ?' : ''}`,
            actor.role === 'student' ? [actor.id] : [],
            c.db
          ),
          d1All<Record<string, unknown>>(
            `SELECT * FROM attendance_records ${actor.role === 'student' ? 'WHERE student_id = ?' : ''}`,
            actor.role === 'student' ? [actor.id] : [],
            c.db
          ),
        ]);

        const modCountByCourse = new Map<string, number>();
        for (const m of modRows) {
          modCountByCourse.set(m.course_id, (modCountByCourse.get(m.course_id) ?? 0) + 1);
        }

        headers = [
          'Student ID',
          'Student Name',
          'Course',
          'Batch',
          'Status',
          'Completion %',
          'Weighted Score %',
          'Letter Grade',
          'Attendance %',
        ];

        rows = enrRows.map((e) => {
          const cid = String(e.course_id);
          const sid = String(e.student_id);
          const completed = sqlJson<string[]>(e.completed_module_ids, []);
          const completionPct = calculateCourseCompletion(
            completed,
            modCountByCourse.get(cid) ?? 0
          );
          const enrGrades = gradeRows
            .filter((g) => g.student_id === sid && g.course_id === cid)
            .map((g) => ({
              score: Math.round((Number(g.score) / Math.max(1, Number(g.max_score))) * 1000) / 10,
              weight: Number(g.assessment_weight ?? 25),
            }));
          const weighted = calculateWeightedAverage(enrGrades);
          const letter = calculateLetterGrade(weighted);
          const enrAtt = attRows
            .filter((a) => String(a.student_id) === sid && String(a.course_id) === cid)
            .map((a) => ({
              id: String(a.id),
              sessionId: String(a.session_id),
              courseId: String(a.course_id),
              studentId: String(a.student_id),
              status: String(a.status) as AttendanceStatus,
              note: String(a.note || ''),
              updatedAt: String(a.updated_at),
              updatedBy: String(a.updated_by),
            }));
          const attRate = calculateAttendanceStats(enrAtt).rate;

          return [
            e.student_code ? String(e.student_code) : sid,
            String(e.student_name),
            `${String(e.course_code)} ${String(e.course_title)}`,
            String(e.cohort),
            String(e.status),
            completionPct,
            weighted !== null ? weighted : 'N/A',
            letter,
            attRate,
          ];
        });
      } else if (kind === 'attendance-summary') {
        if (actor.role === 'student') {
          return c.json(403, {
            error: 'Attendance summary export is restricted to faculty and administrators.',
          });
        }
        title = 'Attendance Summary Report';
        subtitle = `Course & Batch Attendance Metrics (${actor.role.toUpperCase()})`;

        let courseRows: Array<{ id: string; code: string; title: string }> = [];
        if (actor.role === 'instructor') {
          const scope = await getInstructorScopeD1(actor.id, c.db);
          const ids = Array.from(scope.courseIds);
          if (ids.length > 0) {
            courseRows = await d1All<{ id: string; code: string; title: string }>(
              `SELECT id, code, title FROM courses WHERE id IN (${inPlaceholders(ids.length)}) ORDER BY code ASC`,
              ids,
              c.db
            );
          }
        } else {
          courseRows = await d1All<{ id: string; code: string; title: string }>(
            'SELECT id, code, title FROM courses ORDER BY code ASC',
            [],
            c.db
          );
        }

        const [sessions, attendanceRecords] = await Promise.all([
          d1All<{ id: string; course_id: string }>('SELECT id, course_id FROM class_sessions', [], c.db),
          d1All<Record<string, unknown>>('SELECT * FROM attendance_records', [], c.db),
        ]);

        headers = [
          'Course Code',
          'Course Title',
          'Sessions Count',
          'Marked Records',
          'Present',
          'Late',
          'Absent',
          'Excused',
          'Attendance Rate %',
        ];

        rows = courseRows.map((crs) => {
          const sessCount = sessions.filter((s) => s.course_id === crs.id).length;
          const recs = attendanceRecords
            .filter((a) => String(a.course_id) === crs.id)
            .map((a) => ({
              id: String(a.id),
              sessionId: String(a.session_id),
              courseId: String(a.course_id),
              studentId: String(a.student_id),
              status: String(a.status) as AttendanceStatus,
              note: String(a.note || ''),
              updatedAt: String(a.updated_at),
              updatedBy: String(a.updated_by),
            }));
          const stats = calculateAttendanceStats(recs);
          return [
            crs.code,
            crs.title,
            sessCount,
            stats.total,
            stats.present,
            stats.late,
            stats.absent,
            stats.excused,
            stats.rate,
          ];
        });
      } else if (kind === 'financial-collections') {
        if (actor.role !== 'admin') {
          return c.json(403, {
            error: 'Financial collections reports are restricted to administrators.',
          });
        }
        title = 'Financial Collections & Fee Ledger Report';
        subtitle = `Currency: ${academy?.currency || 'INR'}`;

        const invoices = await d1All<Record<string, unknown>>(
          `SELECT fi.*, u.name AS student_name, u.student_code AS student_code,
                  crs.code AS course_code, crs.title AS course_title
           FROM fee_invoices fi
           INNER JOIN users u ON u.id = fi.student_id
           INNER JOIN courses crs ON crs.id = fi.course_id
           WHERE fi.is_archived = 0
           ORDER BY fi.created_at DESC`,
          [],
          c.db
        );

        headers = [
          'Invoice #',
          'Student ID',
          'Student Name',
          'Course',
          'Status',
          'Amount Due',
          'Amount Paid',
          'Balance',
          'Due Date',
        ];

        rows = invoices.map((inv) => {
          const dueStr = sqlFixed(inv.amount_due);
          const paidStr = sqlFixed(inv.amount_paid);
          const dueCents = toCents(dueStr);
          const paidCents = toCents(paidStr);
          const balance =
            String(inv.status) === 'Voided'
              ? '0.00'
              : fromCents(Math.max(0, dueCents - paidCents));
          return [
            String(inv.invoice_number),
            inv.student_code ? String(inv.student_code) : String(inv.student_id),
            String(inv.student_name),
            `${String(inv.course_code)} ${String(inv.course_title)}`,
            String(inv.status),
            dueStr,
            paidStr,
            balance,
            String(inv.due_date).slice(0, 10),
          ];
        });
      } else if (kind === 'admissions-funnel') {
        if (actor.role !== 'admin') {
          return c.json(403, {
            error: 'Admissions funnel reports are restricted to administrators.',
          });
        }
        title = 'Admissions Funnel Report';
        subtitle = 'Application Pipeline & Conversion Status';

        const apps = await d1All<Record<string, unknown>>(
          `SELECT a.*, crs.code AS course_code, crs.title AS course_title
           FROM admissions a
           INNER JOIN courses crs ON crs.id = a.target_course_id
           ORDER BY a.submitted_at DESC`,
          [],
          c.db
        );

        headers = [
          'Application #',
          'Applicant Name',
          'Email',
          'Phone',
          'Target Course',
          'Preferred Batch',
          'Status',
          'Submitted Date',
        ];

        rows = apps.map((a) => [
          a.application_number ? String(a.application_number) : String(a.id),
          String(a.applicant_name),
          String(a.applicant_email),
          String(a.phone || ''),
          `${String(a.course_code)} ${String(a.course_title)}`,
          String(a.preferred_cohort),
          String(a.status),
          String(a.submitted_at).slice(0, 10),
        ]);
      } else {
        return c.json(404, { error: `Unknown report type: ${kind}` });
      }

      const safeFileBase = `igs-${kind}-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'csv') {
        const csv = toCsv(headers, rows);
        return c.binary(200, csv, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeFileBase}.csv"`,
          'X-Content-Type-Options': 'nosniff',
        });
      }

      if (format === 'pdf') {
        const pdfBytes = await generateTablePdfBytes({
          academyName,
          academyAddress,
          title,
          subtitle,
          headers,
          rows,
        });
        return c.binary(200, pdfBytes, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFileBase}.pdf"`,
          'X-Content-Type-Options': 'nosniff',
        });
      }

      return c.json(200, { title, subtitle, headers, rows });
    },
  },
];
