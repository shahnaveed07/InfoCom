import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';
import wranglerPkg from 'wrangler';
import workerEntry from './worker.ts';

const execFileAsync = promisify(execFile);
const { unstable_dev } = wranglerPkg;

test('wrangler deploy --dry-run builds server/worker.ts cleanly under Cloudflare 64 MiB bundle limit', async () => {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist-worker'],
    {
      cwd: process.cwd(),
      timeout: 30_000,
    }
  );
  assert.ok(stdout.includes('env.HYPERDRIVE'), 'Expected HYPERDRIVE binding in dry-run output');
  assert.ok(
    stdout.includes('env.DOCUMENTS_BUCKET'),
    'Expected DOCUMENTS_BUCKET R2 binding in dry-run output'
  );
  assert.ok(stdout.includes('env.JOBS_QUEUE'), 'Expected JOBS_QUEUE binding in dry-run output');
  assert.ok(
    stdout.includes('env.AUTH_RATE_LIMITER') && stdout.includes('env.PUBLIC_RATE_LIMITER'),
    'Expected Rate Limit bindings in dry-run output'
  );
});

test('server/worker.ts boots in real workerd runtime and serves health, sanitized readiness, CORS, and 501 Node boundary', async () => {
  const prevLocalConn = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
    'postgresql://postgres:SecretPassOnlyForLocalProbe@127.0.0.1:59999/igs_test';

  const worker = await unstable_dev('server/worker.ts', {
    config: 'wrangler.jsonc',
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

    // 2. /api/health/ready -> 503 degraded without exposing connection URI or password
    const readyRes = await worker.fetch('/api/health/ready');
    assert.equal(readyRes.status, 503);
    const readyText = await readyRes.text();
    const readyJson = JSON.parse(readyText) as Record<string, unknown>;
    assert.equal(readyJson.status, 'degraded');
    assert.equal(readyJson.database, 'unavailable');
    assert.equal(readyJson.mode, 'hyperdrive');
    assert.equal(readyText.includes('SecretPassOnlyForLocalProbe'), false);
    assert.equal(readyText.includes('postgresql://'), false);

    // 3. Unsupported Node-bound endpoint (/api/auth/login, /api/certificates/:id/download) -> explicit 501
    const loginRes = await worker.fetch('/api/auth/login', { method: 'POST' });
    assert.equal(loginRes.status, 501);
    const loginJson = (await loginRes.json()) as Record<string, unknown>;
    assert.equal(loginJson.code, 'WORKER_RUNTIME_UNSUPPORTED');
    assert.equal(loginJson.requiredBackend, 'node-express-api');

    // 4. CORS allowlist enforcement
    const allowedPreflight = await worker.fetch('/api/public/academy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://igs-infocom.pages.dev' },
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(
      allowedPreflight.headers.get('access-control-allow-origin'),
      'https://igs-infocom.pages.dev'
    );

    const blockedPreflight = await worker.fetch('/api/public/academy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(blockedPreflight.status, 204);
    assert.equal(blockedPreflight.headers.get('access-control-allow-origin'), null);

    // 5. Unknown API route -> 404 API_ROUTE_NOT_FOUND, non-API path -> 404 STATIC_HOSTING_REQUIRED
    const unknownApiRes = await worker.fetch('/api/non-existent-endpoint');
    assert.equal(unknownApiRes.status, 404);
    const unknownApiJson = (await unknownApiRes.json()) as Record<string, unknown>;
    assert.equal(unknownApiJson.code, 'API_ROUTE_NOT_FOUND');

    const staticPathRes = await worker.fetch('/courses');
    assert.equal(staticPathRes.status, 404);
    const staticPathJson = (await staticPathRes.json()) as Record<string, unknown>;
    assert.equal(staticPathJson.code, 'STATIC_HOSTING_REQUIRED');
  } finally {
    await worker.stop();
    if (prevLocalConn === undefined) {
      delete process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
    } else {
      process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = prevLocalConn;
    }
  }
});

test('server/worker.ts directly enforces distributed Cloudflare Rate Limiting on /api/auth/* and /api/public/*', async () => {
  const waitUntil = (p: Promise<unknown>) => {
    void p;
  };
  let calls = 0;
  const resAllowed = await workerEntry.fetch(
    new Request('https://worker.example/api/auth/login', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.12' },
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
  assert.equal(resAllowed.status, 501);
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
