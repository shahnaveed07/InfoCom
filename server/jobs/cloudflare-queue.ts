import { type HyperdriveBinding, prisma, runWithHyperdriveDatabase } from '../db/prisma.ts';
import { type EmailConfigOverrides, runWithEmailConfig } from '../email/mailer.ts';
import {
  type JobQueueBindingLike,
  type JobQueueMessage,
  processPendingJobs,
  processSpecificJobId,
  recoverStaleProcessingJobs,
  runFeeReminderSweep,
  runSessionRemindersSweep,
  runWithJobQueue,
} from './worker.ts';

export interface WorkerQueueMessageLike<T = unknown> {
  id: string;
  body: T;
  attempts: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

export interface WorkerQueueBatchLike<T = unknown> {
  queue: string;
  messages: ReadonlyArray<WorkerQueueMessageLike<T>>;
}

export interface WorkerExecutionContextLike {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

export interface WorkerScheduledControllerLike {
  cron: string;
  scheduledTime: number;
  noRetry: () => void;
}

export interface WorkerRuntimeEnvBindings extends EmailConfigOverrides {
  HYPERDRIVE?: HyperdriveBinding;
  JOBS_QUEUE?: JobQueueBindingLike;
}

export interface WorkerScheduledSweepSummary {
  recoveredPending: number;
  failedExhausted: number;
  processedPending: number;
  sessionRemindersCreated: number;
  feeRemindersQueued: number;
  expiredSessionsDeleted: number;
  expiredResetTokensDeleted: number;
}

export function extractEmailConfigFromEnv(env: WorkerRuntimeEnvBindings): EmailConfigOverrides {
  return {
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    EMAIL_FROM: env.EMAIL_FROM,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_HTTP_URL: env.EMAIL_HTTP_URL,
    EMAIL_HTTP_TOKEN: env.EMAIL_HTTP_TOKEN,
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_SECURE: env.SMTP_SECURE,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASS: env.SMTP_PASS,
    SMTP_FROM: env.SMTP_FROM,
  };
}

export async function handleWorkerQueueBatch(
  batch: WorkerQueueBatchLike<JobQueueMessage>,
  env: WorkerRuntimeEnvBindings,
  ctx?: WorkerExecutionContextLike,
  deps?: {
    processJobById?: typeof processSpecificJobId;
    useDirectDatabaseContext?: boolean;
  }
): Promise<{ acked: number; retried: number }> {
  const processJobById = deps?.processJobById ?? processSpecificJobId;
  let acked = 0;
  let retried = 0;

  const execute = async () => {
    for (const msg of batch.messages) {
      const jobId = msg.body?.jobId;
      if (typeof jobId !== 'string' || !jobId.trim()) {
        msg.ack();
        acked += 1;
        continue;
      }

      try {
        const result = await processJobById(jobId, {
          workerId: `cf-queue-${batch.queue}`,
        });
        if (result.status === 'Pending') {
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
  };

  const withEmailAndQueue = () =>
    runWithEmailConfig(extractEmailConfigFromEnv(env), () =>
      runWithJobQueue(env.JOBS_QUEUE, execute)
    );

  if (deps?.useDirectDatabaseContext) {
    await withEmailAndQueue();
  } else {
    await runWithHyperdriveDatabase(env.HYPERDRIVE, withEmailAndQueue, ctx?.waitUntil);
  }

  return { acked, retried };
}

export async function runHousekeepingCleanup(now = new Date()): Promise<{
  expiredSessionsDeleted: number;
  expiredResetTokensDeleted: number;
}> {
  const sessionCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const resetCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [sessionsRes, resetsRes] = await Promise.all([
    prisma.authSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: sessionCutoff } }],
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: resetCutoff } }, { usedAt: { lt: resetCutoff } }],
      },
    }),
  ]);

  return {
    expiredSessionsDeleted: sessionsRes.count,
    expiredResetTokensDeleted: resetsRes.count,
  };
}

export async function handleWorkerScheduledSweep(
  _controller: WorkerScheduledControllerLike,
  env: WorkerRuntimeEnvBindings,
  ctx?: WorkerExecutionContextLike,
  deps?: {
    useDirectDatabaseContext?: boolean;
    recoverStale?: typeof recoverStaleProcessingJobs;
    processPending?: typeof processPendingJobs;
    runSessionSweep?: typeof runSessionRemindersSweep;
    runFeeSweep?: typeof runFeeReminderSweep;
    cleanupHousekeeping?: typeof runHousekeepingCleanup;
  }
): Promise<WorkerScheduledSweepSummary> {
  const recoverStale = deps?.recoverStale ?? recoverStaleProcessingJobs;
  const processPending = deps?.processPending ?? processPendingJobs;
  const runSessionSweep = deps?.runSessionSweep ?? runSessionRemindersSweep;
  const runFeeSweep = deps?.runFeeSweep ?? runFeeReminderSweep;
  const cleanupHousekeeping = deps?.cleanupHousekeeping ?? runHousekeepingCleanup;

  const execute = async (): Promise<WorkerScheduledSweepSummary> => {
    const recovery = await recoverStale();
    const processedPending = await processPending(20, { workerId: 'cf-cron-worker' });
    const sessionRemindersCreated = await runSessionSweep();
    const feeResult = await runFeeSweep();
    const housekeeping = await cleanupHousekeeping();

    return {
      recoveredPending: recovery.recoveredPending,
      failedExhausted: recovery.failedExhausted,
      processedPending,
      sessionRemindersCreated,
      feeRemindersQueued: feeResult.queuedCount,
      expiredSessionsDeleted: housekeeping.expiredSessionsDeleted,
      expiredResetTokensDeleted: housekeeping.expiredResetTokensDeleted,
    };
  };

  const withEmailAndQueue = () =>
    runWithEmailConfig(extractEmailConfigFromEnv(env), () =>
      runWithJobQueue(env.JOBS_QUEUE, execute)
    );

  if (deps?.useDirectDatabaseContext) {
    return withEmailAndQueue();
  }
  return runWithHyperdriveDatabase(env.HYPERDRIVE, withEmailAndQueue, ctx?.waitUntil);
}
