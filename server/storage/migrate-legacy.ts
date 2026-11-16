import crypto from 'node:crypto';
import { prisma } from '../db/prisma.ts';
import {
  getActiveStorageProvider,
  readPrivateDocument,
  storePrivateDocument,
} from './index.ts';

export interface LegacyMigrationEntryResult {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  storageProvider: string | null;
  storageKey: string | null;
  status: 'migrated' | 'would_migrate' | 'cleared_legacy_payload' | 'skipped' | 'failed';
  reason: string;
}

export interface LegacyMigrationReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  keepBase64: boolean;
  targetProvider: 'local' | 's3';
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
  entries: LegacyMigrationEntryResult[];
}

function normalizeAndValidateBase64(raw: string): Buffer {
  const cleaned = raw.replace(/\s+/g, '');
  if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new Error('Malformed Base64 payload.');
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    throw new Error('Decoded document payload is empty.');
  }
  return buffer;
}

export async function migrateLegacyDocuments(options?: {
  dryRun?: boolean;
  keepBase64?: boolean;
  limit?: number;
  recordIds?: string[];
}): Promise<LegacyMigrationReport> {
  const startedAt = new Date().toISOString();
  const dryRun = Boolean(options?.dryRun);
  const keepBase64 = Boolean(options?.keepBase64);
  const targetProvider = getActiveStorageProvider();

  const candidates = await prisma.fileAsset.findMany({
    where: {
      ...(options?.recordIds?.length ? { id: { in: options.recordIds } } : {}),
      OR: [
        { storageProvider: 'postgres' },
        {
          AND: [
            { contentBase64: { not: null } },
            { contentBase64: { not: '' } },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    ...(options?.limit ? { take: options.limit } : {}),
  });

  const entries: LegacyMigrationEntryResult[] = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let bytesMigrated = 0;

  for (const doc of candidates) {
    try {
      const rawBase64 = (doc.contentBase64 || '').trim();

      // Case A: Already moved to local/s3 previously with --keep-base64; verify round-trip then clear Base64
      if (
        (doc.storageProvider === 'local' || doc.storageProvider === 's3') &&
        doc.storageKey
      ) {
        const storedBytes = await readPrivateDocument({
          storageProvider: doc.storageProvider,
          storageKey: doc.storageKey,
        });
        const storedSha = crypto.createHash('sha256').update(storedBytes).digest('hex');
        if (doc.checksumSha256 && storedSha !== doc.checksumSha256) {
          throw new Error(
            `Stored object checksum mismatch (${storedSha} !== ${doc.checksumSha256}).`
          );
        }
        if (rawBase64 && !keepBase64) {
          const legacyBytes = normalizeAndValidateBase64(rawBase64);
          const legacySha = crypto.createHash('sha256').update(legacyBytes).digest('hex');
          if (legacySha !== storedSha) {
            throw new Error(
              `Legacy Base64 checksum does not match stored object (${legacySha} !== ${storedSha}).`
            );
          }
          if (!dryRun) {
            await prisma.fileAsset.update({
              where: { id: doc.id },
              data: { contentBase64: '' },
            });
          }
          migrated += 1;
          entries.push({
            id: doc.id,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            sizeBytes: storedBytes.length,
            checksumSha256: storedSha,
            storageProvider: doc.storageProvider,
            storageKey: doc.storageKey,
            status: dryRun ? 'would_migrate' : 'cleared_legacy_payload',
            reason: dryRun
              ? 'Verified existing object SHA-256; Base64 payload eligible to clear.'
              : 'Verified existing object SHA-256 and cleared redundant Base64 payload.',
          });
        } else {
          skipped += 1;
          entries.push({
            id: doc.id,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            sizeBytes: storedBytes.length,
            checksumSha256: storedSha,
            storageProvider: doc.storageProvider,
            storageKey: doc.storageKey,
            status: 'skipped',
            reason: 'Already migrated and verified in object storage.',
          });
        }
        continue;
      }

      // Case B: Legacy postgres-backed record without external storageKey
      if (!rawBase64) {
        skipped += 1;
        entries.push({
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          checksumSha256: doc.checksumSha256,
          storageProvider: doc.storageProvider,
          storageKey: doc.storageKey,
          status: 'skipped',
          reason: 'No Base64 payload present to migrate.',
        });
        continue;
      }

      const decoded = normalizeAndValidateBase64(rawBase64);
      const sourceSha = crypto.createHash('sha256').update(decoded).digest('hex');

      if (doc.checksumSha256 && doc.checksumSha256 !== sourceSha) {
        throw new Error(
          `Existing checksum mismatch (${doc.checksumSha256} !== ${sourceSha}); aborting migration for safety.`
        );
      }

      if (dryRun) {
        // Validate MIME & size rules via storePrivateDocument's validator without writing
        const { validateUploadFile } = await import('./index.ts');
        validateUploadFile({
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          contentBase64: rawBase64,
        });
        migrated += 1;
        bytesMigrated += decoded.length;
        entries.push({
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: decoded.length,
          checksumSha256: sourceSha,
          storageProvider: targetProvider,
          storageKey: null,
          status: 'would_migrate',
          reason: `Dry run verified valid payload (${decoded.length} bytes, SHA-256 ${sourceSha.slice(0, 12)}...).`,
        });
        continue;
      }

      const stored = await storePrivateDocument({
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        contentBase64: rawBase64,
      });

      // Read back from object storage and verify SHA-256 round-trip before touching DB
      const verifiedBuffer = await readPrivateDocument({
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
      });
      const verifiedSha = crypto.createHash('sha256').update(verifiedBuffer).digest('hex');

      if (verifiedSha !== sourceSha || verifiedBuffer.length !== decoded.length) {
        throw new Error(
          `Round-trip read-back verification failed (${verifiedSha} !== ${sourceSha}). Legacy Base64 retained.`
        );
      }

      await prisma.fileAsset.update({
        where: { id: doc.id },
        data: {
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          checksumSha256: verifiedSha,
          sizeBytes: stored.sizeBytes,
          ...(keepBase64 ? {} : { contentBase64: '' }),
        },
      });

      migrated += 1;
      bytesMigrated += stored.sizeBytes;
      entries.push({
        id: doc.id,
        fileName: doc.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        checksumSha256: verifiedSha,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        status: 'migrated',
        reason: keepBase64
          ? 'Stored, SHA-256 verified, and updated metadata (Base64 retained via --keep-base64).'
          : 'Stored, SHA-256 verified, and legacy Base64 payload cleared.',
      });
    } catch (err) {
      failed += 1;
      entries.push({
        id: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        checksumSha256: doc.checksumSha256,
        storageProvider: doc.storageProvider,
        storageKey: doc.storageKey,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Unexpected migration error.',
      });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    keepBase64,
    targetProvider,
    scanned: candidates.length,
    migrated,
    skipped,
    failed,
    bytesMigrated,
    entries,
  };
}
