import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import wranglerPkg from 'wrangler';
import { d1All, d1First, d1Run, runWithD1Database } from './d1/client.ts';
import {
  handleD1WorkerQueueBatch,
  handleD1WorkerScheduledSweep,
  queueD1TransactionalEmail,
  runWithD1EmailConfig,
} from './jobs/d1-worker.ts';
import {
  COSE_ALG_ES256,
  COSE_ALG_RS256,
  base64UrlToBytes,
  bytesToBase64Url,
  sha256Bytes,
} from './webauthn/core.ts';
import { SESSION_COOKIE_NAME } from './worker-auth.ts';

const execFileAsync = promisify(execFile);
const { unstable_dev } = wranglerPkg;

function sqlStr(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

function extractCookieHeader(res: {
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
}): string {
  const rawList =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  for (const header of rawList) {
    const m = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    if (m?.[1]) return `${SESSION_COOKIE_NAME}=${m[1]}`;
  }
  return '';
}

// Minimal deterministic CBOR encoder for test-only synthetic WebAuthn authenticators
function encodeCborUint(major: number, n: number): Uint8Array {
  const prefix = major << 5;
  if (n < 24) return new Uint8Array([prefix | n]);
  if (n < 256) return new Uint8Array([prefix | 24, n]);
  if (n < 65536) return new Uint8Array([prefix | 25, n >> 8, n & 0xff]);
  return new Uint8Array([
    prefix | 26,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

function encodeCborValue(val: unknown): Uint8Array {
  if (typeof val === 'number') {
    if (val >= 0) return encodeCborUint(0, val);
    return encodeCborUint(1, -1 - val);
  }
  if (val instanceof Uint8Array) {
    const hdr = encodeCborUint(2, val.length);
    const out = new Uint8Array(hdr.length + val.length);
    out.set(hdr, 0);
    out.set(val, hdr.length);
    return out;
  }
  if (typeof val === 'string') {
    const bytes = new TextEncoder().encode(val);
    const hdr = encodeCborUint(3, bytes.length);
    const out = new Uint8Array(hdr.length + bytes.length);
    out.set(hdr, 0);
    out.set(bytes, hdr.length);
    return out;
  }
  if (val instanceof Map) {
    const chunks: Uint8Array[] = [encodeCborUint(5, val.size)];
    for (const [k, v] of val.entries()) {
      chunks.push(encodeCborValue(k), encodeCborValue(v));
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
  throw new Error(`Unsupported CBOR test value: ${typeof val}`);
}

function rawP1363ToDerEcdsa(raw: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.subarray(start);
    const needPad = (trimmed[0] & 0x80) !== 0;
    const out = new Uint8Array(2 + trimmed.length + (needPad ? 1 : 0));
    out[0] = 0x02;
    out[1] = trimmed.length + (needPad ? 1 : 0);
    if (needPad) {
      out[2] = 0x00;
      out.set(trimmed, 3);
    } else {
      out.set(trimmed, 2);
    }
    return out;
  };
  const r = encodeInt(raw.subarray(0, 32));
  const s = encodeInt(raw.subarray(32, 64));
  const seq = new Uint8Array(2 + r.length + s.length);
  seq[0] = 0x30;
  seq[1] = r.length + s.length;
  seq.set(r, 2);
  seq.set(s, 2 + r.length);
  return seq;
}

async function createTestAuthenticator(
  alg: typeof COSE_ALG_ES256 | typeof COSE_ALG_RS256 = COSE_ALG_ES256
) {
  const credIdBytes = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = bytesToBase64Url(credIdBytes);

  let keyPair: CryptoKeyPair;
  let coseKey: Map<number, unknown>;

  if (alg === COSE_ALG_ES256) {
    keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    coseKey = new Map<number, unknown>([
      [1, 2],
      [3, COSE_ALG_ES256],
      [-1, 1],
      [-2, base64UrlToBytes(jwk.x!)],
      [-3, base64UrlToBytes(jwk.y!)],
    ]);
  } else {
    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    coseKey = new Map<number, unknown>([
      [1, 3],
      [3, COSE_ALG_RS256],
      [-1, base64UrlToBytes(jwk.n!)],
      [-2, base64UrlToBytes(jwk.e!)],
    ]);
  }

  return {
    credentialId,
    async makeRegistration(opts: {
      challenge: string;
      origin: string;
      rpId: string;
      flags?: number;
      signCount?: number;
    }) {
      const rpIdHash = await sha256Bytes(opts.rpId);
      const flags = opts.flags ?? 0x5d; // UP | UV | BE | BS | AT
      const aaguid = new Uint8Array(16);
      const coseBytes = encodeCborValue(coseKey);
      const authData = new Uint8Array(37 + 16 + 2 + credIdBytes.length + coseBytes.length);
      authData.set(rpIdHash, 0);
      authData[32] = flags;
      new DataView(authData.buffer).setUint32(33, opts.signCount ?? 0, false);
      authData.set(aaguid, 37);
      authData[53] = (credIdBytes.length >> 8) & 0xff;
      authData[54] = credIdBytes.length & 0xff;
      authData.set(credIdBytes, 55);
      authData.set(coseBytes, 55 + credIdBytes.length);

      const attObj = encodeCborValue(
        new Map<unknown, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );
      const clientDataBytes = new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: opts.challenge,
          origin: opts.origin,
          crossOrigin: false,
        })
      );
      return {
        credentialId,
        clientDataJSON: bytesToBase64Url(clientDataBytes),
        attestationObject: bytesToBase64Url(attObj),
        transports: ['internal', 'hybrid'],
      };
    },
    async makeAssertion(opts: {
      challenge: string;
      origin: string;
      rpId: string;
      flags?: number;
      signCount?: number;
      tamperSignature?: boolean;
      type?: string;
    }) {
      const rpIdHash = await sha256Bytes(opts.rpId);
      const authData = new Uint8Array(37);
      authData.set(rpIdHash, 0);
      authData[32] = opts.flags ?? 0x1d; // UP | UV | BE | BS
      new DataView(authData.buffer).setUint32(33, opts.signCount ?? 0, false);

      const clientDataBytes = new TextEncoder().encode(
        JSON.stringify({
          type: opts.type ?? 'webauthn.get',
          challenge: opts.challenge,
          origin: opts.origin,
          crossOrigin: false,
        })
      );
      const clientDataHash = await sha256Bytes(clientDataBytes);
      const signedPayload = new Uint8Array(authData.length + clientDataHash.length);
      signedPayload.set(authData, 0);
      signedPayload.set(clientDataHash, authData.length);

      let sigBytes: Uint8Array;
      if (alg === COSE_ALG_ES256) {
        const rawSig = new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            keyPair.privateKey,
            signedPayload
          )
        );
        if (opts.tamperSignature) rawSig[0] ^= 0xff;
        sigBytes = rawP1363ToDerEcdsa(rawSig);
      } else {
        sigBytes = new Uint8Array(
          await crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyPair.privateKey,
            signedPayload
          )
        );
        if (opts.tamperSignature) sigBytes[0] ^= 0xff;
      }

      return {
        credentialId,
        clientDataJSON: bytesToBase64Url(clientDataBytes),
        authenticatorData: bytesToBase64Url(authData),
        signature: bytesToBase64Url(sigBytes),
      };
    },
  };
}

async function runD1Sql(persistDir: string, command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
      '--command',
      command,
      '--json',
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );
  return stdout;
}

test('Cloudflare D1 + WebAuthn Passkeys + R2 + Static Assets end-to-end Worker verification suite (real workerd runtime)', async () => {
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

  const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'igs-cf-d1-e2e-'));
  const seedSqlFile = path.join(os.tmpdir(), `igs-e2e-seed-${Date.now()}.sql`);

  // Apply D1 SQLite schema migrations (0001 + 0002 + 0003) to isolated temporary Wrangler persistence
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );

  // Verify all 47 relational tables exist (45 original + webauthn_credentials + webauthn_challenges)
  const tableListStdout = await runD1Sql(
    persistDir,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name;"
  );
  const parsedTables = JSON.parse(tableListStdout) as Array<{
    results?: Array<{ name: string }>;
  }>;
  const tableNames = (parsedTables[0]?.results ?? []).map((r) => r.name);
  assert.equal(
    tableNames.length,
    47,
    `Expected all 47 D1 schema tables (45 core + 2 WebAuthn), found ${tableNames.length}: ${tableNames.join(', ')}`
  );
  assert.ok(tableNames.includes('webauthn_credentials'));
  assert.ok(tableNames.includes('webauthn_challenges'));

  // Verify reference seed migration is strictly idempotent on repeated execution
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
      '--file',
      path.join(process.cwd(), 'migrations', '0002_seed_reference.sql'),
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );

  // Verify First-Admin Passkey Bootstrap CLI creates initial admin cleanly & refuses duplicate overwrites
  const { stdout: bootstrapStdout } = await execFileAsync(
    'npx',
    [
      'tsx',
      'scripts/d1-bootstrap-passkey-admin.ts',
      '--local',
      '--persist-to',
      persistDir,
      '--email',
      'admin@igs.test',
      '--name',
      'IGS Admin',
      '--app-url',
      'https://igs-infocom-ams-worker.example.workers.dev',
      '--json',
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );
  const bootstrapJson = JSON.parse(bootstrapStdout.trim()) as {
    ok: boolean;
    adminId: string;
    enrollmentToken: string;
  };
  assert.equal(bootstrapJson.ok, true);
  assert.ok(bootstrapJson.enrollmentToken.length >= 32);

  // Second run without --allow-existing-enrollment MUST fail safely without overwriting
  await assert.rejects(
    execFileAsync(
      'npx',
      [
        'tsx',
        'scripts/d1-bootstrap-passkey-admin.ts',
        '--local',
        '--persist-to',
        persistDir,
        '--email',
        'attacker@igs.test',
      ],
      { cwd: process.cwd(), timeout: 30_000 }
    )
  );

  const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  // Preserve legacy password_hash on migrated user rows untouched (verify zero record loss)
  const seedSql = `
    PRAGMA foreign_keys = ON;
    UPDATE academy_settings
    SET value = 'after_first_payment'
    WHERE academy_id = 'acad-infocom' AND key = 'admission.portal_activation_policy';

    INSERT INTO departments (id, academy_id, code, name, status) VALUES
      ('dept-swe', 'acad-infocom', 'SWE', 'Software Engineering', 'active');

    INSERT INTO classrooms (id, academy_id, code, name, building, capacity, is_active) VALUES
      ('room-1', 'acad-infocom', 'LAB-01', 'Computing Lab 01', 'Main Campus', 25, 1);

    INSERT INTO academic_years (id, academy_id, code, name, start_date, end_date, is_current, status) VALUES
      ('ay-2026', 'acad-infocom', 'AY-2026', '2026 Academic Year', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z', 1, 'Active');

    INSERT INTO academic_terms (id, academic_year_id, code, name, start_date, end_date, is_current, status) VALUES
      ('term-1', 'ay-2026', 'SPR-2026', 'Spring 2026', '2026-01-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z', 1, 'Active');

    INSERT INTO users (id, name, email, role, status, staff_code, student_code, department, password_hash, must_change_password) VALUES
      ('u-inst', 'IGS Instructor', 'instructor@igs.test', 'instructor', 'active', 'INS-01', NULL, 'Software Engineering', NULL, 0),
      ('u-student-legacy', 'Migrated Student', 'legacy@igs.test', 'student', 'active', NULL, 'STU-LEG-1', 'Software Engineering', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g', 0),
      ('u-suspended', 'Suspended Account', 'suspended@igs.test', 'student', 'suspended', NULL, 'STU-SUS-1', 'Software Engineering', NULL, 0);

    INSERT INTO instructor_profiles (id, user_id, staff_code, department_id, status) VALUES
      ('ip-1', 'u-inst', 'INS-01', 'dept-swe', 'active');

    INSERT INTO student_profiles (id, user_id, student_code, department_id) VALUES
      ('sp-leg', 'u-student-legacy', 'STU-LEG-1', 'dept-swe'),
      ('sp-sus', 'u-suspended', 'STU-SUS-1', 'dept-swe');

    INSERT INTO courses (id, code, slug, title, track, category, description, department_id, instructor_id, duration_weeks, tuition_fee, is_published, show_tuition_publicly, is_demo, is_archived) VALUES
      ('crs-prod', 'IGS-WEB-101', 'web-development', 'Full-Stack Web Development', 'Software Engineering', 'Diploma', 'Production full-stack course', 'dept-swe', 'u-inst', 16, '10000.00', 1, 1, 0, 0),
      ('crs-demo', 'IGS-DEMO-999', 'demo-only-course', 'Demo Sandbox Course', 'Sandbox', 'Certificate', 'Should be filtered in production', 'dept-swe', 'u-inst', 4, '500.00', 1, 1, 1, 0);

    INSERT INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order) VALUES
      ('mod-1', 'crs-prod', 'M1', 'TypeScript Foundations', 50, 12, 1),
      ('mod-2', 'crs-prod', 'M2', 'Cloudflare & SQL Systems', 50, 16, 2);

    INSERT INTO cohorts (id, code, name, course_id, term_id, instructor_id, classroom_id, capacity, start_date, end_date, status) VALUES
      ('coh-1', 'WEB-A', 'Morning Batch A', 'crs-prod', 'term-1', 'u-inst', 'room-1', 20, ${sqlStr(pastStart)}, ${sqlStr(futureEnd)}, 'Active');

    INSERT INTO instructor_assignments (id, instructor_id, batch_id, course_id, role, is_active) VALUES
      ('ia-1', 'u-inst', 'coh-1', 'crs-prod', 'Lead', 1);

    INSERT INTO fee_plans (id, code, name, installment_count, currency, is_active) VALUES
      ('fp-1', 'FULL', 'Full Tuition', 1, 'INR', 1);

    INSERT INTO fee_invoices (id, invoice_number, student_id, course_id, description, subtotal, amount_due, amount_paid, currency, status, due_date) VALUES
      ('inv-other', 'INV-OTHER-01', 'u-student-legacy', 'crs-prod', 'Tuition Other Student', '5000.00', '5000.00', '0.00', 'INR', 'Unpaid', ${sqlStr(futureStart)});
  `;

  await fs.writeFile(seedSqlFile, seedSql, 'utf8');
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'igs-infocom-db',
      '--local',
      '--persist-to',
      persistDir,
      '--file',
      seedSqlFile,
    ],
    { cwd: process.cwd(), timeout: 30_000 }
  );

  const workerOrigin = 'https://igs-infocom-ams-worker.example.workers.dev';
  const worker = await unstable_dev('server/worker.ts', {
    config: 'wrangler.jsonc',
    persist: true,
    persistTo: persistDir,
    vars: {
      APP_URL: workerOrigin,
      CORS_ALLOWED_ORIGINS: workerOrigin,
    },
    experimental: { disableExperimentalWarning: true },
    logLevel: 'error',
  });

  // Resolve exact origin & RP ID the worker expects
  const configRes = await worker.fetch('/api/auth/config');
  assert.equal(configRes.status, 200);
  const authConfig = (await configRes.json()) as {
    authMode: string;
    passwordAuthEnabled: boolean;
    passkeySupported: boolean;
    rpId: string;
  };
  assert.equal(authConfig.authMode, 'webauthn');
  assert.equal(authConfig.passwordAuthEnabled, false);
  assert.equal(authConfig.passkeySupported, true);
  assert.equal(authConfig.rpId, 'igs-infocom-ams-worker.example.workers.dev');

  const expectedRpId = authConfig.rpId;

  async function enrollPasskeyWithToken(
    enrollmentToken: string,
    authenticator: Awaited<ReturnType<typeof createTestAuthenticator>>,
    deviceLabel: string,
    signCount = 0
  ) {
    const optRes = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ enrollmentToken, deviceLabel }),
    });
    assert.equal(optRes.status, 200, `register/options failed: ${optRes.status}`);
    const optJson = (await optRes.json()) as {
      challengeId: string;
      options: { challenge: string; rp: { id: string } };
    };
    const regPayload = await authenticator.makeRegistration({
      challenge: optJson.options.challenge,
      origin: workerOrigin,
      rpId: optJson.options.rp.id,
      signCount,
    });
    const verRes = await worker.fetch('/api/auth/webauthn/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({
        challengeId: optJson.challengeId,
        enrollmentToken,
        deviceLabel,
        ...regPayload,
      }),
    });
    return { optJson, verRes };
  }

  async function loginWithPasskey(
    email: string,
    authenticator: Awaited<ReturnType<typeof createTestAuthenticator>>,
    opts: { signCount?: number; origin?: string; rpId?: string; tamperSignature?: boolean } = {}
  ) {
    const optRes = await worker.fetch('/api/auth/webauthn/login/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ email }),
    });
    assert.equal(optRes.status, 200);
    const optJson = (await optRes.json()) as {
      challengeId: string;
      options: { challenge: string; rpId: string };
    };
    const assertion = await authenticator.makeAssertion({
      challenge: optJson.options.challenge,
      origin: opts.origin ?? workerOrigin,
      rpId: opts.rpId ?? optJson.options.rpId,
      signCount: opts.signCount ?? 0,
      tamperSignature: opts.tamperSignature,
    });
    const verRes = await worker.fetch('/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({
        challengeId: optJson.challengeId,
        ...assertion,
      }),
    });
    return { optJson, assertion, verRes };
  }

  try {
    // 1. D1 readiness check passes after migration
    const readyRes = await worker.fetch('/api/health/ready');
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as Record<string, unknown>;
    assert.equal(readyJson.status, 'ok');
    assert.equal(readyJson.database, 'connected');
    assert.equal(readyJson.mode, 'd1');

    // 2. Public catalog excludes is_demo = 1 in NODE_ENV=production
    const pubCoursesRes = await worker.fetch('/api/public/courses');
    assert.equal(pubCoursesRes.status, 200);
    const pubCoursesJson = (await pubCoursesRes.json()) as {
      courses: Array<{ code: string; slug: string }>;
    };
    assert.equal(pubCoursesJson.courses.length, 1);
    assert.equal(pubCoursesJson.courses[0].slug, 'web-development');

    // 3. Disabled student self-registration -> 410
    const regRes = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'self@igs.test', name: 'Self', password: 'Password123!' }),
    });
    assert.equal(regRes.status, 410);

    // 4. All password endpoints cleanly return 403 PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE
    for (const ep of [
      { path: '/api/auth/login', body: { email: 'legacy@igs.test', password: 'Password123!' } },
      { path: '/api/auth/forgot-password', body: { email: 'legacy@igs.test' } },
      { path: '/api/auth/reset-password', body: { token: 'abc', newPassword: 'Password123!' } },
    ]) {
      const res = await worker.fetch(ep.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body),
      });
      assert.equal(res.status, 403, `Expected 403 on ${ep.path}`);
      const j = (await res.json()) as { code: string; authMode: string };
      assert.equal(j.code, 'PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE');
      assert.equal(j.authMode, 'webauthn');
    }

    // 5. First-Admin enrolls primary ES256 passkey using single-use bootstrap token
    const adminAuth1 = await createTestAuthenticator(COSE_ALG_ES256);
    const { verRes: adminRegRes } = await enrollPasskeyWithToken(
      bootstrapJson.enrollmentToken,
      adminAuth1,
      'Director MacBook Touch ID',
      0
    );
    if (adminRegRes.status !== 201) {
      assert.fail(`Expected 201 from register/verify, got ${adminRegRes.status}: ${await adminRegRes.text()} (workerOrigin=${workerOrigin}, rpId=${expectedRpId})`);
    }
    const adminRegCookie = extractCookieHeader(adminRegRes);
    assert.ok(adminRegCookie);

    // Reusing the single-use bootstrap enrollment token MUST be rejected
    const replayTokenRes = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ enrollmentToken: bootstrapJson.enrollmentToken }),
    });
    assert.equal(replayTokenRes.status, 400);
    assert.equal(((await replayTokenRes.json()) as { code: string }).code, 'ENROLLMENT_TOKEN_USED');

    // Sign out and sign back in via WebAuthn passkey (synced signCount 0 -> 0 must pass!)
    const logoutRes = await worker.fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: adminRegCookie, Origin: workerOrigin },
    });
    assert.equal(logoutRes.status, 200);

    const { assertion: validAdminAssertion, optJson: adminLoginOpt, verRes: adminLoginRes } =
      await loginWithPasskey('admin@igs.test', adminAuth1, { signCount: 0 });
    assert.equal(adminLoginRes.status, 200);
    const adminCookie = extractCookieHeader(adminLoginRes);
    assert.ok(adminCookie);

    // Verify change-password while authenticated also returns 403 PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE
    const chPassRes = await worker.fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ currentPassword: 'a', newPassword: 'b' }),
    });
    assert.equal(chPassRes.status, 403);
    assert.equal(
      ((await chPassRes.json()) as { code: string }).code,
      'PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE'
    );

    // 6. Phase 8 WebAuthn Negative Security Matrix against live workerd + D1
    // 6a. Replayed challenge MUST be rejected (400 CHALLENGE_REPLAYED)
    const replayChalRes = await worker.fetch('/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({
        challengeId: adminLoginOpt.challengeId,
        ...validAdminAssertion,
      }),
    });
    assert.equal(replayChalRes.status, 400);
    assert.equal(((await replayChalRes.json()) as { code: string }).code, 'CHALLENGE_REPLAYED');

    // 6b. Unknown credential ID -> 401 INVALID_CREDENTIAL
    const unknownAuth = await createTestAuthenticator(COSE_ALG_ES256);
    const { verRes: unknownCredRes } = await loginWithPasskey('admin@igs.test', unknownAuth);
    assert.equal(unknownCredRes.status, 401);
    assert.equal(((await unknownCredRes.json()) as { code: string }).code, 'INVALID_CREDENTIAL');

    // 6c. Tampered signature -> 401 INVALID_SIGNATURE
    const { verRes: tamperedRes } = await loginWithPasskey('admin@igs.test', adminAuth1, {
      tamperSignature: true,
    });
    assert.equal(tamperedRes.status, 401);
    assert.equal(((await tamperedRes.json()) as { code: string }).code, 'INVALID_SIGNATURE');

    // 6d. Wrong RP ID -> 401 RP_ID_MISMATCH
    const { verRes: wrongRpRes } = await loginWithPasskey('admin@igs.test', adminAuth1, {
      rpId: 'evil-rp.example.com',
    });
    assert.equal(wrongRpRes.status, 401);
    assert.equal(((await wrongRpRes.json()) as { code: string }).code, 'RP_ID_MISMATCH');

    // 6e. Wrong Origin -> 401 ORIGIN_MISMATCH
    const { verRes: wrongOriginRes } = await loginWithPasskey('admin@igs.test', adminAuth1, {
      origin: 'https://phishing.example.workers.dev',
    });
    assert.equal(wrongOriginRes.status, 401);
    assert.equal(((await wrongOriginRes.json()) as { code: string }).code, 'ORIGIN_MISMATCH');

    // 6f. Expired challenge -> 400 CHALLENGE_EXPIRED
    const expOptRes = await worker.fetch('/api/auth/webauthn/login/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ email: 'admin@igs.test' }),
    });
    const expOpt = (await expOptRes.json()) as {
      challengeId: string;
      options: { challenge: string; rpId: string };
    };
    await runD1Sql(
      persistDir,
      `UPDATE webauthn_challenges SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ${sqlStr(expOpt.challengeId)};`
    );
    const expAssertion = await adminAuth1.makeAssertion({
      challenge: expOpt.options.challenge,
      origin: workerOrigin,
      rpId: expOpt.options.rpId,
    });
    const expVerRes = await worker.fetch('/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ challengeId: expOpt.challengeId, ...expAssertion }),
    });
    assert.equal(expVerRes.status, 400);
    assert.equal(((await expVerRes.json()) as { code: string }).code, 'CHALLENGE_EXPIRED');

    // 7. Authenticated multi-passkey registration (RS256 with signCount=5), rename, clone detection, step-up reauth + self-revocation
    const adminAuth2 = await createTestAuthenticator(COSE_ALG_RS256);
    const addOptRes = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ deviceLabel: 'Backup Security Key' }),
    });
    assert.equal(addOptRes.status, 200);
    const addOpt = (await addOptRes.json()) as {
      challengeId: string;
      options: { challenge: string; rp: { id: string } };
    };
    const addRegPayload = await adminAuth2.makeRegistration({
      challenge: addOpt.options.challenge,
      origin: workerOrigin,
      rpId: addOpt.options.rp.id,
      signCount: 5,
    });
    const addVerRes = await worker.fetch('/api/auth/webauthn/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        challengeId: addOpt.challengeId,
        deviceLabel: 'Backup Security Key',
        ...addRegPayload,
      }),
    });
    assert.equal(addVerRes.status, 201);
    const addedCred = ((await addVerRes.json()) as { credential: { id: string } }).credential;

    // Monotonic signCount 5 -> 6 succeeds
    const { verRes: rsLoginOk } = await loginWithPasskey('admin@igs.test', adminAuth2, {
      signCount: 6,
    });
    assert.equal(rsLoginOk.status, 200);

    // Clone counter regression 6 -> 6 MUST be rejected with 403 CLONE_SUSPECTED
    const { verRes: cloneRes } = await loginWithPasskey('admin@igs.test', adminAuth2, {
      signCount: 6,
    });
    assert.equal(cloneRes.status, 403);
    assert.equal(((await cloneRes.json()) as { code: string }).code, 'CLONE_SUSPECTED');

    // Rename 2nd passkey
    const renameRes = await worker.fetch(`/api/auth/webauthn/credentials/${addedCred.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ deviceLabel: 'Office YubiKey 5' }),
    });
    assert.equal(renameRes.status, 200);

    // Revoking without step-up reauthProof MUST be blocked (403 REAUTH_REQUIRED)
    const unauthRevokeRes = await worker.fetch(
      `/api/auth/webauthn/credentials/${addedCred.id}/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
        body: JSON.stringify({}),
      }
    );
    assert.equal(unauthRevokeRes.status, 403);
    assert.equal(((await unauthRevokeRes.json()) as { code: string }).code, 'REAUTH_REQUIRED');

    // Perform step-up reauthentication and revoke 2nd passkey
    const reauthOptRes = await worker.fetch('/api/auth/webauthn/reauth/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({}),
    });
    assert.equal(reauthOptRes.status, 200);
    const reauthOpt = (await reauthOptRes.json()) as {
      challengeId: string;
      options: { challenge: string; rpId: string };
    };
    const reauthAssertion = await adminAuth1.makeAssertion({
      challenge: reauthOpt.options.challenge,
      origin: workerOrigin,
      rpId: reauthOpt.options.rpId,
      signCount: 0,
    });
    const reauthVerRes = await worker.fetch('/api/auth/webauthn/reauth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ challengeId: reauthOpt.challengeId, ...reauthAssertion }),
    });
    assert.equal(reauthVerRes.status, 200);
    const { reauthProof } = (await reauthVerRes.json()) as { reauthProof: string };

    const selfRevokeRes = await worker.fetch(
      `/api/auth/webauthn/credentials/${addedCred.id}/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
        body: JSON.stringify({ reauthProof }),
      }
    );
    assert.equal(selfRevokeRes.status, 200);

    // Login using revoked passkey MUST be rejected (401 CREDENTIAL_REVOKED)
    const { verRes: revokedLoginRes } = await loginWithPasskey('admin@igs.test', adminAuth2, {
      signCount: 7,
    });
    assert.equal(revokedLoginRes.status, 401);
    assert.equal(
      ((await revokedLoginRes.json()) as { code: string }).code,
      'CREDENTIAL_REVOKED'
    );

    // 8. Admin CSRF rejection check
    const csrfBlockedRes = await worker.fetch('/api/fee-plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Origin: 'https://evil-attacker.example',
      },
      body: JSON.stringify({ code: 'EVIL', name: 'Evil Plan', installmentCount: 1 }),
    });
    assert.equal(csrfBlockedRes.status, 403);
    assert.equal(((await csrfBlockedRes.json()) as { code: string }).code, 'CSRF_ORIGIN_REJECTED');

    // 9. Suspended account cannot be issued an enrollment link (400), AND a pre-existing token is blocked (403 ACCOUNT_INACTIVE)
    const issueSusRes = await worker.fetch('/api/users/u-suspended/reset-token', {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: workerOrigin },
    });
    assert.equal(issueSusRes.status, 400);

    const susRawToken = crypto.randomBytes(24).toString('hex');
    const susTokenHash = crypto.createHash('sha256').update(susRawToken).digest('hex');
    await runD1Sql(
      persistDir,
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ('prt-sus-1', 'u-suspended', ${sqlStr(susTokenHash)}, ${sqlStr(futureStart)}, ${sqlStr(pastStart)});`
    );
    const susEnrollOpt = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ enrollmentToken: susRawToken }),
    });
    assert.equal(susEnrollOpt.status, 403);
    assert.equal(((await susEnrollOpt.json()) as { code: string }).code, 'ACCOUNT_INACTIVE');

    // 10. Migrated legacy user enrolls passkey (and cross-user guard blocks admin from enrolling student's token)
    const issueLegacyRes = await worker.fetch('/api/users/u-student-legacy/reset-token', {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: workerOrigin },
    });
    assert.equal(issueLegacyRes.status, 200);
    const legacyToken = ((await issueLegacyRes.json()) as { onboardingToken: string })
      .onboardingToken;

    // Cross-user enrollment while signed in as admin MUST be blocked (403 CROSS_USER_ENROLLMENT_FORBIDDEN)
    const crossUserRes = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ enrollmentToken: legacyToken }),
    });
    assert.equal(crossUserRes.status, 403);
    assert.equal(
      ((await crossUserRes.json()) as { code: string }).code,
      'CROSS_USER_ENROLLMENT_FORBIDDEN'
    );

    // Unauthenticated legacy student enrolls passkey cleanly & keeps preserved password_hash untouched
    const legacyAuth = await createTestAuthenticator(COSE_ALG_ES256);
    const { verRes: legacyRegRes } = await enrollPasskeyWithToken(
      legacyToken,
      legacyAuth,
      'Student Pixel Phone'
    );
    assert.equal(legacyRegRes.status, 201);
    const legacyCookie = extractCookieHeader(legacyRegRes);
    const legacyCredId = ((await legacyRegRes.json()) as { credential: { id: string } }).credential
      .id;

    // Confirm legacy user's password_hash column remained untouched in D1
    const hashCheckStdout = await runD1Sql(
      persistDir,
      "SELECT password_hash FROM users WHERE id = 'u-student-legacy';"
    );
    assert.ok(hashCheckStdout.includes('$argon2id$v=19$m=19456,t=2,p=1$'));

    // RBAC: Student cannot access /api/students (403) or /api/users/:id/webauthn (403)
    assert.equal(
      (await worker.fetch('/api/students', { headers: { Cookie: legacyCookie } })).status,
      403
    );
    assert.equal(
      (
        await worker.fetch('/api/users/u-student-legacy/webauthn', {
          headers: { Cookie: legacyCookie },
        })
      ).status,
      403
    );

    // Admin inspects student's passkeys & revokes it -> immediately invalidates student's active session too!
    const adminInspectRes = await worker.fetch('/api/users/u-student-legacy/webauthn', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminInspectRes.status, 200);
    const inspectJson = (await adminInspectRes.json()) as {
      activeCount: number;
      credentials: Array<{ id: string }>;
    };
    assert.equal(inspectJson.activeCount, 1);

    const adminRevokeUserCred = await worker.fetch(
      `/api/users/u-student-legacy/webauthn/${legacyCredId}/revoke`,
      {
        method: 'POST',
        headers: { Cookie: adminCookie, Origin: workerOrigin },
      }
    );
    assert.equal(adminRevokeUserCred.status, 200);

    // Student's previously valid session cookie MUST now be rejected (401)
    const kickedOutRes = await worker.fetch('/api/dashboard', {
      headers: { Cookie: legacyCookie },
    });
    assert.equal(kickedOutRes.status, 401);

    // 11. Public admission submission with PDF attachment (stored in Cloudflare R2)
    const samplePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const pubAdmitRes = await worker.fetch('/api/admissions/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantName: 'Zainab Farooq Mir',
        applicantEmail: 'zainab.mir@igs.test',
        phone: '+91 9906000011',
        targetCourseId: 'crs-prod',
        targetBatchId: 'coh-1',
        preferredCohort: 'Morning Batch A',
        status: 'Submitted',
        documents: [
          {
            documentType: 'ID Verification',
            title: 'Aadhaar Scan',
            category: 'ID Verification',
            fileName: 'id-card.pdf',
            mimeType: 'application/pdf',
            contentBase64: `data:application/pdf;base64,${samplePdfBytes.toString('base64')}`,
          },
        ],
      }),
    });
    assert.equal(pubAdmitRes.status, 201);
    const { admissionId } = (await pubAdmitRes.json()) as { admissionId: string };
    assert.ok(admissionId);

    // 12. Admin inspects admission + downloads R2 document binary
    const admDetailRes = await worker.fetch(`/api/admissions/${admissionId}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(admDetailRes.status, 200);
    const admDetailJson = (await admDetailRes.json()) as {
      documents: Array<{ id: string }>;
    };
    assert.equal(admDetailJson.documents.length, 1);

    const admDocDownload = await worker.fetch(
      `/api/admissions/${admissionId}/documents/${admDetailJson.documents[0].id}/download`,
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(admDocDownload.status, 200);
    const downloadedBuf = Buffer.from(await admDocDownload.arrayBuffer());
    assert.equal(downloadedBuf.equals(samplePdfBytes), true);

    // 13. Admin approves admission -> creates student (inactive pending payment), enrollment, invoice, onboardingToken
    const approveRes = await worker.fetch(`/api/admissions/${admissionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        targetCourseId: 'crs-prod',
        targetBatchId: 'coh-1',
        feePlanId: 'fp-1',
        issueInvoice: true,
      }),
    });
    assert.equal(approveRes.status, 200);
    const approved = (await approveRes.json()) as {
      studentId: string;
      enrollmentId: string;
      invoiceId: string;
      onboardingToken: string;
      portalActivated: boolean;
    };
    assert.ok(approved.studentId);
    assert.ok(approved.enrollmentId);
    assert.ok(approved.invoiceId);
    assert.ok(approved.onboardingToken);
    assert.equal(approved.portalActivated, false);

    // 14. Full invoice payment auto-activates student portal
    const payRes = await worker.fetch(`/api/invoices/${approved.invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        amount: '10000.00',
        method: 'Bank Transfer',
        referenceCode: 'NEFT-2026-88',
        notes: 'Full upfront tuition settlement',
      }),
    });
    assert.equal(payRes.status, 201);
    const payJson = (await payRes.json()) as { paymentId: string; receiptNumber: string };
    assert.ok(payJson.paymentId);

    // Applicant now enrolls passkey using single-use onboardingToken and verifies IDOR protection
    const zainabAuth = await createTestAuthenticator(COSE_ALG_ES256);
    const { verRes: zainabEnrollRes } = await enrollPasskeyWithToken(
      approved.onboardingToken,
      zainabAuth,
      'Zainab Laptop'
    );
    assert.equal(zainabEnrollRes.status, 201);
    const studentCookie = extractCookieHeader(zainabEnrollRes);
    assert.ok(studentCookie);

    const idorInvoiceRes = await worker.fetch('/api/invoices/inv-other', {
      headers: { Cookie: studentCookie },
    });
    assert.equal(idorInvoiceRes.status, 403);

    // 15. Academic progression -> modules, assessment + grade, session + attendance -> certificate PDF & public verification
    for (const modId of ['mod-1', 'mod-2']) {
      const modRes = await worker.fetch('/api/progress/module-completion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
        body: JSON.stringify({
          enrollmentId: approved.enrollmentId,
          moduleId: modId,
          completed: true,
        }),
      });
      assert.equal(modRes.status, 200);
    }

    const assessRes = await worker.fetch('/api/assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        courseId: 'crs-prod',
        moduleId: 'mod-1',
        batchId: 'coh-1',
        title: 'Module 1 Capstone',
        assessmentType: 'Module Assessment',
        maxScore: 100,
        weight: 100,
      }),
    });
    assert.equal(assessRes.status, 201);
    const { assessmentId } = (await assessRes.json()) as { assessmentId: string };
    assert.ok(assessmentId);

    const gradeRes = await worker.fetch(`/api/assessments/${assessmentId}/grades`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        studentId: approved.studentId,
        score: 92,
        feedback: 'Excellent TypeScript craftsmanship.',
      }),
    });
    assert.equal(gradeRes.status, 200);

    const sesRes = await worker.fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        courseId: 'crs-prod',
        cohortId: 'coh-1',
        cohort: 'Morning Batch A',
        title: 'Final Capstone Review',
        room: 'LAB-01',
        startIso: pastStart,
        durationHours: 2,
      }),
    });
    assert.equal(sesRes.status, 201);
    const { sessionId } = (await sesRes.json()) as { sessionId: string };

    const attRes = await worker.fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        sessionId,
        studentId: approved.studentId,
        status: 'Present',
        note: 'Attended full lab',
      }),
    });
    assert.equal(attRes.status, 200);

    const certRes = await worker.fetch('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        studentId: approved.studentId,
        courseId: 'crs-prod',
      }),
    });
    assert.equal(certRes.status, 201);
    const certJson = (await certRes.json()) as {
      certificateCode: string;
      dashboard: {
        certificates: Array<{ id: string; certificateCode: string; verificationHash: string }>;
      };
    };
    const issuedCert = certJson.dashboard.certificates.find(
      (c) => c.certificateCode === certJson.certificateCode
    );
    assert.ok(issuedCert?.id);

    // Pure-JS Certificate PDF download
    const certPdfRes = await worker.fetch(`/api/certificates/${issuedCert.id}/download`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(certPdfRes.status, 200);
    assert.equal(certPdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(
      Buffer.from(await certPdfRes.arrayBuffer())
        .subarray(0, 7)
        .toString('utf8'),
      '%PDF-1.'
    );

    // Public Certificate Verification
    const verifyRes = await worker.fetch(
      `/api/certificates/verify/${encodeURIComponent(issuedCert.certificateCode)}`
    );
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as {
      certificate: { studentName: string; status: string };
    };
    assert.equal(verifyJson.certificate.studentName, 'Zainab Farooq Mir');
    assert.equal(verifyJson.certificate.status, 'Issued');

    // 16. Finance refund updates balance cleanly
    const refundRes = await worker.fetch(`/api/payments/${payJson.paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({ amount: '500.00', reason: 'Scholarship fee concession refund' }),
    });
    assert.equal(refundRes.status, 201);

    // 17. General R2 document upload & download
    const docBytes = Buffer.from('IGS Syllabus Document Content 2026');
    const docUpRes = await worker.fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: workerOrigin },
      body: JSON.stringify({
        ownerUserId: approved.studentId,
        courseId: 'crs-prod',
        title: 'Student Handbook 2026',
        category: 'Syllabus',
        fileName: 'handbook.txt',
        mimeType: 'text/plain',
        contentBase64: docBytes.toString('base64'),
      }),
    });
    assert.equal(docUpRes.status, 201);
    const { documentId } = (await docUpRes.json()) as { documentId: string };
    const docDownRes = await worker.fetch(`/api/documents/${documentId}/download`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(docDownRes.status, 200);
    assert.equal(
      Buffer.from(await docDownRes.arrayBuffer()).toString('utf8'),
      docBytes.toString('utf8')
    );

    // 18. CSV & PDF reports
    const csvRep = await worker.fetch('/api/reports/academic-progress?format=csv', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(csvRep.status, 200);
    assert.ok((csvRep.headers.get('content-type') || '').includes('text/csv'));
    assert.ok((await csvRep.text()).includes('Zainab Farooq Mir'));

    const pdfRep = await worker.fetch('/api/reports/financial-collections?format=pdf', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(pdfRep.status, 200);
    assert.equal(pdfRep.headers.get('content-type'), 'application/pdf');

    // 19. Audit logs, email delivery logs, worker status, token redaction & revocation
    const issueResetRes = await worker.fetch('/api/users/u-inst/reset-token', {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: workerOrigin },
    });
    assert.equal(issueResetRes.status, 200);
    const issuedReset = (await issueResetRes.json()) as {
      ok: boolean;
      onboardingToken: string;
    };
    assert.equal(issuedReset.ok, true);
    assert.ok(issuedReset.onboardingToken.length >= 24);

    // Raw token must never appear in audit logs or background_jobs payload
    const auditAfterIssue = await worker.fetch('/api/audit-logs', {
      headers: { Cookie: adminCookie },
    });
    assert.equal(auditAfterIssue.status, 200);
    const auditBodyText = await auditAfterIssue.text();
    assert.ok(!auditBodyText.includes(issuedReset.onboardingToken));
    assert.ok(auditBodyText.includes('WEBAUTHN_CLONE_SUSPECTED'));

    const bgPayloadStdout = await runD1Sql(
      persistDir,
      "SELECT payload FROM background_jobs WHERE job_type = 'notification_email' ORDER BY created_at DESC LIMIT 5;"
    );
    assert.ok(!bgPayloadStdout.includes(issuedReset.onboardingToken));
    assert.ok(bgPayloadStdout.includes('EMAIL_PROVIDER=disabled'));

    // Explicitly revoke enrollment token and verify WebAuthn register/options rejects it
    const revokeRes = await worker.fetch('/api/users/u-inst/revoke-reset-tokens', {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: workerOrigin },
    });
    assert.equal(revokeRes.status, 200);
    assert.equal(((await revokeRes.json()) as { revokedCount: number }).revokedCount, 1);

    const revokedEnrollRes = await worker.fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: workerOrigin },
      body: JSON.stringify({ enrollmentToken: issuedReset.onboardingToken }),
    });
    assert.equal(revokedEnrollRes.status, 400);
    assert.equal(
      ((await revokedEnrollRes.json()) as { code: string }).code,
      'ENROLLMENT_TOKEN_USED'
    );

    const [emailRes, workerStatusRes] = await Promise.all([
      worker.fetch('/api/admin/email-delivery', { headers: { Cookie: adminCookie } }),
      worker.fetch('/api/admin/worker-status', { headers: { Cookie: adminCookie } }),
    ]);
    assert.equal(emailRes.status, 200);
    assert.equal(workerStatusRes.status, 200);
    assert.ok(expectedRpId.length > 0);
  } finally {
    await worker.stop();
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(seedSqlFile, { force: true }).catch(() => undefined);
  }
});

test('D1 Queue consumer retry/failure exhaustion, idempotent email skip, and Cron sweep (including WebAuthn challenges)', async () => {
  const bgJobs = new Map<string, Record<string, unknown>>();
  const deliveryLogs = new Map<string, Record<string, unknown>>();
  const authSessions = new Map<string, { id: string; expires_at: string; revoked_at: string | null }>();
  const resetTokens = new Map<string, { id: string; expires_at: string; used_at: string | null }>();
  const webAuthnChallenges = new Map<string, { id: string; expires_at: string }>();

  authSessions.set('ses-exp', {
    id: 'ses-exp',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    revoked_at: null,
  });
  resetTokens.set('prt-exp', {
    id: 'prt-exp',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    used_at: null,
  });
  webAuthnChallenges.set('wch-exp', {
    id: 'wch-exp',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const makeStmt = (sql: string, bound: unknown[] = []) => ({
    bind: (...vals: unknown[]) => makeStmt(sql, vals),
    first: async <T = Record<string, unknown>>() => {
      if (sql.includes("FROM background_jobs WHERE id = ? AND status = 'Pending'")) {
        const job = bgJobs.get(String(bound[0]));
        if (job && job.status === 'Pending') return { ...job } as T;
        return null;
      }
      if (sql.includes('FROM background_jobs WHERE dedupe_key = ?')) {
        for (const j of bgJobs.values()) {
          if (j.dedupe_key === bound[0]) return { ...j } as T;
        }
        return null;
      }
      if (sql.includes('SELECT status FROM delivery_logs WHERE id = ?')) {
        const log = deliveryLogs.get(String(bound[0]));
        return log ? ({ status: log.status } as T) : null;
      }
      return null;
    },
    run: async () => {
      if (sql.startsWith('INSERT INTO delivery_logs')) {
        deliveryLogs.set(String(bound[0]), {
          id: bound[0],
          status: 'Queued',
          error_message: null,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('INSERT INTO background_jobs')) {
        bgJobs.set(String(bound[0]), {
          id: bound[0],
          job_type: bound[1],
          dedupe_key: null,
          payload: bound[2],
          status: 'Pending',
          attempts: 0,
          max_attempts: Number(bound[3] ?? 2),
          run_after: bound[4],
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes("SET status = 'Processing'")) {
        const id = String(bound[5]);
        const job = bgJobs.get(id);
        if (job && job.status === 'Pending' && Number(job.attempts) === Number(bound[6])) {
          job.status = 'Processing';
          job.attempts = Number(job.attempts) + 1;
          job.run_after = new Date().toISOString();
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes("SET status = 'Completed'")) {
        const id = String(bound[3]);
        const job = bgJobs.get(id);
        if (job && job.status === 'Processing') job.status = 'Completed';
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE background_jobs') && sql.includes('SET status = ?')) {
        const id = String(bound[7]);
        const job = bgJobs.get(id);
        if (job && job.status === 'Processing') {
          job.status = bound[0];
          job.last_error = bound[2];
          job.run_after = bound[4];
          job.payload = bound[5];
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE delivery_logs')) {
        const log = deliveryLogs.get(String(bound[bound.length - 1]));
        if (log) {
          if (sql.includes("'Failed'")) {
            log.status = 'Failed';
            log.error_message = bound[0] ?? null;
          } else {
            log.status = String(bound[0]);
            log.error_message = bound.length >= 5 ? bound[2] : bound[1];
          }
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('DELETE FROM auth_sessions')) {
        const before = authSessions.size;
        authSessions.delete('ses-exp');
        return { success: true, meta: { changes: before - authSessions.size } };
      }
      if (sql.startsWith('DELETE FROM password_reset_tokens')) {
        const before = resetTokens.size;
        resetTokens.delete('prt-exp');
        return { success: true, meta: { changes: before - resetTokens.size } };
      }
      if (sql.startsWith('DELETE FROM webauthn_challenges')) {
        const before = webAuthnChallenges.size;
        webAuthnChallenges.delete('wch-exp');
        return { success: true, meta: { changes: before - webAuthnChallenges.size } };
      }
      return { success: true, meta: { changes: 0 } };
    },
    all: async <T = Record<string, unknown>>() => ({
      success: true,
      results: [] as T[],
    }),
    raw: async () => [],
  });

  const mockDb = {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: Array<{ run: () => Promise<{ success: boolean }> }>) =>
      Promise.all(stmts.map((s) => s.run())),
  };

  // 1. Disabled email redacts sensitive payloads at enqueue and logs Skipped cleanly
  await runWithD1Database(mockDb, async () => {
    await runWithD1EmailConfig({ EMAIL_PROVIDER: 'disabled' }, async () => {
      const queued = await queueD1TransactionalEmail(
        {
          recipientEmail: 'student@igs.test',
          subject: 'Welcome to IGS',
          bodyText: 'https://igs.test/?enrollToken=sensitive-disabled-token-12345',
          redactSensitive: true,
          maxAttempts: 2,
        },
        mockDb
      );
      assert.ok(queued);
      assert.ok(
        !String(bgJobs.get(queued.jobId)?.payload).includes('sensitive-disabled-token-12345')
      );
      assert.ok(
        String(bgJobs.get(queued.jobId)?.payload).includes('[REDACTED — EMAIL_PROVIDER=disabled]')
      );

      let ackedCount = 0;
      const outcome = await handleD1WorkerQueueBatch(
        {
          queue: 'igs-ams-jobs',
          messages: [
            {
              id: 'msg-1',
              attempts: 1,
              body: {
                jobId: queued.jobId,
                jobType: 'notification_email',
                enqueuedAt: new Date().toISOString(),
              },
              ack: () => {
                ackedCount += 1;
              },
              retry: () => {
                throw new Error('Should not retry disabled email provider');
              },
            },
          ],
        },
        { DB: mockDb, EMAIL_PROVIDER: 'disabled' }
      );
      assert.equal(outcome.acked, 1);
      assert.equal(ackedCount, 1);
      assert.equal(deliveryLogs.get(queued.deliveryLogId)?.status, 'Skipped');
    });
  });

  // 2. Failing HTTP email retries then exhausts cleanly into Failed status & redacts sensitive payload
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Upstream error', { status: 500 })) as typeof fetch;
  try {
    await runWithD1Database(mockDb, async () => {
      await runWithD1EmailConfig(
        {
          EMAIL_PROVIDER: 'http',
          EMAIL_HTTP_URL: 'https://mail.example/send',
          EMAIL_FROM: 'noreply@igs.test',
        },
        async () => {
          const queued = await queueD1TransactionalEmail(
            {
              recipientEmail: 'reset@igs.test',
              subject: 'Passkey Enrollment',
              bodyText: 'secret-token-should-redact',
              redactSensitive: true,
              maxAttempts: 2,
            },
            mockDb
          );
          assert.ok(queued);

          const firstRun = await handleD1WorkerQueueBatch(
            {
              queue: 'igs-ams-jobs',
              messages: [
                {
                  id: 'msg-r1',
                  attempts: 1,
                  body: {
                    jobId: queued.jobId,
                    jobType: 'notification_email',
                    enqueuedAt: new Date().toISOString(),
                  },
                  ack: () => {
                    throw new Error('Should retry on first attempt');
                  },
                  retry: () => {},
                },
              ],
            },
            {
              DB: mockDb,
              EMAIL_PROVIDER: 'http',
              EMAIL_HTTP_URL: 'https://mail.example/send',
              EMAIL_FROM: 'noreply@igs.test',
            }
          );
          assert.equal(firstRun.retried, 1);
          assert.equal(bgJobs.get(queued.jobId)?.status, 'Pending');

          const secondRun = await handleD1WorkerQueueBatch(
            {
              queue: 'igs-ams-jobs',
              messages: [
                {
                  id: 'msg-r2',
                  attempts: 2,
                  body: {
                    jobId: queued.jobId,
                    jobType: 'notification_email',
                    enqueuedAt: new Date().toISOString(),
                  },
                  ack: () => {},
                  retry: () => {
                    throw new Error('Should ack exhausted failure to prevent infinite queue loop');
                  },
                },
              ],
            },
            {
              DB: mockDb,
              EMAIL_PROVIDER: 'http',
              EMAIL_HTTP_URL: 'https://mail.example/send',
              EMAIL_FROM: 'noreply@igs.test',
            }
          );
          assert.equal(secondRun.acked, 1);
          assert.equal(bgJobs.get(queued.jobId)?.status, 'Failed');
          assert.equal(deliveryLogs.get(queued.deliveryLogId)?.status, 'Failed');
          assert.ok(String(bgJobs.get(queued.jobId)?.payload).includes('[REDACTED AFTER FAILURE]'));
        }
      );
    });

    // 3. Cron scheduled sweep housekeeping removes expired sessions, enrollment tokens, and WebAuthn challenges
    const sweep = await handleD1WorkerScheduledSweep(
      { cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry: () => {} },
      { DB: mockDb, EMAIL_PROVIDER: 'disabled' }
    );
    assert.equal(sweep.expiredSessionsDeleted, 1);
    assert.equal(sweep.expiredResetTokensDeleted, 1);
    assert.equal(sweep.expiredWebAuthnChallengesDeleted, 1);
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.equal(typeof d1All, 'function');
  assert.equal(typeof d1First, 'function');
  assert.equal(typeof d1Run, 'function');
});
