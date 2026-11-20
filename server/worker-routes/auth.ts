import { getUserDashboardByIdD1, recordAuditLogD1 } from '../d1/ams-service.ts';
import {
  revokeAllUserSessionsD1,
  revokeAuthSessionByTokenHashD1,
} from '../d1/repository.ts';
import {
  buildClearSessionCookie,
  buildPasswordUnavailablePayload,
  extractAuthToken,
  resolveWorkerAuthMode,
  sha256Hex,
} from '../worker-auth.ts';
import {
  isCrossSiteCookiesEnabledWorker,
  type WorkerRouteEntry,
} from '../worker-router.ts';

export const workerAuthRoutes: WorkerRouteEntry[] = [
  // GET /api/auth/me
  {
    method: 'GET',
    pattern: '/api/auth/me',
    auth: 'optional',
    handler: async (c) =>
      c.json(
        200,
        {
          user: c.authUser,
          authMode: resolveWorkerAuthMode(c.env),
        },
        { 'Cache-Control': 'no-store' }
      ),
  },

  // POST /api/auth/register — Public self-registration remains disabled
  {
    method: 'POST',
    pattern: '/api/auth/register',
    auth: 'none',
    handler: async (c) =>
      c.json(410, {
        error:
          'Public self-registration is disabled. Applicants should submit an admission application or contact an IGS Administrator for a passkey enrollment link.',
        code: 'REGISTRATION_DISABLED',
      }),
  },

  // POST /api/auth/login — Password login deliberately disabled on Cloudflare Workers Free
  {
    method: 'POST',
    pattern: '/api/auth/login',
    auth: 'none',
    handler: async (c) => {
      await recordAuditLogD1(
        {
          actor: null,
          action: 'AUTH_PASSWORD_DISABLED_ATTEMPT',
          entityType: 'auth',
          entityId: 'login',
          ipAddress: c.ipAddress,
          summary: 'Rejected password login attempt on Workers Free (WebAuthn passkeys required).',
        },
        c.db
      );
      return c.json(403, buildPasswordUnavailablePayload(), { 'Cache-Control': 'no-store' });
    },
  },

  // POST /api/auth/logout
  {
    method: 'POST',
    pattern: '/api/auth/logout',
    auth: 'optional',
    handler: async (c) => {
      const rawToken = extractAuthToken(c.request);
      if (rawToken) {
        const tokenHash = await sha256Hex(rawToken);
        await revokeAuthSessionByTokenHashD1(tokenHash, 'logout', c.db);
      }
      if (c.authUser) {
        await recordAuditLogD1(
          {
            actor: c.authUser,
            action: 'AUTH_LOGOUT',
            entityType: 'user',
            entityId: c.authUser.id,
            ipAddress: c.ipAddress,
            summary: `${c.authUser.email} signed out.`,
          },
          c.db
        );
      }
      return c.json(
        200,
        { ok: true },
        {
          'Set-Cookie': buildClearSessionCookie(
            c.request,
            isCrossSiteCookiesEnabledWorker(c.env)
          ),
          'Cache-Control': 'no-store',
        }
      );
    },
  },

  // POST /api/auth/sessions/revoke-all
  {
    method: 'POST',
    pattern: '/api/auth/sessions/revoke-all',
    auth: 'required',
    handler: async (c) => {
      await revokeAllUserSessionsD1(c.authUser!.id, 'user_revoked_all', c.db);
      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'AUTH_SESSIONS_REVOKED',
          entityType: 'user',
          entityId: c.authUser!.id,
          ipAddress: c.ipAddress,
          summary: `${c.authUser!.email} revoked all active sessions.`,
        },
        c.db
      );
      return c.json(
        200,
        { ok: true },
        {
          'Set-Cookie': buildClearSessionCookie(
            c.request,
            isCrossSiteCookiesEnabledWorker(c.env)
          ),
          'Cache-Control': 'no-store',
        }
      );
    },
  },

  // POST /api/auth/change-password — Disabled on Workers Free
  {
    method: 'POST',
    pattern: '/api/auth/change-password',
    auth: 'optional',
    handler: async (c) =>
      c.json(403, buildPasswordUnavailablePayload(), { 'Cache-Control': 'no-store' }),
  },

  // POST /api/auth/forgot-password — Disabled on Workers Free
  {
    method: 'POST',
    pattern: '/api/auth/forgot-password',
    auth: 'none',
    handler: async (c) =>
      c.json(403, buildPasswordUnavailablePayload(), { 'Cache-Control': 'no-store' }),
  },

  // POST /api/auth/reset-password — Disabled on Workers Free
  {
    method: 'POST',
    pattern: '/api/auth/reset-password',
    auth: 'none',
    handler: async (c) =>
      c.json(403, buildPasswordUnavailablePayload(), { 'Cache-Control': 'no-store' }),
  },

  // GET /api/dashboard — Authenticated workspace payload
  {
    method: 'GET',
    pattern: '/api/dashboard',
    auth: 'required',
    handler: async (c) => {
      const dashboard = await getUserDashboardByIdD1(c.authUser!.id, c.db);
      return c.json(200, dashboard, { 'Cache-Control': 'no-store' });
    },
  },
];
