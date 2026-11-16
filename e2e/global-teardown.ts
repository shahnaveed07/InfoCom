import 'dotenv/config';
import { getAdminControlPool } from './helpers/db-env.ts';

export default async function globalTeardown() {
  const { pool: controlPool, targetDbName } = getAdminControlPool();
  try {
    await controlPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDbName]
    );
    await controlPool.query(`DROP DATABASE IF EXISTS "${targetDbName}"`);
  } catch (err) {
    console.warn('[e2e teardown] Failed to drop isolated E2E database:', err);
  } finally {
    await controlPool.end();
  }
}
