import path from 'node:path';
import express from 'express';
import { createApiApp } from './server/app.ts';
import { disconnectPrisma } from './server/db/prisma.ts';
import { startBackgroundWorker, stopBackgroundWorker } from './server/jobs/worker.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = createApiApp();

  // Persistent PostgreSQL background worker (email notifications + session reminders)
  startBackgroundWorker(30_000);

  // Frontend serving (Vite dev middleware in development, static dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IGS — InfoCom Global Services AMS listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    stopBackgroundWorker();
    server.close();
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
