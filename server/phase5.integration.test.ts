import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import test from 'node:test';
import 'dotenv/config';
import { createApiApp } from './app.ts';
import { SESSION_COOKIE_NAME, hashPassword } from './auth.ts';
import { prisma } from './db/prisma.ts';
import { resetAuthRateLimiters } from './routes/auth.routes.ts';

function extractSessionCookie(res: Response): string {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);

  for (const header of setCookies) {
    const match = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return '';
}

test('Phase 5 Admission & Enrollment Workflow Integration Suite', async (t) => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminId = `adm-p5-${runSuffix}`;
  const adminEmail = `admin.p5.${runSuffix}@infocom.test`;
  const instId = `ins-p5-${runSuffix}`;
  const instEmail = `inst.p5.${runSuffix}@infocom.test`;
  const otherStuId = `stu-p5-other-${runSuffix}`;
  const otherStuEmail = `other.p5.${runSuffix}@infocom.test`;
  const password = 'Phase5Test!2026';

  const createdUserIds: string[] = [adminId, instId, otherStuId];
  const createdCourseIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdAdmissionIds: string[] = [];
  const createdEnrollmentIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdFileAssetIds: string[] = [];

  async function apiFetch(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      body?: unknown;
    } = {}
  ) {
    const headers: Record<string, string> = {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie
        ? { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}` }
        : {}),
    };
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, text, json };
  }

  let originalActivationPolicy = 'on_approval';
  let adminCookie = '';
  let instCookie = '';
  let otherStuCookie = '';
  let courseAId = '';
  let courseBId = '';
  let batchFullId = '';
  let batchOpenId = '';
  let batchBId = '';

  try {
    resetAuthRateLimiters();
    const pwHash = await hashPassword(password);

    const existingPolicySetting = await prisma.academySetting.findFirst({
      where: { key: 'admission.portal_activation_policy' },
    });
    if (existingPolicySetting) {
      originalActivationPolicy = existingPolicySetting.value;
    }

    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Phase5 Admin',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: instId,
          name: 'Phase5 Instructor',
          email: instEmail,
          role: 'instructor',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: otherStuId,
          name: 'Other Student',
          email: otherStuEmail,
          role: 'student',
          status: 'active',
          studentCode: `IGS-P5-${runSuffix.slice(0, 4).toUpperCase()}`,
          passwordHash: pwHash,
        },
      ],
    });

    const [loginAdmin, loginInst, loginOther] = await Promise.all([
      apiFetch('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: instEmail, password } }),
      apiFetch('/api/auth/login', { method: 'POST', body: { email: otherStuEmail, password } }),
    ]);
    assert.equal(loginAdmin.res.status, 200);
    assert.equal(loginInst.res.status, 200);
    assert.equal(loginOther.res.status, 200);
    adminCookie = extractSessionCookie(loginAdmin.res);
    instCookie = extractSessionCookie(loginInst.res);
    otherStuCookie = extractSessionCookie(loginOther.res);

    // Create two test courses + batches (one capacity=1 full batch, one open batch, one batch on Course B)
    const crsARes = await apiFetch('/api/courses', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `P5A-${runSuffix.slice(0, 4).toUpperCase()}`,
        title: `Phase5 Course Alpha ${runSuffix}`,
        track: 'Engineering',
        instructorId: instId,
        durationWeeks: 8,
        tuitionFee: '1200.00',
        isPublished: true,
        modules: [{ code: 'M1', title: 'Foundations', weight: 100, labHours: 10 }],
      },
    });
    assert.equal(crsARes.res.status, 201);
    courseAId = String(crsARes.json?.courseId);
    createdCourseIds.push(courseAId);

    const crsBRes = await apiFetch('/api/courses', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `P5B-${runSuffix.slice(0, 4).toUpperCase()}`,
        title: `Phase5 Course Beta ${runSuffix}`,
        track: 'Data Science',
        instructorId: instId,
        durationWeeks: 10,
        tuitionFee: '1500.00',
        isPublished: true,
        modules: [{ code: 'M1', title: 'Analytics', weight: 100, labHours: 12 }],
      },
    });
    assert.equal(crsBRes.res.status, 201);
    courseBId = String(crsBRes.json?.courseId);
    createdCourseIds.push(courseBId);

    const batFullRes = await apiFetch('/api/cohorts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `BF-${runSuffix.slice(0, 4).toUpperCase()}`,
        name: `Full Batch ${runSuffix}`,
        courseId: courseAId,
        instructorId: instId,
        capacity: 1,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-02-01T00:00:00.000Z',
        status: 'Active',
      },
    });
    assert.equal(batFullRes.res.status, 201);
    batchFullId = String(batFullRes.json?.cohortId);
    createdBatchIds.push(batchFullId);

    // Fill Full Batch with Other Student
    const fillRes = await apiFetch('/api/enrollments', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        studentId: otherStuId,
        courseId: courseAId,
        cohort: `Full Batch ${runSuffix}`,
        cohortId: batchFullId,
        status: 'Active',
        issueTuitionInvoice: false,
      },
    });
    assert.equal(fillRes.res.status, 201);
    const fillEnr = (fillRes.json?.dashboard as { enrollments: Array<{ id: string; studentId: string; courseId: string }> })
      .enrollments.find((e) => e.studentId === otherStuId && e.courseId === courseAId);
    assert.ok(fillEnr);
    createdEnrollmentIds.push(fillEnr.id);

    const batOpenRes = await apiFetch('/api/cohorts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `BO-${runSuffix.slice(0, 4).toUpperCase()}`,
        name: `Open Batch ${runSuffix}`,
        courseId: courseAId,
        instructorId: instId,
        capacity: 10,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-02-01T00:00:00.000Z',
        status: 'Active',
      },
    });
    assert.equal(batOpenRes.res.status, 201);
    batchOpenId = String(batOpenRes.json?.cohortId);
    createdBatchIds.push(batchOpenId);

    const batBRes = await apiFetch('/api/cohorts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `BB-${runSuffix.slice(0, 4).toUpperCase()}`,
        name: `Beta Batch ${runSuffix}`,
        courseId: courseBId,
        instructorId: instId,
        capacity: 10,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-02-01T00:00:00.000Z',
        status: 'Active',
      },
    });
    assert.equal(batBRes.res.status, 201);
    batchBId = String(batBRes.json?.cohortId);
    createdBatchIds.push(batchBId);

    let draftAdmissionId = '';
    let docId = '';
    const applicant1Email = `applicant1.${runSuffix}@infocom.test`;

    await t.test('1. Draft creation, incomplete update, submission, and status history audit trail', async () => {
      const draftRes = await apiFetch('/api/admissions', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          status: 'Draft',
          applicantName: `Priya Nair ${runSuffix}`,
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
        },
      });
      assert.equal(draftRes.res.status, 201);
      assert.equal(draftRes.json?.status, 'Draft');
      draftAdmissionId = String(draftRes.json?.admissionId);
      createdAdmissionIds.push(draftAdmissionId);

      // Update draft with full guardian, address, previous academic details & submit
      const submitRes = await apiFetch(`/api/admissions/${draftAdmissionId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
          applicantEmail: applicant1Email,
          phone: '+91-99000-11223',
          dateOfBirth: '2001-05-14',
          address: '42 Tech Park Road',
          city: 'Bengaluru',
          postalCode: '560001',
          guardianName: 'Ramesh Nair',
          guardianRelationship: 'Father',
          guardianPhone: '+91-99000-11224',
          guardianEmail: `guardian.${runSuffix}@infocom.test`,
          previousQualification: 'B.Sc. Computer Science',
          previousInstitution: 'Bangalore University',
          graduationYear: '2024',
          previousScore: '8.9 CGPA',
          preferredCohort: `Open Batch ${runSuffix}`,
          status: 'Submitted',
          reason: 'Applicant completed all fields and submitted',
        },
      });
      assert.equal(submitRes.res.status, 200);

      // Move to Under Review -> Documents Required -> Under Review
      const revRes = await apiFetch(`/api/admissions/${draftAdmissionId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Under Review', reason: 'Assigned to registrar queue' },
      });
      assert.equal(revRes.res.status, 200);

      const docsReqRes = await apiFetch(`/api/admissions/${draftAdmissionId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Documents Required', reason: 'Need clear ID scan' },
      });
      assert.equal(docsReqRes.res.status, 200);

      const detailRes = await apiFetch(`/api/admissions/${draftAdmissionId}`, {
        cookie: adminCookie,
      });
      assert.equal(detailRes.res.status, 200);
      const history = detailRes.json?.statusHistory as Array<{ newStatus: string; actorName: string; reason: string }>;
      assert.ok(history.length >= 4);
      assert.equal(history[0].newStatus, 'Documents Required');
      assert.ok(history[0].actorName);
    });

    await t.test('2. Private admission documents, strict RBAC download, and verification/replacement request', async () => {
      const samplePayload = Buffer.from('PDF-ID-DOCUMENT-SAMPLE').toString('base64');
      const uploadRes = await apiFetch(`/api/admissions/${draftAdmissionId}/documents`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          documentType: 'ID Verification',
          title: 'National ID Card',
          category: 'ID Verification',
          fileName: 'national_id.txt',
          mimeType: 'text/plain',
          contentBase64: samplePayload,
        },
      });
      assert.equal(uploadRes.res.status, 201);
      docId = String(uploadRes.json?.documentId);

      // Record fileAssetId for cleanup
      const docRow = await prisma.admissionDocument.findUnique({ where: { id: docId } });
      if (docRow) createdFileAssetIds.push(docRow.fileAssetId);

      // RBAC: unauthenticated -> 401, instructor -> 403, unrelated student -> 403, admin -> 200
      const unauthDl = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}/download`);
      assert.equal(unauthDl.res.status, 401);

      const instDl = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}/download`, {
        cookie: instCookie,
      });
      assert.equal(instDl.res.status, 403);

      const otherStuDl = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}/download`, {
        cookie: otherStuCookie,
      });
      assert.equal(otherStuDl.res.status, 403);

      const adminDl = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}/download`, {
        cookie: adminCookie,
      });
      assert.equal(adminDl.res.status, 200);
      assert.equal(adminDl.text, 'PDF-ID-DOCUMENT-SAMPLE');

      // Request replacement without remarks -> 400
      const badReqRep = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Replacement Required', verificationRemarks: '' },
      });
      assert.equal(badReqRep.res.status, 400);

      // Request replacement with remarks -> 200 + DeliveryLog created
      const reqRepRes = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
          status: 'Replacement Required',
          verificationRemarks: 'Photo corner is cropped, please upload full card.',
        },
      });
      assert.equal(reqRepRes.res.status, 200);

      // Verify document -> 200
      const verifyRes = await apiFetch(`/api/admissions/${draftAdmissionId}/documents/${docId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
          status: 'Verified',
          verificationRemarks: 'Document verified against registrar checklist.',
        },
      });
      assert.equal(verifyRes.res.status, 200);
    });

    let approvedStudentId = '';
    let approvedEnrollmentId = '';

    await t.test('3. Atomic approval rollback on full batch, then manual_activation approval + duplicate prevention + manual portal activation', async () => {
      // Configure policy to manual_activation
      const currentSettingsRes = await apiFetch('/api/settings', { cookie: adminCookie });
      assert.equal(currentSettingsRes.res.status, 200);
      const currentSettings = currentSettingsRes.json as {
        academy: Record<string, unknown>;
        policies: Record<string, unknown>;
      };
      const putPolicy = await apiFetch('/api/settings', {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          academy: currentSettings.academy,
          policies: {
            ...currentSettings.policies,
            portalActivationPolicy: 'manual_activation',
          },
        },
      });
      assert.equal(putPolicy.res.status, 200);

      // Attempt approval onto FULL batch without waitlistIfFull -> 409 rollback
      const fullFailRes = await apiFetch(`/api/admissions/${draftAdmissionId}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          targetCourseId: courseAId,
          targetBatchId: batchFullId,
          waitlistIfFull: false,
        },
      });
      assert.equal(fullFailRes.res.status, 409);

      // Confirm NO student user was left behind by failed transaction
      const rolledBackUser = await prisma.user.findUnique({ where: { email: applicant1Email } });
      assert.equal(rolledBackUser, null);

      // Now approve onto Open Batch with PLAN-STANDARD
      const approveRes = await apiFetch(`/api/admissions/${draftAdmissionId}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
          feePlanId: 'fp-standard',
          waitlistIfFull: false,
          reviewRemarks: 'Strong academic profile; approved for cohort.',
          issueInvoice: true,
        },
      });
      assert.equal(approveRes.res.status, 200);
      approvedStudentId = String(approveRes.json?.studentId);
      approvedEnrollmentId = String(approveRes.json?.enrollmentId);
      const invoiceId = String(approveRes.json?.invoiceId);
      createdUserIds.push(approvedStudentId);
      createdEnrollmentIds.push(approvedEnrollmentId);
      if (invoiceId && invoiceId !== 'null') createdInvoiceIds.push(invoiceId);

      assert.match(String(approveRes.json?.studentCode), /^IGS-\d{4}-/);
      assert.equal(approveRes.json?.portalActivated, false);

      // Student account starts inactive under manual_activation policy
      const stuRow = await prisma.user.findUnique({ where: { id: approvedStudentId } });
      assert.equal(stuRow?.status, 'inactive');

      // Re-approving same application -> 409
      const dupApproveRes = await apiFetch(`/api/admissions/${draftAdmissionId}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
        },
      });
      assert.equal(dupApproveRes.res.status, 409);

      // Second application for SAME applicant email & SAME course -> duplicate active enrollment blocked (409) & zero duplicate user rows
      const dupAppRes = await apiFetch('/api/admissions', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          applicantName: `Priya Nair ${runSuffix}`,
          applicantEmail: applicant1Email,
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
          preferredCohort: `Open Batch ${runSuffix}`,
          status: 'Submitted',
        },
      });
      assert.equal(dupAppRes.res.status, 201);
      const dupAppId = String(dupAppRes.json?.admissionId);
      createdAdmissionIds.push(dupAppId);

      const dupAppApprove = await apiFetch(`/api/admissions/${dupAppId}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
        },
      });
      assert.equal(dupAppApprove.res.status, 409);

      // Manual portal activation activates student & sets portalActivated = true
      const actRes = await apiFetch(`/api/admissions/${draftAdmissionId}/activate-portal`, {
        method: 'POST',
        cookie: adminCookie,
      });
      assert.equal(actRes.res.status, 200);
      assert.equal(actRes.json?.portalActivated, true);

      const activatedStu = await prisma.user.findUnique({ where: { id: approvedStudentId } });
      assert.equal(activatedStu?.status, 'active');

      // Verify notifications & DeliveryLog were persisted for applicant
      const notifs = await prisma.notification.findMany({ where: { userId: approvedStudentId } });
      assert.ok(notifs.length >= 3);
    });

    await t.test('4. after_first_payment portal activation policy activates student automatically on tuition payment', async () => {
      const currentSettingsRes = await apiFetch('/api/settings', { cookie: adminCookie });
      const currentSettings = currentSettingsRes.json as {
        academy: Record<string, unknown>;
        policies: Record<string, unknown>;
      };
      await apiFetch('/api/settings', {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          academy: currentSettings.academy,
          policies: {
            ...currentSettings.policies,
            portalActivationPolicy: 'after_first_payment',
          },
        },
      });

      const catalogRes = await apiFetch('/api/admissions/public/catalog');
      assert.equal(catalogRes.res.status, 200);
      assert.equal(catalogRes.json?.currency, 'INR');
      const catalogCourses = catalogRes.json?.courses as Array<{ id: string; code: string }>;
      const catalogBatches = catalogRes.json?.batches as Array<{ id: string; courseId: string }>;
      assert.ok(catalogCourses.some((c) => c.id === courseAId));
      assert.ok(catalogBatches.some((b) => b.id === batchOpenId && b.courseId === courseAId));
      assert.equal((catalogRes.json as Record<string, unknown>).students, undefined);

      const app2Email = `applicant2.${runSuffix}@infocom.test`;
      const pubRes = await apiFetch('/api/admissions/public', {
        method: 'POST',
        body: {
          applicantName: `Rohan Mehta ${runSuffix}`,
          applicantEmail: app2Email,
          phone: '+91-98111-22334',
          guardianName: 'Suresh Mehta',
          guardianRelationship: 'Father',
          guardianPhone: '+91-98111-22335',
          previousQualification: '12th Grade',
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
          preferredCohort: `Open Batch ${runSuffix}`,
          status: 'Submitted',
          documents: [
            {
              documentType: 'ID Verification',
              title: 'Public Applicant ID',
              category: 'ID Verification',
              fileName: 'public_id.txt',
              mimeType: 'text/plain',
              contentBase64: Buffer.from('PUBLIC-ID-SAMPLE').toString('base64'),
            },
          ],
        },
      });
      assert.equal(pubRes.res.status, 201);
      assert.match(String(pubRes.json?.applicationNumber), /^ADM-\d{4}-/);
      const app2Id = String(pubRes.json?.admissionId);
      createdAdmissionIds.push(app2Id);
      const app2Docs = await prisma.admissionDocument.findMany({ where: { applicationId: app2Id } });
      for (const d of app2Docs) createdFileAssetIds.push(d.fileAssetId);

      const approve2 = await apiFetch(`/api/admissions/${app2Id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          targetCourseId: courseAId,
          targetBatchId: batchOpenId,
          feePlanId: 'fp-full',
          issueInvoice: true,
        },
      });
      assert.equal(approve2.res.status, 200);
      const stu2Id = String(approve2.json?.studentId);
      const enr2Id = String(approve2.json?.enrollmentId);
      const inv2Id = String(approve2.json?.invoiceId);
      createdUserIds.push(stu2Id);
      createdEnrollmentIds.push(enr2Id);
      createdInvoiceIds.push(inv2Id);
      assert.equal(approve2.json?.portalActivated, false);

      // Record first payment -> auto-activates student & updates admission.portalActivated
      const payRes = await apiFetch(`/api/invoices/${inv2Id}/payments`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          amount: '300.00',
          method: 'Card',
          referenceCode: `PAY-${runSuffix}`,
          notes: 'First tuition installment',
        },
      });
      assert.equal(payRes.res.status, 201);

      const [stu2After, app2After] = await Promise.all([
        prisma.user.findUnique({ where: { id: stu2Id } }),
        prisma.admissionApplication.findUnique({ where: { id: app2Id } }),
      ]);
      assert.equal(stu2After?.status, 'active');
      assert.equal(app2After?.portalActivated, true);
    });

    await t.test('5. Enrollment lifecycle validation, course transfer, cancellation, and history trail', async () => {
      // Course transfer: transfer approvedEnrollmentId from Course A to Course B
      const transferRes = await apiFetch(`/api/enrollments/${approvedEnrollmentId}/course-transfer`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          toCourseId: courseBId,
          toBatchId: batchBId,
          reason: 'Student switching to Data Science track',
          status: 'Active',
          issueTuitionInvoice: false,
        },
      });
      assert.equal(transferRes.res.status, 200);
      const newEnrollmentId = String(transferRes.json?.enrollmentId);
      createdEnrollmentIds.push(newEnrollmentId);

      // Old enrollment is now Withdrawn; attempting to reactivate Withdrawn -> Active returns 400
      const invalidReactivate = await apiFetch(`/api/enrollments/${approvedEnrollmentId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Active' },
      });
      assert.equal(invalidReactivate.res.status, 400);

      // Cancel the new enrollment with reason
      const cancelRes = await apiFetch(`/api/enrollments/${newEnrollmentId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Cancelled', reason: 'Deferred until next quarter' },
      });
      assert.equal(cancelRes.res.status, 200);

      // Invalid transition Cancelled -> Active returns 400
      const invalidPostCancel = await apiFetch(`/api/enrollments/${newEnrollmentId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'Active' },
      });
      assert.equal(invalidPostCancel.res.status, 400);

      // Verify history endpoint for new enrollment shows transfer creation + cancellation
      const histRes = await apiFetch(`/api/enrollments/${newEnrollmentId}/history`, {
        cookie: adminCookie,
      });
      assert.equal(histRes.res.status, 200);
      const entries = histRes.json?.history as Array<{ newStatus: string; reason: string }>;
      assert.ok(entries.length >= 2);
      assert.equal(entries[0].newStatus, 'Cancelled');
      assert.match(entries[0].reason, /Deferred until next quarter/);
    });
  } finally {
    // Restore original portal activation policy
    await prisma.academySetting
      .updateMany({
        where: { key: 'admission.portal_activation_policy' },
        data: { value: originalActivationPolicy },
      })
      .catch(() => undefined);

    if (createdUserIds.length > 0 || createdCourseIds.length > 0 || createdInvoiceIds.length > 0) {
      await prisma.paymentAllocation
        .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
        .catch(() => undefined);
      await prisma.payment
        .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
        .catch(() => undefined);
      await prisma.invoiceItem
        .deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } })
        .catch(() => undefined);
      await prisma.invoice
        .deleteMany({
          where: {
            OR: [
              { id: { in: createdInvoiceIds } },
              { studentId: { in: createdUserIds } },
              { courseId: { in: createdCourseIds } },
            ],
          },
        })
        .catch(() => undefined);
    }

    if (createdEnrollmentIds.length > 0 || createdCourseIds.length > 0 || createdUserIds.length > 0) {
      await prisma.enrollmentHistory
        .deleteMany({
          where: {
            enrollment: {
              OR: [
                { id: { in: createdEnrollmentIds } },
                { courseId: { in: createdCourseIds } },
                { studentId: { in: createdUserIds } },
              ],
            },
          },
        })
        .catch(() => undefined);
      await prisma.enrollment
        .deleteMany({
          where: {
            OR: [
              { id: { in: createdEnrollmentIds } },
              { courseId: { in: createdCourseIds } },
              { studentId: { in: createdUserIds } },
            ],
          },
        })
        .catch(() => undefined);
    }

    if (createdAdmissionIds.length > 0) {
      await prisma.deliveryLog
        .deleteMany({ where: { applicationId: { in: createdAdmissionIds } } })
        .catch(() => undefined);
      await prisma.admissionStatusHistory
        .deleteMany({ where: { applicationId: { in: createdAdmissionIds } } })
        .catch(() => undefined);
      await prisma.admissionDocument
        .deleteMany({ where: { applicationId: { in: createdAdmissionIds } } })
        .catch(() => undefined);
      await prisma.admissionApplication
        .deleteMany({ where: { id: { in: createdAdmissionIds } } })
        .catch(() => undefined);
    }

    if (createdFileAssetIds.length > 0) {
      await prisma.fileAsset
        .deleteMany({ where: { id: { in: createdFileAssetIds } } })
        .catch(() => undefined);
    }

    if (createdBatchIds.length > 0) {
      await prisma.batch
        .deleteMany({ where: { id: { in: createdBatchIds } } })
        .catch(() => undefined);
    }

    if (createdCourseIds.length > 0) {
      await prisma.feeStructure
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.instructorAssignment
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.courseModule
        .deleteMany({ where: { courseId: { in: createdCourseIds } } })
        .catch(() => undefined);
      await prisma.course
        .deleteMany({ where: { id: { in: createdCourseIds } } })
        .catch(() => undefined);
    }

    if (createdUserIds.length > 0) {
      await prisma.guardian
        .deleteMany({ where: { studentProfile: { userId: { in: createdUserIds } } } })
        .catch(() => undefined);
      await prisma.auditLog
        .deleteMany({ where: { actorUserId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.deliveryLog
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.notification
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.authSession
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.userRole
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.studentProfile
        .deleteMany({ where: { userId: { in: createdUserIds } } })
        .catch(() => undefined);
      await prisma.user
        .deleteMany({ where: { id: { in: createdUserIds } } })
        .catch(() => undefined);
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
