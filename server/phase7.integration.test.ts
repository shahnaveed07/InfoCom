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

test('Phase G Financial Management (FeePlans, FeeStructures, Discounts, Scholarships, Refunds, Invoice Detail) Integration Suite', async () => {
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const app = createApiApp();
  const server: Server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const adminId = `adm-pg-${runSuffix}`;
  const adminEmail = `admin.pg.${runSuffix}@infocom.test`;
  const instId = `ins-pg-${runSuffix}`;
  const instEmail = `inst.pg.${runSuffix}@infocom.test`;
  const stu1Id = `stu1-pg-${runSuffix}`;
  const stu1Email = `stu1.pg.${runSuffix}@infocom.test`;
  const stu2Id = `stu2-pg-${runSuffix}`;
  const stu2Email = `stu2.pg.${runSuffix}@infocom.test`;
  const password = 'PhaseGTest!2026';

  const createdUserIds = [adminId, instId, stu1Id, stu2Id];
  const createdCourseIds: string[] = [];
  const createdFeePlanIds: string[] = [];
  const createdFeeStructureIds: string[] = [];
  const createdDiscountIds: string[] = [];
  const createdScholarshipIds: string[] = [];
  const createdInvoiceIds: string[] = [];

  async function apiFetch(
    path: string,
    opts: { method?: string; cookie?: string; body?: unknown } = {}
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

  try {
    resetAuthRateLimiters();
    const pwHash = await hashPassword(password);
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'PhaseG Admin',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          passwordHash: pwHash,
        },
        {
          id: instId,
          name: 'PhaseG Instructor',
          email: instEmail,
          role: 'instructor',
          status: 'active',
          staffCode: `STF-PG-${runSuffix}`,
          passwordHash: pwHash,
        },
        {
          id: stu1Id,
          name: 'PhaseG Student One',
          email: stu1Email,
          role: 'student',
          status: 'active',
          studentCode: `IGS-PG1-${runSuffix}`,
          passwordHash: pwHash,
        },
        {
          id: stu2Id,
          name: 'PhaseG Student Two',
          email: stu2Email,
          role: 'student',
          status: 'active',
          studentCode: `IGS-PG2-${runSuffix}`,
          passwordHash: pwHash,
        },
      ],
    });

    const loginAdmin = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password },
    });
    assert.equal(loginAdmin.res.status, 200);
    const adminCookie = extractSessionCookie(loginAdmin.res);

    const loginInst = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email: instEmail, password },
    });
    assert.equal(loginInst.res.status, 200);
    const instCookie = extractSessionCookie(loginInst.res);

    const loginStu1 = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email: stu1Email, password },
    });
    assert.equal(loginStu1.res.status, 200);
    const stu1Cookie = extractSessionCookie(loginStu1.res);

    const loginStu2 = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email: stu2Email, password },
    });
    assert.equal(loginStu2.res.status, 200);
    const stu2Cookie = extractSessionCookie(loginStu2.res);

    // Create a course for testing finance structures
    const courseRes = await apiFetch('/api/courses', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `PG-${runSuffix.slice(0, 5).toUpperCase()}`,
        title: 'Financial Engineering Course',
        track: 'Engineering',
        instructorId: instId,
        durationWeeks: 12,
        tuitionFee: '10000.00',
        modules: [{ code: 'M1', title: 'Core Ledger', weight: 100, labHours: 10 }],
      },
    });
    assert.equal(courseRes.res.status, 201);
    const courseId = String(courseRes.json?.courseId);
    createdCourseIds.push(courseId);

    // 1. Non-admin cannot create FeePlan
    const stuPlanAttempt = await apiFetch('/api/fee-plans', {
      method: 'POST',
      cookie: stu1Cookie,
      body: { code: `FP-${runSuffix}`, name: 'Denied Plan', installmentCount: 2 },
    });
    assert.equal(stuPlanAttempt.res.status, 403);

    // 2. Admin creates and toggles FeePlan
    const planCode = `FP-${runSuffix}`.toUpperCase();
    const createPlanRes = await apiFetch('/api/fee-plans', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: planCode,
        name: '2-Term Installment',
        description: 'Split across 2 terms',
        installmentCount: 2,
      },
    });
    assert.equal(createPlanRes.res.status, 201);
    const feePlanId = String(createPlanRes.json?.feePlanId);
    createdFeePlanIds.push(feePlanId);

    const togglePlanRes = await apiFetch(`/api/fee-plans/${feePlanId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { isActive: false },
    });
    assert.equal(togglePlanRes.res.status, 200);
    await apiFetch(`/api/fee-plans/${feePlanId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { isActive: true },
    });

    // 3. Admin creates FeeStructure (Tuition 10000 + Reg 500 + Lab 1500 = 12000)
    const fsRes = await apiFetch('/api/fee-structures', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        courseId,
        feePlanId,
        tuitionAmount: '10000.00',
        registrationFee: '500.00',
        labFee: '1500.00',
      },
    });
    assert.equal(fsRes.res.status, 201);
    const feeStructureId = String(fsRes.json?.feeStructureId);
    createdFeeStructureIds.push(feeStructureId);

    // 4. Admin creates Discount (10% off) & Scholarship (INR 1000 fixed)
    const dscRes = await apiFetch('/api/discounts', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `DSC-${runSuffix}`.toUpperCase(),
        name: 'Early Admission 10%',
        discountType: 'Percentage',
        value: '10.00',
      },
    });
    assert.equal(dscRes.res.status, 201);
    const discountId = String(dscRes.json?.discountId);
    createdDiscountIds.push(discountId);

    const schRes = await apiFetch('/api/scholarships', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        code: `SCH-${runSuffix}`.toUpperCase(),
        name: 'Sopore Merit Grant',
        sponsorName: 'IGS Trust',
        coverageType: 'Fixed',
        coverageValue: '1000.00',
        maxRecipients: 5,
      },
    });
    assert.equal(schRes.res.status, 201);
    const scholarshipId = String(schRes.json?.scholarshipId);
    createdScholarshipIds.push(scholarshipId);

    // 5. Issue invoice using FeeStructure -> verifies itemized lines & subtotal 12000.00
    const invRes = await apiFetch('/api/invoices', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        studentId: stu1Id,
        courseId,
        feeStructureId,
        description: 'Cohort Fee Package',
        amountDue: '12000.00',
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    });
    assert.equal(invRes.res.status, 201);
    const invoiceId = String(invRes.json?.invoiceId);
    createdInvoiceIds.push(invoiceId);

    // 6. RBAC on GET /api/invoices/:id (instructor 403, stu2 403, stu1 200, admin 200)
    const instInvDetail = await apiFetch(`/api/invoices/${invoiceId}`, { cookie: instCookie });
    assert.equal(instInvDetail.res.status, 403);
    const stu2InvDetail = await apiFetch(`/api/invoices/${invoiceId}`, { cookie: stu2Cookie });
    assert.equal(stu2InvDetail.res.status, 403);

    const stu1InvDetail = await apiFetch(`/api/invoices/${invoiceId}`, { cookie: stu1Cookie });
    assert.equal(stu1InvDetail.res.status, 200);
    const detailItems = stu1InvDetail.json?.items as Array<{ itemType: string; lineTotal: string }>;
    assert.equal(detailItems.length, 3); // Tuition + Registration + Lab

    // 7. Apply Discount (-1200.00) & Scholarship (-1000.00) -> net due becomes 9800.00
    const adj1 = await apiFetch(`/api/invoices/${invoiceId}/adjustments`, {
      method: 'POST',
      cookie: adminCookie,
      body: { kind: 'discount', targetId: discountId, notes: 'Approved early enrollment' },
    });
    assert.equal(adj1.res.status, 201);
    assert.equal(adj1.json?.adjustmentCents, 120000);

    const adj2 = await apiFetch(`/api/invoices/${invoiceId}/adjustments`, {
      method: 'POST',
      cookie: adminCookie,
      body: { kind: 'scholarship', targetId: scholarshipId },
    });
    assert.equal(adj2.res.status, 201);
    assert.equal(adj2.json?.adjustmentCents, 100000);

    const updatedDetail = await apiFetch(`/api/invoices/${invoiceId}`, { cookie: adminCookie });
    assert.equal(updatedDetail.res.status, 200);
    const invData = updatedDetail.json?.invoice as {
      subtotal: string;
      discountTotal: string;
      scholarshipTotal: string;
      amountDue: string;
    };
    assert.equal(invData.subtotal, '12000.00');
    assert.equal(invData.discountTotal, '1200.00');
    assert.equal(invData.scholarshipTotal, '1000.00');
    assert.equal(invData.amountDue, '9800.00');

    // 8. Record full payment (9800.00) -> status Paid, then test bounded refund (3000.00) -> status Partial
    const payRes = await apiFetch(`/api/invoices/${invoiceId}/payments`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        amount: '9800.00',
        method: 'Bank Transfer',
        referenceCode: `UTR-${runSuffix}`,
        notes: 'Full net settlement',
      },
    });
    assert.equal(payRes.res.status, 201);

    const paymentRow = await prisma.payment.findFirst({ where: { invoiceId } });
    assert.ok(paymentRow);

    // Over-refund rejected
    const overRefundRes = await apiFetch(`/api/payments/${paymentRow.id}/refund`, {
      method: 'POST',
      cookie: adminCookie,
      body: { amount: '9900.00', reason: 'Excess refund attempt' },
    });
    assert.equal(overRefundRes.res.status, 400);

    // Valid partial refund (3000.00) reverts invoice from Paid to Partial
    const refundRes = await apiFetch(`/api/payments/${paymentRow.id}/refund`, {
      method: 'POST',
      cookie: adminCookie,
      body: { amount: '3000.00', reason: 'Course lab waiver post-payment' },
    });
    assert.equal(refundRes.res.status, 201);
    assert.ok(String(refundRes.json?.refundNumber).startsWith('REF-'));

    const postRefundDetail = await apiFetch(`/api/invoices/${invoiceId}`, { cookie: adminCookie });
    assert.equal(postRefundDetail.res.status, 200);
    const invAfterRefund = postRefundDetail.json?.invoice as {
      amountPaid: string;
      status: string;
    };
    assert.equal(invAfterRefund.amountPaid, '6800.00');
    assert.equal(invAfterRefund.status, 'Partial');
    const refundsList = postRefundDetail.json?.refunds as Array<{ amount: string }>;
    assert.equal(refundsList.length, 1);
    assert.equal(refundsList[0].amount, '3000.00');
  } finally {
    await prisma.refund.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await prisma.feeStructure.deleteMany({
      where: {
        OR: [
          { id: { in: createdFeeStructureIds } },
          { courseId: { in: createdCourseIds } },
        ],
      },
    });
    await prisma.feePlan.deleteMany({ where: { id: { in: createdFeePlanIds } } });
    await prisma.discount.deleteMany({ where: { id: { in: createdDiscountIds } } });
    await prisma.scholarship.deleteMany({ where: { id: { in: createdScholarshipIds } } });
    await prisma.courseModule.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.deliveryLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
