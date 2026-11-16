import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_PUBLIC_ACADEMY,
  DEMO_PUBLIC_COURSES,
  findDemoCourseBySlugOrId,
  getDemoCourseSummaries,
} from '../shared/demo-public-data';
import {
  ApiError,
  api,
  isBackendUnavailableError,
  resolveApiBaseUrl,
  resolveApiUrl,
} from './api';
import {
  fetchPublicAcademyWithFallback,
  fetchPublicAdmissionCatalogWithFallback,
  fetchPublicCatalogWithFallback,
  fetchPublicCourseDetailWithFallback,
  publicSiteStore,
  resolvePublicDataConfig,
} from './public-data';

test('API URL resolution defaults to same-origin relative /api/* and supports VITE_API_BASE_URL', () => {
  const prevBase = process.env.VITE_API_BASE_URL;
  try {
    delete process.env.VITE_API_BASE_URL;
    assert.equal(resolveApiBaseUrl(), '');
    assert.equal(resolveApiUrl('/api/public/courses'), '/api/public/courses');
    assert.equal(resolveApiUrl('api/health'), '/api/health');

    process.env.VITE_API_BASE_URL = 'https://api.igs-sopore.example.com/';
    assert.equal(resolveApiBaseUrl(), 'https://api.igs-sopore.example.com');
    assert.equal(
      resolveApiUrl('/api/public/courses'),
      'https://api.igs-sopore.example.com/api/public/courses'
    );
    assert.equal(
      resolveApiUrl('https://other.example.com/health'),
      'https://other.example.com/health'
    );
  } finally {
    if (prevBase === undefined) delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL = prevBase;
  }
});

test('Public data mode and fallback flag resolve from env with auto/true defaults', () => {
  const prevMode = process.env.VITE_PUBLIC_DATA_MODE;
  const prevFallback = process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK;
  try {
    delete process.env.VITE_PUBLIC_DATA_MODE;
    delete process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK;
    assert.deepEqual(resolvePublicDataConfig(), { mode: 'auto', fallbackEnabled: true });

    process.env.VITE_PUBLIC_DATA_MODE = 'demo';
    process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK = 'false';
    assert.deepEqual(resolvePublicDataConfig(), { mode: 'demo', fallbackEnabled: false });

    process.env.VITE_PUBLIC_DATA_MODE = 'api';
    assert.deepEqual(resolvePublicDataConfig(), { mode: 'api', fallbackEnabled: false });
  } finally {
    if (prevMode === undefined) delete process.env.VITE_PUBLIC_DATA_MODE;
    else process.env.VITE_PUBLIC_DATA_MODE = prevMode;
    if (prevFallback === undefined) delete process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK;
    else process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK = prevFallback;
  }
});

test('Demo public catalog contains official IGS branding and all 7 courses', () => {
  assert.equal(DEMO_PUBLIC_ACADEMY.name, 'IGS — InfoCom Global Services');
  assert.equal(DEMO_PUBLIC_ACADEMY.slogan, 'Learn Today, Build Tomorrow.');
  assert.equal(DEMO_PUBLIC_ACADEMY.currency, 'INR');
  assert.equal(DEMO_PUBLIC_COURSES.length, 7);
  assert.equal(getDemoCourseSummaries().length, 7);

  const pythonCourse = findDemoCourseBySlugOrId('python-programming');
  assert.ok(pythonCourse);
  assert.equal(pythonCourse.code, 'IGS-203');
  assert.ok(pythonCourse.modules.length >= 2);
  assert.equal(findDemoCourseBySlugOrId('nonexistent-course-xyz'), null);
});

test('ApiError classifies network failures, HTML 404, 503 DB degraded, invalid JSON, and genuine JSON 404', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. Network error
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      () => api.getPublicCourses(),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'network_error' &&
        err.isNetworkError === true &&
        isBackendUnavailableError(err)
    );

    // 2. Static hosting HTML 404
    globalThis.fetch = async () =>
      new Response('<!doctype html><html><body>Not Found</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    await assert.rejects(
      () => api.getPublicCourses(),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'api_route_missing' &&
        err.isHtmlResponse === true &&
        err.status === 404 &&
        isBackendUnavailableError(err)
    );

    // 3. SPA HTML 200 fallback on API endpoint
    globalThis.fetch = async () =>
      new Response('<!doctype html><html><div id="root"></div></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    await assert.rejects(
      () => api.getPublicCourses(),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'html_fallback' &&
        err.isHtmlResponse === true &&
        isBackendUnavailableError(err)
    );

    // 4. 503 DB unavailable
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: 'degraded', database: 'unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    await assert.rejects(
      () => api.getPublicCourses(),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'database_unavailable' &&
        err.status === 503 &&
        isBackendUnavailableError(err)
    );

    // 5. Malformed JSON
    globalThis.fetch = async () =>
      new Response('{not-valid-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await assert.rejects(
      () => api.getPublicCourses(),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'invalid_response' &&
        isBackendUnavailableError(err)
    );

    // 6. Genuine JSON 404 for unknown course slug (NOT backend unavailable)
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Published program not found.' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    await assert.rejects(
      () => api.getPublicCourseDetail('unknown-slug-xyz'),
      (err: unknown) =>
        err instanceof ApiError &&
        err.kind === 'not_found' &&
        err.status === 404 &&
        !isBackendUnavailableError(err)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scenarios A–H: API-first public catalog & course detail fallback semantics', async () => {
  const silenced = () => undefined;

  // Scenario A: Backend online + database ready -> live data
  const liveCourse = {
    ...getDemoCourseSummaries()[0],
    id: 'crs-live-1',
    code: 'LIVE-101',
    slug: 'live-course',
    title: 'Live Admin Course',
    isDemo: false,
  };
  const liveCatalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => ({
        courses: [liveCourse],
        currency: 'INR',
        isDemoEnvironment: false,
      }),
      onWarning: silenced,
    },
  });
  assert.equal(liveCatalog.source, 'live');
  assert.equal(liveCatalog.courses.length, 1);
  assert.equal(liveCatalog.courses[0].slug, 'live-course');

  // Scenario B: Backend online + database down (503 degraded) -> demo fallback
  const dbDownCatalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => {
        throw new ApiError('Service unavailable', {
          status: 503,
          contentType: 'application/json',
          code: 'DATABASE_UNAVAILABLE',
          kind: 'database_unavailable',
        });
      },
      getReadiness: async () => ({
        backendReachable: true,
        databaseReady: false,
        status: 'degraded',
      }),
      onWarning: silenced,
    },
  });
  assert.equal(dbDownCatalog.source, 'demo');
  assert.equal(dbDownCatalog.courses.length, 7);
  assert.equal(dbDownCatalog.readiness.status, 'degraded');

  // Scenario C: Backend offline -> demo fallback
  const offlineCatalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => {
        throw new ApiError('Network down', {
          status: 0,
          contentType: '',
          code: 'NETWORK_ERROR',
          kind: 'network_error',
          isNetworkError: true,
        });
      },
      getReadiness: async () => ({
        backendReachable: false,
        databaseReady: false,
        status: 'offline',
      }),
      onWarning: silenced,
    },
  });
  assert.equal(offlineCatalog.source, 'demo');
  assert.equal(offlineCatalog.courses.length, 7);

  // Scenario D: API returns HTML 404 -> demo fallback
  const html404Catalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => {
        throw new ApiError('HTML 404', {
          status: 404,
          contentType: 'text/html',
          code: 'HOSTING_HTML_404',
          kind: 'api_route_missing',
          isHtmlResponse: true,
        });
      },
      getReadiness: async () => ({
        backendReachable: false,
        databaseReady: false,
        status: 'offline',
      }),
      onWarning: silenced,
    },
  });
  assert.equal(html404Catalog.source, 'demo');
  assert.equal(html404Catalog.courses.length, 7);

  // Scenario E: Genuine unknown course JSON 404 -> NEVER falls back to demo
  await assert.rejects(
    () =>
      fetchPublicCourseDetailWithFallback('python-programming', {
        config: { mode: 'auto', fallbackEnabled: true },
        deps: {
          getPublicCourseDetail: async () => {
            throw new ApiError('Published program not found.', {
              status: 404,
              contentType: 'application/json',
              code: 'NOT_FOUND',
              kind: 'not_found',
            });
          },
          onWarning: silenced,
        },
      }),
    (err: unknown) => err instanceof ApiError && err.kind === 'not_found'
  );

  // Also offline unknown course slug must reject with not_found (never substitute wrong course)
  await assert.rejects(
    () =>
      fetchPublicCourseDetailWithFallback('unknown-slug-999', {
        config: { mode: 'auto', fallbackEnabled: true },
        deps: {
          getPublicCourseDetail: async () => {
            throw new ApiError('Network down', {
              status: 0,
              contentType: '',
              code: 'NETWORK_ERROR',
              kind: 'network_error',
              isNetworkError: true,
            });
          },
          onWarning: silenced,
        },
      }),
    (err: unknown) => err instanceof ApiError && err.kind === 'not_found'
  );

  // Offline matching demo course slug resolves clean demo syllabus
  const offlineCourseDetail = await fetchPublicCourseDetailWithFallback('python-programming', {
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourseDetail: async () => {
        throw new ApiError('Network down', {
          status: 0,
          contentType: '',
          code: 'NETWORK_ERROR',
          kind: 'network_error',
          isNetworkError: true,
        });
      },
      onWarning: silenced,
    },
  });
  assert.equal(offlineCourseDetail.source, 'demo');
  assert.equal(offlineCourseDetail.course.slug, 'python-programming');

  // Scenario F: Backend 503 -> demo fallback; disabled fallback / api mode -> throws
  await assert.rejects(
    () =>
      fetchPublicCatalogWithFallback({
        config: { mode: 'api', fallbackEnabled: true },
        deps: {
          getPublicCourses: async () => {
            throw new ApiError('Service unavailable', {
              status: 503,
              contentType: 'application/json',
              code: 'SERVICE_UNAVAILABLE',
              kind: 'service_unavailable',
            });
          },
          onWarning: silenced,
        },
      }),
    (err: unknown) => err instanceof ApiError && err.kind === 'service_unavailable'
  );

  // Scenario G: Invalid malformed catalog shape -> falls back to demo in auto mode
  const malformedCatalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => ({ unexpected: true }) as unknown as never,
      getReadiness: async () => ({
        backendReachable: false,
        databaseReady: false,
        status: 'offline',
      }),
      onWarning: silenced,
    },
  });
  assert.equal(malformedCatalog.source, 'demo');
  assert.equal(malformedCatalog.courses.length, 7);

  // Scenario H: Valid empty live catalog -> stays 'live' with 0 courses (NO demo fallback)
  const validEmptyCatalog = await fetchPublicCatalogWithFallback({
    config: { mode: 'auto', fallbackEnabled: true },
    deps: {
      getPublicCourses: async () => ({
        courses: [],
        currency: 'INR',
        isDemoEnvironment: false,
      }),
      onWarning: silenced,
    },
  });
  assert.equal(validEmptyCatalog.source, 'live');
  assert.equal(validEmptyCatalog.courses.length, 0);
});

test('Scenario I: publicSiteStore recovers automatically from demo fallback to live API data', async () => {
  const originalFetch = globalThis.fetch;
  const prevMode = process.env.VITE_PUBLIC_DATA_MODE;
  const prevFallback = process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK;
  publicSiteStore._resetForTest();

  try {
    process.env.VITE_PUBLIC_DATA_MODE = 'auto';
    process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK = 'true';

    // Phase 1: Backend offline -> falls back to demo fixtures
    globalThis.fetch = async () => {
      throw new TypeError('Connection refused');
    };
    await publicSiteStore.refresh();
    const offlineSnap = publicSiteStore.getSnapshot();
    assert.equal(offlineSnap.source, 'demo');
    assert.equal(offlineSnap.courses.length, 7);
    assert.equal(offlineSnap.academy.name, 'IGS — InfoCom Global Services');

    // Phase 2: Backend recovers -> refresh switches seamlessly back to live data
    const recoveredCourse = {
      ...getDemoCourseSummaries()[0],
      id: 'crs-recovered',
      code: 'REC-101',
      slug: 'recovered-program',
      title: 'Recovered Live Program',
      isDemo: false,
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/public/courses')) {
        return new Response(
          JSON.stringify({
            courses: [recoveredCourse],
            currency: 'INR',
            isDemoEnvironment: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/public/academy')) {
        return new Response(JSON.stringify(DEMO_PUBLIC_ACADEMY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'ready', database: 'connected' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await publicSiteStore.refresh({ background: true });
    const recoveredSnap = publicSiteStore.getSnapshot();
    assert.equal(recoveredSnap.source, 'live');
    assert.equal(recoveredSnap.courses.length, 1);
    assert.equal(recoveredSnap.courses[0].slug, 'recovered-program');
    assert.equal(recoveredSnap.readiness.status, 'ready');
  } finally {
    publicSiteStore._resetForTest();
    globalThis.fetch = originalFetch;
    if (prevMode === undefined) delete process.env.VITE_PUBLIC_DATA_MODE;
    else process.env.VITE_PUBLIC_DATA_MODE = prevMode;
    if (prevFallback === undefined) delete process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK;
    else process.env.VITE_ENABLE_PUBLIC_DEMO_FALLBACK = prevFallback;
  }
});

test('Admissions & academy fallbacks handle demo mode and offline status safely', async () => {
  const demoAdmissions = await fetchPublicAdmissionCatalogWithFallback({
    config: { mode: 'demo', fallbackEnabled: true },
  });
  assert.equal(demoAdmissions.source, 'demo');
  assert.equal(demoAdmissions.backendAvailableForSubmission, false);
  assert.equal(demoAdmissions.catalog.courses.length, 7);

  const demoAcademy = await fetchPublicAcademyWithFallback({
    config: { mode: 'demo', fallbackEnabled: true },
  });
  assert.equal(demoAcademy.source, 'demo');
  assert.equal(demoAcademy.academy.name, 'IGS — InfoCom Global Services');
});
