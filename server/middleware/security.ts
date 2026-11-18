import { AsyncLocalStorage } from 'node:async_hooks';
import cors, { type CorsOptions } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { SESSION_COOKIE_NAME } from '../auth.ts';
import {
  type RateLimitBindingName,
  checkDistributedRateLimit,
  getActiveRateLimiterBinding,
} from './rate-limit.ts';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  bindingName?: RateLimitBindingName;
  message?: string;
  keySelector?: (req: Request) => string;
}

export interface SecurityEnvOverrides {
  APP_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
  CORS_CROSS_SITE_COOKIES?: string;
}

const securityEnvStore = new AsyncLocalStorage<SecurityEnvOverrides>();

export async function runWithSecurityEnv<T>(
  overrides: SecurityEnvOverrides | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!overrides) return fn();
  return securityEnvStore.run(overrides, fn);
}

function readSecurityVar(key: keyof SecurityEnvOverrides): string {
  const scoped = securityEnvStore.getStore();
  const scopedVal = scoped?.[key];
  if (typeof scopedVal === 'string' && scopedVal.trim()) {
    return scopedVal.trim();
  }
  const envVal = process.env[key];
  return typeof envVal === 'string' ? envVal.trim() : '';
}

export function isCrossSiteCookiesEnabled(): boolean {
  return readSecurityVar('CORS_CROSS_SITE_COOKIES').toLowerCase() === 'true';
}

export function getClientIp(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window rate limiter middleware for authentication and public endpoints.
 * Delegates automatically to Cloudflare's distributed Rate Limiting binding when active
 * in request context, while remaining synchronous for Node/memory and unit test stability.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateLimitBucket>();

  function pruneExpired(now: number) {
    if (buckets.size < 2000) return;
    for (const [k, v] of buckets.entries()) {
      if (v.resetAt <= now) {
        buckets.delete(k);
      }
    }
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const extra = options.keySelector ? options.keySelector(req) : '';
    const key = extra
      ? `${options.keyPrefix}:${ip}:${extra}`
      : `${options.keyPrefix}:${ip}`;

    const { binding } = getActiveRateLimiterBinding(options.bindingName);
    if (binding) {
      void checkDistributedRateLimit({ binding, key })
        .then((result) => {
          res.setHeader('X-RateLimit-Backend', result.backend);
          if (!result.allowed) {
            const retryAfterSec = Math.max(1, Math.ceil(options.windowMs / 1000));
            res.setHeader('Retry-After', String(retryAfterSec));
            res.status(429).json({
              error:
                options.message ??
                'Too many requests. Please wait a moment before trying again.',
            });
            return;
          }
          next();
        })
        .catch(next);
      return;
    }

    const now = Date.now();
    pruneExpired(now);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Backend', 'memory');
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error:
          options.message ??
          'Too many requests. Please wait a moment before trying again.',
      });
      return;
    }

    next();
  };

  middleware.reset = () => {
    buckets.clear();
  };

  return middleware;
}

/**
 * Helmet security headers middleware.
 * Deliberately omits X-Frame-Options (frameguard: false) so AI Studio preview iframe works,
 * while enabling X-Content-Type-Options, Referrer-Policy, HSTS (HTTPS), and Permissions-Policy.
 */
const baseHelmet = helmet({
  frameguard: false,
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  baseHelmet(req, res, next);
}

function normalizeOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function getAllowedCorsOrigins(): Set<string> {
  const allowed = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  const appUrl = readSecurityVar('APP_URL');
  if (appUrl) {
    const appOrigin = normalizeOrigin(appUrl);
    if (appOrigin) allowed.add(appOrigin);
  }
  const extraOrigins = readSecurityVar('CORS_ALLOWED_ORIGINS');
  if (extraOrigins) {
    for (const entry of extraOrigins.split(',')) {
      const origin = normalizeOrigin(entry.trim());
      if (origin) allowed.add(origin);
    }
  }
  return allowed;
}

export function createSafeCorsMiddleware() {
  const options: CorsOptions = {
    origin(origin, callback) {
      // Allow non-CORS / same-origin requests without Origin header
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = normalizeOrigin(origin);
      const allowed = getAllowedCorsOrigins();
      if (normalized && allowed.has(normalized)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  };
  return cors(options);
}

function extractOriginHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function getExplicitConfiguredOrigins(): Set<string> {
  const configured = new Set<string>();
  const appUrl = readSecurityVar('APP_URL');
  if (appUrl) {
    const appOrigin = normalizeOrigin(appUrl);
    if (appOrigin) configured.add(appOrigin);
  }
  const extraOrigins = readSecurityVar('CORS_ALLOWED_ORIGINS');
  if (extraOrigins) {
    for (const entry of extraOrigins.split(',')) {
      const origin = normalizeOrigin(entry.trim());
      if (origin) configured.add(origin);
    }
  }
  return configured;
}

/**
 * Verifies origin for cookie-authenticated state-changing requests (POST/PUT/PATCH/DELETE).
 * - Blocks `Origin: null` and untrusted Origin/Referer hosts unconditionally.
 * - Blocks `Sec-Fetch-Site: cross-site` by default.
 * - When `CORS_CROSS_SITE_COOKIES=true` (decoupled Cloudflare Pages + API HTTPS deployment),
 *   permits `Sec-Fetch-Site: cross-site` ONLY if an explicit non-null `Origin` header matches
 *   an allowlisted origin configured in `APP_URL` or `CORS_ALLOWED_ORIGINS`.
 */
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const rawCookie = req.headers.cookie ?? '';
  if (!rawCookie.includes(`${SESSION_COOKIE_NAME}=`)) {
    next();
    return;
  }

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader.toLowerCase() === 'null') {
    res.status(403).json({ error: 'Null-origin state-changing request rejected.' });
    return;
  }

  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').trim().toLowerCase();
  const crossSiteAllowed = isCrossSiteCookiesEnabled();

  if (fetchSite === 'cross-site') {
    if (!crossSiteAllowed) {
      res.status(403).json({ error: 'Cross-site state-changing request rejected.' });
      return;
    }
    const normalizedOrigin = originHeader ? normalizeOrigin(originHeader) : null;
    const configuredOrigins = getExplicitConfiguredOrigins();
    if (!normalizedOrigin || !configuredOrigins.has(normalizedOrigin)) {
      res.status(403).json({ error: 'Cross-site origin is not in the CORS allowlist.' });
      return;
    }
    next();
    return;
  }

  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';
  const sourceHeader = originHeader || refererHeader;

  if (!sourceHeader) {
    next();
    return;
  }

  const sourceHost = extractOriginHost(sourceHeader);
  if (!sourceHost) {
    res.status(403).json({ error: 'Invalid request origin.' });
    return;
  }

  const allowedHosts = new Set<string>();
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host;
  if (typeof requestHost === 'string' && requestHost.trim()) {
    allowedHosts.add(requestHost.split(',')[0].trim().toLowerCase());
  }
  const appUrl = readSecurityVar('APP_URL');
  if (appUrl) {
    const appHost = extractOriginHost(appUrl);
    if (appHost) allowedHosts.add(appHost);
  }
  const extraOrigins = readSecurityVar('CORS_ALLOWED_ORIGINS');
  if (extraOrigins) {
    for (const entry of extraOrigins.split(',')) {
      const host = extractOriginHost(entry.trim());
      if (host) allowedHosts.add(host);
    }
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(sourceHost)) {
    res.status(403).json({ error: 'Cross-origin state-changing request rejected.' });
    return;
  }

  next();
}

export function safeApiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status =
    typeof (err as { status?: unknown })?.status === 'number'
      ? ((err as { status: number }).status)
      : typeof (err as { statusCode?: unknown })?.statusCode === 'number'
        ? ((err as { statusCode: number }).statusCode)
        : 500;

  if (status === 413) {
    res.status(413).json({ error: 'Request payload exceeds the maximum allowed size.' });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: 'Malformed request payload.' });
    return;
  }

  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'An internal server error occurred.' });
}
