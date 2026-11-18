import crypto from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../../src/shared/validation.ts';
import {
  findUserByEmail,
  findUserById,
  getUserDashboardById,
  recordAuditLog,
  runSessionReminderSweep,
  toPublicUser,
} from '../ams-service.ts';
import {
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
  generateOpaqueSessionToken,
  generatePasswordResetToken,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  verifyPassword,
} from '../auth.ts';
import { prisma } from '../db/prisma.ts';
import {
  clearSessionCookie,
  extractSessionToken,
  requireAuth,
  resolveRequestUser,
  setSessionCookie,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { createRateLimiter, getClientIp } from '../middleware/security.ts';
import {
  createAuthSessionRecord,
  revokeAllUserSessionsInDb,
  revokeAuthSessionByTokenHash,
  revokeOtherUserSessionsInDb,
} from '../repositories/ams.repository.ts';
import { queueTransactionalEmail } from '../jobs/worker.ts';

export const authRouter = Router();

// Tight 64kb body size limit for authentication routes
authRouter.use('/auth', express.json({ limit: '64kb' }));

async function issueOpaqueSession(
  req: Request,
  user: { id: string; role: string }
): Promise<{ rawToken: string; sessionId: string }> {
  const rawToken = generateOpaqueSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = `ses-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await createAuthSessionRecord({
    id: sessionId,
    tokenHash,
    userId: user.id,
    roleCode: user.role,
    ipAddress: getClientIp(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    expiresAt,
  });

  return { rawToken, sessionId };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'auth-login',
  bindingName: 'auth',
  keySelector: (req) =>
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '',
  message: 'Too many sign-in attempts. Please wait 15 minutes before trying again.',
});

const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'auth-register',
  bindingName: 'auth',
  message: 'Too many registration attempts from this network. Please wait before retrying.',
});

const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'auth-forgot-password',
  bindingName: 'auth',
  keySelector: (req) =>
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '',
  message: 'Too many password reset requests. Please wait before trying again.',
});

const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'auth-reset-password',
  bindingName: 'auth',
  message: 'Too many password reset attempts. Please wait before trying again.',
});

const changePasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'auth-change-password',
  bindingName: 'auth',
  message: 'Too many password change attempts. Please wait before trying again.',
});

export function resetAuthRateLimiters(): void {
  loginLimiter.reset();
  registerLimiter.reset();
  forgotPasswordLimiter.reset();
  resetPasswordLimiter.reset();
  changePasswordLimiter.reset();
}

authRouter.get('/auth/me', async (req: Request, res: Response) => {
  try {
    const user = await resolveRequestUser(req);
    res.json({ user });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.json({ user: null });
  }
});

authRouter.post('/auth/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid login input.' });
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    const verification = await verifyPassword(password, user?.passwordHash);

    if (!user || !user.passwordHash || !verification.valid) {
      await recordAuditLog({
        actor: {
          id: user?.id ?? null,
          email: normalizedEmail,
          role: user?.role ?? 'anonymous',
        },
        action: 'USER_LOGIN_FAILED',
        entityType: 'user',
        entityId: user?.id ?? normalizedEmail,
        ipAddress: getClientIp(req),
        summary: `Failed sign-in attempt for ${normalizedEmail}.`,
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (user.status !== 'active') {
      await recordAuditLog({
        actor: { id: user.id, email: user.email, role: user.role },
        action: 'USER_LOGIN_BLOCKED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: getClientIp(req),
        summary: `Blocked sign-in attempt for ${user.status} account ${user.email}.`,
      });
      res.status(403).json({
        error: 'This account is suspended, inactive, or archived. Contact Academy Administration.',
      });
      return;
    }

    // Transparently upgrade legacy scrypt or outdated Argon2id hashes to Argon2id
    if (verification.needsRehash) {
      const upgradedHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: upgradedHash,
          passwordUpdatedAt: new Date(),
        },
      });
      await recordAuditLog({
        actor: { id: user.id, email: user.email, role: user.role },
        action: 'PASSWORD_HASH_UPGRADED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: getClientIp(req),
        summary: `Upgraded password digest to Argon2id for ${user.email}.`,
      });
    }

    const { rawToken } = await issueOpaqueSession(req, user);
    setSessionCookie(res, rawToken, req);

    await recordAuditLog({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: getClientIp(req),
      summary: `User ${user.email} signed in with academy credentials.`,
    });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

authRouter.post('/auth/register', registerLimiter, async (_req: Request, res: Response) => {
  res.status(410).json({
    error:
      'Public self-registration is disabled. Accounts are issued by IGS — InfoCom Global Services Administration.',
  });
});

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const rawToken = extractSessionToken(req);
  if (rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    await revokeAuthSessionByTokenHash(tokenHash, 'logout');
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

authRouter.post(
  '/auth/change-password',
  requireAuth,
  changePasswordLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password payload.' });
        return;
      }

      const { currentPassword, newPassword } = parsed.data;
      if (currentPassword === newPassword) {
        res.status(400).json({ error: 'New password must differ from your current password.' });
        return;
      }

      const user = await findUserById(req.authUser!.id);
      if (!user || user.status !== 'active') {
        res.status(403).json({ error: 'Account is not active.' });
        return;
      }

      if (user.passwordHash) {
        const verified = await verifyPassword(currentPassword, user.passwordHash);
        if (!verified.valid) {
          res.status(401).json({ error: 'Current password is incorrect.' });
          return;
        }
      }

      const newHash = await hashPassword(newPassword);
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          passwordUpdatedAt: new Date(),
          mustChangePassword: false,
          sessionVersion: { increment: 1 },
        },
      });

      if (req.authSessionId) {
        await revokeOtherUserSessionsInDb(user.id, req.authSessionId, 'password_changed');
      }

      await recordAuditLog({
        actor: req.authUser!,
        action: 'PASSWORD_CHANGED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: getClientIp(req),
        summary: `User ${user.email} updated their account password.`,
      });

      res.json({
        ok: true,
        message: 'Password updated successfully.',
        user: toPublicUser(updatedUser),
      });
    } catch (err) {
      console.error('POST /api/auth/change-password error:', err);
      res.status(500).json({ error: 'Unable to update password right now.' });
    }
  }
);

authRouter.post(
  '/auth/forgot-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Valid email is required.' });
        return;
      }

      const normalizedEmail = parsed.data.email.toLowerCase();
      const user = await findUserByEmail(normalizedEmail);

      if (user && user.status === 'active') {
        const { rawToken, tokenHash } = generatePasswordResetToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
        const appOrigin = (
          process.env.APP_URL ||
          (req.get('host') ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000')
        ).replace(/\/+$/, '');
        const resetUrl = `${appOrigin}/login?resetToken=${encodeURIComponent(rawToken)}`;

        await prisma.$transaction(async (tx) => {
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: now },
          });

          await tx.passwordResetToken.create({
            data: {
              id: `prt-${crypto.randomUUID()}`,
              userId: user.id,
              tokenHash,
              expiresAt,
              createdByUserId: user.id,
            },
          });

          await queueTransactionalEmail(tx, {
            userId: user.id,
            kind: 'password_reset',
            recipientEmail: user.email,
            subject: 'Password Reset Instructions — IGS — InfoCom Global Services',
            bodyText: `Hello ${user.name},\n\nUse the single-use link below to reset your InfoCom Academy password (expires in 30 minutes):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
            bypassPreferences: true,
            redactSensitive: true,
          });
        });

        await recordAuditLog({
          actor: { id: user.id, email: user.email, role: user.role },
          action: 'PASSWORD_RESET_REQUESTED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: getClientIp(req),
          summary: `Password reset token generated for ${user.email} (expires in 30m).`,
        });
      }

      // Always return generic response to prevent account enumeration
      res.json({
        ok: true,
        message:
          'If an active account matches that email address, password reset instructions have been issued.',
      });
    } catch (err) {
      console.error('POST /api/auth/forgot-password error:', err);
      res.status(500).json({ error: 'Unable to process password reset request.' });
    }
  }
);

authRouter.post(
  '/auth/reset-password',
  resetPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid reset payload.' });
        return;
      }

      const tokenHash = hashPasswordResetToken(parsed.data.token);
      const resetRecord = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      const now = new Date();
      const isPendingOnboarding =
        resetRecord?.user?.status === 'inactive' && !resetRecord.user.passwordHash;
      if (
        !resetRecord ||
        resetRecord.usedAt !== null ||
        resetRecord.expiresAt.getTime() <= now.getTime() ||
        !resetRecord.user ||
        (resetRecord.user.status !== 'active' && !isPendingOnboarding)
      ) {
        res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
        return;
      }

      const newHash = await hashPassword(parsed.data.newPassword);

      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.update({
          where: { id: resetRecord.id },
          data: { usedAt: now },
        });

        await tx.user.update({
          where: { id: resetRecord.userId },
          data: {
            passwordHash: newHash,
            passwordUpdatedAt: now,
            mustChangePassword: false,
            sessionVersion: { increment: 1 },
          },
        });

        await tx.authSession.updateMany({
          where: { userId: resetRecord.userId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'password_reset' },
        });
      });

      await revokeAllUserSessionsInDb(resetRecord.userId, 'password_reset');

      await recordAuditLog({
        actor: {
          id: resetRecord.user.id,
          email: resetRecord.user.email,
          role: resetRecord.user.role,
        },
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'user',
        entityId: resetRecord.user.id,
        ipAddress: getClientIp(req),
        summary: `Password setup/reset completed and all prior sessions revoked for ${resetRecord.user.email}.`,
      });

      clearSessionCookie(res, req);
      res.json({
        ok: true,
        message:
          resetRecord.user.status === 'active'
            ? 'Password has been set. You may now sign in.'
            : 'Password has been set. You can sign in once the institute activates your student portal.',
      });
    } catch (err) {
      console.error('POST /api/auth/reset-password error:', err);
      res.status(500).json({ error: 'Unable to reset password right now.' });
    }
  }
);

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
