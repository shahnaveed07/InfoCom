import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCertificateEligibility,
  computeInvoiceStatus,
  fromCents,
  toCents,
} from './academic.ts';
import {
  createCourseSchema,
  createInvoiceSchema,
  recordPaymentSchema,
  registerSchema,
} from './validation.ts';

test('toCents and fromCents handle decimal currency safely without float drift', () => {
  assert.equal(toCents('1499.99'), 149999);
  assert.equal(toCents('0.10') + toCents('0.20'), 30);
  assert.equal(fromCents(149999), '1499.99');
  assert.equal(computeInvoiceStatus('1200.00', '0.00'), 'Unpaid');
  assert.equal(computeInvoiceStatus('1200.00', '450.50'), 'Partial');
  assert.equal(computeInvoiceStatus('1200.00', '1200.00'), 'Paid');
});

test('computeCertificateEligibility enforces completion, weighted score, and attendance thresholds', () => {
  const ineligible = computeCertificateEligibility({
    enrollmentStatus: 'Active',
    completionPct: 75,
    weightedScore: 88,
    attendanceRate: 90,
  });
  assert.equal(ineligible.eligible, false);
  assert.ok(ineligible.reasons.length >= 1);

  const eligible = computeCertificateEligibility({
    enrollmentStatus: 'Completed',
    completionPct: 100,
    weightedScore: 85,
    attendanceRate: 88,
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reasons.length, 0);
});

test('Zod schemas reject invalid registration, invoice, payment, and course inputs', () => {
  const regBad = registerSchema.safeParse({
    name: 'A',
    email: 'not-an-email',
    password: 'short',
  });
  assert.equal(regBad.success, false);

  const invBad = createInvoiceSchema.safeParse({
    studentId: 'stu-1',
    courseId: 'crs-1',
    description: 'Tuition',
    amountDue: '0.00',
    dueDate: '2026-09-01T00:00:00.000Z',
  });
  assert.equal(invBad.success, false);

  const payGood = recordPaymentSchema.safeParse({
    amount: '250.75',
    method: 'Card',
    referenceCode: 'TXN-9012',
    notes: 'Installment 1',
  });
  assert.equal(payGood.success, true);

  const crsGood = createCourseSchema.safeParse({
    code: 'SEC-204',
    title: 'Applied Cloud Security',
    track: 'Security',
    instructorId: 'ins-1',
    durationWeeks: 8,
    tuitionFee: '1350.00',
    modules: [{ code: 'MOD-1', title: 'IAM', weight: 100, labHours: 20 }],
  });
  assert.equal(crsGood.success, true);
});
