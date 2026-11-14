import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { buildPgPoolConfig } from './config.ts';

declare global {
  var _prismaPool: Pool | undefined;
  var _prismaClient: PrismaClient | undefined;
}

export function getPrismaPool(): Pool {
  if (!global._prismaPool) {
    const pool = new Pool(buildPgPoolConfig({ admin: false }));
    pool.on('error', (err) => {
      console.error('Unexpected idle PostgreSQL pool client error:', err);
    });
    global._prismaPool = pool;
  }
  return global._prismaPool;
}

export function getPrismaClient(): PrismaClient {
  if (!global._prismaClient) {
    const adapter = new PrismaPg(getPrismaPool());
    global._prismaClient = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return global._prismaClient;
}

export const prisma = getPrismaClient();

export async function disconnectPrisma(): Promise<void> {
  if (global._prismaClient) {
    await global._prismaClient.$disconnect();
    global._prismaClient = undefined;
  }
  if (global._prismaPool) {
    await global._prismaPool.end();
    global._prismaPool = undefined;
  }
}
