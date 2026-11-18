import { slugifyCourseTitle } from '../../src/shared/academic.ts';
import type {
  CohortStatus,
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
} from '../../src/shared/types.ts';
import {
  d1All,
  d1First,
  sqlBool,
  sqlFixed,
  sqlJson,
} from '../d1/client.ts';
import { verifyCertificateByCodeD1 } from '../d1/ams-service.ts';
import { isProductionEnv, type WorkerRouteEntry } from '../worker-router.ts';

const DEFAULT_ADDRESS =
  'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

export const workerPublicRoutes: WorkerRouteEntry[] = [
  {
    method: 'GET',
    pattern: '/api/public/academy',
    auth: 'none',
    handler: async (c) => {
      const academy = await d1First<Record<string, unknown>>(
        'SELECT * FROM academies ORDER BY created_at ASC LIMIT 1',
        [],
        c.db
      );
      const payload: PublicAcademyInfo = {
        name: academy?.name ? String(academy.name) : 'IGS — InfoCom Global Services',
        legalName: academy?.legal_name
          ? String(academy.legal_name)
          : 'InfoCom Global Services — Computer Institute',
        slogan: 'Learn Today, Build Tomorrow.',
        address: academy?.address ? String(academy.address) : DEFAULT_ADDRESS,
        phone: academy?.phone ? String(academy.phone) : '',
        email: academy?.email ? String(academy.email) : '',
        website: academy?.website ? String(academy.website) : '',
        logoDataUrl: academy?.logo_data_url ? String(academy.logo_data_url) : '',
        timezone: academy?.timezone ? String(academy.timezone) : 'Asia/Kolkata',
        currency: academy?.currency ? String(academy.currency) : 'INR',
      };
      return c.json(200, payload);
    },
  },
  {
    method: 'GET',
    pattern: '/api/public/courses',
    auth: 'none',
    handler: async (c) => {
      const isProduction = isProductionEnv(c.env);
      const [academy, courses, departments, modules, batches] = await Promise.all([
        d1First<{ currency: string }>(
          'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
          [],
          c.db
        ),
        d1All<Record<string, unknown>>(
          `SELECT * FROM courses
           WHERE is_published = 1 AND is_archived = 0 ${isProduction ? 'AND is_demo = 0' : ''}
           ORDER BY created_at ASC`,
          [],
          c.db
        ),
        d1All<{ id: string; name: string }>('SELECT id, name FROM departments', [], c.db),
        d1All<Record<string, unknown>>(
          'SELECT id, course_id, lab_hours FROM course_modules ORDER BY sort_order ASC',
          [],
          c.db
        ),
        d1All<Record<string, unknown>>(
          "SELECT * FROM cohorts WHERE status IN ('Planned', 'Active') ORDER BY start_date ASC",
          [],
          c.db
        ),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d.name]));
      const currency = academy?.currency || 'INR';

      const items: PublicCourseSummary[] = courses.map((course) => {
        const cid = String(course.id);
        const courseModules = modules.filter((m) => String(m.course_id) === cid);
        const courseBatches = batches.filter((b) => String(b.course_id) === cid);
        const showTuition = sqlBool(course.show_tuition_publicly);
        const title = String(course.title);
        return {
          id: cid,
          code: String(course.code),
          slug: course.slug ? String(course.slug) : slugifyCourseTitle(title),
          title,
          track: String(course.track),
          category: String(course.category ?? 'Technical Bootcamp'),
          departmentName: course.department_id
            ? deptMap.get(String(course.department_id)) ?? null
            : null,
          description: String(course.description ?? ''),
          durationWeeks: Number(course.duration_weeks ?? 8),
          tuitionFee: showTuition ? sqlFixed(course.tuition_fee) : null,
          showTuitionPublicly: showTuition,
          isDemo: !isProduction ? sqlBool(course.is_demo) : false,
          currency,
          moduleCount: courseModules.length,
          totalLabHours: courseModules.reduce((acc, m) => acc + Number(m.lab_hours ?? 0), 0),
          activeCohorts: courseBatches.map((b) => ({
            id: String(b.id),
            code: String(b.code),
            name: String(b.name),
            status: String(b.status) as CohortStatus,
            startDate: String(b.start_date),
            endDate: String(b.end_date),
            capacity: Number(b.capacity ?? 24),
          })),
        };
      });

      const isDemoEnvironment =
        !isProduction &&
        (c.env.NODE_ENV || '').toLowerCase() === 'development' &&
        items.some((course) => Boolean(course.isDemo));

      return c.json(200, { courses: items, currency, isDemoEnvironment });
    },
  },
  {
    method: 'GET',
    pattern: '/api/public/courses/:slugOrId',
    auth: 'none',
    handler: async (c) => {
      const isProduction = isProductionEnv(c.env);
      const param = String(c.params.slugOrId || '').trim();
      if (!param) {
        return c.json(400, { error: 'Course identifier is required.' });
      }

      const [academy, course, demoCountRow] = await Promise.all([
        d1First<{ currency: string }>(
          'SELECT currency FROM academies ORDER BY created_at ASC LIMIT 1',
          [],
          c.db
        ),
        d1First<Record<string, unknown>>(
          `SELECT * FROM courses
           WHERE is_published = 1 AND is_archived = 0 ${isProduction ? 'AND is_demo = 0' : ''}
             AND (slug = ? OR id = ?)
           LIMIT 1`,
          [param, param],
          c.db
        ),
        isProduction
          ? Promise.resolve({ total: 0 })
          : d1First<{ total: number }>(
              'SELECT COUNT(*) AS total FROM courses WHERE is_published = 1 AND is_archived = 0 AND is_demo = 1',
              [],
              c.db
            ),
      ]);

      if (!course) {
        return c.json(404, { error: 'Published program not found.' });
      }

      const cid = String(course.id);
      const [dept, modules, batches] = await Promise.all([
        course.department_id
          ? d1First<{ name: string }>(
              'SELECT name FROM departments WHERE id = ? LIMIT 1',
              [String(course.department_id)],
              c.db
            )
          : Promise.resolve(null),
        d1All<Record<string, unknown>>(
          'SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC',
          [cid],
          c.db
        ),
        d1All<Record<string, unknown>>(
          "SELECT * FROM cohorts WHERE course_id = ? AND status IN ('Planned', 'Active') ORDER BY start_date ASC",
          [cid],
          c.db
        ),
      ]);

      const currency = academy?.currency || 'INR';
      const showTuition = sqlBool(course.show_tuition_publicly);
      const title = String(course.title);
      const objectives = sqlJson<unknown[]>(course.learning_objectives, []).filter(
        (o): o is string => typeof o === 'string'
      );

      const detail: PublicCourseDetail = {
        id: cid,
        code: String(course.code),
        slug: course.slug ? String(course.slug) : slugifyCourseTitle(title),
        title,
        track: String(course.track),
        category: String(course.category ?? 'Technical Bootcamp'),
        departmentName: dept?.name ?? null,
        description: String(course.description ?? ''),
        prerequisites: String(course.prerequisites ?? ''),
        learningObjectives: objectives,
        durationWeeks: Number(course.duration_weeks ?? 8),
        tuitionFee: showTuition ? sqlFixed(course.tuition_fee) : null,
        showTuitionPublicly: showTuition,
        isDemo: !isProduction ? sqlBool(course.is_demo) : false,
        currency,
        moduleCount: modules.length,
        totalLabHours: modules.reduce((acc, m) => acc + Number(m.lab_hours ?? 0), 0),
        modules: modules.map((m) => ({
          id: String(m.id),
          code: String(m.code),
          title: String(m.title),
          weight: Number(m.weight ?? 0),
          labHours: Number(m.lab_hours ?? 0),
          sortOrder: Number(m.sort_order ?? 1),
        })),
        activeCohorts: batches.map((b) => ({
          id: String(b.id),
          code: String(b.code),
          name: String(b.name),
          status: String(b.status) as CohortStatus,
          startDate: String(b.start_date),
          endDate: String(b.end_date),
          capacity: Number(b.capacity ?? 24),
        })),
      };

      const isDemoEnvironment =
        !isProduction &&
        (c.env.NODE_ENV || '').toLowerCase() === 'development' &&
        (detail.isDemo || Number(demoCountRow?.total ?? 0) > 0);

      return c.json(200, { course: detail, isDemoEnvironment });
    },
  },
  {
    method: 'GET',
    pattern: '/api/certificates/verify/:code',
    auth: 'none',
    handler: async (c) => {
      const rawCode = String(c.params.code || '').trim();
      if (!rawCode) {
        return c.json(400, { error: 'Verification code is required.' });
      }
      const cert = await verifyCertificateByCodeD1(rawCode, c.db);
      if (!cert) {
        return c.json(404, {
          error: 'No certificate matched that verification code or hash.',
        });
      }
      return c.json(200, { certificate: cert });
    },
  },
];
