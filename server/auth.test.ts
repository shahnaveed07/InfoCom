import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  generateOpaqueSessionToken,
  generatePasswordResetToken,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  parseCookies,
  verifyPassword,
} from './auth.ts';
import { createRateLimiter, csrfOriginGuard } from './middleware/security.ts';
import { ROLE_PERMISSIONS, hasPermission } from './security/permissions.ts';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    headers: {},
    ip: '127.0.0.1',
    body: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = undefined;

  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as unknown as Response;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    headers,
  };
}

test('hashPassword produces salted Argon2id digests and verifyPassword validates them', async () => {
  const hashA = await hashPassword('AcademyPass!2026');
  const hashB = await hashPassword('AcademyPass!2026');
  assert.ok(hashA.startsWith('$argon2id$'));
  assert.ok(hashB.startsWith('$argon2id$'));
  assert.notEqual(hashA, hashB);

  const okRes = await verifyPassword('AcademyPass!2026', hashA);
  assert.deepEqual(okRes, { valid: true, needsRehash: false });

  const badRes = await verifyPassword('WrongPassword', hashA);
  assert.deepEqual(badRes, { valid: false, needsRehash: false });

  assert.deepEqual(await verifyPassword('AcademyPass!2026', 'malformed-hash'), {
    valid: false,
    needsRehash: false,
  });
  assert.deepEqual(await verifyPassword('AcademyPass!2026', null), {
    valid: false,
    needsRehash: false,
  });
});

test('verifyPassword supports legacy scrypt hashes and flags them for Argon2id upgrade', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync('LegacyPass!2026', salt, 64).toString('hex');
  const legacyHash = `${salt}:${derived}`;

  const validLegacy = await verifyPassword('LegacyPass!2026', legacyHash);
  assert.deepEqual(validLegacy, { valid: true, needsRehash: true });

  const invalidLegacy = await verifyPassword('WrongLegacyPass', legacyHash);
  assert.deepEqual(invalidLegacy, { valid: false, needsRehash: false });
});

test('opaque session and password reset tokens produce high-entropy tokens and deterministic SHA-256 hashes', () => {
  const token1 = generateOpaqueSessionToken();
  const token2 = generateOpaqueSessionToken();
  assert.notEqual(token1, token2);
  assert.ok(token1.length >= 40);

  const hash1 = hashSessionToken(token1);
  assert.equal(hash1.length, 64);
  assert.notEqual(hash1, token1);
  assert.equal(hash1, hashSessionToken(token1));

  const reset = generatePasswordResetToken();
  assert.equal(reset.tokenHash, hashPasswordResetToken(reset.rawToken));
  assert.notEqual(reset.rawToken, reset.tokenHash);

  const parsed = parseCookies('foo=bar; nta_session=' + encodeURIComponent(token1));
  assert.equal(parsed.nta_session, token1);
});

test('ROLE_PERMISSIONS enforces explicit boundaries across admin, instructor, and student', () => {
  assert.equal(hasPermission('admin', 'users:manage'), true);
  assert.equal(hasPermission('admin', 'finance:manage'), true);
  assert.equal(hasPermission('admin', 'audit:read'), true);

  assert.equal(hasPermission('instructor', 'grades:manage'), true);
  assert.equal(hasPermission('instructor', 'attendance:manage'), true);
  assert.equal(hasPermission('instructor', 'finance:manage'), false);
  assert.equal(hasPermission('instructor', 'finance:read_own'), false);
  assert.equal(hasPermission('instructor', 'users:manage'), false);
  assert.equal(hasPermission('instructor', 'courses:create'), false);
  assert.equal(hasPermission('instructor', 'audit:read'), false);

  assert.equal(hasPermission('student', 'profile:self'), true);
  assert.equal(hasPermission('student', 'finance:read_own'), true);
  assert.equal(hasPermission('student', 'grades:manage'), false);
  assert.equal(hasPermission('student', 'enrollments:manage'), false);
  assert.equal(hasPermission('student', 'users:manage'), false);
  assert.ok(ROLE_PERMISSIONS.admin.size > ROLE_PERMISSIONS.instructor.size);
});

test('createRateLimiter enforces maxRequests, sets Retry-After on 429, and supports reset()', () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 3,
    keyPrefix: 'test-login',
  });

  let nextCalls = 0;
  for (let i = 0; i < 3; i += 1) {
    const req = createMockReq({ ip: '10.0.0.5' });
    const mock = createMockRes();
    limiter(req, mock.res, () => {
      nextCalls += 1;
    });
    assert.equal(mock.statusCode, 200);
  }
  assert.equal(nextCalls, 3);

  const overflowReq = createMockReq({ ip: '10.0.0.5' });
  const overflowMock = createMockRes();
  limiter(overflowReq, overflowMock.res, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 3);
  assert.equal(overflowMock.statusCode, 429);
  assert.ok(Number(overflowMock.headers['retry-after']) >= 1);

  limiter.reset();
  const afterResetReq = createMockReq({ ip: '10.0.0.5' });
  const afterResetMock = createMockRes();
  limiter(afterResetReq, afterResetMock.res, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 4);
  assert.equal(afterResetMock.statusCode, 200);
});

test('csrfOriginGuard blocks cross-origin, null-origin, and cross-site Fetch metadata on cookie mutations', () => {
  // Same-origin POST with session cookie -> allowed
  let allowed = false;
  const sameOriginReq = createMockReq({
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      cookie: 'nta_session=opaque-session-token',
    },
  });
  const sameOriginRes = createMockRes();
  csrfOriginGuard(sameOriginReq, sameOriginRes.res, () => {
    allowed = true;
  });
  assert.equal(allowed, true);

  // Cross-origin POST with session cookie -> 403
  allowed = false;
  const crossOriginReq = createMockReq({
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'https://evil-site.example',
      cookie: 'nta_session=opaque-session-token',
    },
  });
  const crossOriginRes = createMockRes();
  csrfOriginGuard(crossOriginReq, crossOriginRes.res, () => {
    allowed = true;
  });
  assert.equal(allowed, false);
  assert.equal(crossOriginRes.statusCode, 403);

  // Null origin POST with session cookie -> 403
  allowed = false;
  const nullOriginReq = createMockReq({
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'null',
      cookie: 'nta_session=opaque-session-token',
    },
  });
  const nullOriginRes = createMockRes();
  csrfOriginGuard(nullOriginReq, nullOriginRes.res, () => {
    allowed = true;
  });
  assert.equal(allowed, false);
  assert.equal(nullOriginRes.statusCode, 403);

  // Sec-Fetch-Site: cross-site with session cookie -> 403
  allowed = false;
  const fetchSiteReq = createMockReq({
    method: 'DELETE',
    headers: {
      host: 'localhost:3000',
      'sec-fetch-site': 'cross-site',
      cookie: 'nta_session=opaque-session-token',
    },
  });
  const fetchSiteRes = createMockRes();
  csrfOriginGuard(fetchSiteReq, fetchSiteRes.res, () => {
    allowed = true;
  });
  assert.equal(allowed, false);
  assert.equal(fetchSiteRes.statusCode, 403);

  // Bearer token request -> allowed even with external origin
  allowed = false;
  const bearerReq = createMockReq({
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'https://external-client.example',
      authorization: 'Bearer firebase-id-token',
    },
  });
  const bearerRes = createMockRes();
  csrfOriginGuard(bearerReq, bearerRes.res, () => {
    allowed = true;
  });
  assert.equal(allowed, true);
});
