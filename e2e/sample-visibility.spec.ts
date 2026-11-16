import { expect, test } from '@playwright/test';
import {
  E2E_DEV_URL,
  E2E_PROD_REAL_COURSE_SLUG,
  E2E_PROD_URL,
} from './helpers/db-env.ts';

test.describe('Task 3 — Sample Data Visibility Consistency (Dev vs Production)', () => {
  test('Development mode consistently marks sample courses across Home, Catalog, and Course Detail', async ({
    page,
  }) => {
    await page.goto(`${E2E_DEV_URL}/`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Development Sample Catalog:/i)).toBeVisible();
    await expect(page.getByText('Sample Program').first()).toBeVisible();

    await page.goto(`${E2E_DEV_URL}/courses`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Development Sample Catalog:/i)).toBeVisible();
    await expect(page.getByText('Sample Program').first()).toBeVisible();
    await expect(page.getByText('Web Development')).toBeVisible();
    await expect(page.getByText('Applied Cloud Systems Architecture')).toBeVisible();

    await page.goto(`${E2E_DEV_URL}/courses/web-development`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Development Sample Program:/i)).toBeVisible();
    await expect(page.getByText('Sample Program').first()).toBeVisible();
  });

  test('Production mode excludes isDemo fixtures and sample banners while keeping non-demo Admin courses visible', async ({
    page,
    request,
  }) => {
    const apiCatalogRes = await request.get(`${E2E_PROD_URL}/api/public/courses`);
    expect(apiCatalogRes.status()).toBe(200);
    const catalogJson = (await apiCatalogRes.json()) as {
      isDemoEnvironment: boolean;
      courses: Array<{ slug: string; isDemo?: boolean }>;
    };
    expect(catalogJson.isDemoEnvironment).toBe(false);
    expect(catalogJson.courses.some((c) => c.slug === 'web-development')).toBe(false);
    expect(catalogJson.courses.some((c) => c.isDemo === true)).toBe(false);
    expect(catalogJson.courses.some((c) => c.slug === E2E_PROD_REAL_COURSE_SLUG)).toBe(true);

    const demoDetailRes = await request.get(`${E2E_PROD_URL}/api/public/courses/web-development`);
    expect(demoDetailRes.status()).toBe(404);

    // UI verification across Home, Catalog, Real Course Detail, and blocked Demo Detail
    await page.goto(`${E2E_PROD_URL}/`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Development Sample Catalog/i)).toHaveCount(0);
    await expect(page.getByText('Sample Program')).toHaveCount(0);
    await expect(page.getByText('Web Development')).toHaveCount(0);
    await expect(page.getByText('Applied Cloud Systems Architecture')).toBeVisible();

    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Development Sample Catalog/i)).toHaveCount(0);
    await expect(page.getByText('Sample Program')).toHaveCount(0);
    await expect(page.getByText('Web Development')).toHaveCount(0);
    await expect(page.getByText('Applied Cloud Systems Architecture')).toBeVisible();

    await page.goto(`${E2E_PROD_URL}/courses/${E2E_PROD_REAL_COURSE_SLUG}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Applied Cloud Systems Architecture' })).toBeVisible();
    await expect(page.getByText(/Development Sample/i)).toHaveCount(0);
    await expect(page.getByText('Sample Program')).toHaveCount(0);

    await page.goto(`${E2E_PROD_URL}/courses/web-development`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Program Not Found' })).toBeVisible();
  });
});
