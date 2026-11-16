import cors, { type CorsOptions } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { SESSION_COOKIE_NAME } from '../auth.ts';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  message?: string;
  keySelector?: (req: Request) => string;
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window rate limiter middleware for authentication and public endpoints.
 * Exposes `.reset()` for deterministic security testing.
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
    const now = Date.now();
    pruneExpired(now);

    const ip = getClientIp(req);
    const extra = options.keySelector ? options.keySelector(req) : '';
    const key = extra
      ? `${options.keyPrefix}:${ip}:${extra}`
      : `${options.keyPrefix}:${ip}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.maxRequests - bucket.count);
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

  if (process.env.APP_URL) {
    const appOrigin = normalizeOrigin(process.env.APP_URL);
    if (appOrigin) allowed.add(appOrigin);
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    for (const entry of process.env.CORS_ALLOWED_ORIGINS.split(',')) {
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

/**
 * Verifies same-origin for cookie-authenticated state-changing requests (POST/PUT/PATCH/DELETE).
 * Blocks cross-site Fetch metadata (`Sec-Fetch-Site: cross-site`), `Origin: null`, and untrusted Origin/Referer hosts.
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

  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    res.status(403).json({ error: 'Cross-site state-changing request rejected.' });
    return;
  }

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader.toLowerCase() === 'null') {
    res.status(403).json({ error: 'Null-origin state-changing request rejected.' });
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
  if (process.env.APP_URL) {
    const appHost = extractOriginHost(process.env.APP_URL);
    if (appHost) allowedHosts.add(appHost);
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    for (const entry of process.env.CORS_ALLOWED_ORIGINS.split(',')) {
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
