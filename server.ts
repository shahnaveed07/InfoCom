import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { runSessionReminderSweep } from './server/ams-service.ts';
import { createApiApp } from './server/app.ts';
import { disconnectPrisma } from './server/db/prisma.ts';

const PORT = 3000;

async function startServer() {
  const app = createApiApp();

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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`InfoCom Academy Management System listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
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
