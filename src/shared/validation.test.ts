import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCertificateEligibility,
  computeInvoiceStatus,
  fromCents,
  toCents,
} from './academic.ts';
import {
  applyInvoiceAdjustmentSchema,
  approveAdmissionSchema,
  bulkAttendanceSchema,
  courseTransferSchema,
  createAdmissionSchema,
  createAssessmentSchema,
  createCourseSchema,
  createDiscountSchema,
  createFeePlanSchema,
  createFeeStructureSchema,
  createInvoiceSchema,
  createScholarshipSchema,
  markAttendanceSchema,
  recordPaymentSchema,
  refundPaymentSchema,
  registerSchema,
  saveAssessmentGradeSchema,
  updateEnrollmentStatusSchema,
  verifyAdmissionDocumentSchema,
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

test('Phase 5 admission draft/submit, verification, approval, and course transfer schemas', () => {
  // Incomplete draft is valid as long as name or email + targetCourseId are provided
  assert.equal(
    createAdmissionSchema.safeParse({
      status: 'Draft',
      applicantName: 'Aarav',
      targetCourseId: 'crs-1',
    }).success,
    true
  );

  // Submitting without email or cohort fails
  assert.equal(
    createAdmissionSchema.safeParse({
      status: 'Submitted',
      applicantName: 'Aarav',
      targetCourseId: 'crs-1',
    }).success,
    false
  );

  assert.equal(
    verifyAdmissionDocumentSchema.safeParse({
      status: 'Replacement Required',
      verificationRemarks: 'Blurry ID scan',
    }).success,
    true
  );

  assert.equal(
    approveAdmissionSchema.safeParse({
      targetBatchId: 'bat-1',
      feePlanId: 'fp-1',
      waitlistIfFull: true,
    }).success,
    true
  );

  assert.equal(
    courseTransferSchema.safeParse({
      toCourseId: 'crs-2',
      toBatchId: 'bat-2',
      reason: 'Switching track to Cloud Engineering',
    }).success,
    true
  );

  assert.equal(
    updateEnrollmentStatusSchema.safeParse({
      status: 'Cancelled',
      reason: 'Applicant deferred to next quarter',
    }).success,
    true
  );
});

test('Phase F assessment, grade, Excused attendance, and bulk attendance validation schemas', () => {
  assert.equal(
    createAssessmentSchema.safeParse({
      courseId: 'crs-1',
      title: 'Midterm Practical',
      assessmentType: 'Midterm',
      maxScore: 100,
      weight: 30,
    }).success,
    true
  );
  assert.equal(
    createAssessmentSchema.safeParse({
      courseId: 'crs-1',
      title: 'Invalid Type',
      assessmentType: 'OralPopQuiz',
    }).success,
    false
  );
  assert.equal(
    saveAssessmentGradeSchema.safeParse({
      studentId: 'stu-1',
      score: -5,
      feedback: '',
    }).success,
    false
  );
  assert.equal(
    markAttendanceSchema.safeParse({
      sessionId: 'ses-1',
      studentId: 'stu-1',
      status: 'Excused',
      note: 'Medical leave approved',
    }).success,
    true
  );
  assert.equal(
    bulkAttendanceSchema.safeParse({
      sessionId: 'ses-1',
      entries: [],
    }).success,
    false
  );
  assert.equal(
    bulkAttendanceSchema.safeParse({
      sessionId: 'ses-1',
      entries: [
        { studentId: 'stu-1', status: 'Present', note: '' },
        { studentId: 'stu-2', status: 'Excused', note: 'Exam clash' },
      ],
    }).success,
    true
  );
});

test('Phase G fee plan, fee structure, discount, scholarship, adjustment, and refund schemas', () => {
  assert.equal(
    createFeePlanSchema.safeParse({
      code: 'FP-3TERM',
      name: 'Quarterly Installment',
      installmentCount: 3,
    }).success,
    true
  );
  assert.equal(
    createFeePlanSchema.safeParse({
      code: 'X',
      name: 'Invalid',
      installmentCount: 0,
    }).success,
    false
  );

  assert.equal(
    createFeeStructureSchema.safeParse({
      courseId: 'crs-1',
      tuitionAmount: '12000.00',
      registrationFee: '500.00',
      labFee: '1000.00',
    }).success,
    true
  );

  assert.equal(
    createDiscountSchema.safeParse({
      code: 'OVER100',
      name: 'Invalid Pct',
      discountType: 'Percentage',
      value: '120.00',
    }).success,
    false
  );
  assert.equal(
    createDiscountSchema.safeParse({
      code: 'EARLY15',
      name: 'Early Bird',
      discountType: 'Percentage',
      value: '15.00',
    }).success,
    true
  );

  assert.equal(
    createScholarshipSchema.safeParse({
      code: 'MERIT25',
      name: 'Sopore Merit Grant',
      coverageType: 'Percentage',
      coverageValue: '25.00',
      maxRecipients: 20,
    }).success,
    true
  );

  assert.equal(
    applyInvoiceAdjustmentSchema.safeParse({
      kind: 'discount',
      targetId: 'dsc-1',
    }).success,
    true
  );
  assert.equal(
    refundPaymentSchema.safeParse({
      amount: '500.00',
      reason: 'Abc',
    }).success,
    false
  );
  assert.equal(
    refundPaymentSchema.safeParse({
      amount: '500.00',
      reason: 'Student withdrew before batch start',
    }).success,
    true
  );
});



