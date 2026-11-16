/**
 * Lightweight operational telemetry tracking Cloudflare Free tier budgets:
 * - Workers Free: 100,000 requests/day, 10 ms CPU ceiling per invocation, 128 MB RAM
 * - Hyperdrive Free: 100,000 database statements/day
 * - Queues Free: 10,000 operations/day, 24h max retention, 128 KB max message size
 * - R2 Free: 10 GB-month, 1M Class A ops/mo, 10M Class B ops/mo
 */
export const CLOUDFLARE_FREE_LIMITS = {
  workerRequestsPerDay: 100_000,
  workerCpuLimitMs: 10,
  workerMemoryMb: 128,
  workerMaxSubrequests: 50,
  workerScriptMaxUncompressedMiB: 64,
  hyperdriveQueriesPerDay: 100_000,
  queuesOperationsPerDay: 10_000,
  queuesRetentionHours: 24,
  queuesMaxMessageKb: 128,
  pagesBuildsPerMonth: 500,
  pagesMaxFiles: 20_000,
  pagesMaxFileMiB: 25,
  r2StorageGbMonth: 10,
  r2ClassAOpsPerMonth: 1_000_000,
  r2ClassBOpsPerMonth: 10_000_000,
} as const;

export interface OperationalEvent {
  runtime: 'cloudflare-worker' | 'node';
  route: string;
  method: string;
  status: number;
  durationMs: number;
  dbQueriesEstimated?: number;
  r2Op?: 'put' | 'get' | 'delete';
  queueOps?: number;
}

export function logOperationalMetric(event: OperationalEvent): void {
  const nearCpuBudget =
    event.runtime === 'cloudflare-worker' && event.durationMs >= 8;
  const payload = {
    level: nearCpuBudget ? 'warn' : 'info',
    metric: 'igs_request_telemetry',
    ...event,
    ...(nearCpuBudget
      ? { warning: 'Duration approached/exceeded Cloudflare Free 10ms CPU envelope.' }
      : {}),
  };
  if (nearCpuBudget) {
    console.warn(JSON.stringify(payload));
  } else if (process.env.LOG_OPERATIONAL_METRICS === 'true') {
    console.log(JSON.stringify(payload));
  }
}
