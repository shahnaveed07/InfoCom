import fs from 'node:fs/promises';
import path from 'node:path';

export function getLocalStorageRoot(): string {
  return path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || 'data/private-uploads');
}

export function resolveSafeStoragePath(storageKey: string): string {
  const cleanKey = storageKey.replace(/^\/+/, '');
  if (!cleanKey || cleanKey.includes('..') || cleanKey.includes('\0') || path.isAbsolute(cleanKey)) {
    throw new Error('Invalid storage key.');
  }
  const root = getLocalStorageRoot();
  const resolved = path.resolve(root, cleanKey);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Storage key escapes private upload root.');
  }
  return resolved;
}

export async function writeLocalObject(storageKey: string, buffer: Buffer): Promise<void> {
  const fullPath = resolveSafeStoragePath(storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
}

export async function readLocalObject(storageKey: string): Promise<Buffer> {
  const fullPath = resolveSafeStoragePath(storageKey);
  return fs.readFile(fullPath);
}

export async function deleteLocalObject(storageKey: string): Promise<void> {
  const fullPath = resolveSafeStoragePath(storageKey);
  await fs.rm(fullPath, { force: true });
}
