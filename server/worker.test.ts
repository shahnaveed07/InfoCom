import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import wranglerPkg from 'wrangler';
import workerEntry from './worker.ts';

const execFileAsync = promisify(execFile);
const { unstable_dev } = wranglerPkg;

test('wrangler deploy --dry-run builds server/worker.ts cleanly without Hyperdrive, Prisma, PDFKit, or Nodemailer', async () => {
  const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
  const distExists = await fs
    .access(distIndexPath)
    .then(() => true)
    .catch(() => false);
  if (!distExists) {
    await execFileAsync('npm', ['run', 'build'], {
      cwd: process.cwd(),
      timeout: 60_000,
    });
  }

  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist-worker'],
    {
      cwd: process.cwd(),
      timeout: 30_000,
    }
  );
  assert.ok(stdout.includes('env.DB'), 'Expected D1 binding env.DB in dry-run output');
  assert.ok(stdout.includes('env.ASSETS'), 'Expected Assets binding env.ASSETS in dry-run output');
  assert.ok(
    stdout.includes('env.DOCUMENTS_BUCKET'),
    'Expected DOCUMENTS_BUCKET R2 binding in dry-run output'
  );
  assert.ok(stdout.includes('env.JOBS_QUEUE'), 'Expected JOBS_QUEUE binding in dry-run output');
  assert.ok(
    stdout.includes('env.AUTH_RATE_LIMITER') && stdout.includes('env.PUBLIC_RATE_LIMITER'),
    'Expected Rate Limit bindings in dry-run output'
  );
  assert.equal(stdout.includes('env.HYPERDRIVE'), false, 'Hyperdrive must not be bound');

  const outFiles = await fs.readdir(path.join(process.cwd(), 'dist-worker'));
  assert.equal(
    outFiles.some((f) => f.endsWith('.wasm')),
    false,
    `Worker bundle must not include Prisma WASM query engines: ${outFiles.join(', ')}`
  );
  const workerBundle = await fs.readFile(path.join(process.cwd(), 'dist-worker', 'worker.js'), 'utf8');
  assert.equal(workerBundle.includes('@prisma/client'), false);
  assert.equal(workerBundle.includes('pdfkit'), false);
  assert.equal(workerBundle.includes('nodemailer'), false);
});

test('server/worker.ts boots in real workerd runtime, serves SPA assets, D1 readiness, CORS, and zero 501/404 stubs', async () => {
  const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'igs-worker-boot-'));
  const worker = await unstable_dev('server/worker.ts', {
    config: 'wrangler.jsonc',
    persist: true,
    persistTo: persistDir,
    experimental: { disableExperimentalWarning: true },
    logLevel: 'error',
  });

  try {
    // 1. /api/health -> 200 JSON + security headers without X-Frame-Options
    const healthRes = await worker.fetch('/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), null);
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.runtime, 'cloudflare-workers');

    // 2. /api/health/ready before migrations -> 503 D1_SCHEMA_NOT_APPLIED
    const readyRes = await worker.fetch('/api/health/ready');
    assert.equal(readyRes.status, 503);
    const readyJson = (await readyRes.json()) as Record<string, unknown>;
    assert.equal(readyJson.status, 'degraded');
    assert.equal(readyJson.database, 'unavailable');
    assert.equal(readyJson.mode, 'd1');
    assert.equal(readyJson.code, 'D1_SCHEMA_NOT_APPLIED');

    // 3. Direct SPA navigation paths serve 200 text/html via ASSETS (no 404 STATIC_HOSTING_REQUIRED)
    const spaCoursesRes = await worker.fetch('/courses');
    assert.equal(spaCoursesRes.status, 200);
    assert.ok((spaCoursesRes.headers.get('content-type') || '').includes('text/html'));
    assert.equal(spaCoursesRes.headers.get('x-frame-options'), null);

    const spaDetailRes = await worker.fetch('/courses/web-development');
    assert.equal(spaDetailRes.status, 200);
    assert.ok((spaDetailRes.headers.get('content-type') || '').includes('text/html'));

    // 4. Protected portal routes return proper 401 when unauthenticated (never 501 WORKER_RUNTIME_UNSUPPORTED)
    const studentsRes = await worker.fetch('/api/students');
    assert.equal(studentsRes.status, 401);

    // 5. CORS allowlist enforcement
    const allowedPreflight = await worker.fetch('/api/public/academy', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(
      allowedPreflight.headers.get('access-control-allow-origin'),
      'http://localhost:3000'
    );

    const blockedPreflight = await worker.fetch('/api/public/academy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(blockedPreflight.status, 204);
    assert.equal(blockedPreflight.headers.get('access-control-allow-origin'), null);

    // 6. Unknown API route -> 404 API_ROUTE_NOT_FOUND
    const unknownApiRes = await worker.fetch('/api/non-existent-endpoint');
    assert.equal(unknownApiRes.status, 404);
    const unknownApiJson = (await unknownApiRes.json()) as Record<string, unknown>;
    assert.equal(unknownApiJson.code, 'API_ROUTE_NOT_FOUND');
  } finally {
    await worker.stop();
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('server/worker.ts enforces distributed Cloudflare Rate Limiting on /api/auth/login and /api/public/*', async () => {
  const waitUntil = (p: Promise<unknown>) => {
    void p;
  };
  let calls = 0;
  const resAllowed = await workerEntry.fetch(
    new Request('https://worker.example/api/auth/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '198.51.100.12',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'not-valid', password: 'short' }),
    }),
    {
      AUTH_RATE_LIMITER: {
        limit: async () => {
          calls += 1;
          return { success: calls === 1 };
        },
      },
    },
    { waitUntil }
  );
  // Request reached D1 guard (503 D1_BINDING_MISSING when DB omitted), never 501 stub
  assert.equal(resAllowed.status, 503);
  assert.equal(resAllowed.headers.get('x-ratelimit-backend'), 'cloudflare-binding');

  const resBlocked = await workerEntry.fetch(
    new Request('https://worker.example/api/auth/login', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.12' },
    }),
    {
      AUTH_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    },
    { waitUntil }
  );
  assert.equal(resBlocked.status, 429);
  assert.equal(resBlocked.headers.get('x-ratelimit-backend'), 'cloudflare-binding');
  assert.equal(resBlocked.headers.get('retry-after'), '60');
});
