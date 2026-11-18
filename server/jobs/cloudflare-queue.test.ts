import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithDatabaseContext } from '../db/prisma.ts';
import {
  runWithEmailConfig,
  sendTransactionalEmail,
  verifyEmailTransport,
} from '../email/mailer.ts';
import {
  handleWorkerQueueBatch,
  handleWorkerScheduledSweep,
} from './cloudflare-queue.ts';
import {
  type JobQueueMessage,
  enqueueJob,
  queueTransactionalEmail,
  runWithJobQueue,
} from './worker.ts';

test('HTTP email transport delivers via Resend-compatible HTTP API and verifies configuration', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 're_msg_12345' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await runWithEmailConfig(
      {
        EMAIL_PROVIDER: 'http',
        RESEND_API_KEY: 're_test_key_only',
        EMAIL_FROM: 'IGS Academy <noreply@igs-sopore.example>',
      },
      async () => {
        const verification = await verifyEmailTransport();
        assert.equal(verification.configured, true);
        assert.equal(verification.reachable, true);
        assert.equal(verification.provider, 'http');

        const res = await sendTransactionalEmail({
          to: 'student@example.com',
          subject: 'Admission Update',
          text: 'Your admission was logged.',
        });
        assert.equal(res.status, 'Delivered');
        assert.equal(res.messageId, 're_msg_12345');
        assert.equal(capturedUrl, 'https://api.resend.com/emails');
        assert.equal(capturedHeaders.Authorization, 'Bearer re_test_key_only');
        assert.deepEqual(capturedBody.to, ['student@example.com']);
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP email transport maps non-2xx API responses to Failed cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('Invalid domain', { status: 422 })) as typeof fetch;

  try {
    await runWithEmailConfig(
      {
        EMAIL_PROVIDER: 'http',
        EMAIL_HTTP_URL: 'https://mail.example/send',
        EMAIL_FROM: 'noreply@igs-sopore.example',
      },
      async () => {
        const res = await sendTransactionalEmail({
          to: 'student@example.com',
          subject: 'Test',
          text: 'Body',
        });
        assert.equal(res.status, 'Failed');
        assert.ok(res.reason?.includes('422'));
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('enqueueJob dispatches non-sensitive reference message to Cloudflare Queue without leaking tokens', async () => {
  const queuedMessages: JobQueueMessage[] = [];
  const fakeDb = {
    backgroundJob: {
      findUnique: async () => null,
      create: async (args: { data: { id: string; jobType: string } }) => ({
        id: args.data.id,
        jobType: args.data.jobType,
      }),
    },
    deliveryLog: {
      create: async () => ({ id: 'dlog-1' }),
    },
  } as never;

  await runWithJobQueue(
    {
      send: async (msg) => {
        queuedMessages.push(msg);
      },
    },
    async () => {
      const queued = await queueTransactionalEmail(fakeDb, {
        recipientEmail: 'applicant@example.com',
        subject: 'Reset link',
        bodyText: 'https://app.example/login?resetToken=SUPER_SECRET_RAW_TOKEN',
        redactSensitive: true,
      });
      assert.ok(queued?.jobId);

      const directJob = await enqueueJob('session_reminders', { test: 1 }, { db: fakeDb });
      assert.ok(directJob.id);
    }
  );

  assert.equal(queuedMessages.length, 2);
  assert.equal(queuedMessages[0].jobType, 'notification_email');
  assert.equal(
    JSON.stringify(queuedMessages).includes('SUPER_SECRET_RAW_TOKEN'),
    false
  );
});

test('handleWorkerQueueBatch acks completed/exhausted jobs and retries pending backoff jobs', async () => {
  const outcomes: Array<{ id: string; action: 'ack' | 'retry' }> = [];
  const fakePrisma = {} as never;
  const fakePool = {} as never;

  const result = await runWithDatabaseContext(
    { prisma: fakePrisma, pool: fakePool, mode: 'hyperdrive' },
    () =>
      handleWorkerQueueBatch(
        {
          queue: 'igs-ams-jobs',
          messages: [
            {
              id: 'm1',
              attempts: 1,
              body: { jobId: 'job-ok', jobType: 'notification_email', enqueuedAt: '' },
              ack: () => outcomes.push({ id: 'm1', action: 'ack' }),
              retry: () => outcomes.push({ id: 'm1', action: 'retry' }),
            },
            {
              id: 'm2',
              attempts: 1,
              body: { jobId: 'job-retry', jobType: 'notification_email', enqueuedAt: '' },
              ack: () => outcomes.push({ id: 'm2', action: 'ack' }),
              retry: () => outcomes.push({ id: 'm2', action: 'retry' }),
            },
            {
              id: 'm3',
              attempts: 3,
              body: { jobId: 'job-failed-perm', jobType: 'notification_email', enqueuedAt: '' },
              ack: () => outcomes.push({ id: 'm3', action: 'ack' }),
              retry: () => outcomes.push({ id: 'm3', action: 'retry' }),
            },
          ],
        },
        {},
        undefined,
        {
          useDirectDatabaseContext: true,
          processJobById: async (jobId) => {
            if (jobId === 'job-ok') return { found: true, status: 'Completed' };
            if (jobId === 'job-retry') return { found: true, status: 'Pending' };
            return { found: true, status: 'Failed' };
          },
        }
      )
  );

  assert.deepEqual(result, { acked: 2, retried: 1 });
  assert.deepEqual(outcomes, [
    { id: 'm1', action: 'ack' },
    { id: 'm2', action: 'retry' },
    { id: 'm3', action: 'ack' },
  ]);
});

test('handleWorkerScheduledSweep executes stale recovery, reminders, fee reminders, and housekeeping', async () => {
  const summary = await runWithDatabaseContext(
    { prisma: {} as never, pool: {} as never, mode: 'hyperdrive' },
    () =>
      handleWorkerScheduledSweep(
        { cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry: () => undefined },
        {},
        undefined,
        {
          useDirectDatabaseContext: true,
          recoverStale: async () => ({ recoveredPending: 2, failedExhausted: 1 }),
          processPending: async () => 3,
          runSessionSweep: async () => 4,
          runFeeSweep: async () => ({ queuedCount: 5, scannedInvoices: 8 }),
          cleanupHousekeeping: async () => ({
            expiredSessionsDeleted: 6,
            expiredResetTokensDeleted: 7,
          }),
        }
      )
  );

  assert.deepEqual(summary, {
    recoveredPending: 2,
    failedExhausted: 1,
    processedPending: 3,
    sessionRemindersCreated: 4,
    feeRemindersQueued: 5,
    expiredSessionsDeleted: 6,
    expiredResetTokensDeleted: 7,
  });
});
