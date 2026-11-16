import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import {
  E2E_ADMIN_PASSWORD,
  E2E_DB_NAME,
  E2E_INSTRUCTOR_PASSWORD,
  E2E_OTHER_COURSE_ID,
  E2E_PROD_REAL_COURSE_ID,
  E2E_PROD_REAL_COURSE_SLUG,
  E2E_STUDENT_PASSWORD,
  buildE2eProcessEnv,
  getAdminControlPool,
} from './helpers/db-env.ts';

function buildTargetPool(e2eEnv: Record<string, string>): Pool {
  if (e2eEnv.SQL_HOST && e2eEnv.SQL_DB_NAME) {
    return new Pool({
      host: e2eEnv.SQL_HOST,
      user: e2eEnv.SQL_USER,
      password: e2eEnv.SQL_PASSWORD,
      database: E2E_DB_NAME,
      max: 4,
    });
  }
  return new Pool({
    connectionString: e2eEnv.DATABASE_URL,
    max: 4,
  });
}

export default async function globalSetup() {
  const { pool: controlPool, targetDbName } = getAdminControlPool();
  try {
    await controlPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDbName]
    );
    await controlPool.query(`DROP DATABASE IF EXISTS "${targetDbName}"`);
    await controlPool.query(`CREATE DATABASE "${targetDbName}"`);
  } finally {
    await controlPool.end();
  }

  const e2eEnv = buildE2eProcessEnv();

  // Ensure Prisma client is generated & schema migrations are applied to the clean E2E DB
  execFileSync('npx', ['tsx', 'scripts/prisma-run.ts', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...e2eEnv, NODE_ENV: 'development' },
  });

  // Seed production foundation + official IGS dev demo dataset using explicit env secrets
  execFileSync('npx', ['tsx', 'prisma/seed-demo.ts'], {
    stdio: 'inherit',
    env: {
      ...e2eEnv,
      NODE_ENV: 'development',
      ALLOW_DEMO_SEED: 'true',
      SEED_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SEED_INSTRUCTOR_PASSWORD: E2E_INSTRUCTOR_PASSWORD,
      SEED_STUDENT_PASSWORD: E2E_STUDENT_PASSWORD,
    },
  });

  // Add one non-demo published course (visible in production build checks) and one unrelated instructor course
  const pool = buildTargetPool(e2eEnv);
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.course.upsert({
      where: { id: E2E_PROD_REAL_COURSE_ID },
      update: { isPublished: true, isDemo: false, isArchived: false },
      create: {
        id: E2E_PROD_REAL_COURSE_ID,
        code: 'IGS-401',
        slug: E2E_PROD_REAL_COURSE_SLUG,
        title: 'Applied Cloud Systems Architecture',
        track: 'Cloud & Systems',
        category: 'Diploma Track',
        departmentId: 'dept-swe-dev',
        instructorId: 'inst-elena',
        durationWeeks: 16,
        tuitionFee: '18500.00',
        description:
          'Admin-published production program covering Linux systems, containers, PostgreSQL operations, and cloud deployment architecture.',
        prerequisites: 'Programming Fundamentals or Web Development.',
        learningObjectives: [
          'Deploy containerized full-stack services with automated health checks.',
          'Administer relational databases with verified backups and migrations.',
        ],
        gradingConfig: { scaleName: 'Standard IGS Scale', passingGrade: 'D (60%+)' },
        passingScore: 60,
        minAttendanceRate: 75,
        isPublished: true,
        showTuitionPublicly: true,
        isDemo: false,
        isArchived: false,
      },
    });

    await prisma.courseModule.upsert({
      where: { id: 'mod-e2e-real-1' },
      update: {},
      create: {
        id: 'mod-e2e-real-1',
        courseId: E2E_PROD_REAL_COURSE_ID,
        code: 'MOD-1',
        title: 'Linux, Containers & PostgreSQL Operations',
        weight: 100,
        labHours: 24,
        sortOrder: 1,
      },
    });

    await prisma.course.upsert({
      where: { id: E2E_OTHER_COURSE_ID },
      update: { isPublished: false, isDemo: false, isArchived: false },
      create: {
        id: E2E_OTHER_COURSE_ID,
        code: 'IGS-499',
        slug: 'internal-bi-analytics-other',
        title: 'Internal BI & Predictive Modeling',
        track: 'Data Engineering',
        category: 'Core Track',
        departmentId: 'dept-data-ai',
        instructorId: 'inst-david',
        durationWeeks: 10,
        tuitionFee: '11000.00',
        description: 'Course owned exclusively by Prof. David Okonkwo for RBAC isolation verification.',
        isPublished: false,
        showTuitionPublicly: false,
        isDemo: false,
        isArchived: false,
      },
    });

    await prisma.courseModule.upsert({
      where: { id: 'mod-e2e-other-1' },
      update: {},
      create: {
        id: 'mod-e2e-other-1',
        courseId: E2E_OTHER_COURSE_ID,
        code: 'MOD-1',
        title: 'Restricted Faculty Module',
        weight: 100,
        labHours: 12,
        sortOrder: 1,
      },
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
