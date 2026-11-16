import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApiApp } from './app.ts';
import { hashPassword, SESSION_COOKIE_NAME } from './auth.ts';
import { prisma } from './db/prisma.ts';
import { deletePrivateDocument } from './storage/index.ts';

test('Public Website API, Disabled Self-Registration, Certificate PDF/QR, Local Storage & RBAC Reports', async (t) => {
  const app = createApiApp();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const runSuffix = crypto.randomUUID().slice(0, 8);
  const password = 'PublicPhase7!2026';

  const adminId = `adm-p8-${runSuffix}`;
  const instId = `ins-p8-${runSuffix}`;
  const stuId = `stu-p8-${runSuffix}`;
  const adminEmail = `admin.p8.${runSuffix}@infocom.test`;
  const instEmail = `inst.p8.${runSuffix}@infocom.test`;
  const stuEmail = `stu.p8.${runSuffix}@infocom.test`;

  const createdUserIds = [adminId, instId, stuId];
  const createdCourseIds: string[] = [];
  const createdEnrollmentIds: string[] = [];
  const createdDocIds: string[] = [];
  const createdCertIds: string[] = [];
  const createdStorageFiles: Array<{ storageProvider: string; storageKey: string }> = [];

  async function apiFetch(
    path: string,
    opts: { method?: string; cookie?: string; body?: unknown } = {}
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.cookie
          ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}` }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { res, json, buffer: null as Buffer | null, text: null as string | null };
    }
    const arr = await res.arrayBuffer();
    const buffer = Buffer.from(arr);
    return { res, json: null, buffer, text: buffer.toString('utf8') };
  }

  function extractCookie(res: Response): string {
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie') ?? ''];
    for (const raw of setCookies) {
      const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(raw);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
    return '';
  }

  try {
    const pwHash = await hashPassword(password);
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: `Admin P8 ${runSuffix}`,
          email: adminEmail,
          role: 'admin',
          status: 'active',
          staffCode: `STF-P8A-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
        {
          id: instId,
          name: `Inst P8 ${runSuffix}`,
          email: instEmail,
          role: 'instructor',
          status: 'active',
          staffCode: `STF-P8I-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
        {
          id: stuId,
          name: `Student P8 ${runSuffix}`,
          email: stuEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-P8S-${runSuffix}`,
          passwordHash: pwHash,
          mustChangePassword: false,
        },
      ],
    });

    const [loginAdmin, loginInst, loginStu] = await Promise.all([
      apiFetch('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: instEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: stuEmail, password } }),
    ]);
    const adminCookie = extractCookie(loginAdmin.res);
    const instCookie = extractCookie(loginInst.res);
    const stuCookie = extractCookie(loginStu.res);
    assert.ok(adminCookie && instCookie && stuCookie);

    await t.test('1. Public academy endpoint returns factual IGS branding without sensitive fields', async () => {
      const res = await apiFetch('/api/public/academy');
      assert.equal(res.res.status, 200);
      assert.equal(res.json?.name, 'IGS — InfoCom Global Services');
      assert.equal(res.json?.slogan, 'Learn Today, Build Tomorrow.');
      assert.ok(String(res.json?.address).includes('Downtown Sopore'));
      assert.equal((res.json as Record<string, unknown>).students, undefined);
      assert.equal((res.json as Record<string, unknown>).users, undefined);
    });

    let pubCourseId = '';
    let pubCourseSlug = '';
    let privCourseId = '';

    await t.test('2. Public courses endpoint respects isPublished, isArchived, showTuitionPublicly & excludes PII', async () => {
      const pubRes = await apiFetch('/api/courses', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `PUB-${runSuffix.slice(0, 4).toUpperCase()}`,
          slug: `public-masked-program-${runSuffix}`,
          title: `Public Masked Program ${runSuffix}`,
          track: 'Systems',
          instructorId: instId,
          durationWeeks: 6,
          tuitionFee: '9500.00',
          isPublished: true,
          showTuitionPublicly: false,
          modules: [{ code: 'M1', title: 'Intro Module', weight: 100, labHours: 12 }],
        },
      });
      assert.equal(pubRes.res.status, 201);
      pubCourseId = String(pubRes.json?.courseId);
      pubCourseSlug = `public-masked-program-${runSuffix}`;
      createdCourseIds.push(pubCourseId);

      const privRes = await apiFetch('/api/courses', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: `PRV-${runSuffix.slice(0, 4).toUpperCase()}`,
          slug: `internal-hidden-program-${runSuffix}`,
          title: `Internal Hidden Program ${runSuffix}`,
          track: 'Systems',
          instructorId: instId,
          durationWeeks: 4,
          tuitionFee: '7500.00',
          isPublished: false,
          showTuitionPublicly: true,
          modules: [{ code: 'M1', title: 'Private Module', weight: 100, labHours: 8 }],
        },
      });
      assert.equal(privRes.res.status, 201);
      privCourseId = String(privRes.json?.courseId);
      createdCourseIds.push(privCourseId);

      const catalog = await apiFetch('/api/public/courses');
      assert.equal(catalog.res.status, 200);
      const list = catalog.json?.courses as Array<Record<string, unknown>>;
      const matchedPub = list.find((c) => c.id === pubCourseId);
      const matchedPriv = list.find((c) => c.id === privCourseId);
      assert.ok(matchedPub, 'Published course must appear in /api/public/courses');
      assert.equal(matchedPub.tuitionFee, null, 'Tuition must be masked when showTuitionPublicly is false');
      assert.equal(matchedPub.showTuitionPublicly, false);
      assert.equal(matchedPub.instructorId, undefined, 'Public courses must not leak internal user IDs');
      assert.equal(matchedPriv, undefined, 'Unpublished course must not appear in public catalog');

      const detailOk = await apiFetch(`/api/public/courses/${pubCourseSlug}`);
      assert.equal(detailOk.res.status, 200);
      const detailHidden = await apiFetch(`/api/public/courses/${privCourseId}`);
      assert.equal(detailHidden.res.status, 404);
    });

    await t.test('3. POST /api/auth/register returns 410 Gone unconditionally', async () => {
      const regRes = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Blocked User',
          email: `blocked.${runSuffix}@infocom.test`,
          password,
        },
      });
      assert.equal(regRes.res.status, 410);
      const found = await prisma.user.findUnique({
        where: { email: `blocked.${runSuffix}@infocom.test` },
      });
      assert.equal(found, null);
    });

    await t.test('4. Private object storage stores uploads outside PostgreSQL and blocks unsafe extensions', async () => {
      const badUpload = await apiFetch('/api/documents', {
        method: 'POST',
        cookie: stuCookie,
        body: {
          title: 'Malicious HTML',
          category: 'Other',
          fileName: 'payload.html',
          mimeType: 'text/html',
          contentBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
        },
      });
      assert.equal(badUpload.res.status, 400);

      const goodContent = 'Official IGS assignment verification payload.';
      const goodUpload = await apiFetch('/api/documents', {
        method: 'POST',
        cookie: stuCookie,
        body: {
          title: 'Valid Assignment Text',
          category: 'Assignment',
          fileName: 'assignment_notes.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from(goodContent).toString('base64'),
        },
      });
      assert.equal(goodUpload.res.status, 201);
      const docId = String(goodUpload.json?.documentId);
      createdDocIds.push(docId);

      const asset = await prisma.fileAsset.findUnique({ where: { id: docId } });
      assert.ok(asset);
      assert.equal(asset.storageProvider, 'local');
      assert.ok(asset.storageKey);
      assert.equal(asset.contentBase64, '');
      createdStorageFiles.push({
        storageProvider: asset.storageProvider,
        storageKey: asset.storageKey,
      });

      const downloadRes = await apiFetch(`/api/documents/${docId}/download`, { cookie: stuCookie });
      assert.equal(downloadRes.res.status, 200);
      assert.equal(downloadRes.text, goodContent);

      const unauthDownload = await apiFetch(`/api/documents/${docId}/download`);
      assert.equal(unauthDownload.res.status, 401);
    });

    await t.test('5. Certificate PDF download generates a valid PDF with QR verification payload', async () => {
      const enrId = `enr-p8-${runSuffix}`;
      createdEnrollmentIds.push(enrId);
      await prisma.enrollment.create({
        data: {
          id: enrId,
          studentId: stuId,
          courseId: pubCourseId,
          cohort: 'SOP-TEST-01',
          status: 'Completed',
        },
      });

      const certId = `crt-p8-${runSuffix}`;
      const certCode = `IGS-P8-${runSuffix.toUpperCase()}`;
      createdCertIds.push(certId);

      await prisma.certificate.create({
        data: {
          id: certId,
          certificateCode: certCode,
          verificationHash: crypto.randomBytes(16).toString('hex'),
          studentId: stuId,
          courseId: pubCourseId,
          enrollmentId: enrId,
          courseTitleSnapshot: `Public Masked Program ${runSuffix}`,
          finalScore: 92,
          letterGrade: 'A',
          attendanceRate: 96,
          issuedByUserId: adminId,
          issuedByName: `Admin P8 ${runSuffix}`,
          status: 'Issued',
        },
      });

      const pdfRes = await apiFetch(`/api/certificates/${certId}/download`, {
        cookie: stuCookie,
      });
      assert.equal(pdfRes.res.status, 200);
      assert.equal(pdfRes.res.headers.get('content-type'), 'application/pdf');
      assert.ok(pdfRes.buffer && pdfRes.buffer.subarray(0, 5).toString('ascii') === '%PDF-');

      const publicVerify = await apiFetch(`/api/certificates/verify/${certCode}`);
      assert.equal(publicVerify.res.status, 200);
      assert.equal((publicVerify.json?.certificate as { status: string }).status, 'Issued');
    });

    await t.test('6. Reports endpoint enforces RBAC across CSV and PDF exports', async () => {
      // Financial collections must be Admin-only (403 for student & instructor)
      const stuFin = await apiFetch('/api/reports/financial-collections?format=csv', {
        cookie: stuCookie,
      });
      assert.equal(stuFin.res.status, 403);

      const instFin = await apiFetch('/api/reports/financial-collections?format=pdf', {
        cookie: instCookie,
      });
      assert.equal(instFin.res.status, 403);

      const admFinCsv = await apiFetch('/api/reports/financial-collections?format=csv', {
        cookie: adminCookie,
      });
      assert.equal(admFinCsv.res.status, 200);
      assert.ok(String(admFinCsv.res.headers.get('content-type')).includes('text/csv'));
      assert.ok(admFinCsv.text?.includes('Invoice #'));

      const admFinPdf = await apiFetch('/api/reports/financial-collections?format=pdf', {
        cookie: adminCookie,
      });
      assert.equal(admFinPdf.res.status, 200);
      assert.equal(admFinPdf.res.headers.get('content-type'), 'application/pdf');
      assert.ok(admFinPdf.buffer && admFinPdf.buffer.subarray(0, 5).toString('ascii') === '%PDF-');

      // Attendance summary forbidden for students, allowed for instructors & admins
      const stuAtt = await apiFetch('/api/reports/attendance-summary?format=csv', {
        cookie: stuCookie,
      });
      assert.equal(stuAtt.res.status, 403);

      const instAtt = await apiFetch('/api/reports/attendance-summary?format=csv', {
        cookie: instCookie,
      });
      assert.equal(instAtt.res.status, 200);

      // Student can download their own academic-progress PDF
      const stuProg = await apiFetch('/api/reports/academic-progress?format=pdf', {
        cookie: stuCookie,
      });
      assert.equal(stuProg.res.status, 200);
      assert.ok(stuProg.buffer && stuProg.buffer.subarray(0, 5).toString('ascii') === '%PDF-');
    });
  } finally {
    for (const obj of createdStorageFiles) {
      await deletePrivateDocument(obj).catch(() => undefined);
    }
    await prisma.certificate.deleteMany({ where: { id: { in: createdCertIds } } });
    await prisma.enrollment.deleteMany({ where: { id: { in: createdEnrollmentIds } } });
    await prisma.fileAsset.deleteMany({ where: { id: { in: createdDocIds } } });
    await prisma.courseModule.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
