import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(
  crypto.scrypt as unknown as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    options: crypto.ScryptOptions,
    callback: (err: Error | null, derivedKey: Buffer) => void
  ) => void
);

export const SESSION_COOKIE_NAME = 'igs_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const WORKER_SCRYPT_COST = 16384;
export const WORKER_SCRYPT_BLOCK_SIZE = 8;
export const WORKER_SCRYPT_PARALLELISM = 1;
export const WORKER_SCRYPT_KEYLEN = 64;

export async function hashPasswordWorker(password: string): Promise<string> {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, saltHex, WORKER_SCRYPT_KEYLEN, {
    N: WORKER_SCRYPT_COST,
    r: WORKER_SCRYPT_BLOCK_SIZE,
    p: WORKER_SCRYPT_PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${WORKER_SCRYPT_COST}$${WORKER_SCRYPT_BLOCK_SIZE}$${WORKER_SCRYPT_PARALLELISM}$${saltHex}$${derived.toString('hex')}`;
}

export async function verifyPasswordWorker(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; unsupportedAlgorithm?: 'argon2' }> {
  if (!storedHash) return { valid: false };

  // Versioned scrypt format: scrypt$N$r$p$saltHex$hashHex
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 6) return { valid: false };
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const saltHex = parts[4];
    const expectedHex = parts[5];
    if (!n || !r || !p || !saltHex || !expectedHex) return { valid: false };
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const derived = await scryptAsync(password, saltHex, expectedBuf.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    if (derived.length !== expectedBuf.length) return { valid: false };
    return { valid: crypto.timingSafeEqual(derived, expectedBuf) };
  }

  // Legacy scrypt format from earlier Node versions: <saltHex>:<hashHex>
  if (storedHash.includes(':') && !storedHash.startsWith('$argon2')) {
    const [saltHex, expectedHex] = storedHash.split(':');
    if (!saltHex || !expectedHex) return { valid: false };
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const derived = await scryptAsync(password, saltHex, expectedBuf.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    if (derived.length !== expectedBuf.length) return { valid: false };
    return { valid: crypto.timingSafeEqual(derived, expectedBuf) };
  }

  // Legacy native argon2id hashes cannot run in Cloudflare Workers without Wasm/FFI
  if (storedHash.startsWith('$argon2')) {
    return { valid: false, unsupportedAlgorithm: 'argon2' };
  }

  return { valid: false };
}

export function generateOpaqueToken(bytes = 32): string {
  const raw = crypto.randomBytes(bytes);
  return raw
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isHttpsRequest(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto && proto.toLowerCase().includes('https')) return true;
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildSessionCookieHeader(params: {
  token: string;
  request: Request;
  maxAgeSeconds?: number;
  crossSiteCookies?: boolean;
}): string {
  const secure = params.crossSiteCookies || isHttpsRequest(params.request);
  const sameSite = params.crossSiteCookies && secure ? 'None' : 'Lax';
  const maxAge = params.maxAgeSeconds ?? SESSION_TTL_SECONDS;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(params.token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.max(0, maxAge)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(
  request: Request,
  crossSiteCookies = false
): string {
  const secure = crossSiteCookies || isHttpsRequest(request);
  const sameSite = crossSiteCookies && secure ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function parseSessionCookie(request: Request): string | null {
  const rawCookie = request.headers.get('cookie');
  if (!rawCookie) return null;
  const parts = rawCookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key === SESSION_COOKIE_NAME) {
      const val = trimmed.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return parseSessionCookie(request);
}
