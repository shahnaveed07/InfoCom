import { AsyncLocalStorage } from 'node:async_hooks';

export interface D1ExecResultLike {
  count?: number;
  duration?: number;
}

export interface D1ResultMetaLike {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1ResultLike<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: D1ResultMetaLike;
}

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = Record<string, unknown>>(colName?: string) => Promise<T | null>;
  run: () => Promise<D1ResultLike>;
  all: <T = Record<string, unknown>>() => Promise<D1ResultLike<T>>;
  raw: <T = unknown[]>() => Promise<T[]>;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: <T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[]
  ) => Promise<Array<D1ResultLike<T>>>;
  exec?: (query: string) => Promise<D1ExecResultLike>;
}

export class D1ConfigurationError extends Error {
  code = 'D1_BINDING_MISSING';
  constructor(message = 'Cloudflare D1 DB binding is missing or unconfigured.') {
    super(message);
    this.name = 'D1ConfigurationError';
  }
}

export class WorkflowError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'WORKFLOW_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'WorkflowError';
  }
}

const d1Store = new AsyncLocalStorage<D1DatabaseLike>();

export function hasActiveD1(): boolean {
  return Boolean(d1Store.getStore());
}

export function getActiveD1(): D1DatabaseLike {
  const db = d1Store.getStore();
  if (!db) {
    throw new D1ConfigurationError();
  }
  return db;
}

export async function runWithD1Database<T>(
  db: D1DatabaseLike | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!db) {
    return fn();
  }
  return d1Store.run(db, fn);
}

function sanitizeBindValue(val: unknown): unknown {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val instanceof Date) return val.toISOString();
  return val;
}

export function d1Stmt(
  sql: string,
  params: unknown[] = [],
  db: D1DatabaseLike = getActiveD1()
): D1PreparedStatementLike {
  const stmt = db.prepare(sql);
  if (params.length === 0) return stmt;
  return stmt.bind(...params.map(sanitizeBindValue));
}

export async function d1All<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: D1DatabaseLike = getActiveD1()
): Promise<T[]> {
  const res = await d1Stmt(sql, params, db).all<T>();
  return res.results ?? [];
}

export async function d1First<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  db: D1DatabaseLike = getActiveD1()
): Promise<T | null> {
  return d1Stmt(sql, params, db).first<T>();
}

export async function d1Run(
  sql: string,
  params: unknown[] = [],
  db: D1DatabaseLike = getActiveD1()
): Promise<D1ResultLike> {
  return d1Stmt(sql, params, db).run();
}

export async function d1Batch(
  statements: D1PreparedStatementLike[],
  db: D1DatabaseLike = getActiveD1()
): Promise<Array<D1ResultLike>> {
  if (statements.length === 0) return [];
  return db.batch(statements);
}

export async function checkD1Readiness(
  db: D1DatabaseLike | undefined | null
): Promise<{
  ready: boolean;
  status: 'ok' | 'degraded';
  database: 'connected' | 'unavailable';
  mode: 'd1' | 'uninitialized';
  latencyMs: number;
  errorCode?: string;
}> {
  const started = Date.now();
  if (!db) {
    return {
      ready: false,
      status: 'degraded',
      database: 'unavailable',
      mode: 'uninitialized',
      latencyMs: Math.max(0, Date.now() - started),
      errorCode: 'D1_BINDING_MISSING',
    };
  }
  try {
    await db.prepare('SELECT 1 AS ok').first();
    // Verify schema has been applied
    const roleCheck = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'academies'")
      .first<{ name: string }>();
    if (!roleCheck) {
      return {
        ready: false,
        status: 'degraded',
        database: 'unavailable',
        mode: 'd1',
        latencyMs: Math.max(0, Date.now() - started),
        errorCode: 'D1_SCHEMA_NOT_APPLIED',
      };
    }
    return {
      ready: true,
      status: 'ok',
      database: 'connected',
      mode: 'd1',
      latencyMs: Math.max(0, Date.now() - started),
    };
  } catch {
    return {
      ready: false,
      status: 'degraded',
      database: 'unavailable',
      mode: 'd1',
      latencyMs: Math.max(0, Date.now() - started),
      errorCode: 'D1_UNAVAILABLE',
    };
  }
}

export function sqlBool(val: unknown): boolean {
  return val === true || val === 1 || val === '1' || val === 'true';
}

export function sqlJson<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

export function sqlFixed(val: unknown, fallback = '0.00'): string {
  if (val === null || val === undefined || val === '') return fallback;
  const num = Number(val);
  return Number.isFinite(num) ? num.toFixed(2) : fallback;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string, chars = 8): string {
  return `${prefix}-${crypto.randomUUID().slice(0, chars)}`;
}

export function inPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
