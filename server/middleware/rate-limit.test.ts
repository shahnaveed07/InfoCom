import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { runWithRateLimiters } from './rate-limit.ts';
import {
  createRateLimiter,
  csrfOriginGuard,
  runWithSecurityEnv,
} from './security.ts';

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

test('csrfOriginGuard enforces cross-site allowlist only when CORS_CROSS_SITE_COOKIES=true and rejects null/unlisted origins', async () => {
  // 1. Cross-site allowed ONLY when CORS_CROSS_SITE_COOKIES=true and Origin is allowlisted
  await runWithSecurityEnv(
    {
      CORS_CROSS_SITE_COOKIES: 'true',
      CORS_ALLOWED_ORIGINS: 'https://igs-app.pages.dev',
      APP_URL: 'https://api.igs.example',
    },
    async () => {
      let nextCalled = false;
      const validCrossSiteReq = createMockReq({
        method: 'POST',
        headers: {
          host: 'api.igs.example',
          origin: 'https://igs-app.pages.dev',
          'sec-fetch-site': 'cross-site',
          cookie: 'igs_session=opaque-token',
        },
      });
      const validRes = createMockRes();
      csrfOriginGuard(validCrossSiteReq, validRes.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.equal(validRes.statusCode, 200);

      // Missing Origin header on cross-site Fetch -> still rejected
      nextCalled = false;
      const missingOriginReq = createMockReq({
        method: 'POST',
        headers: {
          host: 'api.igs.example',
          'sec-fetch-site': 'cross-site',
          cookie: 'igs_session=opaque-token',
        },
      });
      const missingRes = createMockRes();
      csrfOriginGuard(missingOriginReq, missingRes.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(missingRes.statusCode, 403);

      // Unlisted origin on cross-site Fetch -> rejected
      nextCalled = false;
      const evilCrossSiteReq = createMockReq({
        method: 'POST',
        headers: {
          host: 'api.igs.example',
          origin: 'https://evil-attacker.example',
          'sec-fetch-site': 'cross-site',
          cookie: 'igs_session=opaque-token',
        },
      });
      const evilRes = createMockRes();
      csrfOriginGuard(evilCrossSiteReq, evilRes.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(evilRes.statusCode, 403);

      // Origin: null -> always rejected even when CORS_CROSS_SITE_COOKIES=true
      nextCalled = false;
      const nullOriginReq = createMockReq({
        method: 'POST',
        headers: {
          host: 'api.igs.example',
          origin: 'null',
          'sec-fetch-site': 'cross-site',
          cookie: 'igs_session=opaque-token',
        },
      });
      const nullRes = createMockRes();
      csrfOriginGuard(nullOriginReq, nullRes.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(nullRes.statusCode, 403);
    }
  );
});

test('createRateLimiter delegates to Cloudflare distributed RateLimit binding when active and preserves fallback', async () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    keyPrefix: 'auth-login',
    bindingName: 'auth',
  });

  let hits = 0;
  const seenKeys: string[] = [];
  const fakeBinding = {
    async limit({ key }: { key: string }) {
      seenKeys.push(key);
      hits += 1;
      return { success: hits <= 2 };
    },
  };

  await runWithRateLimiters({ auth: fakeBinding, runtime: 'cloudflare-worker' }, async () => {
    for (let i = 0; i < 2; i += 1) {
      const req = createMockReq({
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      });
      const mock = createMockRes();
      let passed = false;
      await new Promise<void>((resolve) => {
        limiter(req, mock.res, () => {
          passed = true;
          resolve();
        });
      });
      assert.equal(passed, true);
      assert.equal(mock.headers['x-ratelimit-backend'], 'cloudflare-binding');
    }

    const blockedReq = createMockReq({
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    const blockedMock = createMockRes();
    let passedBlocked = false;
    await new Promise<void>((resolve) => {
      const origJson = blockedMock.res.json.bind(blockedMock.res);
      blockedMock.res.json = ((payload: unknown) => {
        origJson(payload);
        resolve();
        return blockedMock.res;
      }) as typeof blockedMock.res.json;

      limiter(blockedReq, blockedMock.res, () => {
        passedBlocked = true;
        resolve();
      });
    });

    assert.equal(passedBlocked, false);
    assert.equal(blockedMock.statusCode, 429);
    assert.equal(blockedMock.headers['x-ratelimit-backend'], 'cloudflare-binding');
    assert.ok(Number(blockedMock.headers['retry-after']) >= 1);
  });

  assert.equal(seenKeys.length, 3);
  assert.equal(seenKeys[0], 'auth-login:203.0.113.9');
});
