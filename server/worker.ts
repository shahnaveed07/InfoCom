import {
  D1ConfigurationError,
  WorkflowError,
  checkD1Readiness,
  runWithD1Database,
} from './d1/client.ts';
import {
  type D1JobQueueMessage,
  type WorkerD1ExecutionContextLike,
  type WorkerD1ScheduledControllerLike,
  type WorkerQueueBatchD1Like,
  extractWorkerEmailEnv,
  handleD1WorkerQueueBatch,
  handleD1WorkerScheduledSweep,
  runWithD1EmailConfig,
  runWithD1JobQueue,
} from './jobs/d1-worker.ts';
import {
  checkDistributedRateLimit,
  runWithRateLimiters,
} from './middleware/rate-limit.ts';
import { R2ConfigurationError, runWithR2Bucket } from './storage/r2.ts';
import { logOperationalMetric } from './telemetry/cloudflare-limits.ts';
import {
  PayloadError,
  type WorkerRequestContext,
  type WorkerRouteEntry,
  type WorkerRouteEnv,
  applySecurityHeadersToResponseHeaders,
  buildWorkerBinaryResponse,
  buildWorkerJsonResponse,
  checkCsrfOriginGuardWorker,
  getWorkerClientIp,
  isPasswordChangeExemptPath,
  matchWorkerRoutePath,
  readBoundedJsonBody,
  resolveWorkerSession,
} from './worker-router.ts';
import { workerAcademicRoutes } from './worker-routes/academics.ts';
import { workerAdminRoutes } from './worker-routes/admin.ts';
import { workerAdmissionsRoutes } from './worker-routes/admissions.ts';
import { workerAuthRoutes } from './worker-routes/auth.ts';
import { workerFinanceRoutes } from './worker-routes/finance.ts';
import { workerOpsReportsRoutes } from './worker-routes/ops-reports.ts';
import { workerPublicRoutes } from './worker-routes/public.ts';
import { workerWebAuthnRoutes } from './worker-routes/webauthn.ts';

export type CloudflareWorkerEnv = WorkerRouteEnv;

const WORKER_ROUTES: WorkerRouteEntry[] = [
  ...workerPublicRoutes,
  ...workerAuthRoutes,
  ...workerWebAuthnRoutes,
  ...workerAdmissionsRoutes,
  ...workerFinanceRoutes,
  ...workerAcademicRoutes,
  ...workerAdminRoutes,
  ...workerOpsReportsRoutes,
];

const AUTH_RATE_LIMITED_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/change-password',
  '/api/auth/webauthn/register/options',
  '/api/auth/webauthn/register/verify',
  '/api/auth/webauthn/login/options',
  '/api/auth/webauthn/login/verify',
  '/api/auth/webauthn/reauth/options',
  '/api/auth/webauthn/reauth/verify',
]);

async function serveSpaAsset(
  request: Request,
  env: CloudflareWorkerEnv
): Promise<Response> {
  if (!env.ASSETS) {
    return buildWorkerJsonResponse(request, env, 404, {
      error: 'Static asset binding is not configured on this Worker.',
      code: 'ASSETS_BINDING_MISSING',
    });
  }

  let assetRes = await env.ASSETS.fetch(request);
  if (
    assetRes.status === 404 &&
    request.method.toUpperCase() === 'GET'
  ) {
    const reqUrl = new URL(request.url);
    const lastSegment = reqUrl.pathname.split('/').pop() ?? '';
    if (!lastSegment.includes('.')) {
      const indexUrl = new URL('/', reqUrl);
      assetRes = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
    }
  }

  const headers = new Headers(assetRes.headers);
  applySecurityHeadersToResponseHeaders(headers, request, env);
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers,
  });
}

export default {
  async fetch(
    request: Request,
    env: CloudflareWorkerEnv,
    ctx: WorkerD1ExecutionContextLike
  ): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    const finalize = (res: Response): Response => {
      logOperationalMetric({
        runtime: 'cloudflare-worker',
        route: pathname,
        method,
        status: res.status,
        durationMs: Math.max(0, Date.now() - started),
      });
      return res;
    };

    if (!pathname.startsWith('/api')) {
      try {
        return finalize(await serveSpaAsset(request, env));
      } catch (err) {
        console.error('Worker SPA asset error:', err);
        return finalize(
          buildWorkerJsonResponse(request, env, 500, {
            error: 'Failed to serve application asset.',
          })
        );
      }
    }

    if (method === 'OPTIONS') {
      const headers = new Headers();
      applySecurityHeadersToResponseHeaders(headers, request, env);
      return finalize(new Response(null, { status: 204, headers }));
    }

    if (pathname === '/api/health' && method === 'GET') {
      return finalize(
        buildWorkerJsonResponse(request, env, 200, {
          status: 'ok',
          service: 'igs-ams-worker',
          runtime: 'cloudflare-workers',
          environment: env.NODE_ENV || 'production',
          timestamp: new Date().toISOString(),
        })
      );
    }

    if (pathname === '/api/health/ready' && method === 'GET') {
      const readiness = await checkD1Readiness(env.DB);
      return finalize(
        buildWorkerJsonResponse(request, env, readiness.ready ? 200 : 503, {
          status: readiness.status,
          database: readiness.database,
          mode: readiness.mode,
          latencyMs: readiness.latencyMs,
          ...(readiness.errorCode ? { code: readiness.errorCode } : {}),
        })
      );
    }

    const clientIp = getWorkerClientIp(request);
    const rateHeaders: Record<string, string> = {};

    if (AUTH_RATE_LIMITED_PATHS.has(pathname) && env.AUTH_RATE_LIMITER) {
      const rl = await checkDistributedRateLimit({
        binding: env.AUTH_RATE_LIMITER,
        key: `auth:${pathname}:${clientIp}`,
      });
      rateHeaders['X-RateLimit-Backend'] = rl.backend;
      if (!rl.allowed) {
        return finalize(
          buildWorkerJsonResponse(
            request,
            env,
            429,
            { error: 'Too many authentication attempts. Please wait before trying again.' },
            { ...rateHeaders, 'Retry-After': '60' }
          )
        );
      }
    } else if (
      (pathname.startsWith('/api/public/') ||
        pathname === '/api/admissions/public' ||
        pathname === '/api/admissions/public/catalog' ||
        pathname.startsWith('/api/certificates/verify/')) &&
      env.PUBLIC_RATE_LIMITER
    ) {
      const rl = await checkDistributedRateLimit({
        binding: env.PUBLIC_RATE_LIMITER,
        key: `public:${pathname}:${clientIp}`,
      });
      rateHeaders['X-RateLimit-Backend'] = rl.backend;
      if (!rl.allowed) {
        return finalize(
          buildWorkerJsonResponse(
            request,
            env,
            429,
            { error: 'Too many requests. Please wait a moment before trying again.' },
            { ...rateHeaders, 'Retry-After': '60' }
          )
        );
      }
    }

    const csrfError = checkCsrfOriginGuardWorker(request, env);
    if (csrfError) {
      return finalize(
        buildWorkerJsonResponse(
          request,
          env,
          403,
          { error: csrfError, code: 'CSRF_ORIGIN_REJECTED' },
          rateHeaders
        )
      );
    }

    let matchedRoute: WorkerRouteEntry | null = null;
    let matchedParams: Record<string, string> = {};
    for (const candidate of WORKER_ROUTES) {
      if (candidate.method !== method) continue;
      const params = matchWorkerRoutePath(candidate.pattern, pathname);
      if (params) {
        matchedRoute = candidate;
        matchedParams = params;
        break;
      }
    }

    if (!matchedRoute) {
      return finalize(
        buildWorkerJsonResponse(
          request,
          env,
          404,
          { error: 'API endpoint not found.', code: 'API_ROUTE_NOT_FOUND' },
          rateHeaders
        )
      );
    }

    if (!env.DB) {
      return finalize(
        buildWorkerJsonResponse(
          request,
          env,
          503,
          {
            error: 'Cloudflare D1 database binding is missing or unconfigured.',
            code: 'D1_BINDING_MISSING',
          },
          rateHeaders
        )
      );
    }

    const db = env.DB;

    try {
      const response = await runWithRateLimiters(
        {
          auth: env.AUTH_RATE_LIMITER,
          public: env.PUBLIC_RATE_LIMITER,
          runtime: 'cloudflare-worker',
        },
        () =>
          runWithR2Bucket(env.DOCUMENTS_BUCKET, () =>
            runWithD1Database(db, () =>
              runWithD1EmailConfig(extractWorkerEmailEnv(env), () =>
                runWithD1JobQueue(env.JOBS_QUEUE, async () => {
                  const authMode = matchedRoute!.auth ?? 'none';
                  let authUser = null;
                  let authSessionId: string | null = null;

                  if (authMode === 'required' || authMode === 'optional') {
                    const resolved = await resolveWorkerSession(request, db);
                    if (resolved) {
                      authUser = resolved.user;
                      authSessionId = resolved.sessionId;
                    }
                  }

                  if (authMode === 'required' && !authUser) {
                    return buildWorkerJsonResponse(
                      request,
                      env,
                      401,
                      { error: 'Authentication required.' },
                      rateHeaders
                    );
                  }

                  if (
                    authMode === 'required' &&
                    authUser?.mustChangePassword &&
                    !isPasswordChangeExemptPath(pathname)
                  ) {
                    return buildWorkerJsonResponse(
                      request,
                      env,
                      403,
                      {
                        error:
                          'Password change is required before accessing the academy portal.',
                        code: 'PASSWORD_CHANGE_REQUIRED',
                      },
                      rateHeaders
                    );
                  }

                  if (
                    authMode === 'required' &&
                    matchedRoute!.roles &&
                    authUser &&
                    !matchedRoute!.roles.includes(authUser.role)
                  ) {
                    return buildWorkerJsonResponse(
                      request,
                      env,
                      403,
                      { error: 'Insufficient permissions.' },
                      rateHeaders
                    );
                  }

                  const context: WorkerRequestContext = {
                    request,
                    url,
                    pathname,
                    method,
                    params: matchedParams,
                    query: url.searchParams,
                    env,
                    ctx,
                    db,
                    authUser,
                    authSessionId,
                    ipAddress: clientIp,
                    rateHeaders,
                    json: (status, body, extraHeaders) => {
                      const merged = new Headers(rateHeaders);
                      if (extraHeaders) {
                        new Headers(extraHeaders).forEach((value, key) => {
                          if (key.toLowerCase() === 'set-cookie') {
                            merged.append(key, value);
                          } else {
                            merged.set(key, value);
                          }
                        });
                      }
                      return buildWorkerJsonResponse(request, env, status, body, merged);
                    },
                    binary: (status, body, extraHeaders) => {
                      const merged = new Headers(rateHeaders);
                      if (extraHeaders) {
                        new Headers(extraHeaders).forEach((value, key) => {
                          merged.set(key, value);
                        });
                      }
                      return buildWorkerBinaryResponse(request, env, status, body, merged);
                    },
                    readJson: <T = Record<string, unknown>>(maxBytes = 5 * 1024 * 1024) =>
                      readBoundedJsonBody<T>(request, maxBytes),
                  };

                  return matchedRoute!.handler(context);
                })
              )
            )
          )
      );

      return finalize(response);
    } catch (err) {
      if (err instanceof PayloadError) {
        return finalize(
          buildWorkerJsonResponse(
            request,
            env,
            err.status,
            { error: err.message, code: err.code },
            rateHeaders
          )
        );
      }
      if (err instanceof WorkflowError) {
        return finalize(
          buildWorkerJsonResponse(
            request,
            env,
            err.status,
            { error: err.message, code: err.code },
            rateHeaders
          )
        );
      }
      if (err instanceof D1ConfigurationError || err instanceof R2ConfigurationError) {
        return finalize(
          buildWorkerJsonResponse(
            request,
            env,
            503,
            { error: err.message, code: err.code },
            rateHeaders
          )
        );
      }
      console.error('Worker request error:', err);
      return finalize(
        buildWorkerJsonResponse(
          request,
          env,
          500,
          { error: 'An internal server error occurred.' },
          rateHeaders
        )
      );
    }
  },

  async queue(
    batch: WorkerQueueBatchD1Like<D1JobQueueMessage>,
    env: CloudflareWorkerEnv,
    ctx: WorkerD1ExecutionContextLike
  ): Promise<void> {
    await handleD1WorkerQueueBatch(batch, env, ctx);
  },

  async scheduled(
    controller: WorkerD1ScheduledControllerLike,
    env: CloudflareWorkerEnv,
    ctx: WorkerD1ExecutionContextLike
  ): Promise<void> {
    await handleD1WorkerScheduledSweep(controller, env, ctx);
  },
};
