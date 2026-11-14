import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { runSessionReminderSweep } from './server/ams-service.ts';
import { academicsRouter } from './server/routes/academics.routes.ts';
import { adminOpsRouter } from './server/routes/admin-ops.routes.ts';
import { authRouter } from './server/routes/auth.routes.ts';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Mount modular REST API routers (backed by PostgreSQL + Drizzle ORM)
  app.use('/api', authRouter);
  app.use('/api', academicsRouter);
  app.use('/api', adminOpsRouter);

  // Periodic 5-minute automated reminder sweep (lazy, catches any transient DB error)
  setInterval(() => {
    runSessionReminderSweep().catch((err) => {
      console.error('Background session reminder sweep error:', err);
    });
  }, 5 * 60 * 1000);

  // Frontend serving (Vite dev middleware in development, static dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`InfoCom Academy Management System listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
