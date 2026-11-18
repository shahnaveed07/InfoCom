import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HyperdriveConfigurationError,
  checkDatabaseReadiness,
  createRequestScopedDatabase,
  getActiveRequestDatabaseContext,
  getPrismaClient,
  runWithDatabaseContext,
  runWithHyperdriveDatabase,
  sanitizePoolErrorSummary,
} from './prisma.ts';

test('sanitizePoolErrorSummary classifies transient idle drops and strips connection credentials', () => {
  const errWithClient = Object.assign(new Error('Connection terminated unexpectedly'), {
    client: { _events: {}, _connectionError: false, password: 'NeverLeakPassword' },
  });
  const summary = sanitizePoolErrorSummary(errWithClient);
  assert.equal(summary.transient, true);
  assert.equal(summary.code, 'IDLE_CONNECTION_RESET');
  assert.equal(JSON.stringify(summary).includes('NeverLeakPassword'), false);
  assert.equal(JSON.stringify(summary).includes('_connectionError'), false);

  const uriErr = new Error('connect ETIMEDOUT postgresql://admin:SuperSecret@db.internal:5432/app');
  const masked = sanitizePoolErrorSummary(uriErr);
  assert.equal(masked.transient, false);
  assert.equal(masked.message.includes('SuperSecret'), false);
});

test('prisma module exports lazy proxy and detects uninitialized context without eager throw', () => {
  assert.equal(getActiveRequestDatabaseContext(), undefined);
  assert.equal(typeof createRequestScopedDatabase, 'function');
});

test('runWithHyperdriveDatabase rejects missing or blank Hyperdrive binding cleanly', async () => {
  await assert.rejects(
    () => runWithHyperdriveDatabase(undefined, async () => 'never'),
    (err: unknown) =>
      err instanceof HyperdriveConfigurationError &&
      err.code === 'HYPERDRIVE_BINDING_MISSING'
  );

  await assert.rejects(
    () => runWithHyperdriveDatabase({ connectionString: '   ' }, async () => 'never'),
    (err: unknown) =>
      err instanceof HyperdriveConfigurationError &&
      err.code === 'HYPERDRIVE_BINDING_MISSING'
  );
});

test('runWithHyperdriveDatabase binds request-scoped client and cleans up pool/client afterward', async () => {
  const waitUntilPromises: Array<Promise<unknown>> = [];
  let sawHyperdriveContext = false;

  const result = await runWithHyperdriveDatabase(
    { connectionString: 'postgresql://postgres:secret-pass@127.0.0.1:59999/igs_test' },
    async () => {
      const ctx = getActiveRequestDatabaseContext();
      assert.ok(ctx);
      assert.equal(ctx.mode, 'hyperdrive');
      assert.equal(getPrismaClient(), ctx.prisma);
      sawHyperdriveContext = true;
      return 42;
    },
    (p) => {
      waitUntilPromises.push(p);
    }
  );

  assert.equal(result, 42);
  assert.equal(sawHyperdriveContext, true);
  assert.equal(waitUntilPromises.length, 1);
  await Promise.all(waitUntilPromises);
  assert.equal(getActiveRequestDatabaseContext(), undefined);
});

test('checkDatabaseReadiness returns ready when DB responds and sanitizes errors without leaking credentials', async () => {
  const fakePool = {} as never;
  const healthyPrisma = {
    $queryRawUnsafe: async () => [{ '?column?': 1 }],
  } as never;

  const okReadiness = await runWithDatabaseContext(
    { prisma: healthyPrisma, pool: fakePool, mode: 'hyperdrive' },
    () => checkDatabaseReadiness()
  );

  assert.equal(okReadiness.ready, true);
  assert.equal(okReadiness.status, 'ready');
  assert.equal(okReadiness.database, 'connected');
  assert.equal(okReadiness.mode, 'hyperdrive');
  assert.equal(okReadiness.errorCode, undefined);

  const failingPrisma = {
    $queryRawUnsafe: async () => {
      const e = new Error(
        'password authentication failed for postgresql://super:TopSecret123@db.internal:5432/prod'
      ) as Error & { code?: string };
      e.code = 'ECONNREFUSED';
      throw e;
    },
  } as never;

  const degradedReadiness = await runWithDatabaseContext(
    { prisma: failingPrisma, pool: fakePool, mode: 'hyperdrive' },
    () => checkDatabaseReadiness()
  );

  assert.equal(degradedReadiness.ready, false);
  assert.equal(degradedReadiness.status, 'degraded');
  assert.equal(degradedReadiness.database, 'unavailable');
  assert.equal(degradedReadiness.mode, 'hyperdrive');
  assert.equal(degradedReadiness.errorCode, 'ECONNREFUSED');
  assert.equal(JSON.stringify(degradedReadiness).includes('TopSecret123'), false);
  assert.equal(JSON.stringify(degradedReadiness).includes('db.internal'), false);
});
