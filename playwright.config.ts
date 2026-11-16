import fs from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';
import 'dotenv/config';
import {
  E2E_DEV_URL,
  E2E_PROD_URL,
  resolveChromiumExecutablePath,
} from './e2e/helpers/db-env.ts';

const defaultPath = chromium.executablePath();
const useFallbackExec = !fs.existsSync(defaultPath) ? resolveChromiumExecutablePath() : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: E2E_DEV_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(useFallbackExec ? { launchOptions: { executablePath: useFallbackExec } } : {}),
  },
  webServer: [
    {
      command: 'npx tsx scripts/e2e-server.ts --mode=development --port=3105',
      url: `${E2E_DEV_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'npx tsx scripts/e2e-server.ts --mode=production --port=3106',
      url: `${E2E_PROD_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
