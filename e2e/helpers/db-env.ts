import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';

export const E2E_DB_NAME = 'infocom_ams_e2e_test';
export const E2E_DEV_PORT = 3105;
export const E2E_PROD_PORT = 3106;
export const E2E_DEV_URL = `http://127.0.0.1:${E2E_DEV_PORT}`;
export const E2E_PROD_URL = `http://127.0.0.1:${E2E_PROD_PORT}`;

export const E2E_SESSION_SECRET = 'infocom-e2e-session-secret-key-min-32-chars-2026';

export const E2E_ADMIN_EMAIL = 'admin@infocom.edu';
export const E2E_ADMIN_PASSWORD = 'IgsE2e!Admin#2026';

export const E2E_INSTRUCTOR_EMAIL = 'elena.vance@infocom-faculty.local';
export const E2E_INSTRUCTOR_PASSWORD = 'IgsE2e!Faculty#2026';

export const E2E_OTHER_INSTRUCTOR_EMAIL = 'david.okonkwo@infocom-faculty.local';

export const E2E_STUDENT_EMAIL = 'aarav.sharma@igs-demo.local';
export const E2E_STUDENT_PASSWORD = 'IgsE2e!Student#2026';

export const E2E_OTHER_STUDENT_ID = 'stu-zoya';
export const E2E_OTHER_COURSE_ID = 'crs-e2e-other';
export const E2E_PROD_REAL_COURSE_ID = 'crs-e2e-prod-real';
export const E2E_PROD_REAL_COURSE_SLUG = 'applied-cloud-systems-e2e';
export const E2E_DEMO_CERT_CODE = 'IGS-CERT-2026-0001';

export function buildE2eProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }

  env.SESSION_SECRET = env.SESSION_SECRET || E2E_SESSION_SECRET;
  env.ENABLE_BACKGROUND_WORKER = 'false';

  if (env.SQL_HOST && env.SQL_DB_NAME) {
    env.SQL_DB_NAME = E2E_DB_NAME;
    env.TEST_SQL_DB_NAME = E2E_DB_NAME;
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
  } else {
    const baseUrl = env.E2E_DATABASE_URL || env.TEST_DATABASE_URL || env.DATABASE_URL;
    if (baseUrl) {
      const parsed = new URL(baseUrl);
      parsed.pathname = `/${E2E_DB_NAME}`;
      const e2eUrl = parsed.toString();
      env.DATABASE_URL = e2eUrl;
      env.TEST_DATABASE_URL = e2eUrl;
    }
  }

  return env;
}

export function getAdminControlPool(): { pool: Pool; targetDbName: string } {
  const rawHost = process.env.SQL_HOST;
  if (rawHost && process.env.SQL_DB_NAME) {
    const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || 'postgres';
    const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || '';
    const pool = new Pool({
      host: rawHost,
      user,
      password,
      database: 'postgres',
      max: 2,
      connectionTimeoutMillis: 15000,
    });
    return { pool, targetDbName: E2E_DB_NAME };
  }

  const baseUrl =
    process.env.E2E_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('E2E database configuration requires SQL_HOST/SQL_DB_NAME or DATABASE_URL.');
  }
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  return {
    pool: new Pool({
      connectionString: adminUrl.toString(),
      max: 2,
      connectionTimeoutMillis: 15000,
    }),
    targetDbName: E2E_DB_NAME,
  };
}

export function resolveChromiumExecutablePath(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const containerShell = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
  try {
    // Prefer Playwright's own downloaded binary when available (e.g. Ubuntu CI)
    if (fs.existsSync(containerShell)) {
      return containerShell;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function uniqueSuffix(): string {
  return crypto.randomUUID().slice(0, 8);
}
