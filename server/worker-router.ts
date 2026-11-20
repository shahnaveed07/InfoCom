import type { UserPublic, UserRole } from '../src/shared/types.ts';
import type { D1DatabaseLike } from './d1/client.ts';
import {
  findActiveAuthSessionByTokenHashD1,
  toPublicUserD1,
} from './d1/repository.ts';
import type { WorkerD1EnvBindings } from './jobs/d1-worker.ts';
import type { DistributedRateLimitBinding } from './middleware/rate-limit.ts';
import type { R2BucketLike } from './storage/r2.ts';
import {
  SESSION_COOKIE_NAME,
  extractAuthToken,
  sha256Hex,
} from './worker-auth.ts';

export interface AssetsFetcherLike {
  fetch(request: Request | string): Promise<Response>;
}

export interface WorkerExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface WorkerRouteEnv extends WorkerD1EnvBindings {
  ASSETS?: AssetsFetcherLike;
  DOCUMENTS_BUCKET?: R2BucketLike;
  AUTH_RATE_LIMITER?: DistributedRateLimitBinding;
  PUBLIC_RATE_LIMITER?: DistributedRateLimitBinding;
  NODE_ENV?: string;
  APP_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
  CORS_CROSS_SITE_COOKIES?: string;
  STORAGE_PROVIDER?: string;
  EMAIL_PROVIDER?: string;
  LOG_OPERATIONAL_METRICS?: string;
  SESSION_SECRET?: string;
  AUTH_MODE?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
}

export class PayloadError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface WorkerRequestContext {
  request: Request;
  url: URL;
  pathname: string;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  env: WorkerRouteEnv;
  ctx: WorkerExecutionContextLike;
  db: D1DatabaseLike;
  authUser: UserPublic | null;
  authSessionId: string | null;
  ipAddress: string;
  rateHeaders: Record<string, string>;
  json(status: number, body: unknown, extraHeaders?: HeadersInit): Response;
  binary(
    status: number,
    body: Uint8Array | ArrayBuffer | string,
    extraHeaders?: HeadersInit
  ): Response;
  readJson<T = Record<string, unknown>>(maxBytes?: number): Promise<T>;
}

export type WorkerRouteHandler = (c: WorkerRequestContext) => Promise<Response>;

export interface WorkerRouteEntry {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: string;
  auth?: 'none' | 'optional' | 'required';
  roles?: UserRole[];
  handler: WorkerRouteHandler;
}

export function getWorkerClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  return 'unknown';
}

export function isProductionEnv(env: WorkerRouteEnv): boolean {
  return (env.NODE_ENV || 'production').trim().toLowerCase() === 'production';
}

export function isCrossSiteCookiesEnabledWorker(env: WorkerRouteEnv): boolean {
  return (env.CORS_CROSS_SITE_COOKIES || '').trim().toLowerCase() === 'true';
}

function normalizeOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin.toLowerCase();
  } catch {
    return null;
  }
}

function extractOriginHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

export function getAllowedCorsOriginsWorker(
  request: Request,
  env: WorkerRouteEnv
): Set<string> {
  const allowed = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  const selfOrigin = normalizeOrigin(request.url);
  if (selfOrigin) allowed.add(selfOrigin);

  const candidates = [env.APP_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')];
  for (const item of candidates) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (!trimmed) continue;
    const normalized = normalizeOrigin(trimmed);
    if (normalized) allowed.add(normalized);
  }
  return allowed;
}

export function applySecurityHeadersToResponseHeaders(
  headers: Headers,
  request: Request,
  env: WorkerRouteEnv
): void {
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!headers.has('Referrer-Policy')) {
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  if (!headers.has('Permissions-Policy')) {
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }
  if (!headers.has('Cross-Origin-Opener-Policy')) {
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  }

  const origin = request.headers.get('origin');
  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized && getAllowedCorsOriginsWorker(request, env).has(normalized)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With'
      );
      headers.set('Vary', 'Origin');
    }
  }
}

export function buildWorkerJsonResponse(
  request: Request,
  env: WorkerRouteEnv,
  status: number,
  body: unknown,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  applySecurityHeadersToResponseHeaders(headers, request, env);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export function buildWorkerBinaryResponse(
  request: Request,
  env: WorkerRouteEnv,
  status: number,
  body: Uint8Array | ArrayBuffer | string,
  extraHeaders?: HeadersInit
): Response {
  const headers = new Headers(extraHeaders);
  applySecurityHeadersToResponseHeaders(headers, request, env);
  let payload: BodyInit;
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    payload = copy.buffer;
  } else {
    payload = body;
  }
  return new Response(payload, { status, headers });
}

export function checkCsrfOriginGuardWorker(
  request: Request,
  env: WorkerRouteEnv
): string | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return null;
  }

  const rawCookie = request.headers.get('cookie') ?? '';
  if (!rawCookie.includes(`${SESSION_COOKIE_NAME}=`)) {
    return null;
  }

  const originHeader = (request.headers.get('origin') ?? '').trim();
  if (originHeader.toLowerCase() === 'null') {
    return 'Null-origin state-changing request rejected.';
  }

  const fetchSite = (request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase();
  const crossSiteAllowed = isCrossSiteCookiesEnabledWorker(env);

  if (fetchSite === 'cross-site') {
    if (!crossSiteAllowed) {
      return 'Cross-site state-changing request rejected.';
    }
    const normalizedOrigin = originHeader ? normalizeOrigin(originHeader) : null;
    const configuredOrigins = new Set<string>();
    const candidates = [env.APP_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')];
    for (const item of candidates) {
      const normalized = item ? normalizeOrigin(item.trim()) : null;
      if (normalized) configuredOrigins.add(normalized);
    }
    if (!normalizedOrigin || !configuredOrigins.has(normalizedOrigin)) {
      return 'Cross-site origin is not in the CORS allowlist.';
    }
    return null;
  }

  const refererHeader = (request.headers.get('referer') ?? '').trim();
  const sourceHeader = originHeader || refererHeader;
  if (!sourceHeader) {
    return null;
  }

  const sourceHost = extractOriginHost(sourceHeader);
  if (!sourceHost) {
    return 'Invalid request origin.';
  }

  const allowedHosts = new Set<string>();
  const requestHost =
    request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (requestHost && requestHost.trim()) {
    allowedHosts.add(requestHost.split(',')[0].trim().toLowerCase());
  }
  try {
    allowedHosts.add(new URL(request.url).host.toLowerCase());
  } catch {
    // ignore
  }
  const candidates = [env.APP_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')];
  for (const entry of candidates) {
    const host = entry ? extractOriginHost(entry.trim()) : null;
    if (host) allowedHosts.add(host);
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(sourceHost)) {
    return 'Cross-origin state-changing request rejected.';
  }

  return null;
}

export async function readBoundedJsonBody<T = Record<string, unknown>>(
  request: Request,
  maxBytes: number
): Promise<T> {
  const lenHeader = request.headers.get('content-length');
  if (lenHeader) {
    const parsedLen = Number(lenHeader);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      throw new PayloadError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request payload exceeds the maximum allowed size.'
      );
    }
  }

  const text = await request.text();
  const byteLen = new TextEncoder().encode(text).byteLength;
  if (byteLen > maxBytes) {
    throw new PayloadError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request payload exceeds the maximum allowed size.'
    );
  }
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PayloadError(400, 'INVALID_JSON', 'Malformed request payload.');
  }
}

export function matchWorkerRoutePath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const pat = patternParts[i];
    const seg = pathParts[i];
    if (pat.startsWith(':')) {
      try {
        params[pat.slice(1)] = decodeURIComponent(seg);
      } catch {
        params[pat.slice(1)] = seg;
      }
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}

export async function resolveWorkerSession(
  request: Request,
  db: D1DatabaseLike
): Promise<{ user: UserPublic; sessionId: string } | null> {
  const rawToken = extractAuthToken(request);
  if (!rawToken) return null;

  const tokenHash = await sha256Hex(rawToken);
  const match = await findActiveAuthSessionByTokenHashD1(tokenHash, db);
  if (!match) return null;

  if (match.user.status !== 'active') {
    return null;
  }

  return {
    user: toPublicUserD1(match.user),
    sessionId: match.session.id,
  };
}

export function isPasswordChangeExemptPath(pathname: string): boolean {
  return (
    pathname === '/api/auth/me' ||
    pathname === '/api/auth/config' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/change-password' ||
    pathname === '/api/auth/reset-password' ||
    pathname === '/api/auth/forgot-password' ||
    pathname.startsWith('/api/auth/webauthn/')
  );
}

export function resolveRequestOrigin(request: Request, env: WorkerRouteEnv): string {
  const envUrl = env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  try {
    return new URL(request.url).origin.replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}
