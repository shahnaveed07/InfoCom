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

test('buildPgPoolConfig uses Object Method for SQL_HOST and respects TEST_SQL_DB_NAME', () => {
  const snapshot = { ...process.env };
  try {
    process.env.NODE_ENV = 'test';
    process.env.SQL_HOST = '/app/cloudsql/proj:reg:inst';
    process.env.SQL_DB_NAME = 'prod_db';
    process.env.TEST_SQL_DB_NAME = 'test_db';
    process.env.SQL_USER = 'app_u';
    process.env.SQL_PASSWORD = 'app_p';

    const cfg = buildPgPoolConfig({ admin: false });
    assert.equal(cfg.host, '/app/cloudsql/proj:reg:inst');
    assert.equal(cfg.database, 'test_db');
    assert.equal(cfg.user, 'app_u');
    assert.equal(cfg.max, 5);

    const cliUrl = buildPrismaCliDatabaseUrl({ admin: true });
    assert.match(cliUrl, /^postgresql:\/\/.+@localhost\/test_db\?host=/);
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
