import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 3107;
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igs-cf-worker-e2e-'));
const tokenStateFile = path.join(os.tmpdir(), `igs-cf-e2e-enroll-${port}.json`);

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
  },
});

const origin = `http://localhost:${port}`;

// Issue a single-use passkey enrollment token for the seeded demo admin via the official bootstrap CLI
const bootstrapOut = execFileSync(
  'npx',
  [
    'tsx',
    'scripts/d1-bootstrap-passkey-admin.ts',
    '--local',
    '--persist-to',
    persistDir,
    '--allow-existing-enrollment',
    '--email',
    'admin.demo@igssopore.local',
    '--name',
    'IGS Principal Administrator',
    '--app-url',
    origin,
    '--json',
  ],
  { cwd: process.cwd(), encoding: 'utf-8' }
);
const bootstrapPayload = JSON.parse(bootstrapOut.trim()) as {
  enrollmentToken: string;
  enrollPath: string;
  email: string;
};
fs.writeFileSync(tokenStateFile, JSON.stringify(bootstrapPayload), { mode: 0o600 });

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
    'AUTH_MODE:webauthn',
    '--var',
    'WEBAUTHN_RP_ID:localhost',
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
  try {
    fs.rmSync(tokenStateFile, { force: true });
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
  try {
    fs.rmSync(tokenStateFile, { force: true });
  } catch {
    // ignore
  }
  process.exit(code ?? 0);
});
