import crypto from 'node:crypto';
import argon2 from 'argon2';

export const SESSION_COOKIE_NAME = 'nta_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30; // 30 minutes

const ARGON2_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 19456, // 19 MiB (OWASP minimum recommended for Argon2id)
  timeCost: 2,
  parallelism: 1,
  raw: false as const,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against either an Argon2id digest ($argon2id$...)
 * or a legacy Phase 1/2 salted scrypt digest (<32-char-hex-salt>:<128-char-hex-key>).
 * Returns `needsRehash: true` when a legacy scrypt hash or outdated Argon2id cost is matched
 * so the authentication flow can transparently upgrade the stored hash in PostgreSQL.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!password || !storedHash) {
    return { valid: false, needsRehash: false };
  }

  if (storedHash.startsWith('$argon2')) {
    try {
      const valid = await argon2.verify(storedHash, password);
      if (!valid) {
        return { valid: false, needsRehash: false };
      }
      const needsRehash =
        !storedHash.startsWith('$argon2id$') || argon2.needsRehash(storedHash, ARGON2_OPTIONS);
      return { valid: true, needsRehash };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Legacy scrypt format (<salt>:<64-byte-hex-key>)
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return { valid: false, needsRehash: false };
  }
  const [salt, keyHex] = parts;
  if (!salt || !keyHex || keyHex.length !== 128) {
    return { valid: false, needsRehash: false };
  }

  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) {
      return { valid: false, needsRehash: false };
    }
    const valid = crypto.timingSafeEqual(keyBuf, derivedBuf);
    return { valid, needsRehash: valid };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/**
 * Generates an opaque, high-entropy 256-bit session identifier.
 * Only its SHA-256 hash is persisted in PostgreSQL (`auth_sessions.token_hash`).
 */
export function generateOpaqueSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generatePasswordResetToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: hashPasswordResetToken(rawToken),
  };
}

export function hashPasswordResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}
