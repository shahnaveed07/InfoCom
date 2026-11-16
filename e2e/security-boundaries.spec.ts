import { expect, test } from '@playwright/test';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_DEV_URL,
  E2E_INSTRUCTOR_EMAIL,
  E2E_INSTRUCTOR_PASSWORD,
  E2E_OTHER_COURSE_ID,
  E2E_OTHER_STUDENT_ID,
  E2E_STUDENT_EMAIL,
  E2E_STUDENT_PASSWORD,
} from './helpers/db-env.ts';

test.describe('Security Boundaries & RBAC Enforcement', () => {
  test('Login screen has no Register tab or Google SSO, and POST /api/auth/register returns 410 Gone', async ({
    page,
    request,
  }) => {
    await page.goto(`${E2E_DEV_URL}/login`, { waitUntil: 'networkidle' });

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reset / Setup Password' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Register|Sign Up/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Google/i })).toHaveCount(0);

    const regRes = await request.post(`${E2E_DEV_URL}/api/auth/register`, {
      data: {
        name: 'Rogue User',
        email: 'rogue.e2e@infocom.test',
        password: 'RoguePassword123!',
      },
    });
    expect(regRes.status()).toBe(410);
  });

  test('Unauthenticated access to /portal redirects to /login and logout invalidates session across reload', async ({
    page,
  }) => {
    await page.goto(`${E2E_DEV_URL}/portal`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /Sign In to Portal/i })).toBeVisible();

    await page.locator('#auth-email').fill(E2E_ADMIN_EMAIL);
    await page.locator('#auth-password').fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole('button', { name: /Sign Out/i })).toBeVisible();

    await page.getByRole('button', { name: /Sign Out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(`${E2E_DEV_URL}/portal`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login$/);

    const meRes = await page.request.get(`${E2E_DEV_URL}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    const meJson = (await meRes.json()) as { user: unknown };
    expect(meJson.user).toBeNull();

    const dashboardRes = await page.request.get(`${E2E_DEV_URL}/api/dashboard`);
    expect(dashboardRes.status()).toBe(401);
  });

  test('Instructor receives 403 on unrelated courses and financial endpoints', async ({ page }) => {
    await page.goto(`${E2E_DEV_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#auth-email').fill(E2E_INSTRUCTOR_EMAIL);
    await page.locator('#auth-password').fill(E2E_INSTRUCTOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByText(/Dr\. Elena Vance/i).first()).toBeVisible();

    // Unrelated course assigned to Prof. David Okonkwo is hidden in UI and returns 403 via API
    await expect(page.getByText('Internal BI & Predictive Modeling')).toHaveCount(0);

    const unrelatedCourseRes = await page.request.get(
      `${E2E_DEV_URL}/api/courses/${E2E_OTHER_COURSE_ID}`
    );
    expect(unrelatedCourseRes.status()).toBe(403);

    const paymentsRes = await page.request.get(`${E2E_DEV_URL}/api/payments`);
    expect(paymentsRes.status()).toBe(403);
  });

  test('Student receives 403 on another student record and administrative endpoints', async ({
    page,
  }) => {
    await page.goto(`${E2E_DEV_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#auth-email').fill(E2E_STUDENT_EMAIL);
    await page.locator('#auth-password').fill(E2E_STUDENT_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByText('Aarav Sharma').first()).toBeVisible();

    const otherProfileRes = await page.request.get(
      `${E2E_DEV_URL}/api/students/${E2E_OTHER_STUDENT_ID}`
    );
    expect(otherProfileRes.status()).toBe(403);

    const otherFinanceRes = await page.request.get(
      `${E2E_DEV_URL}/api/students/${E2E_OTHER_STUDENT_ID}/finance`
    );
    expect(otherFinanceRes.status()).toBe(403);

    const auditLogsRes = await page.request.get(`${E2E_DEV_URL}/api/audit-logs`);
    expect(auditLogsRes.status()).toBe(403);
  });
});
