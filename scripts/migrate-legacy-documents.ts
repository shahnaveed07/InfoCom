import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { disconnectPrisma } from '../server/db/prisma.ts';
import { migrateLegacyDocuments } from '../server/storage/migrate-legacy.ts';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const keepBase64 = argv.includes('--keep-base64');
  const confirmClearBase64 = argv.includes('--confirm-clear-base64');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const reportArg = argv.find((a) => a.startsWith('--report='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const reportPath = reportArg ? reportArg.split('=')[1] : undefined;
  return {
    dryRun,
    keepBase64,
    confirmClearBase64,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    reportPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[storage-migration] Starting legacy document scan (dryRun=${args.dryRun}, keepBase64=${args.keepBase64}, confirmClearBase64=${args.confirmClearBase64})...`
  );

  const report = await migrateLegacyDocuments({
    dryRun: args.dryRun,
    keepBase64: args.keepBase64,
    confirmClearBase64: args.confirmClearBase64,
    limit: args.limit,
  });

  console.log(
    JSON.stringify(
      {
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        dryRun: report.dryRun,
        keepBase64: report.keepBase64,
        confirmClearBase64: report.confirmClearBase64,
        targetProvider: report.targetProvider,
        scanned: report.scanned,
        migrated: report.migrated,
        skipped: report.skipped,
        failed: report.failed,
        bytesMigrated: report.bytesMigrated,
      },
      null,
      2
    )
  );

  if (args.reportPath) {
    const resolved = path.resolve(process.cwd(), args.reportPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[storage-migration] Full report written to ${resolved}`);
  }

  if (report.failed > 0) {
    console.error(`[storage-migration] ${report.failed} record(s) failed; re-run safely to retry.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[storage-migration] Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
