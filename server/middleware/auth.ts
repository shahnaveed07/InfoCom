import type { NextFunction, Request, Response } from 'express';
import type { UserPublic, UserRole } from '../../src/shared/types.ts';
import { toPublicUser } from '../ams-service.ts';
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  hashSessionToken,
  parseCookies,
} from '../auth.ts';
import { findActiveAuthSessionByTokenHash } from '../repositories/ams.repository.ts';
import { hasPermission, type Permission } from '../security/permissions.ts';

export interface AuthenticatedRequest extends Request {
  authUser?: UserPublic;
  authSessionId?: string;
}

export function isSecureRequest(req: Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return Boolean(req.secure || xfProto === 'https');
}

export function extractSessionToken(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

export function setSessionCookie(res: Response, rawToken: string, req?: Request): void {
  const secure =
    process.env.NODE_ENV === 'production' || (req ? isSecureRequest(req) : false);
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const secure =
    process.env.NODE_ENV === 'production' || (req ? isSecureRequest(req) : false);
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
}

export async function resolveRequestSession(
  req: Request
): Promise<{ user: UserPublic; sessionId?: string } | null> {
  // Check opaque HttpOnly server session cookie via SHA-256 token hash lookup
  const rawToken = extractSessionToken(req);
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const session = await findActiveAuthSessionByTokenHash(tokenHash);
  if (!session || !session.user) return null;

  if (session.user.status !== 'active') return null;
  if (session.roleCode !== session.user.role) return null;

  return {
    user: toPublicUser(session.user),
    sessionId: session.id,
  };
}

export async function resolveRequestUser(req: Request): Promise<UserPublic | null> {
  const resolved = await resolveRequestSession(req);
  return resolved?.user ?? null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resolved = await resolveRequestSession(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const reqPath = req.originalUrl.split('?')[0];
    if (
      resolved.user.mustChangePassword &&
      reqPath !== '/api/auth/me' &&
      reqPath !== '/api/auth/logout' &&
      reqPath !== '/api/auth/change-password' &&
      reqPath !== '/api/auth/reset-password' &&
      reqPath !== '/api/auth/forgot-password'
    ) {
      res.status(403).json({
        error: 'Password change required before accessing academy resources.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
      return;
    }
    req.authUser = resolved.user;
    req.authSessionId = resolved.sessionId;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication service unavailable.' });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.authUser || !hasPermission(req.authUser.role, permission)) {
      res.status(403).json({
        error: 'Access denied. Insufficient permissions.',
      });
      return;
    }
    next();
  };
}
