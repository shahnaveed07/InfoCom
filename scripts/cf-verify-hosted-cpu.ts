#!/usr/bin/env node
/**
 * Hosted Cloudflare Workers Free Staging Probe & CPU Verification Checklist.
 *
 * This script does NOT deploy or modify Cloudflare resources. It benchmarks
 * non-mutating endpoints on an already-deployed staging workers.dev URL and prints
 * the exact Cloudflare Workers Free 10 ms CPU verification checklist required
 * before production cutover.
 *
 * Usage:
 *   npx tsx scripts/cf-verify-hosted-cpu.ts --url https://igs-infocom-ams-worker.<subdomain>.workers.dev [--iterations 10]
 */

interface ProbeSample {
  endpoint: string;
  method: 'GET' | 'POST';
  status: number;
  wallMs: number;
  ok: boolean;
}

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function probeEndpoint(
  baseUrl: string,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<ProbeSample> {
  const started = performance.now();
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.text();
  const wallMs = performance.now() - started;
  return {
    endpoint,
    method,
    status: res.status,
    wallMs,
    ok: res.status >= 200 && res.status < 500,
  };
}

function summarize(samples: ProbeSample[]) {
  const sorted = [...samples].map((s) => s.wallMs).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const statuses = Array.from(new Set(samples.map((s) => s.status))).join(',');
  return { p50: p50.toFixed(1), p95: p95.toFixed(1), max: max.toFixed(1), statuses };
}

async function main() {
  const rawUrl = (parseArg('--url') || '').trim().replace(/\/+$/, '');
  const iterations = Math.max(3, Math.min(25, Number(parseArg('--iterations') || '5')));

  if (!rawUrl || !/^https?:\/\//.test(rawUrl) || rawUrl.includes('<your-subdomain>')) {
    console.error(
      'Provide a live deployed staging URL via --url https://igs-infocom-ams-worker.<subdomain>.workers.dev'
    );
    console.error('Hosted Cloudflare Free CPU verification remains PENDING until executed on live workers.dev.');
    process.exit(1);
  }

  console.log(`\nProbing Cloudflare Workers Free deployment: ${rawUrl} (${iterations} iterations each)\n`);

  const targets: Array<{ endpoint: string; method: 'GET' | 'POST'; body?: Record<string, unknown> }> = [
    { endpoint: '/api/health', method: 'GET' },
    { endpoint: '/api/health/ready', method: 'GET' },
    { endpoint: '/api/auth/config', method: 'GET' },
    { endpoint: '/api/public/courses', method: 'GET' },
    { endpoint: '/api/auth/webauthn/login/options', method: 'POST', body: {} },
  ];

  let anyServerError = false;
  for (const target of targets) {
    const samples: ProbeSample[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const sample = await probeEndpoint(rawUrl, target.endpoint, target.method, target.body);
      samples.push(sample);
      if (sample.status >= 500) anyServerError = true;
    }
    const stats = summarize(samples);
    console.log(
      `${target.method.padEnd(4)} ${target.endpoint.padEnd(36)} status=[${stats.statuses}] wall p50=${stats.p50}ms p95=${stats.p95}ms max=${stats.max}ms`
    );
  }

  console.log('\nMandatory Cloudflare Free 10 ms CPU Cutover Checklist:');
  console.log('1. Run `npx wrangler tail igs-infocom-ams-worker --format=pretty` during live passkey registration, login, and PDF download.');
  console.log('2. Confirm ZERO `exceededCpu` / Error 1102 exceptions in Workers tail logs & Dashboard Analytics.');
  console.log('3. Confirm Dashboard Workers CPU Time p99 stays strictly below 10 ms across:');
  console.log('   - POST /api/auth/webauthn/register/verify');
  console.log('   - POST /api/auth/webauthn/login/verify');
  console.log('   - GET  /api/certificates/:id/download (pdf-lib certificate generation)');
  console.log('   - GET  /api/reports/financial-collections?format=pdf');
  console.log('4. Confirm Queue consumer (`igs-ams-jobs`) and 15-min Cron trigger (`*/15 * * * *`) report zero CPU exceptions.\n');

  if (anyServerError) {
    console.error('One or more staging probes returned HTTP 5xx. Do NOT cut over to production.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Staging probe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
