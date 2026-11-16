import crypto from 'node:crypto';
import os from 'node:os';
import type { Prisma } from '@prisma/client';
import { findUpcomingSessionsNeedingReminders, formatCents, toCents } from '../../src/shared/academic.ts';
import { getPrismaPool, prisma } from '../db/prisma.ts';
import { sendTransactionalEmail } from '../email/mailer.ts';

export type BackgroundJobType = 'notification_email' | 'session_reminders' | 'fee_reminders';

type PrismaDbClient = Prisma.TransactionClient | typeof prisma;

export const DEFAULT_WORKER_LEASE_MS = Math.max(
  15_000,
  Number(process.env.WORKER_LEASE_MS) || 120_000
);

const DEFAULT_WORKER_ID = `${os.hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 6)}`;

const SESSION_REMINDER_LOCK_KEY = 420101;
const FEE_REMINDER_LOCK_KEY = 420102;

export interface NotificationEmailPayload {
  deliveryLogId?: string;
  notificationId?: string | null;
  userId?: string | null;
  applicationId?: string | null;
  kind?: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bypassPreferences?: boolean;
  redactSensitive?: boolean;
}

export interface ClaimedJobRow {
  id: string;
  jobType: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
}

export interface StaleRecoveryReport {
  recoveredPending: number;
  failedExhausted: number;
}

export interface WorkerTelemetry {
  workerId: string;
  leaseMs: number;
  countsByStatus: Record<'Pending' | 'Processing' | 'Completed' | 'Failed', number>;
  staleProcessingCount: number;
  recentFailures: Array<{
    id: string;
    jobType: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    durationMs: number | null;
    updatedAt: string;
  }>;
}

export async function enqueueJob(
  jobType: BackgroundJobType,
  payload: Record<string, unknown>,
  options?: {
    runAfter?: Date;
    maxAttempts?: number;
    dedupeKey?: string | null;
    db?: PrismaDbClient;
  }
) {
  const db = options?.db ?? prisma;
  const dedupeKey = options?.dedupeKey?.trim() || null;

  if (dedupeKey) {
    try {
      return await db.backgroundJob.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          id: `job-${crypto.randomUUID()}`,
          jobType,
          dedupeKey,
          payload: payload as Prisma.InputJsonValue,
          status: 'Pending',
          attempts: 0,
          maxAttempts: options?.maxAttempts ?? 3,
          runAfter: options?.runAfter ?? new Date(),
        },
      });
    } catch (err) {
      const existing = await db.backgroundJob.findUnique({ where: { dedupeKey } });
      if (existing) return existing;
      throw err;
    }
  }

  return db.backgroundJob.create({
    data: {
      id: `job-${crypto.randomUUID()}`,
      jobType,
      dedupeKey: null,
      payload: payload as Prisma.InputJsonValue,
      status: 'Pending',
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      runAfter: options?.runAfter ?? new Date(),
    },
  });
}

export async function queueTransactionalEmail(
  db: PrismaDbClient,
  params: {
    notificationId?: string | null;
    userId?: string | null;
    applicationId?: string | null;
    kind?: string;
    recipientEmail: string;
    subject: string;
    bodyText: string;
    bypassPreferences?: boolean;
    redactSensitive?: boolean;
    maxAttempts?: number;
    dedupeKey?: string | null;
  }
): Promise<{ deliveryLogId: string; jobId: string } | null> {
  const recipient = params.recipientEmail.trim().toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    return null;
  }

  const dedupeKey = params.dedupeKey?.trim() || null;
  if (dedupeKey) {
    const existingJob = await db.backgroundJob.findUnique({
      where: { dedupeKey },
      select: { id: true, payload: true },
    });
    if (existingJob) {
      const p = (existingJob.payload ?? {}) as Record<string, unknown>;
      return {
        deliveryLogId: typeof p.deliveryLogId === 'string' ? p.deliveryLogId : '',
        jobId: existingJob.id,
      };
    }
  }

  const deliveryLogId = `dlog-${crypto.randomUUID()}`;
  await db.deliveryLog.create({
    data: {
      id: deliveryLogId,
      notificationId: params.notificationId ?? null,
      userId: params.userId ?? null,
      applicationId: params.applicationId ?? null,
      channel: 'email',
      recipient,
      status: 'Queued',
    },
  });

  const job = await enqueueJob(
    'notification_email',
    {
      deliveryLogId,
      notificationId: params.notificationId ?? null,
      userId: params.userId ?? null,
      applicationId: params.applicationId ?? null,
      kind: params.kind ?? 'general',
      recipientEmail: recipient,
      subject: params.subject,
      bodyText: params.bodyText,
      bypassPreferences: Boolean(params.bypassPreferences),
      redactSensitive: Boolean(params.redactSensitive),
    },
    { db, maxAttempts: params.maxAttempts ?? 3, dedupeKey }
  );

  return { deliveryLogId, jobId: job.id };
}

async function isEmailChannelEnabledForUser(
  userId: string | null | undefined,
  kind: string | undefined,
  bypassPreferences?: boolean
): Promise<boolean> {
  if (bypassPreferences || !userId) return true;
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId, channel: 'email' },
  });
  if (prefs.length === 0) return true;
  if (kind) {
    const exact = prefs.find((p) => p.kind === kind);
    if (exact) return exact.enabled;
  }
  const allPref = prefs.find((p) => p.kind === 'all');
  return allPref ? allPref.enabled : true;
}

async function handleNotificationEmailJob(payload: NotificationEmailPayload) {
  const emailEnabled = await isEmailChannelEnabledForUser(
    payload.userId,
    payload.kind,
    payload.bypassPreferences
  );
  let resultStatus: 'Delivered' | 'Skipped' | 'Failed' = 'Skipped';
  let messageId: string | null = null;
  let errorMessage: string | null = null;

  if (!emailEnabled) {
    resultStatus = 'Skipped';
    errorMessage = 'Recipient opted out of email notifications for this category.';
  } else {
    const res = await sendTransactionalEmail({
      to: payload.recipientEmail,
      subject: payload.subject,
      text: payload.bodyText,
    });
    resultStatus = res.status;
    messageId = res.messageId;
    errorMessage = res.reason;
  }

  if (payload.deliveryLogId) {
    await prisma.deliveryLog.updateMany({
      where: { id: payload.deliveryLogId },
      data: {
        status: resultStatus,
        providerMessageId: messageId,
        errorMessage,
        sentAt: new Date(),
      },
    });
  } else {
    await prisma.deliveryLog.create({
      data: {
        id: `dlog-${crypto.randomUUID()}`,
        notificationId: payload.notificationId ?? null,
        userId: payload.userId ?? null,
        applicationId: payload.applicationId ?? null,
        channel: 'email',
        recipient: payload.recipientEmail,
        status: resultStatus,
        providerMessageId: messageId,
        errorMessage,
      },
    });
  }

  if (resultStatus === 'Failed') {
    throw new Error(errorMessage || 'Email delivery failed');
  }
}

async function withAdvisorySweepLock<T>(
  lockKey: number,
  fn: () => Promise<T>
): Promise<{ acquired: boolean; result: T | null }> {
  const client = await getPrismaPool().connect();
  let acquired = false;
  try {
    const lockRes = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockKey]
    );
    acquired = Boolean(lockRes.rows[0]?.acquired);
    if (!acquired) {
      return { acquired: false, result: null };
    }
    const result = await fn();
    return { acquired: true, result };
  } finally {
    if (acquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    }
    client.release();
  }
}

export async function runSessionRemindersSweep(): Promise<number> {
  const { acquired, result } = await withAdvisorySweepLock(
    SESSION_REMINDER_LOCK_KEY,
    async () => {
      const [sessions, courses, enrollments, notifications, reminderSetting] = await Promise.all([
        prisma.classSession.findMany({
          where: { status: { not: 'Cancelled' } },
        }),
        prisma.course.findMany({ include: { modules: true, instructor: true } }),
        prisma.enrollment.findMany({ where: { status: 'Active' } }),
        prisma.notification.findMany({ where: { kind: 'reminder' } }),
        prisma.academySetting.findFirst({ where: { key: 'session.reminder_window_hours' } }),
      ]);

      const windowHours = reminderSetting ? Number(reminderSetting.value) || 24 : 24;
      const generated = findUpcomingSessionsNeedingReminders({
        sessions: sessions.map((s) => ({
          id: s.id,
          courseId: s.courseId,
          cohortId: s.cohortId,
          classroomId: s.classroomId,
          cohort: s.cohort,
          title: s.title,
          topic: s.topic,
          room: s.room,
          instructorId: s.instructorId,
          instructorName: s.instructorName,
          startIso: s.startIso.toISOString(),
          endIso: s.endIso.toISOString(),
          status: s.status as 'Scheduled' | 'Completed' | 'Cancelled',
        })),
        courses: courses.map((c) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          track: c.track,
          instructorId: c.instructorId,
          instructorName: c.instructor.name,
          durationWeeks: c.durationWeeks,
          tuitionFee: c.tuitionFee.toFixed(2),
          modules: c.modules.map((m) => ({
            id: m.id,
            code: m.code,
            title: m.title,
            weight: m.weight,
            labHours: m.labHours,
          })),
        })),
        enrollments: enrollments.map((e) => ({
          id: e.id,
          studentId: e.studentId,
          courseId: e.courseId,
          cohortId: e.cohortId,
          cohort: e.cohort,
          status: e.status as 'Active',
          enrolledAt: e.enrolledAt.toISOString(),
          completedModuleIds: Array.isArray(e.completedModuleIds)
            ? (e.completedModuleIds as string[])
            : [],
        })),
        existingNotifications: notifications.map((n) => ({
          id: n.id,
          userId: n.userId,
          kind: n.kind as 'reminder',
          title: n.title,
          message: n.message,
          relatedCourseId: n.relatedCourseId,
          relatedSessionId: n.relatedSessionId,
          dedupeKey: n.dedupeKey,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
        })),
        nowMs: Date.now(),
        windowHours,
      });

      if (generated.length === 0) return 0;

      let createdCount = 0;
      for (const item of generated) {
        try {
          const notifId = `ntf-${crypto.randomUUID()}`;
          const user = await prisma.user.findUnique({
            where: { id: item.userId },
            select: { id: true, email: true },
          });
          await prisma.$transaction(async (tx) => {
            await tx.notification.create({
              data: {
                id: notifId,
                userId: item.userId,
                kind: item.kind,
                title: item.title,
                message: item.message,
                relatedCourseId: item.relatedCourseId ?? null,
                relatedSessionId: item.relatedSessionId ?? null,
                dedupeKey: item.dedupeKey ?? null,
                read: false,
              },
            });
            await tx.deliveryLog.create({
              data: {
                id: `del-${crypto.randomUUID().slice(0, 8)}`,
                notificationId: notifId,
                userId: item.userId,
                channel: 'in_app',
                recipient: user?.email ?? item.userId,
                status: 'Delivered',
              },
            });
            if (user?.email) {
              await queueTransactionalEmail(tx, {
                notificationId: notifId,
                userId: user.id,
                kind: 'reminder',
                recipientEmail: user.email,
                subject: `${item.title} — IGS — InfoCom Global Services`,
                bodyText: item.message,
                dedupeKey: item.dedupeKey ? `email:${item.dedupeKey}` : null,
              });
            }
          });
          createdCount += 1;
        } catch {
          // Ignore duplicate dedupeKey race
        }
      }

      return createdCount;
    }
  );

  return acquired && result !== null ? result : 0;
}

export async function runFeeReminderSweep(options?: {
  nowMs?: number;
  includeUpcomingDays?: number;
}): Promise<{ queuedCount: number; scannedInvoices: number }> {
  const { acquired, result } = await withAdvisorySweepLock(FEE_REMINDER_LOCK_KEY, async () => {
    const nowMs = options?.nowMs ?? Date.now();
    const dateStamp = new Date(nowMs).toISOString().slice(0, 10);
    const horizonMs = nowMs + (options?.includeUpcomingDays ?? 3) * 24 * 60 * 60 * 1000;

    const invoices = await prisma.invoice.findMany({
      where: {
        isArchived: false,
        status: { in: ['Unpaid', 'Partial'] },
        dueDate: { lte: new Date(horizonMs) },
      },
      include: {
        student: { select: { id: true, name: true, email: true, status: true } },
      },
    });

    let queuedCount = 0;

    for (const inv of invoices) {
      if (!inv.student || inv.student.status === 'archived' || inv.student.status === 'suspended') {
        continue;
      }
      const dueCents = toCents(inv.amountDue.toFixed(2));
      const paidCents = toCents(inv.amountPaid.toFixed(2));
      const balanceCents = Math.max(0, dueCents - paidCents);
      if (balanceCents <= 0) continue;

      const dedupeKey = `fee-rem:${inv.id}:${dateStamp}`;
      const existing = await prisma.notification.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });
      if (existing) continue;

      const isOverdue = inv.dueDate.getTime() < nowMs;
      const balanceFormatted = formatCents(balanceCents, inv.currency || 'INR');
      const dueDateFormatted = inv.dueDate.toISOString().slice(0, 10);
      const title = isOverdue
        ? `Overdue Fee Reminder · ${inv.invoiceNumber}`
        : `Upcoming Fee Due Reminder · ${inv.invoiceNumber}`;
      const message = `Dear ${inv.student.name}, invoice ${inv.invoiceNumber} (${inv.description}) has an outstanding balance of ${balanceFormatted} due on ${dueDateFormatted}. Please contact the IGS — InfoCom Global Services office or submit payment to keep your enrollment clear.`;

      try {
        await prisma.$transaction(async (tx) => {
          const notifId = `ntf-${crypto.randomUUID()}`;
          await tx.notification.create({
            data: {
              id: notifId,
              userId: inv.student.id,
              kind: 'finance',
              title,
              message,
              relatedCourseId: inv.courseId,
              dedupeKey,
              read: false,
            },
          });
          await tx.deliveryLog.create({
            data: {
              id: `del-${crypto.randomUUID().slice(0, 8)}`,
              notificationId: notifId,
              userId: inv.student.id,
              channel: 'in_app',
              recipient: inv.student.email,
              status: 'Delivered',
            },
          });
          await queueTransactionalEmail(tx, {
            notificationId: notifId,
            userId: inv.student.id,
            kind: 'finance',
            recipientEmail: inv.student.email,
            subject: `${title} — IGS — InfoCom Global Services`,
            bodyText: message,
            dedupeKey: `email:${dedupeKey}`,
          });
        });
        queuedCount += 1;
      } catch {
        // Ignore duplicate dedupeKey race
      }
    }

    return { queuedCount, scannedInvoices: invoices.length };
  });

  return acquired && result !== null ? result : { queuedCount: 0, scannedInvoices: 0 };
}

/**
 * Recovers jobs left stuck in `Processing` past their lease expiration (for example after
 * a worker crash or pod termination). Jobs with remaining attempts return to `Pending`;
 * exhausted jobs transition cleanly to `Failed` with sensitive payload redaction.
 */
export async function recoverStaleProcessingJobs(options?: {
  now?: Date;
  fallbackStaleMs?: number;
}): Promise<StaleRecoveryReport> {
  const now = options?.now ?? new Date();
  const fallbackStaleMs = options?.fallbackStaleMs ?? DEFAULT_WORKER_LEASE_MS;
  const fallbackCutoff = new Date(now.getTime() - fallbackStaleMs);

  const staleJobs = await prisma.backgroundJob.findMany({
    where: {
      status: 'Processing',
      OR: [
        { leaseExpiresAt: { lt: now } },
        { AND: [{ leaseExpiresAt: null }, { lockedAt: { lt: fallbackCutoff } }] },
        { AND: [{ leaseExpiresAt: null }, { lockedAt: null }, { updatedAt: { lt: fallbackCutoff } }] },
      ],
    },
    take: 100,
  });

  let recoveredPending = 0;
  let failedExhausted = 0;

  for (const job of staleJobs) {
    const exhausted = job.attempts >= job.maxAttempts;
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const staleReason = exhausted
      ? `Worker processing lease expired after ${job.attempts}/${job.maxAttempts} attempt(s).`
      : `Recovered stale worker lease from ${job.workerId || 'unknown-worker'} (attempt ${job.attempts}/${job.maxAttempts}).`;

    const sanitizedPayload =
      exhausted && job.jobType === 'notification_email' && payload.redactSensitive === true
        ? ({
            ...payload,
            bodyText: '[REDACTED AFTER FAILURE]',
          } as Prisma.InputJsonValue)
        : undefined;

    const updated = await prisma.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: 'Processing',
        attempts: job.attempts,
      },
      data: {
        status: exhausted ? 'Failed' : 'Pending',
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        runAfter: now,
        completedAt: exhausted ? now : null,
        lastError: staleReason,
        ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
      },
    });

    if (updated.count === 0) continue;

    if (exhausted) {
      failedExhausted += 1;
      if (job.jobType === 'notification_email' && typeof payload.deliveryLogId === 'string') {
        await prisma.deliveryLog
          .updateMany({
            where: { id: payload.deliveryLogId },
            data: {
              status: 'Failed',
              errorMessage: staleReason,
              sentAt: now,
            },
          })
          .catch(() => undefined);
      }
    } else {
      recoveredPending += 1;
    }
  }

  return { recoveredPending, failedExhausted };
}

/**
 * Atomically claims ready `Pending` jobs using PostgreSQL `FOR UPDATE SKIP LOCKED`
 * so concurrent API/worker replicas never execute the same job simultaneously.
 */
export async function claimPendingJobs(
  limit = 20,
  options?: { workerId?: string; leaseMs?: number; now?: Date }
): Promise<ClaimedJobRow[]> {
  const now = options?.now ?? new Date();
  const leaseMs = options?.leaseMs ?? DEFAULT_WORKER_LEASE_MS;
  const workerId = options?.workerId || DEFAULT_WORKER_ID;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  const sql = `
    WITH next_jobs AS (
      SELECT id
      FROM background_jobs
      WHERE status = 'Pending'
        AND run_after <= $1
      ORDER BY run_after ASC, created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE background_jobs j
    SET
      status = 'Processing',
      worker_id = $3,
      locked_at = $1,
      started_at = $1,
      lease_expires_at = $4,
      attempts = j.attempts + 1,
      updated_at = $1
    FROM next_jobs
    WHERE j.id = next_jobs.id
    RETURNING
      j.id,
      j.job_type AS "jobType",
      j.dedupe_key AS "dedupeKey",
      j.payload,
      j.attempts,
      j.max_attempts AS "maxAttempts",
      j.run_after AS "runAfter"
  `;

  const result = await getPrismaPool().query<{
    id: string;
    jobType: string;
    dedupeKey: string | null;
    payload: Record<string, unknown>;
    attempts: number;
    maxAttempts: number;
    runAfter: Date;
  }>(sql, [now, safeLimit, workerId, leaseExpiresAt]);

  return result.rows.map((r) => ({
    id: r.id,
    jobType: r.jobType,
    dedupeKey: r.dedupeKey,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    runAfter: new Date(r.runAfter),
  }));
}

export async function processPendingJobs(
  limit = 20,
  options?: { workerId?: string; leaseMs?: number }
): Promise<number> {
  await recoverStaleProcessingJobs({ fallbackStaleMs: options?.leaseMs });

  const claimedJobs = await claimPendingJobs(limit, options);
  let processed = 0;

  for (const job of claimedJobs) {
    const startedMs = Date.now();
    const currentAttempt = job.attempts;
    const payload = job.payload ?? {};

    try {
      if (job.jobType === 'notification_email') {
        await handleNotificationEmailJob(payload as unknown as NotificationEmailPayload);
      } else if (job.jobType === 'session_reminders') {
        await runSessionRemindersSweep();
      } else if (job.jobType === 'fee_reminders') {
        await runFeeReminderSweep();
      } else {
        throw new Error(`Unknown background job type: ${job.jobType}`);
      }

      const sanitizedPayload =
        job.jobType === 'notification_email' && payload.redactSensitive === true
          ? ({
              ...payload,
              bodyText: '[REDACTED AFTER DELIVERY]',
            } as Prisma.InputJsonValue)
          : undefined;

      const durationMs = Math.max(0, Date.now() - startedMs);
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'Completed',
          completedAt: new Date(),
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          durationMs,
          lastError: null,
          ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
        },
      });
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Background job execution failed.';
      const exhausted = currentAttempt >= job.maxAttempts;
      const delayMs = Math.pow(2, currentAttempt) * 15_000;
      const durationMs = Math.max(0, Date.now() - startedMs);

      if (job.jobType === 'notification_email' && typeof payload.deliveryLogId === 'string') {
        await prisma.deliveryLog
          .updateMany({
            where: { id: payload.deliveryLogId },
            data: {
              status: exhausted ? 'Failed' : 'Queued',
              errorMessage: `${message.slice(0, 500)} (attempt ${currentAttempt}/${job.maxAttempts})`,
              sentAt: new Date(),
            },
          })
          .catch(() => undefined);
      }

      const sanitizedPayload =
        exhausted && job.jobType === 'notification_email' && payload.redactSensitive === true
          ? ({
              ...payload,
              bodyText: '[REDACTED AFTER FAILURE]',
            } as Prisma.InputJsonValue)
          : undefined;

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: exhausted ? 'Failed' : 'Pending',
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          durationMs,
          lastError: message.slice(0, 1000),
          completedAt: exhausted ? new Date() : null,
          runAfter: exhausted ? job.runAfter : new Date(Date.now() + delayMs),
          ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
        },
      });
    }
  }

  return processed;
}

export async function getWorkerTelemetry(): Promise<WorkerTelemetry> {
  const now = new Date();
  const [grouped, staleProcessingCount, recentFailures] = await Promise.all([
    prisma.backgroundJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.backgroundJob.count({
      where: {
        status: 'Processing',
        leaseExpiresAt: { lt: now },
      },
    }),
    prisma.backgroundJob.findMany({
      where: { status: 'Failed' },
      orderBy: { updatedAt: 'desc' },
      take: 15,
      select: {
        id: true,
        jobType: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        durationMs: true,
        updatedAt: true,
      },
    }),
  ]);

  const countsByStatus: WorkerTelemetry['countsByStatus'] = {
    Pending: 0,
    Processing: 0,
    Completed: 0,
    Failed: 0,
  };
  for (const row of grouped) {
    if (row.status in countsByStatus) {
      countsByStatus[row.status as keyof WorkerTelemetry['countsByStatus']] = row._count._all;
    }
  }

  return {
    workerId: DEFAULT_WORKER_ID,
    leaseMs: DEFAULT_WORKER_LEASE_MS,
    countsByStatus,
    staleProcessingCount,
    recentFailures: recentFailures.map((f) => ({
      ...f,
      updatedAt: f.updatedAt.toISOString(),
    })),
  };
}

let workerTimer: NodeJS.Timeout | null = null;
let lastReminderSweepMs = 0;
let tickInFlight = false;

export async function runWorkerTick(options?: {
  batchLimit?: number;
  workerId?: string;
  leaseMs?: number;
  reminderIntervalMs?: number;
}): Promise<{ processedCount: number; remindersCreated: number }> {
  if (tickInFlight) {
    return { processedCount: 0, remindersCreated: 0 };
  }
  tickInFlight = true;
  try {
    const processedCount = await processPendingJobs(options?.batchLimit ?? 25, {
      workerId: options?.workerId,
      leaseMs: options?.leaseMs,
    });
    let remindersCreated = 0;
    const nowMs = Date.now();
    const reminderIntervalMs = options?.reminderIntervalMs ?? 15 * 60 * 1000;
    if (nowMs - lastReminderSweepMs > reminderIntervalMs) {
      lastReminderSweepMs = nowMs;
      remindersCreated = await runSessionRemindersSweep();
    }
    return { processedCount, remindersCreated };
  } finally {
    tickInFlight = false;
  }
}

export function startBackgroundWorker(intervalMs = 30_000) {
  if (workerTimer) return;

  const tick = async () => {
    try {
      await runWorkerTick();
    } catch (err) {
      console.error('[worker] background sweep error:', err);
    }
  };

  void tick();
  workerTimer = setInterval(() => {
    void tick();
  }, intervalMs);
  workerTimer.unref();
}

export function stopBackgroundWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
