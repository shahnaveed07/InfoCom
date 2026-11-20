#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * First-Admin Passkey Bootstrap CLI for Cloudflare D1 (Workers Free Production).
 *
 * Security guarantees:
 * - Refuses to overwrite or duplicate an existing administrator account.
 * - Inserts a single active administrator with password_hash = NULL (zero weak passwords).
 * - Generates a 32-byte cryptographically random single-use enrollment token (default TTL: 15 min).
 * - Persists ONLY the SHA-256 hash of the token in password_reset_tokens.
 * - Prints the one-time setup URL to operator stdout ONLY (never logged to D1 audit_logs or queues).
 *
 * Usage:
 *   npx tsx scripts/d1-bootstrap-passkey-admin.ts --local --email admin@igs.edu --name "IGS Director" --app-url http://127.0.0.1:8787
 *   npx tsx scripts/d1-bootstrap-passkey-admin.ts --remote --database igs-infocom-db --email admin@igs.edu --name "IGS Director" --app-url https://igs-infocom-ams-worker.<subdomain>.workers.dev
 */

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sqlQuote(val: string | null): string {
  if (val === null) return 'NULL';
  return `'${val.replace(/'/g, "''")}'`;
}

function runWranglerD1Command(opts: {
  database: string;
  isRemote: boolean;
  persistTo?: string;
  sqlFile?: string;
  command?: string;
}): string {
  const args = ['wrangler', 'd1', 'execute', opts.database, opts.isRemote ? '--remote' : '--local'];
  if (!opts.isRemote && opts.persistTo) {
    args.push('--persist-to', opts.persistTo);
  }
  if (opts.sqlFile) {
    args.push('--file', opts.sqlFile);
  } else if (opts.command) {
    args.push('--command', opts.command, '--json');
  }
  return execFileSync('npx', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  const isRemote = hasFlag('--remote');
  const isLocal = hasFlag('--local') || !isRemote;
  const database = parseArg('--database') || 'igs-infocom-db';
  const persistTo = parseArg('--persist-to');
  const email = (parseArg('--email') || '').trim().toLowerCase();
  const name = (parseArg('--name') || 'Academy Director').trim();
  const appUrl = (parseArg('--app-url') || 'http://127.0.0.1:8787').trim().replace(/\/+$/, '');
  const ttlMinutes = Math.max(5, Math.min(120, Number(parseArg('--ttl-minutes') || '15')));
  const jsonOutput = hasFlag('--json');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Error: Provide a valid administrator email via --email <email>.');
    process.exit(1);
  }

  // 1. Refuse to overwrite or create a second bootstrap admin if an active admin already exists
  const checkRaw = runWranglerD1Command({
    database,
    isRemote: !isLocal,
    persistTo,
    command: "SELECT id, email, status FROM users WHERE role = 'admin' LIMIT 5;",
  });

  let existingAdmins: Array<{ id: string; email: string; status: string }> = [];
  try {
    const parsed = JSON.parse(checkRaw) as Array<{ results?: Array<{ id: string; email: string; status: string }> }>;
    existingAdmins = parsed[0]?.results ?? [];
  } catch {
    console.error('Failed to parse existing admin check from wrangler d1 execute output.');
    process.exit(1);
  }

  if (existingAdmins.length > 0 && !hasFlag('--allow-existing-enrollment')) {
    console.error(
      `Refusing to overwrite existing administrator(s): ${existingAdmins
        .map((a) => `${a.email} (${a.status})`)
        .join(', ')}.`
    );
    console.error(
      'Sign in as an existing administrator to issue passkey enrollment links, or pass --allow-existing-enrollment for local recovery.'
    );
    process.exit(2);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenId = `prt-${crypto.randomBytes(8).toString('hex')}`;

  const matchedExisting = existingAdmins.find((a) => a.email.toLowerCase() === email);
  const adminId = matchedExisting?.id || `adm-${crypto.randomBytes(8).toString('hex')}`;

  const sqlLines: string[] = ['PRAGMA foreign_keys = ON;'];
  if (!matchedExisting) {
    sqlLines.push(
      `INSERT INTO users (id, name, email, role, status, staff_code, department, password_hash, must_change_password, session_version, created_at, updated_at)
       VALUES (${sqlQuote(adminId)}, ${sqlQuote(name)}, ${sqlQuote(email)}, 'admin', 'active', 'IGS-ADM-001', 'Academy Administration', NULL, 0, 1, ${sqlQuote(nowIso)}, ${sqlQuote(nowIso)});`,
      `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_at)
       VALUES (${sqlQuote(`ur-${adminId}-admin`)}, ${sqlQuote(adminId)}, 'role-admin', ${sqlQuote(nowIso)});`
    );
  }

  sqlLines.push(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by_user_id, created_at)
     VALUES (${sqlQuote(tokenId)}, ${sqlQuote(adminId)}, ${sqlQuote(tokenHash)}, ${sqlQuote(expiresAtIso)}, ${sqlQuote(adminId)}, ${sqlQuote(nowIso)});`
  );

  const tmpFile = path.join(os.tmpdir(), `igs-bootstrap-admin-${crypto.randomBytes(6).toString('hex')}.sql`);
  try {
    fs.writeFileSync(tmpFile, sqlLines.join('\n'), { mode: 0o600 });
    runWranglerD1Command({
      database,
      isRemote: !isLocal,
      persistTo,
      sqlFile: tmpFile,
    });
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }

  const enrollPath = `/login?enrollToken=${encodeURIComponent(rawToken)}`;
  const enrollUrl = `${appUrl}${enrollPath}`;

  if (jsonOutput) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        adminId,
        email,
        target: isLocal ? 'local' : 'remote',
        database,
        enrollmentToken: rawToken,
        enrollPath,
        enrollUrl,
        expiresAt: expiresAtIso,
      }) + '\n'
    );
    return;
  }

  console.log('\nIGS — InfoCom Global Services: First-Admin Passkey Bootstrap Ready');
  console.log('==================================================================');
  console.log(`Target Database : ${database} (${isLocal ? 'local D1' : 'REMOTE D1'})`);
  console.log(`Administrator   : ${name} <${email}> (${adminId})`);
  console.log(`Token Expires   : ${expiresAtIso} (${ttlMinutes} minutes, single-use)`);
  console.log(`\nOne-Time Passkey Enrollment URL (open in browser immediately):\n${enrollUrl}\n`);
  console.log('Security Notice: Only the SHA-256 hash was stored in D1. This URL will not be shown again.');
}

main().catch((err) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
