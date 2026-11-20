import fs from 'node:fs';
import path from 'node:path';
import { chromium, defineConfig } from '@playwright/test';

const CF_E2E_PORT = 3107;
const CF_E2E_URL = `http://localhost:${CF_E2E_PORT}`;

function resolveWorkerChromiumPath(): string | undefined {
  const defaultPath = chromium.executablePath();
  if (fs.existsSync(defaultPath)) {
    return undefined;
  }
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const msRoot = '/ms-playwright';
  if (fs.existsSync(msRoot)) {
    for (const entry of fs.readdirSync(msRoot)) {
      if (entry.startsWith('chromium_headless_shell-')) {
        const candidate = path.join(
          msRoot,
          entry,
          'chrome-headless-shell-linux64',
          'chrome-headless-shell'
        );
        if (fs.existsSync(candidate)) return candidate;
      }
      if (entry.startsWith('chromium-')) {
        const candidate = path.join(msRoot, entry, 'chrome-linux', 'chrome');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

const fallbackExecutablePath = resolveWorkerChromiumPath();

export default defineConfig({
  testDir: './e2e-worker',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [['list']],
  use: {
    baseURL: CF_E2E_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(fallbackExecutablePath
      ? { launchOptions: { executablePath: fallbackExecutablePath } }
      : {}),
  },
  webServer: {
    command: `npx tsx scripts/cf-e2e-server.ts --port=${CF_E2E_PORT}`,
    url: `${CF_E2E_URL}/api/health/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
