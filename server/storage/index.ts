import crypto from 'node:crypto';
import path from 'node:path';
import { deleteLocalObject, readLocalObject, writeLocalObject } from './local.ts';
import { deleteS3Object, readS3Object, writeS3Object } from './s3.ts';

export type StorageProviderKind = 'local' | 's3' | 'postgres';

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

export function getActiveStorageProvider(): 'local' | 's3' {
  const raw = (process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (raw === 's3') return 's3';
  return 'local';
}

export function validateUploadFile(params: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}): {
  buffer: Buffer;
  cleanFileName: string;
  normalizedMimeType: string;
  extension: string;
  sizeBytes: number;
  checksumSha256: string;
} {
  const normalizedMimeType = params.mimeType.trim().toLowerCase();
  const allowedExts = ALLOWED_MIME_TYPES.get(normalizedMimeType);
  if (!allowedExts) {
    throw new Error(
      `Unsupported file type "${params.mimeType}". Allowed: PDF, PNG, JPEG, WEBP, TXT, CSV, DOC, DOCX.`
    );
  }

  const baseName = path.basename(params.fileName.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(baseName).toLowerCase();
  const safeExt = allowedExts.includes(ext) ? ext : allowedExts[0];
  const cleanFileName = baseName.endsWith(safeExt)
    ? baseName
    : `${baseName.replace(/\.[^.]*$/, '') || 'document'}${safeExt}`;

  const buffer = Buffer.from(params.contentBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Uploaded file must be between 1 byte and 2 MB.');
  }

  const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    cleanFileName,
    normalizedMimeType,
    extension: safeExt,
    sizeBytes: buffer.length,
    checksumSha256,
  };
}

export async function storePrivateDocument(params: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}): Promise<{
  storageProvider: 'local' | 's3';
  storageKey: string;
  cleanFileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}> {
  const validated = validateUploadFile(params);
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storageKey = `${prefix}/${crypto.randomUUID()}${validated.extension}`;
  const provider = getActiveStorageProvider();

  if (provider === 's3') {
    await writeS3Object(storageKey, validated.buffer, validated.normalizedMimeType);
  } else {
    await writeLocalObject(storageKey, validated.buffer);
  }

  return {
    storageProvider: provider,
    storageKey,
    cleanFileName: validated.cleanFileName,
    mimeType: validated.normalizedMimeType,
    sizeBytes: validated.sizeBytes,
    checksumSha256: validated.checksumSha256,
  };
}

export async function readPrivateDocument(params: {
  storageProvider: string;
  storageKey?: string | null;
  contentBase64?: string | null;
}): Promise<Buffer> {
  if (params.storageProvider === 'local' && params.storageKey) {
    return readLocalObject(params.storageKey);
  }
  if (params.storageProvider === 's3' && params.storageKey) {
    return readS3Object(params.storageKey);
  }
  if (params.contentBase64) {
    return Buffer.from(params.contentBase64, 'base64');
  }
  throw new Error('Stored document payload could not be located.');
}

export async function deletePrivateDocument(params: {
  storageProvider: string;
  storageKey?: string | null;
}): Promise<void> {
  if (!params.storageKey) return;
  if (params.storageProvider === 'local') {
    await deleteLocalObject(params.storageKey);
  } else if (params.storageProvider === 's3') {
    await deleteS3Object(params.storageKey);
  }
}
