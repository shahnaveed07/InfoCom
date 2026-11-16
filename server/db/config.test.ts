import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPgPoolConfig, buildPrismaCliDatabaseUrl, resolveAppEnvironment } from './config.ts';
import { normalizePagination } from '../repositories/ams.repository.ts';

test('resolveAppEnvironment maps NODE_ENV cleanly', () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(resolveAppEnvironment(), 'production');
    process.env.NODE_ENV = 'test';
    assert.equal(resolveAppEnvironment(), 'test');
    process.env.NODE_ENV = 'development';
    assert.equal(resolveAppEnvironment(), 'development');
  } finally {
    process.env.NODE_ENV = prev;
  }
});

function clearDbEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.SQL_HOST;
  delete process.env.SQL_DB_NAME;
  delete process.env.TEST_SQL_DB_NAME;
  delete process.env.SQL_USER;
  delete process.env.SQL_PASSWORD;
  delete process.env.SQL_ADMIN_USER;
  delete process.env.SQL_ADMIN_PASSWORD;
}

test('buildPgPoolConfig uses Object Method for SQL_HOST and respects TEST_SQL_DB_NAME', () => {
  const snapshot = { ...process.env };
  try {
    clearDbEnv();
    process.env.NODE_ENV = 'test';
    process.env.SQL_HOST = '/app/cloudsql/proj:reg:inst';
    process.env.SQL_DB_NAME = 'prod_db';
    process.env.TEST_SQL_DB_NAME = 'test_db';
    process.env.SQL_USER = 'app_u';
    process.env.SQL_PASSWORD = 'app_p';
    process.env.SQL_ADMIN_USER = 'adm_u';
    process.env.SQL_ADMIN_PASSWORD = 'adm_p';

    const cfg = buildPgPoolConfig({ admin: false });
    assert.equal(cfg.host, '/app/cloudsql/proj:reg:inst');
    assert.equal(cfg.database, 'test_db');
    assert.equal(cfg.user, 'app_u');
    assert.equal(cfg.max, 5);

    const adminCfg = buildPgPoolConfig({ admin: true });
    assert.equal(adminCfg.user, 'adm_u');
    assert.equal(adminCfg.password, 'adm_p');

    const cliUrl = buildPrismaCliDatabaseUrl({ admin: true });
    assert.match(cliUrl, /^postgresql:\/\/adm_u:adm_p@localhost\/test_db\?host=/);
  } finally {
    process.env = snapshot;
  }
});

test('buildPgPoolConfig and buildPrismaCliDatabaseUrl support standard DATABASE_URL and TEST_DATABASE_URL', () => {
  const snapshot = { ...process.env };
  try {
    clearDbEnv();
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://prod_u:prod_p@db.internal:5432/infocom_prod';
    process.env.TEST_DATABASE_URL = 'postgresql://test_u:test_p@localhost:5432/infocom_test';

    const prodPool = buildPgPoolConfig();
    assert.equal(prodPool.connectionString, 'postgresql://prod_u:prod_p@db.internal:5432/infocom_prod');
    assert.equal(prodPool.max, 10);
    assert.equal(
      buildPrismaCliDatabaseUrl(),
      'postgresql://prod_u:prod_p@db.internal:5432/infocom_prod'
    );

    process.env.NODE_ENV = 'test';
    const testPool = buildPgPoolConfig();
    assert.equal(testPool.connectionString, 'postgresql://test_u:test_p@localhost:5432/infocom_test');
    assert.equal(testPool.max, 5);
    assert.equal(
      buildPrismaCliDatabaseUrl(),
      'postgresql://test_u:test_p@localhost:5432/infocom_test'
    );

    // Even when SQL_HOST is also defined in test mode, explicit TEST_DATABASE_URL takes precedence for Prisma CLI
    process.env.SQL_HOST = '/app/cloudsql/proj:reg:inst';
    process.env.SQL_DB_NAME = 'prod_db';
    assert.equal(
      buildPrismaCliDatabaseUrl(),
      'postgresql://test_u:test_p@localhost:5432/infocom_test'
    );
  } finally {
    process.env = snapshot;
  }
});

test('normalizePagination bounds page and pageSize safely', () => {
  assert.deepEqual(normalizePagination({ page: 0, pageSize: 500 }), {
    page: 1,
    pageSize: 100,
    skip: 0,
    take: 100,
  });
  assert.deepEqual(normalizePagination({ page: 3, pageSize: 25 }), {
    page: 3,
    pageSize: 25,
    skip: 50,
    take: 25,
  });
});
