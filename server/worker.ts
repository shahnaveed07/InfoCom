import { slugifyCourseTitle } from '../src/shared/academic.ts';
import type {
  CohortStatus,
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
} from '../src/shared/types.ts';
import {
  type HyperdriveBinding,
  HyperdriveConfigurationError,
  checkDatabaseReadiness,
  prisma,
  runWithHyperdriveDatabase,
} from './db/prisma.ts';
import {
  type WorkerExecutionContextLike,
  type WorkerQueueBatchLike,
  type WorkerRuntimeEnvBindings,
  type WorkerScheduledControllerLike,
  handleWorkerQueueBatch,
  handleWorkerScheduledSweep,
} from './jobs/cloudflare-queue.ts';
import { type JobQueueMessage } from './jobs/worker.ts';
import {
  type DistributedRateLimitBinding,
  checkDistributedRateLimit,
  runWithRateLimiters,
} from './middleware/rate-limit.ts';
import { type R2BucketLike, runWithR2Bucket } from './storage/r2.ts';
import { logOperationalMetric } from './telemetry/cloudflare-limits.ts';

export interface CloudflareWorkerEnv extends WorkerRuntimeEnvBindings {
  NODE_ENV?: string;
  APP_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
  CORS_CROSS_SITE_COOKIES?: string;
  STORAGE_PROVIDER?: string;
  LOG_OPERATIONAL_METRICS?: string;
  HYPERDRIVE?: HyperdriveBinding;
  DOCUMENTS_BUCKET?: R2BucketLike;
  AUTH_RATE_LIMITER?: DistributedRateLimitBinding;
  PUBLIC_RATE_LIMITER?: DistributedRateLimitBinding;
}

const DEFAULT_ADDRESS =
  'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

function getAllowedWorkerCorsOrigins(env: CloudflareWorkerEnv): Set<string> {
  const allowed = new Set<string>(['http://localhost:3000', 'http://127.0.0.1:3000']);
  const candidates = [env.APP_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')];
  for (const item of candidates) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (!trimmed) continue;
    try {
      allowed.add(new URL(trimmed).origin.toLowerCase());
    } catch {
      // Ignore invalid origin strings
    }
  }
  return allowed;
}

function buildWorkerHeaders(
  request: Request,
  env: CloudflareWorkerEnv,
  extraHeaders?: Record<string, string>
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    ...extraHeaders,
  });

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const normalized = new URL(origin).origin.toLowerCase();
      if (getAllowedWorkerCorsOrigins(env).has(normalized)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Credentials', 'true');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        headers.set(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With'
        );
        headers.set('Vary', 'Origin');
      }
    } catch {
      // Omit CORS allow headers for malformed origins
    }
  }

  return headers;
}

function jsonResponse(
  request: Request,
  env: CloudflareWorkerEnv,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildWorkerHeaders(request, env, extraHeaders),
  });
}

function getWorkerClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  return 'unknown';
}

function isProductionEnv(env: CloudflareWorkerEnv): boolean {
  return (env.NODE_ENV || 'production').trim().toLowerCase() === 'production';
}

export default {
  async fetch(
    request: Request,
    env: CloudflareWorkerEnv,
    ctx: WorkerExecutionContextLike
  ): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    let statusCode = 200;

    const finalize = (res: Response): Response => {
      statusCode = res.status;
      logOperationalMetric({
        runtime: 'cloudflare-worker',
        route: pathname,
        method,
        status: statusCode,
        durationMs: Math.max(0, Date.now() - started),
      });
      return res;
    };

    if (method === 'OPTIONS' && pathname.startsWith('/api')) {
      return finalize(
        new Response(null, {
          status: 204,
          headers: buildWorkerHeaders(request, env),
        })
      );
    }

    if (pathname === '/api/health' && method === 'GET') {
      return finalize(
        jsonResponse(request, env, 200, {
          status: 'ok',
          service: 'igs-ams-worker',
          runtime: 'cloudflare-workers',
          environment: env.NODE_ENV || 'production',
          timestamp: new Date().toISOString(),
        })
      );
    }

    if (pathname === '/api/health/ready' && method === 'GET') {
      if (!env.HYPERDRIVE?.connectionString) {
        return finalize(
          jsonResponse(request, env, 503, {
            status: 'degraded',
            database: 'unavailable',
            mode: 'uninitialized',
            latencyMs: Math.max(0, Date.now() - started),
            code: 'HYPERDRIVE_BINDING_MISSING',
          })
        );
      }

      const readiness = await runWithHyperdriveDatabase(
        env.HYPERDRIVE,
        () => checkDatabaseReadiness(),
        ctx.waitUntil.bind(ctx)
      ).catch(() => ({
        ready: false,
        status: 'degraded' as const,
        database: 'unavailable' as const,
        mode: 'hyperdrive' as const,
        latencyMs: Math.max(0, Date.now() - started),
        errorCode: 'DB_UNAVAILABLE',
      }));

      return finalize(
        jsonResponse(request, env, readiness.ready ? 200 : 503, {
          status: readiness.status,
          database: readiness.database,
          mode: readiness.mode,
          latencyMs: readiness.latencyMs,
          ...(readiness.errorCode ? { code: readiness.errorCode } : {}),
        })
      );
    }

    const rateBackendHeaders: Record<string, string> = {};
    if (pathname.startsWith('/api/auth/') && env.AUTH_RATE_LIMITER) {
      const rl = await checkDistributedRateLimit({
        binding: env.AUTH_RATE_LIMITER,
        key: `auth:${pathname}:${getWorkerClientIp(request)}`,
      });
      rateBackendHeaders['X-RateLimit-Backend'] = rl.backend;
      if (!rl.allowed) {
        return finalize(
          jsonResponse(
            request,
            env,
            429,
            { error: 'Too many authentication attempts. Please wait before trying again.' },
            { ...rateBackendHeaders, 'Retry-After': '60' }
          )
        );
      }
    } else if (
      (pathname.startsWith('/api/public/') || pathname === '/api/admissions/public') &&
      env.PUBLIC_RATE_LIMITER
    ) {
      const rl = await checkDistributedRateLimit({
        binding: env.PUBLIC_RATE_LIMITER,
        key: `public:${pathname}:${getWorkerClientIp(request)}`,
      });
      rateBackendHeaders['X-RateLimit-Backend'] = rl.backend;
      if (!rl.allowed) {
        return finalize(
          jsonResponse(
            request,
            env,
            429,
            { error: 'Too many requests. Please wait a moment before trying again.' },
            { ...rateBackendHeaders, 'Retry-After': '60' }
          )
        );
      }
    }

    const isPublicReadRoute =
      method === 'GET' &&
      (pathname === '/api/public/academy' ||
        pathname === '/api/public/courses' ||
        pathname.startsWith('/api/public/courses/') ||
        pathname.startsWith('/api/certificates/verify/'));

    if (!isPublicReadRoute) {
      if (!pathname.startsWith('/api')) {
        return finalize(
          jsonResponse(request, env, 404, {
            error: 'Static SPA assets must be served via Cloudflare Pages.',
            code: 'STATIC_HOSTING_REQUIRED',
          })
        );
      }

      // Routes relying on native Argon2id (>10ms Free CPU budget), PDFKit, or Express4 iconv-lite
      // are explicitly routed to the external Node.js API backend.
      const isWorkerBlockedApi =
        pathname.startsWith('/api/auth/') ||
        pathname.startsWith('/api/admissions') ||
        pathname.startsWith('/api/students') ||
        pathname.startsWith('/api/instructors') ||
        pathname.startsWith('/api/courses') ||
        pathname.startsWith('/api/batches') ||
        pathname.startsWith('/api/enrollments') ||
        pathname.startsWith('/api/sessions') ||
        pathname.startsWith('/api/attendance') ||
        pathname.startsWith('/api/grades') ||
        pathname.startsWith('/api/progress') ||
        pathname.startsWith('/api/invoices') ||
        pathname.startsWith('/api/payments') ||
        pathname.startsWith('/api/certificates') ||
        pathname.startsWith('/api/documents') ||
        pathname.startsWith('/api/reports') ||
        pathname.startsWith('/api/admin') ||
        pathname.startsWith('/api/audit-logs') ||
        pathname.startsWith('/api/notifications') ||
        pathname === '/api/dashboard' ||
        pathname.startsWith('/api/users');

      if (isWorkerBlockedApi) {
        return finalize(
          jsonResponse(
            request,
            env,
            501,
            {
              error:
                'This endpoint requires the external Node.js API backend due to Cloudflare Workers Free runtime limits (Argon2id >10ms CPU budget, PDFKit binary fonts, and Express 4 raw-body CJS shims). Configure VITE_API_BASE_URL to target the Node backend.',
              code: 'WORKER_RUNTIME_UNSUPPORTED',
              requiredBackend: 'node-express-api',
            },
            rateBackendHeaders
          )
        );
      }

      return finalize(
        jsonResponse(request, env, 404, {
          error: 'API endpoint not found.',
          code: 'API_ROUTE_NOT_FOUND',
        })
      );
    }

    try {
      const responsePayload = await runWithRateLimiters(
        {
          auth: env.AUTH_RATE_LIMITER,
          public: env.PUBLIC_RATE_LIMITER,
          runtime: 'cloudflare-worker',
        },
        () =>
          runWithR2Bucket(env.DOCUMENTS_BUCKET, () =>
            runWithHyperdriveDatabase(
              env.HYPERDRIVE,
              async (): Promise<{ status: number; body: unknown }> => {
                const isProduction = isProductionEnv(env);

                if (pathname === '/api/public/academy') {
                  const academy = await prisma.academy.findFirst({
                    orderBy: { createdAt: 'asc' },
                  });
                  const payload: PublicAcademyInfo = {
                    name: academy?.name || 'IGS — InfoCom Global Services',
                    legalName:
                      academy?.legalName || 'InfoCom Global Services — Computer Institute',
                    slogan: 'Learn Today, Build Tomorrow.',
                    address: academy?.address || DEFAULT_ADDRESS,
                    phone: academy?.phone ?? '',
                    email: academy?.email ?? '',
                    website: academy?.website ?? '',
                    logoDataUrl: academy?.logoDataUrl ?? '',
                    timezone: academy?.timezone || 'Asia/Kolkata',
                    currency: academy?.currency || 'INR',
                  };
                  return { status: 200, body: payload };
                }

                if (pathname === '/api/public/courses') {
                  const [academy, courses] = await Promise.all([
                    prisma.academy.findFirst({
                      orderBy: { createdAt: 'asc' },
                      select: { currency: true },
                    }),
                    prisma.course.findMany({
                      where: {
                        isPublished: true,
                        isArchived: false,
                        ...(isProduction ? { isDemo: false } : {}),
                      },
                      orderBy: [{ createdAt: 'asc' }],
                      include: {
                        department: { select: { name: true } },
                        modules: { orderBy: { sortOrder: 'asc' } },
                        batches: {
                          where: { status: { in: ['Planned', 'Active'] } },
                          orderBy: { startDate: 'asc' },
                        },
                      },
                    }),
                  ]);

                  const currency = academy?.currency || 'INR';
                  const items: PublicCourseSummary[] = courses.map((course) => ({
                    id: course.id,
                    code: course.code,
                    slug: course.slug || slugifyCourseTitle(course.title),
                    title: course.title,
                    track: course.track,
                    category: course.category,
                    departmentName: course.department?.name ?? null,
                    description: course.description,
                    durationWeeks: course.durationWeeks,
                    tuitionFee: course.showTuitionPublicly
                      ? course.tuitionFee.toFixed(2)
                      : null,
                    showTuitionPublicly: course.showTuitionPublicly,
                    isDemo: !isProduction ? course.isDemo : false,
                    currency,
                    moduleCount: course.modules.length,
                    totalLabHours: course.modules.reduce((acc, m) => acc + m.labHours, 0),
                    activeCohorts: course.batches.map((b) => ({
                      id: b.id,
                      code: b.code,
                      name: b.name,
                      status: b.status as CohortStatus,
                      startDate: b.startDate.toISOString(),
                      endDate: b.endDate.toISOString(),
                      capacity: b.capacity,
                    })),
                  }));

                  return {
                    status: 200,
                    body: {
                      courses: items,
                      currency,
                      isDemoEnvironment: false,
                    },
                  };
                }

                if (pathname.startsWith('/api/public/courses/')) {
                  const slugOrId = decodeURIComponent(
                    pathname.slice('/api/public/courses/'.length)
                  ).trim();
                  if (!slugOrId) {
                    return { status: 400, body: { error: 'Course identifier is required.' } };
                  }
                  const [academy, course] = await Promise.all([
                    prisma.academy.findFirst({
                      orderBy: { createdAt: 'asc' },
                      select: { currency: true },
                    }),
                    prisma.course.findFirst({
                      where: {
                        isPublished: true,
                        isArchived: false,
                        ...(isProduction ? { isDemo: false } : {}),
                        OR: [{ slug: slugOrId }, { id: slugOrId }],
                      },
                      include: {
                        department: { select: { name: true } },
                        modules: { orderBy: { sortOrder: 'asc' } },
                        batches: {
                          where: { status: { in: ['Planned', 'Active'] } },
                          orderBy: { startDate: 'asc' },
                        },
                      },
                    }),
                  ]);
                  if (!course) {
                    return { status: 404, body: { error: 'Published program not found.' } };
                  }

                  const currency = academy?.currency || 'INR';
                  const objectives = Array.isArray(course.learningObjectives)
                    ? course.learningObjectives.filter(
                        (o): o is string => typeof o === 'string'
                      )
                    : [];

                  const detail: PublicCourseDetail = {
                    id: course.id,
                    code: course.code,
                    slug: course.slug || slugifyCourseTitle(course.title),
                    title: course.title,
                    track: course.track,
                    category: course.category,
                    departmentName: course.department?.name ?? null,
                    description: course.description,
                    prerequisites: course.prerequisites,
                    learningObjectives: objectives,
                    durationWeeks: course.durationWeeks,
                    tuitionFee: course.showTuitionPublicly
                      ? course.tuitionFee.toFixed(2)
                      : null,
                    showTuitionPublicly: course.showTuitionPublicly,
                    isDemo: !isProduction ? course.isDemo : false,
                    currency,
                    moduleCount: course.modules.length,
                    totalLabHours: course.modules.reduce((acc, m) => acc + m.labHours, 0),
                    modules: course.modules.map((m) => ({
                      id: m.id,
                      code: m.code,
                      title: m.title,
                      weight: m.weight,
                      labHours: m.labHours,
                      sortOrder: m.sortOrder,
                    })),
                    activeCohorts: course.batches.map((b) => ({
                      id: b.id,
                      code: b.code,
                      name: b.name,
                      status: b.status as CohortStatus,
                      startDate: b.startDate.toISOString(),
                      endDate: b.endDate.toISOString(),
                      capacity: b.capacity,
                    })),
                  };

                  return {
                    status: 200,
                    body: { course: detail, isDemoEnvironment: false },
                  };
                }

                // GET /api/certificates/verify/:code
                const rawCode = decodeURIComponent(
                  pathname.slice('/api/certificates/verify/'.length)
                ).trim();
                if (!rawCode) {
                  return { status: 400, body: { error: 'Verification code is required.' } };
                }
                const cert = await prisma.certificate.findFirst({
                  where: {
                    OR: [
                      { certificateCode: { equals: rawCode, mode: 'insensitive' } },
                      { verificationHash: { equals: rawCode, mode: 'insensitive' } },
                    ],
                  },
                  include: {
                    student: { select: { name: true, studentCode: true } },
                    course: { select: { code: true, title: true } },
                  },
                });
                if (!cert) {
                  return {
                    status: 404,
                    body: { error: 'No certificate matched that verification code or hash.' },
                  };
                }
                return {
                  status: 200,
                  body: {
                    certificate: {
                      certificateCode: cert.certificateCode,
                      verificationHash: cert.verificationHash,
                      studentName: cert.student?.name ?? 'Student',
                      studentCode: cert.student?.studentCode ?? '',
                      courseCode: cert.course?.code ?? '',
                      courseTitle: cert.courseTitleSnapshot ?? cert.course?.title ?? '',
                      finalScore: cert.finalScore.toFixed(2),
                      letterGrade: cert.letterGrade,
                      attendanceRate: cert.attendanceRate,
                      issuedByName: cert.issuedByName,
                      status: cert.status,
                      revokedReason: cert.revokedReason,
                      issuedAt: cert.issuedAt.toISOString(),
                    },
                  },
                };
              },
              ctx.waitUntil.bind(ctx)
            )
          )
      );

      return finalize(
        jsonResponse(request, env, responsePayload.status, responsePayload.body, rateBackendHeaders)
      );
    } catch (err) {
      if (err instanceof HyperdriveConfigurationError) {
        return finalize(
          jsonResponse(
            request,
            env,
            503,
            {
              error: 'Database binding is unconfigured on this Worker.',
              code: err.code,
            },
            rateBackendHeaders
          )
        );
      }
      console.error('Worker request error:', err);
      return finalize(
        jsonResponse(
          request,
          env,
          500,
          { error: 'An internal server error occurred.' },
          rateBackendHeaders
        )
      );
    }
  },

  async queue(
    batch: WorkerQueueBatchLike<JobQueueMessage>,
    env: CloudflareWorkerEnv,
    ctx: WorkerExecutionContextLike
  ): Promise<void> {
    await handleWorkerQueueBatch(batch, env, ctx);
  },

  async scheduled(
    controller: WorkerScheduledControllerLike,
    env: CloudflareWorkerEnv,
    ctx: WorkerExecutionContextLike
  ): Promise<void> {
    await handleWorkerScheduledSweep(controller, env, ctx);
  },
};
