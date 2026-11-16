import { Router } from 'express';
import { slugifyCourseTitle } from '../../src/shared/academic.ts';
import type {
  CohortStatus,
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
} from '../../src/shared/types.ts';
import { prisma } from '../db/prisma.ts';

export const publicRouter = Router();

const DEFAULT_ADDRESS =
  'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

publicRouter.get('/academy', async (_req, res) => {
  try {
    const academy = await prisma.academy.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    const payload: PublicAcademyInfo = {
      name: academy?.name || 'IGS — InfoCom Global Services',
      legalName: academy?.legalName || 'InfoCom Global Services — Computer Institute',
      slogan: 'Learn Today, Build Tomorrow.',
      address: academy?.address || DEFAULT_ADDRESS,
      phone: academy?.phone ?? '',
      email: academy?.email ?? '',
      website: academy?.website ?? '',
      logoDataUrl: academy?.logoDataUrl ?? '',
      timezone: academy?.timezone || 'Asia/Kolkata',
      currency: academy?.currency || 'INR',
    };

    res.json(payload);
  } catch (err) {
    console.error('Public academy endpoint failed:', err);
    res.status(500).json({ error: 'Unable to load institute overview.' });
  }
});

publicRouter.get('/courses', async (_req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const [academy, courses] = await Promise.all([
      prisma.academy.findFirst({ orderBy: { createdAt: 'asc' }, select: { currency: true } }),
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
      tuitionFee: course.showTuitionPublicly ? course.tuitionFee.toFixed(2) : null,
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

    const isDemoEnvironment =
      !isProduction &&
      process.env.NODE_ENV === 'development' &&
      items.some((c) => Boolean(c.isDemo));

    res.json({ courses: items, currency, isDemoEnvironment });
  } catch (err) {
    console.error('Public courses listing failed:', err);
    res.status(500).json({ error: 'Unable to load published course catalog.' });
  }
});

publicRouter.get('/courses/:slugOrId', async (req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const param = String(req.params.slugOrId || '').trim();
    if (!param) {
      res.status(400).json({ error: 'Course identifier is required.' });
      return;
    }

    const [academy, course, demoCount] = await Promise.all([
      prisma.academy.findFirst({ orderBy: { createdAt: 'asc' }, select: { currency: true } }),
      prisma.course.findFirst({
        where: {
          isPublished: true,
          isArchived: false,
          ...(isProduction ? { isDemo: false } : {}),
          OR: [{ slug: param }, { id: param }],
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
      isProduction
        ? Promise.resolve(0)
        : prisma.course.count({ where: { isPublished: true, isArchived: false, isDemo: true } }),
    ]);

    if (!course) {
      res.status(404).json({ error: 'Published program not found.' });
      return;
    }

    const currency = academy?.currency || 'INR';
    const objectives = Array.isArray(course.learningObjectives)
      ? course.learningObjectives.filter((o): o is string => typeof o === 'string')
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
      tuitionFee: course.showTuitionPublicly ? course.tuitionFee.toFixed(2) : null,
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

    const isDemoEnvironment =
      !isProduction &&
      process.env.NODE_ENV === 'development' &&
      (Boolean(course.isDemo) || demoCount > 0);

    res.json({ course: detail, isDemoEnvironment });
  } catch (err) {
    console.error('Public course detail failed:', err);
    res.status(500).json({ error: 'Unable to load program details.' });
  }
});
