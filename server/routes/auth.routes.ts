import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import type { UserRole } from '../../src/shared/types.ts';
import { loginSchema, registerSchema } from '../../src/shared/validation.ts';
import {
  findUserByEmail,
  getUserDashboardById,
  recordAuditLog,
  registerStudentAccount,
  runSessionReminderSweep,
  syncFirebaseUser,
  toPublicUser,
} from '../ams-service.ts';
import { SESSION_COOKIE_NAME, signSessionToken, verifyPassword } from '../auth.ts';
import {
  requireAuth,
  resolveRequestUser,
  setSessionCookie,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';

export const authRouter = Router();

authRouter.get('/auth/me', async (req: Request, res: Response) => {
  try {
    const user = await resolveRequestUser(req);
    res.json({ user });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.json({ user: null });
  }
});

authRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid login input.' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ error: 'This account is inactive or archived. Contact Academy Administration.' });
      return;
    }

    const token = signSessionToken(user.id, user.role as UserRole);
    setSessionCookie(res, token);

    await recordAuditLog({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      summary: `User ${user.email} signed in with academy credentials.`,
    });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

authRouter.post('/auth/firebase', async (req: Request, res: Response) => {
  try {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
    if (!idToken) {
      res.status(400).json({ error: 'Firebase ID token is required.' });
      return;
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded.email) {
      res.status(400).json({ error: 'Google account must expose a verified email address.' });
      return;
    }

    const user = await syncFirebaseUser({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name ?? decoded.email.split('@')[0],
    });

    if (user.status !== 'active') {
      res.status(403).json({ error: 'This account is inactive or archived. Contact Academy Administration.' });
      return;
    }

    const token = signSessionToken(user.id, user.role as UserRole);
    setSessionCookie(res, token);

    await recordAuditLog({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'USER_GOOGLE_LOGIN',
      entityType: 'user',
      entityId: user.id,
      summary: `User ${user.email} authenticated via Google Sign-In.`,
    });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('POST /api/auth/firebase error:', err);
    res.status(401).json({ error: 'Google Sign-In verification failed.' });
  }
});

authRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration data.' });
      return;
    }

    const created = await registerStudentAccount(parsed.data);
    if (!created.ok) {
      res.status(409).json({ error: created.error });
      return;
    }

    const token = signSessionToken(created.user.id, created.user.role as UserRole);
    setSessionCookie(res, token);
    res.status(201).json({ user: toPublicUser(created.user) });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

authRouter.post('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/dashboard', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await runSessionReminderSweep().catch(() => undefined);
    const dashboard = await getUserDashboardById(req.authUser!.id);
    res.json(dashboard);
  } catch (err) {
    console.error('GET /api/dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});
