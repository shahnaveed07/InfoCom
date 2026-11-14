import type { PoolConfig } from 'pg';

export type AppEnvironment = 'development' | 'test' | 'production';

export function resolveAppEnvironment(): AppEnvironment {
  const raw = (process.env.NODE_ENV || 'development').toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'test') return 'test';
  return 'development';
}

/**
 * Builds PostgreSQL connection pool options using the Object Method for Cloud SQL
 * Auth Proxy Unix sockets (SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME), with
 * optional test-environment overrides (TEST_SQL_DB_NAME / TEST_DATABASE_URL) and
 * standard local/CI DATABASE_URL fallback when SQL_HOST is absent.
 */
export function buildPgPoolConfig(options: { admin?: boolean } = {}): PoolConfig {
  const env = resolveAppEnvironment();
  const isTest = env === 'test';

  if (process.env.SQL_HOST && process.env.SQL_DB_NAME) {
    const database = isTest && process.env.TEST_SQL_DB_NAME
      ? process.env.TEST_SQL_DB_NAME
      : process.env.SQL_DB_NAME;

    const user = options.admin
      ? process.env.SQL_ADMIN_USER || process.env.SQL_USER
      : process.env.SQL_USER;
    const password = options.admin
      ? process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD
      : process.env.SQL_PASSWORD;

    return {
      host: process.env.SQL_HOST,
      user,
      password,
      database,
      max: isTest ? 5 : 10,
      connectionTimeoutMillis: 15000,
    };
  }

  const connectionString = isTest
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      `Database configuration missing for "${env}" environment. Set SQL_HOST/SQL_DB_NAME/SQL_USER/SQL_PASSWORD or DATABASE_URL.`
    );
  }

  return {
    connectionString,
    max: isTest ? 5 : 10,
    connectionTimeoutMillis: 15000,
  };
}

/**
 * Constructs a Prisma CLI connection URL from environment variables (preferring
 * SQL_ADMIN_USER/SQL_ADMIN_PASSWORD for schema migrations when running on Cloud SQL).
 */
export function buildPrismaCliDatabaseUrl(options: { admin?: boolean } = { admin: true }): string {
  const env = resolveAppEnvironment();
  const isTest = env === 'test';

  if (isTest && process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  if (process.env.SQL_HOST && process.env.SQL_DB_NAME) {
    const dbName = isTest && process.env.TEST_SQL_DB_NAME
      ? process.env.TEST_SQL_DB_NAME
      : process.env.SQL_DB_NAME;
    const user = options.admin
      ? process.env.SQL_ADMIN_USER || process.env.SQL_USER || 'postgres'
      : process.env.SQL_USER || 'postgres';
    const password = options.admin
      ? process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || ''
      : process.env.SQL_PASSWORD || '';

    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(password);
    const encodedDb = encodeURIComponent(dbName);
    const hostParam = encodeURIComponent(process.env.SQL_HOST);

    if (process.env.SQL_HOST.startsWith('/')) {
      return `postgresql://${encodedUser}:${encodedPass}@localhost/${encodedDb}?host=${hostParam}`;
    }
    return `postgresql://${encodedUser}:${encodedPass}@${process.env.SQL_HOST}:5432/${encodedDb}`;
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  throw new Error('Cannot construct Prisma CLI DATABASE_URL from environment.');
}
