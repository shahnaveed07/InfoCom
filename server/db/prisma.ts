import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { buildPgPoolConfig, resolveAppEnvironment } from './config.ts';

export interface HyperdriveBinding {
  connectionString: string;
}

export type DatabaseConnectionMode = 'hyperdrive' | 'pool';

export interface RequestDatabaseContext {
  prisma: PrismaClient;
  pool: Pool;
  mode: DatabaseConnectionMode;
}

export interface DatabaseReadinessResult {
  ready: boolean;
  status: 'ready' | 'degraded';
  database: 'connected' | 'unavailable';
  mode: DatabaseConnectionMode | 'uninitialized';
  latencyMs: number;
  errorCode?: string;
}

export class HyperdriveConfigurationError extends Error {
  code = 'HYPERDRIVE_BINDING_MISSING';
  constructor(message = 'Cloudflare Hyperdrive binding (HYPERDRIVE) is missing or unconfigured.') {
    super(message);
    this.name = 'HyperdriveConfigurationError';
  }
}

const dbRequestStore = new AsyncLocalStorage<RequestDatabaseContext>();

declare global {
  var _prismaPool: Pool | undefined;
  var _prismaClient: PrismaClient | undefined;
}

export function getActiveRequestDatabaseContext(): RequestDatabaseContext | undefined {
  return dbRequestStore.getStore();
}

export function createRequestScopedDatabase(connectionString: string): {
  pool: Pool;
  prisma: PrismaClient;
  close: () => Promise<void>;
} {
  if (!connectionString || !connectionString.trim()) {
    throw new HyperdriveConfigurationError(
      'Database connection string for request-scoped pool is empty.'
    );
  }
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (err) => {
    console.error('Request-scoped PostgreSQL pool error:', err instanceof Error ? err.message : 'unknown');
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({
    adapter,
    log: resolveAppEnvironment() === 'development' ? ['error', 'warn'] : ['error'],
  });
  return {
    pool,
    prisma: client,
    close: async () => {
      await client.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

/**
 * Executes an async operation (Worker HTTP request, Queue batch, or Cron sweep)
 * inside an isolated per-request PostgreSQL Pool + PrismaClient backed by Cloudflare
 * Hyperdrive (`env.HYPERDRIVE.connectionString`).
 */
export async function runWithHyperdriveDatabase<T>(
  binding: HyperdriveBinding | undefined | null,
  fn: () => Promise<T>,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<T> {
  if (!binding || typeof binding.connectionString !== 'string' || !binding.connectionString.trim()) {
    throw new HyperdriveConfigurationError();
  }
  const scoped = createRequestScopedDatabase(binding.connectionString);
  const context: RequestDatabaseContext = {
    prisma: scoped.prisma,
    pool: scoped.pool,
    mode: 'hyperdrive',
  };
  try {
    return await dbRequestStore.run(context, fn);
  } finally {
    const cleanup = scoped.close();
    if (waitUntil) {
      waitUntil(cleanup);
    } else {
      await cleanup;
    }
  }
}

/**
 * Executes an arbitrary callback inside a provided RequestDatabaseContext (used in tests
 * and request-scoped Node runners).
 */
export async function runWithDatabaseContext<T>(
  context: RequestDatabaseContext,
  fn: () => Promise<T>
): Promise<T> {
  return dbRequestStore.run(context, fn);
}

export function getPrismaPool(): Pool {
  const active = dbRequestStore.getStore();
  if (active) {
    return active.pool;
  }
  if (!global._prismaPool) {
    const pool = new Pool(buildPgPoolConfig({ admin: false }));
    pool.on('error', (err) => {
      console.error('Unexpected idle PostgreSQL pool client error:', err);
    });
    global._prismaPool = pool;
  }
  return global._prismaPool;
}

export function getPrismaClient(): PrismaClient {
  const active = dbRequestStore.getStore();
  if (active) {
    return active.prisma;
  }
  if (!global._prismaClient) {
    const adapter = new PrismaPg(getPrismaPool());
    global._prismaClient = new PrismaClient({
      adapter,
      log: resolveAppEnvironment() === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return global._prismaClient;
}

/**
 * Lazy proxy delegating to the active request-scoped client (Hyperdrive on Workers)
 * or lazy Node singleton pool, avoiding eager module-level database connections.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export async function checkDatabaseReadiness(): Promise<DatabaseReadinessResult> {
  const started = Date.now();
  const active = dbRequestStore.getStore();
  const mode: DatabaseReadinessResult['mode'] = active
    ? active.mode
    : global._prismaClient
      ? 'pool'
      : 'uninitialized';

  try {
    const client = getPrismaClient();
    await client.$queryRawUnsafe('SELECT 1');
    return {
      ready: true,
      status: 'ready',
      database: 'connected',
      mode: active ? active.mode : 'pool',
      latencyMs: Math.max(0, Date.now() - started),
    };
  } catch (err) {
    const errorCode =
      err instanceof HyperdriveConfigurationError
        ? err.code
        : typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : 'DB_UNAVAILABLE';
    console.error('Database readiness check failed:', errorCode);
    return {
      ready: false,
      status: 'degraded',
      database: 'unavailable',
      mode,
      latencyMs: Math.max(0, Date.now() - started),
      errorCode,
    };
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (global._prismaClient) {
    await global._prismaClient.$disconnect();
    global._prismaClient = undefined;
  }
  if (global._prismaPool) {
    await global._prismaPool.end();
    global._prismaPool = undefined;
  }
}
