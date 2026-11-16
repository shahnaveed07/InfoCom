import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { findUpcomingSessionsNeedingReminders, formatCents, toCents } from '../../src/shared/academic.ts';
import { prisma } from '../db/prisma.ts';
import { sendTransactionalEmail } from '../email/mailer.ts';

export type BackgroundJobType = 'notification_email' | 'session_reminders';

type PrismaDbClient = Prisma.TransactionClient | typeof prisma;

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

export async function enqueueJob(
  jobType: BackgroundJobType,
  payload: Record<string, unknown>,
  options?: { runAfter?: Date; maxAttempts?: number; db?: PrismaDbClient }
) {
  const db = options?.db ?? prisma;
  return db.backgroundJob.create({
    data: {
      id: `job-${crypto.randomUUID()}`,
      jobType,
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
  }
): Promise<{ deliveryLogId: string; jobId: string } | null> {
  const recipient = params.recipientEmail.trim().toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    return null;
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
    { db, maxAttempts: params.maxAttempts ?? 3 }
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

export async function runSessionRemindersSweep(): Promise<number> {
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

export async function runFeeReminderSweep(options?: {
  nowMs?: number;
  includeUpcomingDays?: number;
}): Promise<{ queuedCount: number; scannedInvoices: number }> {
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
        });
      });
      queuedCount += 1;
    } catch {
      // Ignore duplicate dedupeKey race
    }
  }

  return { queuedCount, scannedInvoices: invoices.length };
}

export async function processPendingJobs(limit = 20): Promise<number> {
  const now = new Date();
  const candidates = await prisma.backgroundJob.findMany({
    where: {
      status: 'Pending',
      runAfter: { lte: now },
    },
    orderBy: { runAfter: 'asc' },
    take: limit,
  });

  let processed = 0;

  for (const candidate of candidates) {
    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: candidate.id, status: 'Pending' },
      data: {
        status: 'Processing',
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue;

    const currentAttempt = candidate.attempts + 1;
    const payload = (candidate.payload ?? {}) as Record<string, unknown>;
    try {
      if (candidate.jobType === 'notification_email') {
        await handleNotificationEmailJob(payload as unknown as NotificationEmailPayload);
      } else if (candidate.jobType === 'session_reminders') {
        await runSessionRemindersSweep();
      } else {
        throw new Error(`Unknown background job type: ${candidate.jobType}`);
      }

      const sanitizedPayload =
        candidate.jobType === 'notification_email' && payload.redactSensitive === true
          ? ({
              ...payload,
              bodyText: '[REDACTED AFTER DELIVERY]',
            } as Prisma.InputJsonValue)
          : undefined;

      await prisma.backgroundJob.update({
        where: { id: candidate.id },
        data: {
          status: 'Completed',
          completedAt: new Date(),
          lastError: null,
          ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
        },
      });
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Background job execution failed.';
      const exhausted = currentAttempt >= candidate.maxAttempts;
      const delayMs = Math.pow(2, currentAttempt) * 15_000;

      if (candidate.jobType === 'notification_email' && typeof payload.deliveryLogId === 'string') {
        await prisma.deliveryLog
          .updateMany({
            where: { id: payload.deliveryLogId },
            data: {
              status: exhausted ? 'Failed' : 'Queued',
              errorMessage: `${message.slice(0, 500)} (attempt ${currentAttempt}/${candidate.maxAttempts})`,
              sentAt: new Date(),
            },
          })
          .catch(() => undefined);
      }

      const sanitizedPayload =
        exhausted && candidate.jobType === 'notification_email' && payload.redactSensitive === true
          ? ({
              ...payload,
              bodyText: '[REDACTED AFTER FAILURE]',
            } as Prisma.InputJsonValue)
          : undefined;

      await prisma.backgroundJob.update({
        where: { id: candidate.id },
        data: {
          status: exhausted ? 'Failed' : 'Pending',
          lastError: message.slice(0, 1000),
          runAfter: exhausted ? candidate.runAfter : new Date(Date.now() + delayMs),
          ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
        },
      });
    }
  }

  return processed;
}

let workerTimer: NodeJS.Timeout | null = null;
let lastReminderSweepMs = 0;

export function startBackgroundWorker(intervalMs = 30_000) {
  if (workerTimer) return;

  const tick = async () => {
    try {
      await processPendingJobs(25);
      const nowMs = Date.now();
      if (nowMs - lastReminderSweepMs > 15 * 60 * 1000) {
        lastReminderSweepMs = nowMs;
        await runSessionRemindersSweep();
      }
    } catch (err) {
      console.error('[worker] background sweep error:', err);
    }
  };

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
