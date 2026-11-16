import 'dotenv/config';
import { disconnectPrisma } from '../server/db/prisma.ts';
import {
  DEFAULT_WORKER_LEASE_MS,
  runWorkerTick,
  startBackgroundWorker,
  stopBackgroundWorker,
} from '../server/jobs/worker.ts';

async function main() {
  const once = process.argv.includes('--once');
  const intervalMs = Math.max(5_000, Number(process.env.WORKER_POLL_INTERVAL_MS) || 15_000);

  if (once) {
    const res = await runWorkerTick();
    console.log(
      `[worker] Single tick complete (processed=${res.processedCount}, reminders=${res.remindersCreated}).`
    );
    await disconnectPrisma();
    return;
  }

  console.log(
    `[worker] Dedicated IGS background worker running (poll=${intervalMs}ms, lease=${DEFAULT_WORKER_LEASE_MS}ms).`
  );
  startBackgroundWorker(intervalMs);

  const shutdown = async () => {
    console.log('[worker] Shutting down cleanly...');
    stopBackgroundWorker();
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
