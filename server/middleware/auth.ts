import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import type { UserPublic, UserRole } from '../../src/shared/types.ts';
import {
  findUserById,
  syncFirebaseUser,
  toPublicUser,
} from '../ams-service.ts';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
} from '../auth.ts';

export interface AuthenticatedRequest extends Request {
  authUser?: UserPublic;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

export async function resolveRequestUser(req: Request): Promise<UserPublic | null> {
  // 1. Check Bearer Firebase ID Token if provided
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const userRow = await syncFirebaseUser({
          uid: decoded.uid,
          email: decoded.email ?? '',
          name: decoded.name ?? decoded.email ?? 'Academy User',
        });
        if (userRow.status !== 'active') return null;
        return toPublicUser(userRow);
      } catch {
        return null;
      }
    }
  }

  // 2. Check signed HttpOnly server session cookie
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (!payload) return null;

  const userRow = await findUserById(payload.userId);
  if (!userRow || userRow.status !== 'active') return null;
  return toPublicUser(userRow);
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await resolveRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    req.authUser = user;
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
