import { expect, test, type Page } from '@playwright/test';
import { E2E_DEMO_CERT_CODE, E2E_DEV_URL } from './helpers/db-env.ts';

const PUBLIC_PAGES = [
  { path: '/', expectedHeading: /Practical computing/i },
  { path: '/courses', expectedHeading: /Training Programs Catalog/i },
  { path: '/courses/web-development', expectedHeading: /Web Development/i },
  { path: '/about', expectedHeading: /Structured computer training/i },
  { path: '/admissions', expectedHeading: /Online Admission Application/i },
  { path: '/contact', expectedHeading: /Campus Location/i },
  { path: '/verify-certificate', expectedHeading: /Official Certificate Verification/i },
  { path: '/login', expectedHeading: /Sign In to Portal/i },
] as const;

const VIEWPORTS = [
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
] as const;

async function auditPageHealth(page: Page, path: string, expectedHeading: RegExp) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: Array<{ url: string; status: number }> = [];

  const isBenignHmrWebSocketError = (text: string) =>
    /WebSocket/i.test(text) &&
    /closed without opened|WebSocket handshake|127\.0\.0\.1:24678|HMR|vite/i.test(text);

  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Initial unauthenticated mount checks /api/auth/me which legitimately returns 401
      if (text.includes('401') && text.includes('Unauthorized')) return;
      if (text.includes('status of 401')) return;
      if (isBenignHmrWebSocketError(text)) return;
      consoleErrors.push(text);
    }
  };
  const onPageError = (err: Error) => {
    if (isBenignHmrWebSocketError(err.message) || err.message === 'WebSocket closed without opened.') {
      return;
    }
    pageErrors.push(err.message);
  };
  const onResponse = (res: { url(): string; status(): number }) => {
    const url = res.url();
    const status = res.status();
    if (status >= 400) {
      if (url.endsWith('/api/auth/me') && status === 401) return;
      if (url.includes('/api/')) {
        failedApiResponses.push({ url, status });
      }
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    await page.goto(`${E2E_DEV_URL}${path}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: expectedHeading }).first()).toBeVisible();

    // Official IGS — InfoCom Global Services branding checks
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText).toContain('IGS — InfoCom Global Services');
    expect(bodyText).toContain('Learn Today, Build Tomorrow.');

    // Verify all visible images render cleanly with non-zero naturalWidth
    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter((img) => {
          const style = window.getComputedStyle(img);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute('src') || img.alt);
    });
    expect(brokenImages, `Broken images on ${path}`).toEqual([]);

    // Verify zero horizontal overflow across responsive viewport
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `Horizontal overflow detected on ${path}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth);

    expect(pageErrors, `Uncaught page errors on ${path}`).toEqual([]);
    expect(consoleErrors, `Console errors on ${path}`).toEqual([]);
    expect(failedApiResponses, `Failed API responses on ${path}`).toEqual([]);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

test.describe('Public Website Pages, Responsiveness & Navigation', () => {
  for (const vp of VIEWPORTS) {
    test(`All 8 public routes render cleanly without errors or overflow on ${vp.name} (${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of PUBLIC_PAGES) {
        await auditPageHealth(page, route.path, route.expectedHeading);
      }
    });
  }

  test('Public desktop & mobile navigation transitions cleanly and Sopore address/certificate verification work without login', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${E2E_DEV_URL}/`, { waitUntil: 'networkidle' });

    await expect(
      page.getByText(
        /Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India\./i
      ).first()
    ).toBeVisible();

    const desktopNav = page.getByRole('navigation', { name: 'Primary website navigation' });
    await desktopNav.getByRole('link', { name: 'Programs' }).click();
    await expect(page).toHaveURL(/\/courses$/);

    await desktopNav.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);

    await desktopNav.getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/\/contact$/);

    await desktopNav.getByRole('link', { name: 'Verify Certificate' }).click();
    await expect(page).toHaveURL(/\/verify-certificate$/);

    await page.locator('#public-verify-cert-input').fill(E2E_DEMO_CERT_CODE);
    await page.getByRole('button', { name: /Verify Credential/i }).click();
    await expect(page.getByText(/Verified Authentic & Active/i)).toBeVisible();
    await expect(page.getByText(/Aarav Sharma/i)).toBeVisible();

    // Verify mobile hamburger menu navigation
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.getByRole('link', { name: 'Admissions', exact: true }).first().click();
    await expect(page).toHaveURL(/\/admissions$/);
  });
});
