// Cloudflare Workers Free authentication primitives.
// Strictly excludes slow password KDFs (scrypt/Argon2id) from the Worker runtime so
// every request executes well within the 10 ms Cloudflare Workers Free CPU ceiling.
// Password hashing remains strictly in legacy local Node.js (server/auth.ts).

export const SESSION_COOKIE_NAME = 'igs_session';
export const SESSION_TTL_HOURS = 24;
export const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const ENROLLMENT_TOKEN_TTL_HOURS = 72;

export type WorkerAuthMode = 'webauthn';

export function resolveWorkerAuthMode(_env?: { AUTH_MODE?: string }): WorkerAuthMode {
  // Cloudflare Workers Free production always enforces first-party WebAuthn/passkey auth.
  return 'webauthn';
}

export function generateOpaqueToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
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

export function extractAuthToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('cookie'));
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return null;
}

export function buildSessionCookie(
  token: string,
  request: Request,
  crossSite = false
): string {
  const url = new URL(request.url);
  const isHttps =
    url.protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https';
  const maxAge = SESSION_TTL_HOURS * 60 * 60;
  const sameSite = crossSite && isHttps ? 'SameSite=None' : 'SameSite=Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    sameSite,
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookie(request: Request, crossSite = false): string {
  const url = new URL(request.url);
  const isHttps =
    url.protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https';
  const sameSite = crossSite && isHttps ? 'SameSite=None' : 'SameSite=Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    sameSite,
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildPasswordUnavailablePayload() {
  return {
    error:
      'Password sign-in is disabled on Cloudflare Workers Free due to the 10 ms CPU ceiling. Sign in with a registered passkey or use a single-use passkey enrollment link issued by an IGS Administrator.',
    code: 'PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE',
    authMode: 'webauthn' as const,
  };
}
