import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizePoolErrorSummary, withTransientDbRetry } from '../db/prisma.ts';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from '../d1/client.ts';
import {
  processPendingD1Jobs,
  setD1EmailSenderOverrideForTest,
} from './d1-worker.ts';

test('withTransientDbRetry retries transient connection drops and recovers cleanly', async () => {
  let attempts = 0;
  const result = await withTransientDbRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('Connection terminated unexpectedly');
      }
      return 'recovered';
    },
    { maxRetries: 2, delayMs: 10 }
  );

  assert.equal(result, 'recovered');
  assert.equal(attempts, 3);
});

test('withTransientDbRetry does NOT retry non-transient SQL/validation errors', async () => {
  let attempts = 0;
  await assert.rejects(
    withTransientDbRetry(
      async () => {
        attempts += 1;
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code?: string;
        };
        err.code = '23505';
        throw err;
      },
      { maxRetries: 3, delayMs: 10 }
    ),
    /duplicate key/
  );
  assert.equal(attempts, 1);
});

test('sanitizePoolErrorSummary classifies transient codes and masks PostgreSQL credentials', () => {
  const transient = sanitizePoolErrorSummary({
    code: '57P01',
    message: 'terminating connection due to administrator command on postgresql://user:secret@host/db',
  });
  assert.equal(transient.transient, true);
  assert.equal(transient.code, '57P01');
  assert.equal(transient.message.includes('secret'), false);
  assert.equal(transient.message.includes('postgresql://***@'), true);

  const nonTransient = sanitizePoolErrorSummary({
    code: '42601',
    message: 'syntax error at or near SELECT',
  });
  assert.equal(nonTransient.transient, false);
});

test('email job idempotency prevents duplicate email sends when delivery_log is already Delivered', async () => {
  let sendCalls = 0;
  let completedUpdates = 0;

  // Minimal stateful D1 stub simulating a recovered job whose delivery_log was already Delivered
  const jobState = {
    id: 'job-idem-1',
    job_type: 'notification_email',
    dedupe_key: 'idem-key-1',
    payload: JSON.stringify({
      deliveryLogId: 'dlog-already-delivered',
      recipientEmail: 'student@infocom.edu',
      subject: 'Test',
      bodyText: 'Hello',
      bypassPreferences: true,
    }),
    attempts: 1,
    max_attempts: 3,
    run_after: new Date(Date.now() - 60_000).toISOString(),
    status: 'Pending',
  };

  const mockDb: D1DatabaseLike = {
    prepare(sql: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const stmt: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM delivery_logs WHERE id = ?')) {
            return { status: 'Delivered' } as T;
          }
          return null;
        },
        async all<T>(): Promise<D1ResultLike<T>> {
          if (sql.includes("WHERE status = 'Processing'")) {
            return { success: true, results: [] };
          }
          if (sql.includes("WHERE status = 'Pending'")) {
            return {
              success: true,
              results: jobState.status === 'Pending' ? ([{ ...jobState }] as unknown as T[]) : [],
            };
          }
          return { success: true, results: [] };
        },
        async run(): Promise<D1ResultLike> {
          if (sql.includes("SET status = 'Processing'")) {
            jobState.status = 'Processing';
            jobState.attempts += 1;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'Completed'")) {
            // Verify conditional guard includes status='Processing' AND attempts=?
            assert.match(sql, /status = 'Processing' AND attempts = \?/);
            assert.equal(bound[bound.length - 1], jobState.attempts);
            jobState.status = 'Completed';
            completedUpdates += 1;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async raw<T>(): Promise<T[]> {
          return [];
        },
      };
      return stmt;
    },
    async batch() {
      return [];
    },
  };

  setD1EmailSenderOverrideForTest(async () => {
    sendCalls += 1;
    return { status: 'Delivered', messageId: 'msg-1', reason: null };
  });

  try {
    const processed = await processPendingD1Jobs(5, { workerId: 'test-worker' }, mockDb);
    assert.equal(processed, 1);
    assert.equal(completedUpdates, 1);
    assert.equal(sendCalls, 0, 'Must NOT invoke email transport when delivery_log is already Delivered');
  } finally {
    setD1EmailSenderOverrideForTest(null);
  }
});
