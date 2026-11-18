import { getActiveR2Bucket, normalizeSafeR2Key } from './storage/r2.ts';

const ALLOWED_MIME_TYPES = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/webp', ['.webp']],
  ['text/plain', ['.txt']],
  ['text/csv', ['.csv']],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ['.docx'],
  ],
  ['application/msword', ['.doc']],
]);

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

function decodeBase64(b64: string): Uint8Array {
  const withoutDataUrl = b64.trim().replace(/^data:[^,]*;base64,/i, '');
  const clean = withoutDataUrl.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function storeWorkerR2Document(params: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}): Promise<{
  storageProvider: 'r2';
  storageKey: string;
  cleanFileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}> {
  const normalizedMimeType = params.mimeType.trim().toLowerCase();
  const allowedExts = ALLOWED_MIME_TYPES.get(normalizedMimeType);
  if (!allowedExts) {
    throw new Error(
      `Unsupported file type "${params.mimeType}". Allowed: PDF, PNG, JPEG, WEBP, TXT, CSV, DOC, DOCX.`
    );
  }

  const trimmed = params.fileName.trim().split(/[/\\]/).pop() || 'document';
  const baseName = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dotIdx = baseName.lastIndexOf('.');
  const ext = dotIdx > 0 ? baseName.slice(dotIdx).toLowerCase() : '';
  const safeExt = allowedExts.includes(ext) ? ext : allowedExts[0];
  const cleanFileName = baseName.endsWith(safeExt)
    ? baseName
    : `${baseName.replace(/\.[^.]*$/, '') || 'document'}${safeExt}`;

  const bytes = decodeBase64(params.contentBase64);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('Uploaded file must be between 1 byte and 2 MB.');
  }

  const checksumSha256 = await computeSha256Hex(bytes);
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storageKey = normalizeSafeR2Key(`${prefix}/${crypto.randomUUID()}${safeExt}`);

  const bucket = getActiveR2Bucket();
  await bucket.put(storageKey, bytes, {
    httpMetadata: {
      contentType: normalizedMimeType,
      cacheControl: 'private, no-store',
    },
    customMetadata: {
      visibility: 'private',
      sha256: checksumSha256,
      originalName: cleanFileName,
    },
  });

  return {
    storageProvider: 'r2',
    storageKey,
    cleanFileName,
    mimeType: normalizedMimeType,
    sizeBytes: bytes.length,
    checksumSha256,
  };
}

export async function readWorkerR2Document(params: {
  storageProvider: string;
  storageKey?: string | null;
  contentBase64?: string | null;
}): Promise<Uint8Array> {
  if (params.storageProvider === 'r2' && params.storageKey) {
    const bucket = getActiveR2Bucket();
    const key = normalizeSafeR2Key(params.storageKey);
    const obj = await bucket.get(key);
    if (!obj) {
      throw new Error('Stored R2 document object was not found.');
    }
    return new Uint8Array(await obj.arrayBuffer());
  }
  if (params.contentBase64) {
    return decodeBase64(params.contentBase64);
  }
  throw new Error('Stored document payload could not be located.');
}
