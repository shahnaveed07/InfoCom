import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import {
  E2E_DEV_PORT,
  E2E_PROD_PORT,
  buildE2eProcessEnv,
} from '../e2e/helpers/db-env.ts';

const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const portArg = process.argv.find((a) => a.startsWith('--port='));

const mode = modeArg?.split('=')[1] === 'production' ? 'production' : 'development';
const port = Number(portArg?.split('=')[1]) || (mode === 'production' ? E2E_PROD_PORT : E2E_DEV_PORT);

const e2eEnv = buildE2eProcessEnv();
e2eEnv.NODE_ENV = mode;
e2eEnv.PORT = String(port);
e2eEnv.APP_URL = `http://127.0.0.1:${port}`;

if (mode === 'production') {
  const clientIndex = path.resolve(process.cwd(), 'dist/index.html');
  const compiledServer = path.resolve(process.cwd(), 'dist-server/server.js');
  if (!fs.existsSync(clientIndex)) {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: e2eEnv });
  }
  if (!fs.existsSync(compiledServer)) {
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', env: e2eEnv });
  }
}

const child =
  mode === 'production'
    ? spawn('node', ['dist-server/server.js'], { stdio: 'inherit', env: e2eEnv })
    : spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', env: e2eEnv });

const forwardSignal = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
