import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin.demo@igssopore.local';
const ADMIN_PASSWORD = process.env.CF_E2E_ADMIN_PASSWORD || 'IgsCfE2e!Admin#2026';

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

test('Cloudflare Worker serves public SPA routes, deep links, and certificate verification with zero errors', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackRuntimeErrors(page);

  // Readiness & public security boundary checks
  const readyRes = await request.get('/api/health/ready');
  expect(readyRes.status()).toBe(200);
  const readyJson = await readyRes.json();
  expect(readyJson.status).toBe('ok');
  expect(readyJson.database).toBe('connected');
  expect(readyJson.mode).toBe('d1');

  const regRes = await request.post('/api/auth/register', {
    data: { name: 'Public User', email: 'pub@example.com', password: 'Password123!' },
  });
  expect(regRes.status()).toBe(410);

  const unauthStudents = await request.get('/api/students');
  expect(unauthStudents.status()).toBe(401);

  // Public SPA routes including direct deep-link loads
  for (const route of ['/', '/about', '/courses', '/admissions', '/verify-certificate', '/contact', '/login']) {
    const res = await page.goto(route, { waitUntil: 'networkidle' });
    expect(res?.status(), `Route ${route} returned non-200`).toBe(200);
    await expect(page.locator('body')).toContainText('InfoCom Global Services');
  }

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

test('Cloudflare Worker admin sign-in, onboarding token issuance, and explicit revocation work end-to-end', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackRuntimeErrors(page);

  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email Address').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL(/\/portal/, { timeout: 20_000 });
  await expect(page.locator('body')).toContainText('IGS Principal Administrator');

  // Navigate to User Accounts and issue + revoke a single-use onboarding link in the UI
  await page.getByRole('button', { name: 'User Accounts' }).click();
  await expect(page.locator('body')).toContainText('Amina Rashid Lone');

  await page.getByRole('button', { name: 'Issue reset link for Amina Rashid Lone' }).click();
  const urlInput = page.getByLabel('Onboarding setup URL');
  await expect(urlInput).toBeVisible();
  const issuedUrl = await urlInput.inputValue();
  const parsedUrl = new URL(issuedUrl);
  const setupToken = parsedUrl.searchParams.get('setupToken');
  expect(setupToken).toBeTruthy();

  // Explicitly revoke the newly issued token via the UI Revoke Link button
  await page.getByRole('button', { name: 'Revoke reset links for Amina Rashid Lone' }).click();
  await expect(page.locator('[role="status"]')).toContainText(/Revoked 1 active onboarding\/reset token/i);
  await expect(urlInput).toHaveCount(0);

  // Confirm the revoked token is rejected by /api/auth/reset-password
  const resetRes = await request.post('/api/auth/reset-password', {
    data: {
      token: setupToken,
      newPassword: 'BlockedRevokedPassword!2026',
    },
  });
  expect(resetRes.status()).toBe(400);

  errors.assertClean();
});
