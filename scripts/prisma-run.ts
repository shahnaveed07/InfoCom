import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import { buildPrismaCliDatabaseUrl } from '../server/db/config.ts';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/prisma-run.ts <prisma subcommand...>');
  process.exit(1);
}

const databaseUrl = buildPrismaCliDatabaseUrl({ admin: true });

try {
  execFileSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
} catch (err) {
  const code = (err as { status?: number })?.status ?? 1;
  process.exit(code);
}
