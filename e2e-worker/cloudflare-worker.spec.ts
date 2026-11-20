import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin.demo@igssopore.local';
const TOKEN_STATE_FILE = path.join(os.tmpdir(), 'igs-cf-e2e-enroll-3107.json');

function trackRuntimeErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  return {
    assertClean: () => {
      expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
      expect(serverErrors, `HTTP 5xx responses: ${serverErrors.join(' | ')}`).toEqual([]);
    },
  };
}

test('Cloudflare Worker serves public SPA routes, auth config, deep links, and certificate verification with zero errors', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackRuntimeErrors(page);

  // Readiness, WebAuthn config, & public security boundary checks
  const readyRes = await request.get('/api/health/ready');
  expect(readyRes.status()).toBe(200);
  const readyJson = await readyRes.json();
  expect(readyJson.status).toBe('ok');
  expect(readyJson.database).toBe('connected');
  expect(readyJson.mode).toBe('d1');

  const configRes = await request.get('/api/auth/config');
  expect(configRes.status()).toBe(200);
  const configJson = await configRes.json();
  expect(configJson.authMode).toBe('webauthn');
  expect(configJson.passwordAuthEnabled).toBe(false);
  expect(configJson.passkeySupported).toBe(true);

  const regRes = await request.post('/api/auth/register', {
    data: { name: 'Public User', email: 'pub@example.com', password: 'Password123!' },
  });
  expect(regRes.status()).toBe(410);

  const unauthStudents = await request.get('/api/students');
  expect(unauthStudents.status()).toBe(401);

  // Public SPA routes including direct deep-link loads
  for (const route of [
    '/',
    '/about',
    '/courses',
    '/admissions',
    '/verify-certificate',
    '/contact',
    '/login',
  ]) {
    const res = await page.goto(route, { waitUntil: 'networkidle' });
    expect(res?.status(), `Route ${route} returned non-200`).toBe(200);
    await expect(page.locator('body')).toContainText('InfoCom Global Services');
  }

  // Login screen shows Passkey Sign In (not password field) in WebAuthn mode
  await expect(page.getByRole('button', { name: /Sign In with Passkey/i })).toBeVisible();

  // Deep-link course detail route reload served cleanly via env.ASSETS SPA fallback
  const courseRes = await page.goto('/courses/web-development', {
    waitUntil: 'networkidle',
  });
  expect(courseRes?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('Full-Stack Web Development');

  // Public certificate verification against D1
  await page.goto('/verify-certificate', { waitUntil: 'networkidle' });
  await page.getByPlaceholder(/IGS-CERT|certificate/i).fill('IGS-2026-0001');
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page.locator('body')).toContainText('Amina Rashid Lone');
  await expect(page.locator('body')).toContainText('Full-Stack Web Development');

  // Verify no broken images on landing page & mobile viewport has no horizontal overflow
  await page.goto('/', { waitUntil: 'networkidle' });
  const brokenImages = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth === 0
    ).length
  );
  expect(brokenImages).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  expect(hasOverflow).toBe(false);

  errors.assertClean();
});

test('Cloudflare Worker WebAuthn passkey enrollment, sign-in, passkey management, and admin link issuance/revocation work end-to-end with Chromium Virtual Authenticator', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackRuntimeErrors(page);

  // Attach a real CTAP2 / internal WebAuthn virtual authenticator via Chromium CDP
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId: primaryAuthId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  let backupAuthId: string | null = null;

  try {
    // 1. Load the one-time enrollment token issued by scripts/d1-bootstrap-passkey-admin.ts
    const bootstrapData = JSON.parse(fs.readFileSync(TOKEN_STATE_FILE, 'utf-8')) as {
      enrollmentToken: string;
      enrollPath: string;
    };
    expect(bootstrapData.enrollmentToken).toBeTruthy();

    await page.goto(bootstrapData.enrollPath, { waitUntil: 'networkidle' });
    await expect(page.getByLabel(/Device Name/i)).toBeVisible();
    await page.getByLabel(/Device Name/i).fill('Director Chromium Key');
    await page.getByRole('button', { name: /Register Passkey & Sign In/i }).click();

    await page.waitForURL(/\/portal/, { timeout: 20_000 });
    await expect(page.locator('body')).toContainText('IGS Principal Administrator');

    // 2. Sign out and sign back in using the newly enrolled WebAuthn passkey
    await page.getByRole('button', { name: /Sign Out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    await page.getByLabel(/Academy Email Address/i).fill(ADMIN_EMAIL);
    await page.getByRole('button', { name: /Sign In with Passkey/i }).click();

    await page.waitForURL(/\/portal/, { timeout: 20_000 });
    await expect(page.locator('body')).toContainText('IGS Principal Administrator');

    // 3. Open Security & Passkeys modal -> verify primary passkey & excludeCredentials duplicate protection
    await page.getByRole('button', { name: 'Security & Passkeys' }).click();
    await expect(page.locator('body')).toContainText('Director Chromium Key');

    // Attempting to register again on the SAME authenticator must show friendly excludeCredentials error
    await page.getByLabel('Add a New Passkey / Backup Device').fill('Duplicate Attempt');
    await page.getByRole('button', { name: 'Register Passkey' }).click();
    await expect(page.locator('body')).toContainText(
      /already has a passkey registered for this account/i
    );

    // Pause presence simulation on primary device and attach a 2nd virtual roaming authenticator (YubiKey simulation)
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId: primaryAuthId,
      enabled: false,
    });
    const backupAdded = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    backupAuthId = backupAdded.authenticatorId;

    await page.getByLabel('Add a New Passkey / Backup Device').fill('Backup Lab Key');
    await page.getByRole('button', { name: 'Register Passkey' }).click();
    await expect(page.locator('body')).toContainText('Backup Lab Key');

    // Rename the second passkey
    const backupRow = page.locator('li', { hasText: 'Backup Lab Key' }).first();
    await backupRow.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('New passkey device label').fill('Renamed Lab Key');
    await page.getByRole('button', { name: 'Save passkey name' }).click();
    await expect(page.locator('body')).toContainText('Renamed Lab Key');

    // Revoke the second passkey (triggers live WebAuthn step-up reauthentication!)
    const renamedRow = page.locator('li', { hasText: 'Renamed Lab Key' }).first();
    await renamedRow.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.locator('body')).toContainText(/Revoked passkey "Renamed Lab Key"/i);

    // Close modal
    await page.getByRole('button', { name: 'Close passkey management modal' }).click();

    // 4. Navigate to User Accounts -> issue & revoke a single-use passkey enrollment link for Amina Rashid Lone
    await page.getByRole('button', { name: 'User Accounts' }).click();
    await expect(page.locator('body')).toContainText('Amina Rashid Lone');

    await page.getByRole('button', { name: 'Issue passkey enrollment link for Amina Rashid Lone' }).click();
    const urlInput = page.getByLabel('Onboarding setup URL');
    await expect(urlInput).toBeVisible();
    const issuedUrl = await urlInput.inputValue();
    const parsedUrl = new URL(issuedUrl);
    const enrollToken = parsedUrl.searchParams.get('enrollToken');
    expect(enrollToken).toBeTruthy();

    // Explicitly revoke the newly issued token via the UI Revoke Link button
    await page.getByRole('button', { name: 'Revoke reset links for Amina Rashid Lone' }).click();
    await expect(page.locator('[role="status"]')).toContainText(
      /Revoked 1 active onboarding\/reset token/i
    );
    await expect(urlInput).toHaveCount(0);

    // Confirm the revoked enrollment token is rejected by /api/auth/webauthn/register/options
    const revokedOptRes = await request.post('/api/auth/webauthn/register/options', {
      data: { enrollmentToken: enrollToken },
    });
    expect(revokedOptRes.status()).toBe(400);
    const revokedOptJson = await revokedOptRes.json();
    expect(revokedOptJson.code).toBe('ENROLLMENT_TOKEN_USED');

    // Admin inspects user passkeys modal cleanly
    await page.getByRole('button', { name: 'Manage passkeys for Amina Rashid Lone' }).click();
    await expect(page.locator('body')).toContainText('Amina Rashid Lone');
    await page.getByRole('button', { name: 'Close user passkeys modal' }).click();

    errors.assertClean();
  } finally {
    if (backupAuthId) {
      await cdp
        .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: backupAuthId })
        .catch(() => {});
    }
    await cdp
      .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: primaryAuthId })
      .catch(() => {});
  }
});
