import express from 'express';
import {
  createSafeCorsMiddleware,
  csrfOriginGuard,
  safeApiErrorHandler,
  securityHeaders,
} from './middleware/security.ts';
import { academicsRouter } from './routes/academics.routes.ts';
import { adminMasterRouter } from './routes/admin-master.routes.ts';
import { adminOpsRouter } from './routes/admin-ops.routes.ts';
import { authRouter } from './routes/auth.routes.ts';

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use('/api', createSafeCorsMiddleware());
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', csrfOriginGuard);
  app.use('/api', authRouter);
  app.use('/api', academicsRouter);
  app.use('/api', adminOpsRouter);
  app.use('/api', adminMasterRouter);

  app.use('/api', safeApiErrorHandler);
  return app;
}
