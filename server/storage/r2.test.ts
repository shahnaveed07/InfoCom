import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  deletePrivateDocument,
  getActiveStorageProvider,
  readPrivateDocument,
  storePrivateDocument,
} from './index.ts';
import {
  R2ConfigurationError,
  type R2BucketLike,
  normalizeSafeR2Key,
  readR2Object,
  runWithR2Bucket,
  writeR2Object,
} from './r2.ts';

function createMemoryR2Bucket(): {
  bucket: R2BucketLike;
  store: Map<string, { data: Uint8Array; httpMetadata?: unknown; customMetadata?: Record<string, string> }>;
} {
  const store = new Map<
    string,
    { data: Uint8Array; httpMetadata?: unknown; customMetadata?: Record<string, string> }
  >();
  const bucket: R2BucketLike = {
    async put(key, value, options) {
      const bytes =
        value instanceof Uint8Array
          ? new Uint8Array(value)
          : new TextEncoder().encode(String(value));
      store.set(key, {
        data: bytes,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      });
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        async arrayBuffer() {
          return entry.data.slice().buffer;
        },
      };
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { bucket, store };
}

test('R2 adapter rejects missing binding cleanly', async () => {
  await assert.rejects(
    () => writeR2Object('2026-11/sample.pdf', Buffer.from('pdf'), 'application/pdf'),
    (err: unknown) =>
      err instanceof R2ConfigurationError && err.code === 'R2_BUCKET_MISSING'
  );
  await assert.rejects(
    () => readR2Object('2026-11/sample.pdf'),
    (err: unknown) => err instanceof R2ConfigurationError
  );
});

test('R2 adapter rejects path traversal and invalid keys', () => {
  assert.throws(() => normalizeSafeR2Key('../secret.txt'));
  assert.throws(() => normalizeSafeR2Key('foo/../bar.pdf'));
  assert.throws(() => normalizeSafeR2Key('foo\\bar.pdf'));
  assert.throws(() => normalizeSafeR2Key('   '));
  assert.equal(normalizeSafeR2Key('/2026-11/doc.pdf'), '2026-11/doc.pdf');
});

test('storePrivateDocument, readPrivateDocument, and deletePrivateDocument work with R2 bucket and verify SHA-256', async () => {
  const { bucket, store } = createMemoryR2Bucket();
  const payload = Buffer.from('%PDF-1.4\nIGS Student Transcript\n', 'utf8');
  const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

  await runWithR2Bucket(bucket, async () => {
    assert.equal(getActiveStorageProvider(), 'r2');

    const stored = await storePrivateDocument({
      fileName: 'transcript.pdf',
      mimeType: 'application/pdf',
      contentBase64: payload.toString('base64'),
    });

    assert.equal(stored.storageProvider, 'r2');
    assert.equal(stored.checksumSha256, expectedSha);
    assert.equal(stored.mimeType, 'application/pdf');
    assert.equal(stored.sizeBytes, payload.length);

    const entry = store.get(stored.storageKey);
    assert.ok(entry);
    assert.equal(entry.customMetadata?.visibility, 'private');
    assert.equal(entry.customMetadata?.sha256, expectedSha);

    const roundTrip = await readPrivateDocument({
      storageProvider: 'r2',
      storageKey: stored.storageKey,
    });
    assert.equal(roundTrip.toString('utf8'), payload.toString('utf8'));

    await deletePrivateDocument({
      storageProvider: 'r2',
      storageKey: stored.storageKey,
    });
    assert.equal(store.has(stored.storageKey), false);
    await assert.rejects(() =>
      readPrivateDocument({ storageProvider: 'r2', storageKey: stored.storageKey })
    );
  });
});

test('storePrivateDocument preserves MIME and 2MB size limits when using R2', async () => {
  const { bucket } = createMemoryR2Bucket();
  await runWithR2Bucket(bucket, async () => {
    await assert.rejects(() =>
      storePrivateDocument({
        fileName: 'script.js',
        mimeType: 'application/javascript',
        contentBase64: Buffer.from('alert(1)').toString('base64'),
      })
    );

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 65);
    await assert.rejects(() =>
      storePrivateDocument({
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        contentBase64: oversized.toString('base64'),
      })
    );
  });
});
