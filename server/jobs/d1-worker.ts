import { AsyncLocalStorage } from 'node:async_hooks';
import {
  findUpcomingSessionsNeedingReminders,
  formatCents,
  toCents,
} from '../../src/shared/academic.ts';
import {
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  d1All,
  d1Batch,
  d1First,
  d1Run,
  d1Stmt,
  getActiveD1,
  nowIso,
  randomId,
  runWithD1Database,
  sqlBool,
  sqlJson,
} from '../d1/client.ts';

export type D1BackgroundJobType = 'notification_email' | 'session_reminders' | 'fee_reminders';

export interface D1JobQueueMessage {
  jobId: string;
  jobType: D1BackgroundJobType;
  enqueuedAt: string;
}

export interface D1JobQueueBindingLike {
  send: (message: D1JobQueueMessage) => Promise<void>;
}

export interface WorkerEmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  EMAIL_HTTP_URL?: string;
  EMAIL_HTTP_TOKEN?: string;
  WORKER_LEASE_MS?: string;
}

export interface WorkerQueueMsgLike<T = unknown> {
  id: string;
  body: T;
  attempts: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

export interface WorkerQueueBatchD1Like<T = unknown> {
  queue: string;
  messages: ReadonlyArray<WorkerQueueMsgLike<T>>;
}

export interface WorkerD1ExecutionContextLike {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

export interface WorkerD1ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
  noRetry: () => void;
}

export interface WorkerD1EnvBindings extends WorkerEmailEnv {
  DB?: D1DatabaseLike;
  JOBS_QUEUE?: D1JobQueueBindingLike;
}

export interface D1ScheduledSweepSummary {
  recoveredPending: number;
  failedExhausted: number;
  processedPending: number;
  sessionRemindersCreated: number;
  feeRemindersQueued: number;
  expiredSessionsDeleted: number;
  expiredResetTokensDeleted: number;
}

export interface D1NotificationEmailPayload {
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

export interface D1ClaimedJobRow {
  id: string;
  jobType: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
}

export interface D1WorkerTelemetry {
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

export type WorkerEmailSendResult = {
  status: 'Delivered' | 'Skipped' | 'Failed';
  messageId: string | null;
  reason: string | null;
};

type EmailSenderOverrideFn = (params: {
  to: string;
  subject: string;
  text: string;
  from: string;
  provider: string;
}) => Promise<WorkerEmailSendResult>;

const d1JobQueueStore = new AsyncLocalStorage<D1JobQueueBindingLike>();
const d1EmailEnvStore = new AsyncLocalStorage<WorkerEmailEnv>();
let emailSenderOverrideForTest: EmailSenderOverrideFn | null = null;
let cachedWorkerId: string | null = null;

export const DEFAULT_D1_WORKER_LEASE_MS = 120_000;

export function setD1EmailSenderOverrideForTest(fn: EmailSenderOverrideFn | null): void {
  emailSenderOverrideForTest = fn;
}

export function resolveDefaultD1WorkerId(): string {
  if (!cachedWorkerId) {
    cachedWorkerId = `cf-d1-${crypto.randomUUID().slice(0, 8)}`;
  }
  return cachedWorkerId;
}

export async function runWithD1JobQueue<T>(
  queue: D1JobQueueBindingLike | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!queue) return fn();
  return d1JobQueueStore.run(queue, fn);
}

export async function runWithD1EmailConfig<T>(
  config: WorkerEmailEnv | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!config) return fn();
  return d1EmailEnvStore.run(config, fn);
}

export function getActiveD1JobQueue(): D1JobQueueBindingLike | undefined {
  return d1JobQueueStore.getStore();
}

function readEmailVar(key: keyof WorkerEmailEnv, fallback?: string): string {
  const scoped = d1EmailEnvStore.getStore()?.[key];
  if (typeof scoped === 'string' && scoped.trim()) return scoped.trim();
  const proc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (typeof proc === 'string' && proc.trim()) return proc.trim();
  return fallback ?? '';
}

export function extractWorkerEmailEnv(env: WorkerEmailEnv): WorkerEmailEnv {
  return {
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    EMAIL_FROM: env.EMAIL_FROM,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_HTTP_URL: env.EMAIL_HTTP_URL,
    EMAIL_HTTP_TOKEN: env.EMAIL_HTTP_TOKEN,
    WORKER_LEASE_MS: env.WORKER_LEASE_MS,
  };
}

export function resolveWorkerLeaseMs(): number {
  const raw = Number(readEmailVar('WORKER_LEASE_MS'));
  return Number.isFinite(raw) && raw >= 15_000 ? raw : DEFAULT_D1_WORKER_LEASE_MS;
}

export function isWorkerEmailConfigured(config?: WorkerEmailEnv): boolean {
  const provider = (config?.EMAIL_PROVIDER ?? readEmailVar('EMAIL_PROVIDER', 'disabled')).toLowerCase();
  if (provider === 'disabled' || provider === '' || provider === 'none') {
    return false;
  }
  const from = (config?.EMAIL_FROM ?? readEmailVar('EMAIL_FROM')).trim();
  if (!from) return false;
  if (provider === 'resend') {
    return Boolean((config?.RESEND_API_KEY ?? readEmailVar('RESEND_API_KEY')).trim());
  }
  if (provider === 'http') {
    const httpUrl = (config?.EMAIL_HTTP_URL ?? readEmailVar('EMAIL_HTTP_URL')).trim();
    const resendKey = (config?.RESEND_API_KEY ?? readEmailVar('RESEND_API_KEY')).trim();
    return Boolean(httpUrl || resendKey);
  }
  return false;
}

export async function verifyWorkerEmailTransport(config?: WorkerEmailEnv): Promise<{
  configured: boolean;
  ok: boolean;
  provider: string;
  message: string;
}> {
  const provider = (config?.EMAIL_PROVIDER ?? readEmailVar('EMAIL_PROVIDER', 'disabled')).toLowerCase();
  const configured = isWorkerEmailConfigured(config);
  if (!configured) {
    return {
      configured: false,
      ok: true,
      provider: provider || 'disabled',
      message:
        provider === 'disabled' || !provider
          ? 'Transactional email provider is set to disabled (Cloudflare Free zero-cost default); in-app notifications & setup links are active and email logs record Skipped.'
          : 'HTTP email endpoint or EMAIL_FROM is not configured; email delivery will record Skipped.',
    };
  }
  return {
    configured: true,
    ok: true,
    provider,
    message: `Worker Fetch email transport ready via ${provider}.`,
  };
}

export async function sendD1TransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<WorkerEmailSendResult> {
  const provider = readEmailVar('EMAIL_PROVIDER', 'disabled').toLowerCase();
  const from = readEmailVar('EMAIL_FROM');

  if (emailSenderOverrideForTest) {
    return emailSenderOverrideForTest({
      to: params.to,
      subject: params.subject,
      text: params.text,
      from: from || 'noreply@infocom.local',
      provider: provider || 'test',
    });
  }

  if (provider === 'disabled' || !provider || provider === 'none') {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'Email delivery disabled (EMAIL_PROVIDER=disabled); use in-app notification or setup link.',
    };
  }

  if (!from) {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'EMAIL_FROM is not configured.',
    };
  }

  const resendKey = readEmailVar('RESEND_API_KEY');
  const httpUrl = readEmailVar('EMAIL_HTTP_URL');
  const httpToken = readEmailVar('EMAIL_HTTP_TOKEN');

  const endpoint =
    provider === 'resend'
      ? 'https://api.resend.com/emails'
      : httpUrl || (resendKey ? 'https://api.resend.com/emails' : '');

  if (!endpoint) {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'No EMAIL_HTTP_URL or RESEND_API_KEY configured for HTTP email transport.',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const bearer = endpoint.includes('api.resend.com') ? resendKey || httpToken : httpToken || resendKey;
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        status: 'Failed',
        messageId: null,
        reason: `HTTP email gateway returned ${res.status}: ${errBody.slice(0, 200)}`.trim(),
      };
    }
    const parsed = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return {
      status: 'Delivered',
      messageId: parsed.id || parsed.messageId || `http-${crypto.randomUUID().slice(0, 8)}`,
      reason: null,
    };
  } catch (err) {
    return {
      status: 'Failed',
      messageId: null,
      reason: err instanceof Error ? err.message : 'Network error calling email HTTP gateway.',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchJobToQueue(jobId: string, jobType: D1BackgroundJobType): Promise<void> {
  const queue = getActiveD1JobQueue();
  if (!queue) return;
  try {
    await queue.send({
      jobId,
      jobType,
      enqueuedAt: nowIso(),
    });
  } catch (err) {
    console.warn(
      '[d1-worker] Cloudflare Queue publish warning (D1 persistence intact):',
      err instanceof Error ? err.message : 'unknown'
    );
  }
}

export async function enqueueD1Job(
  jobType: D1BackgroundJobType,
  payload: Record<string, unknown>,
  options?: {
    runAfter?: Date;
    maxAttempts?: number;
    dedupeKey?: string | null;
    deferQueuePublish?: boolean;
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const dedupeKey = options?.dedupeKey?.trim() || null;
  const runAfterIso = (options?.runAfter ?? new Date()).toISOString();
  const maxAttempts = options?.maxAttempts ?? 3;
  const now = nowIso();
  const jobId = `job-${crypto.randomUUID()}`;
  const payloadStr = JSON.stringify(payload);

  if (dedupeKey) {
    const existing = await d1First<{ id: string; payload: string }>(
      'SELECT id, payload FROM background_jobs WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
      db
    );
    if (existing) {
      return {
        id: existing.id,
        payload: sqlJson<Record<string, unknown>>(existing.payload, payload),
      };
    }

    await d1Run(
      `INSERT OR IGNORE INTO background_jobs
         (id, job_type, dedupe_key, payload, status, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Pending', 0, ?, ?, ?, ?)`,
      [jobId, jobType, dedupeKey, payloadStr, maxAttempts, runAfterIso, now, now],
      db
    );

    const row = await d1First<{ id: string; payload: string }>(
      'SELECT id, payload FROM background_jobs WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
      db
    );
    const resolvedId = row?.id || jobId;
    if (!options?.deferQueuePublish && (!options?.runAfter || options.runAfter.getTime() <= Date.now())) {
      await dispatchJobToQueue(resolvedId, jobType);
    }
    return {
      id: resolvedId,
      payload: sqlJson<Record<string, unknown>>(row?.payload, payload),
    };
  }

  await d1Run(
    `INSERT INTO background_jobs
       (id, job_type, dedupe_key, payload, status, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'Pending', 0, ?, ?, ?, ?)`,
    [jobId, jobType, payloadStr, maxAttempts, runAfterIso, now, now],
    db
  );

  if (!options?.deferQueuePublish && (!options?.runAfter || options.runAfter.getTime() <= Date.now())) {
    await dispatchJobToQueue(jobId, jobType);
  }
  return { id: jobId, payload };
}

export async function queueD1TransactionalEmail(
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
  },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ deliveryLogId: string; jobId: string } | null> {
  const recipient = params.recipientEmail.trim().toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    return null;
  }

  const dedupeKey = params.dedupeKey?.trim() || null;
  if (dedupeKey) {
    const existing = await d1First<{ id: string; payload: string }>(
      'SELECT id, payload FROM background_jobs WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
      db
    );
    if (existing) {
      const p = sqlJson<Record<string, unknown>>(existing.payload, {});
      return {
        deliveryLogId: typeof p.deliveryLogId === 'string' ? p.deliveryLogId : '',
        jobId: existing.id,
      };
    }
  }

  const deliveryLogId = `dlog-${crypto.randomUUID()}`;
  const now = nowIso();

  await d1Run(
    `INSERT INTO delivery_logs
       (id, notification_id, user_id, application_id, channel, recipient, status, sent_at)
     VALUES (?, ?, ?, ?, 'email', ?, 'Queued', ?)`,
    [
      deliveryLogId,
      params.notificationId ?? null,
      params.userId ?? null,
      params.applicationId ?? null,
      recipient,
      now,
    ],
    db
  );

  const job = await enqueueD1Job(
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
    { maxAttempts: params.maxAttempts ?? 3, dedupeKey },
    db
  );

  return { deliveryLogId, jobId: job.id };
}

async function isEmailChannelEnabledForUserD1(
  userId: string | null | undefined,
  kind: string | undefined,
  bypassPreferences: boolean | undefined,
  db: D1DatabaseLike
): Promise<boolean> {
  if (bypassPreferences || !userId) return true;
  const prefs = await d1All<{ kind: string; enabled: number }>(
    "SELECT kind, enabled FROM notification_preferences WHERE user_id = ? AND channel = 'email'",
    [userId],
    db
  );
  if (prefs.length === 0) return true;
  if (kind) {
    const exact = prefs.find((p) => p.kind === kind);
    if (exact) return sqlBool(exact.enabled);
  }
  const allPref = prefs.find((p) => p.kind === 'all');
  return allPref ? sqlBool(allPref.enabled) : true;
}

async function handleNotificationEmailJobD1(
  payload: D1NotificationEmailPayload,
  db: D1DatabaseLike
): Promise<void> {
  const emailEnabled = await isEmailChannelEnabledForUserD1(
    payload.userId,
    payload.kind,
    payload.bypassPreferences,
    db
  );

  let resultStatus: 'Delivered' | 'Skipped' | 'Failed' = 'Skipped';
  let messageId: string | null = null;
  let errorMessage: string | null = null;

  if (!emailEnabled) {
    resultStatus = 'Skipped';
    errorMessage = 'Recipient opted out of email notifications for this category.';
  } else {
    const res = await sendD1TransactionalEmail({
      to: payload.recipientEmail,
      subject: payload.subject,
      text: payload.bodyText,
    });
    resultStatus = res.status;
    messageId = res.messageId;
    errorMessage = res.reason;
  }

  const now = nowIso();
  if (payload.deliveryLogId) {
    await d1Run(
      'UPDATE delivery_logs SET status = ?, provider_message_id = ?, error_message = ?, sent_at = ? WHERE id = ?',
      [resultStatus, messageId, errorMessage, now, payload.deliveryLogId],
      db
    );
  } else {
    await d1Run(
      `INSERT INTO delivery_logs
         (id, notification_id, user_id, application_id, channel, recipient, status, provider_message_id, error_message, sent_at)
       VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?)`,
      [
        `dlog-${crypto.randomUUID()}`,
        payload.notificationId ?? null,
        payload.userId ?? null,
        payload.applicationId ?? null,
        payload.recipientEmail,
        resultStatus,
        messageId,
        errorMessage,
        now,
      ],
      db
    );
  }

  if (resultStatus === 'Failed') {
    throw new Error(errorMessage || 'Email delivery failed');
  }
}

export async function runD1SessionReminderSweep(
  db: D1DatabaseLike = getActiveD1()
): Promise<number> {
  const [sessions, courses, modules, users, enrollments, notifications, reminderSetting] =
    await Promise.all([
      d1All<Record<string, unknown>>(
        "SELECT * FROM class_sessions WHERE status != 'Cancelled'",
        [],
        db
      ),
      d1All<Record<string, unknown>>('SELECT * FROM courses', [], db),
      d1All<Record<string, unknown>>('SELECT * FROM course_modules ORDER BY sort_order ASC', [], db),
      d1All<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users', [], db),
      d1All<Record<string, unknown>>("SELECT * FROM enrollments WHERE status = 'Active'", [], db),
      d1All<Record<string, unknown>>("SELECT * FROM notifications WHERE kind = 'reminder'", [], db),
      d1First<{ value: string }>(
        "SELECT value FROM academy_settings WHERE key = 'session.reminder_window_hours' LIMIT 1",
        [],
        db
      ),
    ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const modsByCourse = new Map<string, Array<{ id: string; code: string; title: string; weight: number; labHours: number }>>();
  for (const m of modules) {
    const cid = String(m.course_id);
    const list = modsByCourse.get(cid) ?? [];
    list.push({
      id: String(m.id),
      code: String(m.code),
      title: String(m.title),
      weight: Number(m.weight),
      labHours: Number(m.lab_hours),
    });
    modsByCourse.set(cid, list);
  }

  const windowHours = reminderSetting ? Number(reminderSetting.value) || 24 : 24;
  const generated = findUpcomingSessionsNeedingReminders({
    sessions: sessions.map((s) => ({
      id: String(s.id),
      courseId: String(s.course_id),
      cohortId: s.cohort_id ? String(s.cohort_id) : null,
      classroomId: s.classroom_id ? String(s.classroom_id) : null,
      cohort: String(s.cohort),
      title: String(s.title),
      topic: String(s.topic || ''),
      room: String(s.room),
      instructorId: s.instructor_id ? String(s.instructor_id) : null,
      instructorName: String(s.instructor_name),
      startIso: String(s.start_at),
      endIso: String(s.end_at),
      status: String(s.status) as 'Scheduled' | 'Completed' | 'Cancelled',
    })),
    courses: courses.map((c) => {
      const inst = userMap.get(String(c.instructor_id));
      return {
        id: String(c.id),
        code: String(c.code),
        title: String(c.title),
        track: String(c.track),
        instructorId: String(c.instructor_id),
        instructorName: inst?.name ?? 'Instructor',
        durationWeeks: Number(c.duration_weeks),
        tuitionFee: String(c.tuition_fee),
        modules: modsByCourse.get(String(c.id)) ?? [],
      };
    }),
    enrollments: enrollments.map((e) => ({
      id: String(e.id),
      studentId: String(e.student_id),
      courseId: String(e.course_id),
      cohortId: e.cohort_id ? String(e.cohort_id) : null,
      cohort: String(e.cohort),
      status: 'Active' as const,
      enrolledAt: String(e.enrolled_at),
      completedModuleIds: sqlJson<string[]>(e.completed_module_ids, []),
    })),
    existingNotifications: notifications.map((n) => ({
      id: String(n.id),
      userId: String(n.user_id),
      kind: 'reminder' as const,
      title: String(n.title),
      message: String(n.message),
      relatedCourseId: n.related_course_id ? String(n.related_course_id) : null,
      relatedSessionId: n.related_session_id ? String(n.related_session_id) : null,
      dedupeKey: n.dedupe_key ? String(n.dedupe_key) : null,
      read: sqlBool(n.read),
      createdAt: String(n.created_at),
    })),
    nowMs: Date.now(),
    windowHours,
  });

  if (generated.length === 0) return 0;

  let createdCount = 0;
  for (const item of generated) {
    try {
      if (item.dedupeKey) {
        const exists = await d1First<{ id: string }>(
          'SELECT id FROM notifications WHERE dedupe_key = ? LIMIT 1',
          [item.dedupeKey],
          db
        );
        if (exists) continue;
      }

      const notifId = `ntf-${crypto.randomUUID()}`;
      const user = userMap.get(item.userId);
      const now = nowIso();

      await d1Batch(
        [
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, related_session_id, dedupe_key, read, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              notifId,
              item.userId,
              item.kind,
              item.title,
              item.message,
              item.relatedCourseId ?? null,
              item.relatedSessionId ?? null,
              item.dedupeKey ?? null,
              now,
            ],
            db
          ),
          d1Stmt(
            `INSERT INTO delivery_logs
               (id, notification_id, user_id, channel, recipient, status, sent_at)
             VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
            [randomId('del', 8), notifId, item.userId, user?.email ?? item.userId, now],
            db
          ),
        ],
        db
      );

      if (user?.email) {
        await queueD1TransactionalEmail(
          {
            notificationId: notifId,
            userId: user.id,
            kind: 'reminder',
            recipientEmail: user.email,
            subject: `${item.title} — IGS — InfoCom Global Services`,
            bodyText: item.message,
            dedupeKey: item.dedupeKey ? `email:${item.dedupeKey}` : null,
          },
          db
        );
      }
      createdCount += 1;
    } catch {
      // Ignore duplicate dedupe_key conflict
    }
  }

  return createdCount;
}

export async function runD1FeeReminderSweep(
  options?: { nowMs?: number; includeUpcomingDays?: number },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ queuedCount: number; scannedInvoices: number }> {
  const nowMs = options?.nowMs ?? Date.now();
  const dateStamp = new Date(nowMs).toISOString().slice(0, 10);
  const horizonIso = new Date(
    nowMs + (options?.includeUpcomingDays ?? 3) * 24 * 60 * 60 * 1000
  ).toISOString();

  const invoices = await d1All<{
    id: string;
    invoice_number: string;
    course_id: string;
    description: string;
    amount_due: string;
    amount_paid: string;
    currency: string;
    due_date: string;
    student_id: string;
    student_name: string;
    student_email: string;
    student_status: string;
  }>(
    `SELECT fi.id, fi.invoice_number, fi.course_id, fi.description, fi.amount_due, fi.amount_paid,
            fi.currency, fi.due_date, fi.student_id,
            u.name AS student_name, u.email AS student_email, u.status AS student_status
     FROM fee_invoices fi
     INNER JOIN users u ON u.id = fi.student_id
     WHERE fi.is_archived = 0
       AND fi.status IN ('Unpaid', 'Partial')
       AND fi.due_date <= ?`,
    [horizonIso],
    db
  );

  let queuedCount = 0;

  for (const inv of invoices) {
    if (inv.student_status === 'archived' || inv.student_status === 'suspended') {
      continue;
    }
    const dueCents = toCents(inv.amount_due);
    const paidCents = toCents(inv.amount_paid);
    const balanceCents = Math.max(0, dueCents - paidCents);
    if (balanceCents <= 0) continue;

    const dedupeKey = `fee-rem:${inv.id}:${dateStamp}`;
    const existing = await d1First<{ id: string }>(
      'SELECT id FROM notifications WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
      db
    );
    if (existing) continue;

    const isOverdue = Date.parse(inv.due_date) < nowMs;
    const balanceFormatted = formatCents(balanceCents, inv.currency || 'INR');
    const dueDateFormatted = inv.due_date.slice(0, 10);
    const title = isOverdue
      ? `Overdue Fee Reminder · ${inv.invoice_number}`
      : `Upcoming Fee Due Reminder · ${inv.invoice_number}`;
    const message = `Dear ${inv.student_name}, invoice ${inv.invoice_number} (${inv.description}) has an outstanding balance of ${balanceFormatted} due on ${dueDateFormatted}. Please contact the IGS — InfoCom Global Services office or submit payment to keep your enrollment clear.`;

    try {
      const notifId = `ntf-${crypto.randomUUID()}`;
      const now = nowIso();
      await d1Batch(
        [
          d1Stmt(
            `INSERT INTO notifications
               (id, user_id, kind, title, message, related_course_id, dedupe_key, read, created_at)
             VALUES (?, ?, 'finance', ?, ?, ?, ?, 0, ?)`,
            [notifId, inv.student_id, title, message, inv.course_id, dedupeKey, now],
            db
          ),
          d1Stmt(
            `INSERT INTO delivery_logs
               (id, notification_id, user_id, channel, recipient, status, sent_at)
             VALUES (?, ?, ?, 'in_app', ?, 'Delivered', ?)`,
            [randomId('del', 8), notifId, inv.student_id, inv.student_email, now],
            db
          ),
        ],
        db
      );

      await queueD1TransactionalEmail(
        {
          notificationId: notifId,
          userId: inv.student_id,
          kind: 'finance',
          recipientEmail: inv.student_email,
          subject: `${title} — IGS — InfoCom Global Services`,
          bodyText: message,
          dedupeKey: `email:${dedupeKey}`,
        },
        db
      );
      queuedCount += 1;
    } catch {
      // Ignore duplicate dedupe_key race
    }
  }

  return { queuedCount, scannedInvoices: invoices.length };
}

export async function recoverStaleD1Jobs(
  options?: { now?: Date; fallbackStaleMs?: number },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ recoveredPending: number; failedExhausted: number }> {
  const now = options?.now ?? new Date();
  const nowStr = now.toISOString();
  const fallbackStaleMs = options?.fallbackStaleMs ?? DEFAULT_D1_WORKER_LEASE_MS;
  const fallbackCutoffStr = new Date(now.getTime() - fallbackStaleMs).toISOString();

  const staleJobs = await d1All<{
    id: string;
    job_type: string;
    payload: string;
    attempts: number;
    max_attempts: number;
    worker_id: string | null;
  }>(
    `SELECT id, job_type, payload, attempts, max_attempts, worker_id
     FROM background_jobs
     WHERE status = 'Processing'
       AND (
         lease_expires_at < ?
         OR (lease_expires_at IS NULL AND locked_at < ?)
         OR (lease_expires_at IS NULL AND locked_at IS NULL AND updated_at < ?)
       )
     LIMIT 100`,
    [nowStr, fallbackCutoffStr, fallbackCutoffStr],
    db
  );

  let recoveredPending = 0;
  let failedExhausted = 0;

  for (const job of staleJobs) {
    const exhausted = job.attempts >= job.max_attempts;
    const payload = sqlJson<Record<string, unknown>>(job.payload, {});
    const staleReason = exhausted
      ? `Worker processing lease expired after ${job.attempts}/${job.max_attempts} attempt(s).`
      : `Recovered stale worker lease from ${job.worker_id || 'unknown-worker'} (attempt ${job.attempts}/${job.max_attempts}).`;

    const nextPayload =
      exhausted && job.job_type === 'notification_email' && payload.redactSensitive === true
        ? JSON.stringify({ ...payload, bodyText: '[REDACTED AFTER FAILURE]' })
        : job.payload;

    const updateRes = await d1Run(
      `UPDATE background_jobs
       SET status = ?,
           worker_id = NULL,
           locked_at = NULL,
           lease_expires_at = NULL,
           run_after = ?,
           completed_at = ?,
           last_error = ?,
           payload = ?,
           updated_at = ?
       WHERE id = ? AND status = 'Processing' AND attempts = ?`,
      [
        exhausted ? 'Failed' : 'Pending',
        nowStr,
        exhausted ? nowStr : null,
        staleReason,
        nextPayload,
        nowStr,
        job.id,
        job.attempts,
      ],
      db
    );

    if (Number(updateRes.meta?.changes ?? 0) === 0) continue;

    if (exhausted) {
      failedExhausted += 1;
      if (job.job_type === 'notification_email' && typeof payload.deliveryLogId === 'string') {
        await d1Run(
          "UPDATE delivery_logs SET status = 'Failed', error_message = ?, sent_at = ? WHERE id = ?",
          [staleReason, nowStr, payload.deliveryLogId],
          db
        ).catch(() => undefined);
      }
    } else {
      recoveredPending += 1;
    }
  }

  return { recoveredPending, failedExhausted };
}

export async function claimPendingD1Jobs(
  limit = 20,
  options?: { workerId?: string; leaseMs?: number; now?: Date },
  db: D1DatabaseLike = getActiveD1()
): Promise<D1ClaimedJobRow[]> {
  const now = options?.now ?? new Date();
  const nowStr = now.toISOString();
  const leaseMs = options?.leaseMs ?? resolveWorkerLeaseMs();
  const workerId = options?.workerId || resolveDefaultD1WorkerId();
  const leaseExpiresAtStr = new Date(now.getTime() + leaseMs).toISOString();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  const candidates = await d1All<{
    id: string;
    job_type: string;
    dedupe_key: string | null;
    payload: string;
    attempts: number;
    max_attempts: number;
    run_after: string;
  }>(
    `SELECT id, job_type, dedupe_key, payload, attempts, max_attempts, run_after
     FROM background_jobs
     WHERE status = 'Pending' AND run_after <= ?
     ORDER BY run_after ASC, created_at ASC
     LIMIT ?`,
    [nowStr, safeLimit],
    db
  );

  const claimed: D1ClaimedJobRow[] = [];
  for (const row of candidates) {
    const res = await d1Run(
      `UPDATE background_jobs
       SET status = 'Processing',
           worker_id = ?,
           locked_at = ?,
           started_at = ?,
           lease_expires_at = ?,
           attempts = attempts + 1,
           updated_at = ?
       WHERE id = ? AND status = 'Pending' AND attempts = ?`,
      [workerId, nowStr, nowStr, leaseExpiresAtStr, nowStr, row.id, row.attempts],
      db
    );
    if (Number(res.meta?.changes ?? 0) === 1) {
      claimed.push({
        id: row.id,
        jobType: row.job_type,
        dedupeKey: row.dedupe_key,
        payload: sqlJson<Record<string, unknown>>(row.payload, {}),
        attempts: Number(row.attempts) + 1,
        maxAttempts: Number(row.max_attempts),
        runAfter: row.run_after,
      });
    }
  }
  return claimed;
}

async function executeClaimedD1Job(
  job: D1ClaimedJobRow,
  db: D1DatabaseLike
): Promise<'Completed' | 'Pending' | 'Failed'> {
  const startedMs = Date.now();
  const currentAttempt = job.attempts;
  const payload = job.payload ?? {};

  try {
    if (job.jobType === 'notification_email') {
      await handleNotificationEmailJobD1(payload as unknown as D1NotificationEmailPayload, db);
    } else if (job.jobType === 'session_reminders') {
      await runD1SessionReminderSweep(db);
    } else if (job.jobType === 'fee_reminders') {
      await runD1FeeReminderSweep(undefined, db);
    } else {
      throw new Error(`Unknown background job type: ${job.jobType}`);
    }

    const sanitizedPayload =
      job.jobType === 'notification_email' && payload.redactSensitive === true
        ? JSON.stringify({ ...payload, bodyText: '[REDACTED AFTER DELIVERY]' })
        : JSON.stringify(payload);

    const now = nowIso();
    const durationMs = Math.max(0, Date.now() - startedMs);
    await d1Run(
      `UPDATE background_jobs
       SET status = 'Completed',
           completed_at = ?,
           worker_id = NULL,
           locked_at = NULL,
           lease_expires_at = NULL,
           duration_ms = ?,
           last_error = NULL,
           payload = ?,
           updated_at = ?
       WHERE id = ?`,
      [now, durationMs, sanitizedPayload, now, job.id],
      db
    );
    return 'Completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Background job execution failed.';
    const exhausted = currentAttempt >= job.maxAttempts;
    const delayMs = Math.pow(2, currentAttempt) * 15_000;
    const durationMs = Math.max(0, Date.now() - startedMs);
    const now = nowIso();

    if (job.jobType === 'notification_email' && typeof payload.deliveryLogId === 'string') {
      await d1Run(
        'UPDATE delivery_logs SET status = ?, error_message = ?, sent_at = ? WHERE id = ?',
        [
          exhausted ? 'Failed' : 'Queued',
          `${message.slice(0, 500)} (attempt ${currentAttempt}/${job.maxAttempts})`,
          now,
          payload.deliveryLogId,
        ],
        db
      ).catch(() => undefined);
    }

    const nextPayload =
      exhausted && job.jobType === 'notification_email' && payload.redactSensitive === true
        ? JSON.stringify({ ...payload, bodyText: '[REDACTED AFTER FAILURE]' })
        : JSON.stringify(payload);

    await d1Run(
      `UPDATE background_jobs
       SET status = ?,
           worker_id = NULL,
           locked_at = NULL,
           lease_expires_at = NULL,
           duration_ms = ?,
           last_error = ?,
           completed_at = ?,
           run_after = ?,
           payload = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        exhausted ? 'Failed' : 'Pending',
        durationMs,
        message.slice(0, 1000),
        exhausted ? now : null,
        exhausted ? job.runAfter : new Date(Date.now() + delayMs).toISOString(),
        nextPayload,
        now,
        job.id,
      ],
      db
    );

    return exhausted ? 'Failed' : 'Pending';
  }
}

export async function processD1JobById(
  jobId: string,
  options?: { workerId?: string; leaseMs?: number; now?: Date },
  db: D1DatabaseLike = getActiveD1()
): Promise<{ found: boolean; status: 'Completed' | 'Pending' | 'Failed' | 'Skipped' }> {
  const existing = await d1First<{
    id: string;
    job_type: string;
    dedupe_key: string | null;
    payload: string;
    attempts: number;
    max_attempts: number;
    run_after: string;
    status: string;
  }>(
    "SELECT id, job_type, dedupe_key, payload, attempts, max_attempts, run_after, status FROM background_jobs WHERE id = ? AND status = 'Pending' LIMIT 1",
    [jobId],
    db
  );

  if (!existing) {
    return { found: false, status: 'Skipped' };
  }

  const now = options?.now ?? new Date();
  const nowStr = now.toISOString();
  const leaseMs = options?.leaseMs ?? resolveWorkerLeaseMs();
  const workerId = options?.workerId || resolveDefaultD1WorkerId();
  const leaseExpiresAtStr = new Date(now.getTime() + leaseMs).toISOString();

  const claimRes = await d1Run(
    `UPDATE background_jobs
     SET status = 'Processing',
         worker_id = ?,
         locked_at = ?,
         started_at = ?,
         lease_expires_at = ?,
         attempts = attempts + 1,
         updated_at = ?
     WHERE id = ? AND status = 'Pending' AND attempts = ?`,
    [workerId, nowStr, nowStr, leaseExpiresAtStr, nowStr, existing.id, existing.attempts],
    db
  );

  if (Number(claimRes.meta?.changes ?? 0) === 0) {
    return { found: false, status: 'Skipped' };
  }

  const outcome = await executeClaimedD1Job(
    {
      id: existing.id,
      jobType: existing.job_type,
      dedupeKey: existing.dedupe_key,
      payload: sqlJson<Record<string, unknown>>(existing.payload, {}),
      attempts: Number(existing.attempts) + 1,
      maxAttempts: Number(existing.max_attempts),
      runAfter: existing.run_after,
    },
    db
  );

  return { found: true, status: outcome };
}

export async function processPendingD1Jobs(
  limit = 20,
  options?: { workerId?: string; leaseMs?: number },
  db: D1DatabaseLike = getActiveD1()
): Promise<number> {
  await recoverStaleD1Jobs({ fallbackStaleMs: options?.leaseMs }, db);
  const claimedJobs = await claimPendingD1Jobs(limit, options, db);
  let processed = 0;

  for (const job of claimedJobs) {
    const outcome = await executeClaimedD1Job(job, db);
    if (outcome === 'Completed') {
      processed += 1;
    }
  }

  return processed;
}

export async function runD1HousekeepingCleanup(
  now = new Date(),
  db: D1DatabaseLike = getActiveD1()
): Promise<{ expiredSessionsDeleted: number; expiredResetTokensDeleted: number }> {
  const nowStr = now.toISOString();
  const sessionCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const resetCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [sessRes, tokenRes] = await Promise.all([
    d1Run(
      'DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
      [nowStr, sessionCutoff],
      db
    ),
    d1Run(
      'DELETE FROM password_reset_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)',
      [resetCutoff, resetCutoff],
      db
    ),
  ]);

  return {
    expiredSessionsDeleted: Number(sessRes.meta?.changes ?? 0),
    expiredResetTokensDeleted: Number(tokenRes.meta?.changes ?? 0),
  };
}

export async function getD1WorkerTelemetry(
  db: D1DatabaseLike = getActiveD1()
): Promise<D1WorkerTelemetry> {
  const nowStr = nowIso();
  const [grouped, staleRow, recentFailures] = await Promise.all([
    d1All<{ status: string; cnt: number }>(
      'SELECT status, COUNT(*) AS cnt FROM background_jobs GROUP BY status',
      [],
      db
    ),
    d1First<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM background_jobs WHERE status = 'Processing' AND lease_expires_at < ?",
      [nowStr],
      db
    ),
    d1All<{
      id: string;
      job_type: string;
      attempts: number;
      max_attempts: number;
      last_error: string | null;
      duration_ms: number | null;
      updated_at: string;
    }>(
      "SELECT id, job_type, attempts, max_attempts, last_error, duration_ms, updated_at FROM background_jobs WHERE status = 'Failed' ORDER BY updated_at DESC LIMIT 15",
      [],
      db
    ),
  ]);

  const countsByStatus: D1WorkerTelemetry['countsByStatus'] = {
    Pending: 0,
    Processing: 0,
    Completed: 0,
    Failed: 0,
  };
  for (const row of grouped) {
    if (row.status in countsByStatus) {
      countsByStatus[row.status as keyof D1WorkerTelemetry['countsByStatus']] = Number(row.cnt);
    }
  }

  return {
    workerId: resolveDefaultD1WorkerId(),
    leaseMs: resolveWorkerLeaseMs(),
    countsByStatus,
    staleProcessingCount: Number(staleRow?.cnt ?? 0),
    recentFailures: recentFailures.map((f) => ({
      id: f.id,
      jobType: f.job_type,
      attempts: Number(f.attempts),
      maxAttempts: Number(f.max_attempts),
      lastError: f.last_error,
      durationMs: f.duration_ms !== null ? Number(f.duration_ms) : null,
      updatedAt: f.updated_at,
    })),
  };
}

export async function handleD1WorkerQueueBatch(
  batch: WorkerQueueBatchD1Like<D1JobQueueMessage>,
  env: WorkerD1EnvBindings,
  _ctx?: WorkerD1ExecutionContextLike
): Promise<{ acked: number; retried: number }> {
  if (!env.DB) {
    throw new Error('Cloudflare D1 DB binding is required for Queue consumer.');
  }
  let acked = 0;
  let retried = 0;

  await runWithD1Database(env.DB, () =>
    runWithD1EmailConfig(extractWorkerEmailEnv(env), () =>
      runWithD1JobQueue(env.JOBS_QUEUE, async () => {
        for (const msg of batch.messages) {
          const jobId = msg.body?.jobId;
          if (typeof jobId !== 'string' || !jobId.trim()) {
            msg.ack();
            acked += 1;
            continue;
          }
          try {
            const res = await processD1JobById(
              jobId,
              { workerId: `cf-queue-${batch.queue}` },
              env.DB!
            );
            if (res.status === 'Pending') {
              msg.retry({ delaySeconds: Math.min(300, Math.max(15, msg.attempts * 30)) });
              retried += 1;
            } else {
              msg.ack();
              acked += 1;
            }
          } catch (err) {
            console.error(`Queue message ${msg.id} (job ${jobId}) failed:`, err);
            msg.retry({ delaySeconds: Math.min(300, Math.max(15, msg.attempts * 30)) });
            retried += 1;
          }
        }
      })
    )
  );

  return { acked, retried };
}

export async function handleD1WorkerScheduledSweep(
  _controller: WorkerD1ScheduledControllerLike,
  env: WorkerD1EnvBindings,
  _ctx?: WorkerD1ExecutionContextLike
): Promise<D1ScheduledSweepSummary> {
  if (!env.DB) {
    throw new Error('Cloudflare D1 DB binding is required for scheduled Cron sweeps.');
  }

  return runWithD1Database(env.DB, () =>
    runWithD1EmailConfig(extractWorkerEmailEnv(env), () =>
      runWithD1JobQueue(env.JOBS_QUEUE, async () => {
        const recovery = await recoverStaleD1Jobs(undefined, env.DB!);
        const processedPending = await processPendingD1Jobs(
          20,
          { workerId: 'cf-cron-worker' },
          env.DB!
        );
        const sessionRemindersCreated = await runD1SessionReminderSweep(env.DB!);
        const feeResult = await runD1FeeReminderSweep(undefined, env.DB!);
        const housekeeping = await runD1HousekeepingCleanup(new Date(), env.DB!);

        return {
          recoveredPending: recovery.recoveredPending,
          failedExhausted: recovery.failedExhausted,
          processedPending,
          sessionRemindersCreated,
          feeRemindersQueued: feeResult.queuedCount,
          expiredSessionsDeleted: housekeeping.expiredSessionsDeleted,
          expiredResetTokensDeleted: housekeeping.expiredResetTokensDeleted,
        };
      })
    )
  );
}

export { d1Batch, type D1PreparedStatementLike };
