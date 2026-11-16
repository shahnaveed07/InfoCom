import { expect, test } from '@playwright/test';
import { E2E_DEV_URL, E2E_PROD_REAL_COURSE_SLUG, E2E_PROD_URL } from './helpers/db-env.ts';

test.describe('Part 13 — Health Endpoints, Production SPA Routing, Image Assets & Demo Fallback Recovery', () => {
  test('Health, readiness, and unknown /api/* JSON 404 endpoints behave properly in dev and prod servers', async ({
    request,
  }) => {
    for (const baseUrl of [E2E_DEV_URL, E2E_PROD_URL]) {
      const healthRes = await request.get(`${baseUrl}/api/health`);
      expect(healthRes.status()).toBe(200);
      const healthJson = (await healthRes.json()) as { status: string; service: string };
      expect(healthJson.status).toBe('ok');
      expect(healthJson.service).toBe('igs-ams-api');

      const readyRes = await request.get(`${baseUrl}/api/health/ready`);
      expect(readyRes.status()).toBe(200);
      const readyJson = (await readyRes.json()) as { status: string; database: string };
      expect(readyJson.status).toBe('ready');
      expect(readyJson.database).toBe('connected');

      const missingApiRes = await request.get(`${baseUrl}/api/non-existent-endpoint-check`);
      expect(missingApiRes.status()).toBe(404);
      expect(missingApiRes.headers()['content-type']).toContain('application/json');
      const missingJson = (await missingApiRes.json()) as { code: string; error: string };
      expect(missingJson.code).toBe('API_ROUTE_NOT_FOUND');
    }
  });

  test('Production build serves SPA routes directly and bundles all campus studio images without 404s', async ({
    page,
  }) => {
    const routesToCheck = [
      { path: '/', heading: /Practical computing/i, hasStudioImg: true },
      { path: '/courses', heading: /Training Programs Catalog/i, hasStudioImg: false },
      {
        path: `/courses/${E2E_PROD_REAL_COURSE_SLUG}`,
        heading: /Applied Cloud Systems Architecture/i,
        hasStudioImg: false,
      },
      { path: '/about', heading: /Structured computer training/i, hasStudioImg: true },
      { path: '/admissions', heading: /Online Admission Application/i, hasStudioImg: false },
      { path: '/contact', heading: /Campus Location/i, hasStudioImg: false },
      { path: '/verify-certificate', heading: /Official Certificate Verification/i, hasStudioImg: false },
      { path: '/login', heading: /Sign In to Portal/i, hasStudioImg: true },
    ];

    for (const route of routesToCheck) {
      await page.goto(`${E2E_PROD_URL}${route.path}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();

      if (route.hasStudioImg) {
        const broken = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img'))
            .filter((img) => {
              const s = window.getComputedStyle(img);
              return s.display !== 'none' && s.visibility !== 'hidden';
            })
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => img.getAttribute('src') || img.alt)
        );
        expect(broken, `Broken image on production ${route.path}`).toEqual([]);
      }
    }

    // Direct page reload on deep SPA route works cleanly
    await page.goto(`${E2E_PROD_URL}/courses/${E2E_PROD_REAL_COURSE_SLUG}`, {
      waitUntil: 'networkidle',
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { name: /Applied Cloud Systems Architecture/i })
    ).toBeVisible();
  });

  test('Backend offline falls back cleanly across Home, Courses, Course Detail, Unknown Slug, Admissions, Certificate Verification & Portal Guard', async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));

    // 1. Home renders DEMO PREVIEW banner + local demo courses
    await page.goto(`${E2E_PROD_URL}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await expect(page.getByText(/DEMO PREVIEW/i).first()).toBeVisible();
    await expect(page.getByText('Python Programming').first()).toBeVisible();

    // 2. Full catalog lists all 7 demo courses cleanly
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await expect(page.getByText('Basic Computer Applications').first()).toBeVisible();
    await expect(page.getByText('Web Development').first()).toBeVisible();

    // 3. Matching demo course detail works offline
    await page.goto(`${E2E_PROD_URL}/courses/python-programming`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Python Programming' })).toBeVisible();
    await expect(page.getByText('MOD-1')).toBeVisible();
    await expect(page.getByText('Python Syntax, Collections & Functions')).toBeVisible();

    // 4. Unknown course slug STILL renders Program Not Found (does not display wrong course)
    await page.goto(`${E2E_PROD_URL}/courses/unknown-program-xyz`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Program Not Found' })).toBeVisible();

    // 5. Admissions form keeps demo courses selectable, blocks submission, and preserves user input
    await page.goto(`${E2E_PROD_URL}/admissions`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admissions-offline-notice')).toBeVisible();
    await expect(page.locator('#pub-app-course option')).toHaveCount(7);

    await page.locator('#pub-app-name').fill('Zaid Mir');
    await page.locator('#pub-app-email').fill('zaid.mir@example.org');
    await page.locator('#pub-app-phone').fill('+91 9800001122');
    await page.getByRole('button', { name: 'Submit Admission Application' }).click();

    await expect(
      page.getByText(
        /Admission submission is temporarily unavailable while the institute portal is being connected\. Your information has not been submitted\./i
      )
    ).toBeVisible();
    await expect(page.locator('#pub-app-name')).toHaveValue('Zaid Mir');
    await expect(page.locator('#pub-app-email')).toHaveValue('zaid.mir@example.org');
    await expect(page.getByText('Admission Application Submitted')).toHaveCount(0);

    // 6. Certificate verification shows temporary unavailability and never fakes verification
    await page.goto(`${E2E_PROD_URL}/verify-certificate`, { waitUntil: 'domcontentloaded' });
    await page.locator('#public-verify-cert-input').fill('IGS-CERT-FAKE-001');
    await page.getByRole('button', { name: /Verify Credential/i }).click();
    await expect(
      page.getByText(/Certificate verification service is temporarily unavailable\./i)
    ).toBeVisible();
    await expect(page.getByText(/Verified Authentic/i)).toHaveCount(0);

    // 7. Private portal NEVER opens with fake data when backend is offline
    await page.goto(`${E2E_PROD_URL}/portal`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('HTML 404, 503 degraded DB, and malformed JSON trigger demo fallback while valid empty catalog preserves live empty state', async ({
    page,
  }) => {
    // HTML 404 fallback
    await page.route('**/api/public/**', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<!doctype html><html><body>404 Page Not Found</body></html>',
      })
    );
    await page.route('**/api/health/ready', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<!doctype html><html><body>404</body></html>',
      })
    );
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await expect(page.getByText('Web Development').first()).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 503 DB degraded fallback
    await page.route('**/api/public/**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'degraded', database: 'unavailable' }),
      })
    );
    await page.route('**/api/health/ready', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'degraded', database: 'unavailable' }),
      })
    );
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await expect(page.getByText('Python Programming').first()).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Malformed JSON fallback
    await page.route('**/api/public/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{invalid-json',
      })
    );
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Valid empty live catalog -> stays live empty state without demo fallback
    await page.route('**/api/public/courses', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ courses: [], currency: 'INR', isDemoEnvironment: false }),
      })
    );
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toHaveCount(0);
    await expect(
      page.getByText(/No published programs match your current filter\./i)
    ).toBeVisible();
  });

  test('Public site automatically recovers from demo fallback to live backend data once backend is ready', async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await page.goto(`${E2E_PROD_URL}/courses`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-preview-banner')).toBeVisible();
    await expect(page.getByText('Python Programming').first()).toBeVisible();

    // Bring backend online by removing the abort intercept; backoff retry (4s) should recover live data
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await expect(
      page.getByText('Applied Cloud Systems Architecture').first()
    ).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('demo-preview-banner')).toHaveCount(0);
  });
});
