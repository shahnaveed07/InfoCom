import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 3107;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igs-cf-worker-e2e-'));

const adminPassword = process.env.CF_E2E_ADMIN_PASSWORD || 'IgsCfE2e!Admin#2026';
const instructorPassword = process.env.CF_E2E_INSTRUCTOR_PASSWORD || 'IgsCfE2e!Faculty#2026';
const studentPassword = process.env.CF_E2E_STUDENT_PASSWORD || 'IgsCfE2e!Student#2026';

const distIndexPath = path.resolve(process.cwd(), 'dist', 'index.html');
if (!fs.existsSync(distIndexPath)) {
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' });
}

execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'igs-infocom-db',
    '--local',
    '--persist-to',
    persistDir,
  ],
  { cwd: process.cwd(), stdio: 'inherit' }
);

execFileSync('npx', ['tsx', 'scripts/d1-seed-demo.ts', '--persist-to', persistDir], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    ALLOW_DEMO_SEED: 'true',
    SEED_ADMIN_PASSWORD: adminPassword,
    SEED_INSTRUCTOR_PASSWORD: instructorPassword,
    SEED_STUDENT_PASSWORD: studentPassword,
  },
});

const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    persistDir,
    '--var',
    'NODE_ENV:development',
    '--var',
    `APP_URL:${origin}`,
    '--var',
    `CORS_ALLOWED_ORIGINS:${origin}`,
    '--var',
    'EMAIL_PROVIDER:disabled',
  ],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true',
    },
  }
);

function cleanup() {
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  try {
    fs.rmSync(persistDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

child.on('exit', (code) => {
  try {
    fs.rmSync(persistDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(code ?? 0);
});
