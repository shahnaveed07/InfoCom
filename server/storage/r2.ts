import { AsyncLocalStorage } from 'node:async_hooks';

export interface R2ObjectBodyLike {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: {
        contentType?: string;
        contentDisposition?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    }
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  delete: (key: string) => Promise<void>;
}

export class R2ConfigurationError extends Error {
  code = 'R2_BUCKET_MISSING';
  constructor(message = 'Cloudflare R2 DOCUMENTS_BUCKET binding is missing or unconfigured.') {
    super(message);
    this.name = 'R2ConfigurationError';
  }
}

const r2BucketStore = new AsyncLocalStorage<R2BucketLike>();

export function hasActiveR2Bucket(): boolean {
  return Boolean(r2BucketStore.getStore());
}

export function getActiveR2Bucket(): R2BucketLike {
  const bucket = r2BucketStore.getStore();
  if (!bucket) {
    throw new R2ConfigurationError();
  }
  return bucket;
}

export async function runWithR2Bucket<T>(
  bucket: R2BucketLike | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!bucket) {
    return fn();
  }
  return r2BucketStore.run(bucket, fn);
}

export function normalizeSafeR2Key(storageKey: string): string {
  const cleanKey = storageKey.trim().replace(/^\/+/, '');
  if (
    !cleanKey ||
    cleanKey.includes('..') ||
    cleanKey.includes('\\') ||
    cleanKey.includes('\0') ||
    cleanKey.startsWith('/')
  ) {
    throw new Error('Invalid R2 storage key.');
  }
  return cleanKey;
}

export async function writeR2Object(
  storageKey: string,
  buffer: Buffer,
  contentType: string,
  metadata?: { checksumSha256?: string; originalName?: string }
): Promise<void> {
  const bucket = getActiveR2Bucket();
  const key = normalizeSafeR2Key(storageKey);
  await bucket.put(key, new Uint8Array(buffer), {
    httpMetadata: {
      contentType,
      cacheControl: 'private, no-store',
    },
    customMetadata: {
      visibility: 'private',
      ...(metadata?.checksumSha256 ? { sha256: metadata.checksumSha256 } : {}),
      ...(metadata?.originalName ? { originalName: metadata.originalName } : {}),
    },
  });
}

export async function readR2Object(storageKey: string): Promise<Buffer> {
  const bucket = getActiveR2Bucket();
  const key = normalizeSafeR2Key(storageKey);
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error('Stored R2 document object was not found.');
  }
  const arr = await obj.arrayBuffer();
  return Buffer.from(arr);
}

export async function deleteR2Object(storageKey: string): Promise<void> {
  const bucket = getActiveR2Bucket();
  const key = normalizeSafeR2Key(storageKey);
  await bucket.delete(key);
}
