import express from 'express';
import { resolveAppEnvironment } from './db/config.ts';
import { checkDatabaseReadiness } from './db/prisma.ts';
import {
  createSafeCorsMiddleware,
  csrfOriginGuard,
  safeApiErrorHandler,
  securityHeaders,
} from './middleware/security.ts';
import { academicsRouter } from './routes/academics.routes.ts';
import { adminMasterRouter } from './routes/admin-master.routes.ts';
import { adminOpsRouter } from './routes/admin-ops.routes.ts';
import { admissionsRouter } from './routes/admissions.routes.ts';
import { authRouter } from './routes/auth.routes.ts';
import { financeRouter } from './routes/finance.routes.ts';
import { publicRouter } from './routes/public.routes.ts';
import { reportsRouter } from './routes/reports.routes.ts';

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use('/api', createSafeCorsMiddleware());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'igs-ams-api',
      environment: resolveAppEnvironment(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const readiness = await checkDatabaseReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.status,
      database: readiness.database,
      mode: readiness.mode,
      latencyMs: readiness.latencyMs,
      ...(readiness.errorCode ? { code: readiness.errorCode } : {}),
    });
  });

  app.use('/api', csrfOriginGuard);
  app.use('/api/public', publicRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', authRouter);
  app.use('/api', admissionsRouter);
  app.use('/api', academicsRouter);
  app.use('/api', adminOpsRouter);
  app.use('/api', adminMasterRouter);
  app.use('/api', financeRouter);

  // Never allow unmatched /api/* paths to fall through to Vite/SPA index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'API_ROUTE_NOT_FOUND',
    });
  });

  app.use('/api', safeApiErrorHandler);
  return app;
}
