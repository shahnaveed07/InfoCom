import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../../src/shared/validation.ts';
import {
  getUserDashboardByIdD1,
  recordAuditLogD1,
} from '../d1/ams-service.ts';
import {
  d1First,
  d1Run,
  nowIso,
  randomId,
} from '../d1/client.ts';
import {
  createAuthSessionRecordD1,
  revokeAllUserSessionsD1,
  revokeAuthSessionByTokenHashD1,
  revokeOtherUserSessionsD1,
  toPublicUserD1,
  type DbUserRow,
} from '../d1/repository.ts';
import {
  queueD1TransactionalEmail,
  runD1SessionReminderSweep,
} from '../jobs/d1-worker.ts';
import {
  SESSION_TTL_SECONDS,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  extractAuthToken,
  generateOpaqueToken,
  hashPasswordWorker,
  sha256Hex,
  verifyPasswordWorker,
} from '../worker-auth.ts';
import {
  isCrossSiteCookiesEnabledWorker,
  resolveRequestOrigin,
  resolveWorkerSession,
  type WorkerRouteEntry,
} from '../worker-router.ts';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export const workerAuthRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/auth/me',
    auth: 'none',
    handler: async (c) => {
      try {
        const resolved = await resolveWorkerSession(c.request, c.db);
        return c.json(200, { user: resolved?.user ?? null });
      } catch {
        return c.json(200, { user: null });
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/login',
    auth: 'none',
    handler: async (c) => {
      const body = await c.readJson(64 * 1024);
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid login input.',
        });
      }

      const { email, password } = parsed.data;
      const normalizedEmail = email.trim().toLowerCase();
      const user = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1',
        [normalizedEmail],
        c.db
      );

      if (!user || !user.password_hash) {
        await recordAuditLogD1(
          {
            actor: {
              id: user?.id ?? '',
              email: normalizedEmail,
              role: (user?.role as 'admin' | 'instructor' | 'student') ?? 'student',
            },
            action: 'USER_LOGIN_FAILED',
            entityType: 'user',
            entityId: user?.id ?? normalizedEmail,
            ipAddress: c.ipAddress,
            summary: `Failed sign-in attempt for ${normalizedEmail}.`,
          },
          c.db
        );
        return c.json(401, { error: 'Invalid email or password.' });
      }

      const verification = await verifyPasswordWorker(password, user.password_hash);
      if (verification.unsupportedAlgorithm === 'argon2') {
        await recordAuditLogD1(
          {
            actor: {
              id: user.id,
              email: user.email,
              role: user.role as 'admin' | 'instructor' | 'student',
            },
            action: 'USER_LOGIN_BLOCKED_ARGON2',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Blocked sign-in in Worker for legacy $argon2 hash (${user.email}); password reset required.`,
          },
          c.db
        );
        return c.json(501, {
          error:
            'Your account uses a legacy Argon2id digest that cannot execute inside Cloudflare Workers Free CPU limits. Use Forgot Password or ask Administration for a single-use password reset link to re-hash your password with Worker-compatible scrypt.',
          code: 'ARGON2_REHASH_REQUIRED',
        });
      }

      if (!verification.valid) {
        await recordAuditLogD1(
          {
            actor: {
              id: user.id,
              email: user.email,
              role: user.role as 'admin' | 'instructor' | 'student',
            },
            action: 'USER_LOGIN_FAILED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Failed sign-in attempt for ${normalizedEmail}.`,
          },
          c.db
        );
        return c.json(401, { error: 'Invalid email or password.' });
      }

      if (user.status !== 'active') {
        await recordAuditLogD1(
          {
            actor: {
              id: user.id,
              email: user.email,
              role: user.role as 'admin' | 'instructor' | 'student',
            },
            action: 'USER_LOGIN_BLOCKED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Blocked sign-in attempt for ${user.status} account ${user.email}.`,
          },
          c.db
        );
        return c.json(403, {
          error:
            'This account is suspended, inactive, or archived. Contact Academy Administration.',
        });
      }

      // Upgrade legacy <salt>:<hash> scrypt format to versioned scrypt$N$r$p$salt$hash
      if (!user.password_hash.startsWith('scrypt$')) {
        const upgradedHash = await hashPasswordWorker(password);
        const now = nowIso();
        await d1Run(
          'UPDATE users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?',
          [upgradedHash, now, now, user.id],
          c.db
        );
        await recordAuditLogD1(
          {
            actor: {
              id: user.id,
              email: user.email,
              role: user.role as 'admin' | 'instructor' | 'student',
            },
            action: 'PASSWORD_HASH_UPGRADED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Upgraded legacy scrypt digest to versioned format for ${user.email}.`,
          },
          c.db
        );
      }

      const rawToken = generateOpaqueToken(32);
      const tokenHash = await sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      await createAuthSessionRecordD1(
        {
          id: randomId('ses', 10),
          tokenHash,
          userId: user.id,
          roleCode: user.role,
          ipAddress: c.ipAddress,
          userAgent: c.request.headers.get('user-agent') ?? undefined,
          expiresAt,
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: {
            id: user.id,
            email: user.email,
            role: user.role as 'admin' | 'instructor' | 'student',
          },
          action: 'USER_LOGIN',
          entityType: 'user',
          entityId: user.id,
          ipAddress: c.ipAddress,
          summary: `User ${user.email} signed in with academy credentials.`,
        },
        c.db
      );

      const cookieHeader = buildSessionCookieHeader({
        token: rawToken,
        request: c.request,
        crossSiteCookies: isCrossSiteCookiesEnabledWorker(c.env),
      });

      return c.json(200, { user: toPublicUserD1(user) }, { 'Set-Cookie': cookieHeader });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/register',
    auth: 'none',
    handler: async (c) => {
      return c.json(410, {
        error:
          'Public self-registration is disabled. Accounts are issued by IGS — InfoCom Global Services Administration.',
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/logout',
    auth: 'none',
    handler: async (c) => {
      const rawToken = extractAuthToken(c.request);
      if (rawToken) {
        const tokenHash = await sha256Hex(rawToken);
        await revokeAuthSessionByTokenHashD1(tokenHash, 'logout', c.db);
      }
      const clearCookie = buildClearSessionCookieHeader(
        c.request,
        isCrossSiteCookiesEnabledWorker(c.env)
      );
      return c.json(200, { ok: true }, { 'Set-Cookie': clearCookie });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/change-password',
    auth: 'required',
    handler: async (c) => {
      const body = await c.readJson(64 * 1024);
      const parsed = changePasswordSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid password payload.',
        });
      }

      const { currentPassword, newPassword } = parsed.data;
      if (currentPassword === newPassword) {
        return c.json(400, {
          error: 'New password must differ from your current password.',
        });
      }

      const user = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [c.authUser!.id],
        c.db
      );
      if (!user || user.status !== 'active') {
        return c.json(403, { error: 'Account is not active.' });
      }

      if (user.password_hash) {
        const verified = await verifyPasswordWorker(currentPassword, user.password_hash);
        if (verified.unsupportedAlgorithm === 'argon2') {
          return c.json(501, {
            error:
              'Legacy Argon2id verification cannot execute inside Workers Free limits. Use Forgot Password or contact Administration for a reset token.',
            code: 'ARGON2_REHASH_REQUIRED',
          });
        }
        if (!verified.valid) {
          return c.json(401, { error: 'Current password is incorrect.' });
        }
      }

      const newHash = await hashPasswordWorker(newPassword);
      const now = nowIso();
      await d1Run(
        `UPDATE users
         SET password_hash = ?, password_updated_at = ?, must_change_password = 0,
             session_version = session_version + 1, updated_at = ?
         WHERE id = ?`,
        [newHash, now, now, user.id],
        c.db
      );

      if (c.authSessionId) {
        await revokeOtherUserSessionsD1(
          user.id,
          c.authSessionId,
          'password_changed',
          c.db
        );
      }

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'PASSWORD_CHANGED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: c.ipAddress,
          summary: `User ${user.email} updated their account password.`,
        },
        c.db
      );

      const updated = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [user.id],
        c.db
      );

      return c.json(200, {
        ok: true,
        message: 'Password updated successfully.',
        user: updated ? toPublicUserD1(updated) : toPublicUserD1(user),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/forgot-password',
    auth: 'none',
    handler: async (c) => {
      const body = await c.readJson(64 * 1024);
      const parsed = forgotPasswordSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Valid email is required.',
        });
      }

      const normalizedEmail = parsed.data.email.trim().toLowerCase();
      const user = await d1First<DbUserRow>(
        'SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1',
        [normalizedEmail],
        c.db
      );

      if (user && user.status === 'active') {
        const rawToken = generateOpaqueToken(24);
        const tokenHash = await sha256Hex(rawToken);
        const now = nowIso();
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
        const origin = resolveRequestOrigin(c.request, c.env);
        const resetUrl = `${origin}/login?resetToken=${encodeURIComponent(rawToken)}`;

        await d1Run(
          'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
          [now, user.id],
          c.db
        );
        await d1Run(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomId('prt', 8), user.id, tokenHash, expiresAt, user.id, now],
          c.db
        );

        await queueD1TransactionalEmail(
          {
            userId: user.id,
            kind: 'password_reset',
            recipientEmail: user.email,
            subject: 'Password Reset Instructions — IGS — InfoCom Global Services',
            bodyText: `Hello ${user.name},\n\nUse the single-use link below to reset your InfoCom Academy password (expires in 30 minutes):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
            bypassPreferences: true,
            redactSensitive: true,
          },
          c.db
        );

        await recordAuditLogD1(
          {
            actor: {
              id: user.id,
              email: user.email,
              role: user.role as 'admin' | 'instructor' | 'student',
            },
            action: 'PASSWORD_RESET_REQUESTED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Password reset token generated for ${user.email} (expires in 30m).`,
          },
          c.db
        );
      }

      return c.json(200, {
        ok: true,
        message:
          'If an active account matches that email address, password reset instructions have been issued.',
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/reset-password',
    auth: 'none',
    handler: async (c) => {
      const body = await c.readJson(64 * 1024);
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid reset payload.',
        });
      }

      const tokenHash = await sha256Hex(parsed.data.token);
      const resetRecord = await d1First<
        {
          id: string;
          user_id: string;
          expires_at: string;
          used_at: string | null;
        } & DbUserRow
      >(
        `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at,
                u.id AS u_id, u.name, u.email, u.role, u.status, u.password_hash
         FROM password_reset_tokens prt
         INNER JOIN users u ON u.id = prt.user_id
         WHERE prt.token_hash = ?
         LIMIT 1`,
        [tokenHash],
        c.db
      );

      const nowMs = Date.now();
      const isPendingOnboarding =
        resetRecord?.status === 'inactive' && !resetRecord.password_hash;

      if (
        !resetRecord ||
        resetRecord.used_at !== null ||
        Date.parse(resetRecord.expires_at) <= nowMs ||
        (resetRecord.status !== 'active' && !isPendingOnboarding)
      ) {
        return c.json(400, {
          error: 'Password reset token is invalid or has expired.',
        });
      }

      const newHash = await hashPasswordWorker(parsed.data.newPassword);
      const now = nowIso();

      await d1Run(
        'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?',
        [now, resetRecord.id],
        c.db
      );
      await d1Run(
        `UPDATE users
         SET password_hash = ?, password_updated_at = ?, must_change_password = 0,
             session_version = session_version + 1, updated_at = ?
         WHERE id = ?`,
        [newHash, now, now, resetRecord.user_id],
        c.db
      );
      await revokeAllUserSessionsD1(resetRecord.user_id, 'password_reset', c.db);

      await recordAuditLogD1(
        {
          actor: {
            id: resetRecord.user_id,
            email: resetRecord.email,
            role: resetRecord.role as 'admin' | 'instructor' | 'student',
          },
          action: 'PASSWORD_RESET_COMPLETED',
          entityType: 'user',
          entityId: resetRecord.user_id,
          ipAddress: c.ipAddress,
          summary: `Password setup/reset completed and all prior sessions revoked for ${resetRecord.email}.`,
        },
        c.db
      );

      const clearCookie = buildClearSessionCookieHeader(
        c.request,
        isCrossSiteCookiesEnabledWorker(c.env)
      );

      return c.json(
        200,
        {
          ok: true,
          message:
            resetRecord.status === 'active'
              ? 'Password has been set. You may now sign in.'
              : 'Password has been set. You can sign in once the institute activates your student portal.',
        },
        { 'Set-Cookie': clearCookie }
      );
    },
  },
  {
    method: 'GET',
    pattern: '/api/dashboard',
    auth: 'required',
    handler: async (c) => {
      await runD1SessionReminderSweep(c.db).catch(() => undefined);
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, dashboard);
    },
  },
];
