import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8, 'Current password is required.'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .max(128, 'Password cannot exceed 128 characters.'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Valid email address is required.'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16, 'Valid password reset token is required.').max(256),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .max(128, 'Password cannot exceed 128 characters.'),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required.').max(120),
  email: z.string().trim().email('Valid email is required.'),
  role: z.enum(['admin', 'instructor', 'student']),
  department: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  password: z
    .string()
    .min(8, 'Initial password must be at least 8 characters.')
    .max(128)
    .optional()
    .or(z.literal('')),
  requirePasswordChange: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['admin', 'instructor', 'student']).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'archived']).optional(),
  department: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
});

export const admissionAttachmentSchema = z.object({
  documentType: z.string().trim().min(2).max(80).default('ID Verification'),
  title: z.string().trim().min(2).max(160),
  category: z
    .enum(['ID Verification', 'Transcript', 'Syllabus', 'Assignment', 'Receipt', 'Other'])
    .default('ID Verification'),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(4).max(3_000_000, 'File exceeds 2MB decoded upload limit.'),
});

export const createAdmissionSchema = z
  .object({
    applicantName: z.string().trim().max(120).optional().default(''),
    applicantEmail: z.string().trim().max(160).optional().default(''),
    phone: z.string().trim().max(40).optional().default(''),
    dateOfBirth: z.string().trim().max(40).optional().nullable(),
    gender: z.string().trim().max(40).optional().default(''),
    nationality: z.string().trim().max(80).optional().default(''),
    address: z.string().trim().max(400).optional().default(''),
    city: z.string().trim().max(100).optional().default(''),
    postalCode: z.string().trim().max(32).optional().default(''),
    guardianName: z.string().trim().max(120).optional().default(''),
    guardianRelationship: z.string().trim().max(60).optional().default(''),
    guardianPhone: z.string().trim().max(40).optional().default(''),
    guardianEmail: z.string().trim().max(160).optional().default(''),
    previousQualification: z.string().trim().max(160).optional().default(''),
    previousInstitution: z.string().trim().max(160).optional().default(''),
    graduationYear: z.string().trim().max(16).optional().default(''),
    previousScore: z.string().trim().max(40).optional().default(''),
    targetCourseId: z.string().trim().min(1, 'Target course is required.'),
    targetBatchId: z.string().trim().optional().nullable(),
    feePlanId: z.string().trim().optional().nullable(),
    preferredCohort: z.string().trim().max(120).optional().default(''),
    status: z.enum(['Draft', 'Submitted']).optional().default('Submitted'),
    notes: z.string().trim().max(1000).optional().default(''),
    applicantRemarks: z.string().trim().max(1000).optional().default(''),
    documents: z.array(admissionAttachmentSchema).max(6).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'Draft') {
      if (data.applicantName.length < 2 && !data.applicantEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['applicantName'],
          message: 'Provide at least applicant name or email to save a draft.',
        });
      }
      if (data.applicantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.applicantEmail)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['applicantEmail'],
          message: 'Valid applicant email is required.',
        });
      }
      if (data.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['guardianEmail'],
          message: 'Valid guardian email is required.',
        });
      }
      return;
    }

    if (data.applicantName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicantName'],
        message: 'Applicant name is required.',
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.applicantEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicantEmail'],
        message: 'Valid applicant email is required.',
      });
    }
    if (data.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guardianEmail'],
        message: 'Valid guardian email is required.',
      });
    }
    if (!data.preferredCohort && !data.targetBatchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preferredCohort'],
        message: 'Preferred cohort or batch is required.',
      });
    }
  });

export const updateAdmissionSchema = z.object({
  applicantName: z.string().trim().min(2).max(120).optional(),
  applicantEmail: z.string().trim().email('Valid applicant email is required.').optional(),
  phone: z.string().trim().max(40).optional(),
  dateOfBirth: z.string().trim().max(40).optional().nullable(),
  gender: z.string().trim().max(40).optional(),
  nationality: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(32).optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianRelationship: z.string().trim().max(60).optional(),
  guardianPhone: z.string().trim().max(40).optional(),
  guardianEmail: z.string().trim().email('Valid guardian email is required.').or(z.literal('')).optional(),
  previousQualification: z.string().trim().max(160).optional(),
  previousInstitution: z.string().trim().max(160).optional(),
  graduationYear: z.string().trim().max(16).optional(),
  previousScore: z.string().trim().max(40).optional(),
  targetCourseId: z.string().trim().min(1).optional(),
  targetBatchId: z.string().trim().optional().nullable(),
  feePlanId: z.string().trim().optional().nullable(),
  preferredCohort: z.string().trim().max(120).optional(),
  status: z
    .enum([
      'Draft',
      'Submitted',
      'Under Review',
      'Documents Required',
      'Approved',
      'Rejected',
      'Withdrawn',
      'Accepted',
      'Enrolled',
    ])
    .optional(),
  notes: z.string().trim().max(1000).optional(),
  applicantRemarks: z.string().trim().max(1000).optional(),
  reviewRemarks: z.string().trim().max(1000).optional(),
  rejectionReason: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(500).optional(),
  convertToEnrollment: z.boolean().optional(),
  waitlistIfFull: z.boolean().optional(),
});

export const approveAdmissionSchema = z.object({
  targetCourseId: z.string().trim().min(1).optional(),
  targetBatchId: z.string().trim().min(1, 'Target batch allocation is required.'),
  feePlanId: z.string().trim().optional().nullable(),
  waitlistIfFull: z.boolean().optional().default(false),
  reviewRemarks: z.string().trim().max(1000).optional().default(''),
  issueInvoice: z.boolean().optional().default(true),
});

export const uploadAdmissionDocumentSchema = admissionAttachmentSchema;

export const verifyAdmissionDocumentSchema = z.object({
  status: z.enum(['Verified', 'Replacement Required', 'Rejected']),
  verificationRemarks: z.string().trim().max(500).optional().default(''),
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(3).max(160),
  track: z.string().trim().min(2).max(100),
  category: z.string().trim().max(100).optional().default('Technical Bootcamp'),
  departmentId: z.string().trim().optional().nullable(),
  description: z.string().trim().max(2000).optional().default(''),
  prerequisites: z.string().trim().max(1000).optional().default(''),
  learningObjectives: z.array(z.string().trim().min(2).max(300)).max(20).optional().default([]),
  passingScore: z.coerce.number().int().min(1).max(100).optional().default(60),
  minAttendanceRate: z.coerce.number().int().min(1).max(100).optional().default(75),
  gradingConfig: z
    .object({
      scaleName: z.string().trim().max(80).optional(),
      passingGrade: z.string().trim().max(10).optional(),
      rubricNotes: z.string().trim().max(1000).optional(),
    })
    .optional(),
  instructorId: z.string().trim().min(1),
  durationWeeks: z.coerce.number().int().min(1).max(104),
  tuitionFee: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Tuition fee must be a valid non-negative decimal.'),
  slug: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase letters, numbers, and hyphens only.')
    .optional(),
  isPublished: z.boolean().optional().default(false),
  showTuitionPublicly: z.boolean().optional().default(true),
  modules: z
    .array(
      z.object({
        id: z.string().trim().optional(),
        code: z.string().trim().min(1).max(16),
        title: z.string().trim().min(2).max(160),
        weight: z.coerce.number().int().min(1).max(100),
        labHours: z.coerce.number().int().min(1).max(200),
      })
    )
    .min(1, 'At least one module is required.'),
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

export const createCohortSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(120),
  courseId: z.string().trim().min(1),
  termId: z.string().trim().optional().nullable(),
  instructorId: z.string().trim().min(1),
  classroomId: z.string().trim().optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(500),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start date required.'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid end date required.'),
  status: z.enum(['Planned', 'Active', 'Completed', 'Archived']).default('Active'),
});

export const updateCohortSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  termId: z.string().trim().optional().nullable(),
  instructorId: z.string().trim().min(1).optional(),
  classroomId: z.string().trim().optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start date required.').optional(),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid end date required.').optional(),
  status: z.enum(['Planned', 'Active', 'Completed', 'Archived']).optional(),
});

export const createEnrollmentSchema = z.object({
  studentId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  cohort: z.string().trim().min(2).max(120),
  cohortId: z.string().trim().optional(),
  status: z.enum(['Active', 'Waitlisted']).default('Active'),
  issueTuitionInvoice: z.boolean().optional().default(true),
});

export const updateEnrollmentStatusSchema = z.object({
  status: z.enum([
    'Active',
    'Waitlisted',
    'Completed',
    'Cancelled',
    'Withdrawn',
    'Dropped',
  ]),
  reason: z.string().trim().max(500).optional().default(''),
});

export const toggleModuleSchema = z.object({
  enrollmentId: z.string().trim().min(1),
  moduleId: z.string().trim().min(1),
  completed: z.boolean(),
});

export const assessmentTypeSchema = z.enum([
  'Module Assessment',
  'Assignment',
  'Quiz',
  'Lab',
  'Midterm',
  'Final',
]);

export const createAssessmentSchema = z.object({
  courseId: z.string().trim().min(1, 'Course is required.'),
  moduleId: z.string().trim().optional().nullable(),
  batchId: z.string().trim().optional().nullable(),
  title: z.string().trim().min(2, 'Assessment title is required.').max(160),
  assessmentType: assessmentTypeSchema.default('Assignment'),
  maxScore: z.coerce.number().int().min(1).max(1000).default(100),
  weight: z.coerce.number().int().min(1).max(100).default(20),
  dueDate: z
    .string()
    .trim()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid due date required.')
    .optional()
    .nullable(),
});

export const updateAssessmentSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  assessmentType: assessmentTypeSchema.optional(),
  moduleId: z.string().trim().optional().nullable(),
  batchId: z.string().trim().optional().nullable(),
  maxScore: z.coerce.number().int().min(1).max(1000).optional(),
  weight: z.coerce.number().int().min(1).max(100).optional(),
  dueDate: z
    .string()
    .trim()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid due date required.')
    .optional()
    .nullable(),
});

export const saveAssessmentGradeSchema = z.object({
  studentId: z.string().trim().min(1),
  score: z.coerce.number().min(0, 'Score cannot be negative.'),
  feedback: z.string().trim().max(1000).optional().default(''),
});

export const saveGradeSchema = z.object({
  studentId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  moduleId: z.string().trim().min(1),
  score: z.coerce.number().int().min(0).max(100),
  feedback: z.string().trim().max(1000).optional().default(''),
});

export const saveRemarkSchema = z.object({
  studentId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  summary: z.string().trim().min(4).max(2000),
});

export const attendanceStatusSchema = z.enum(['Present', 'Late', 'Absent', 'Excused']);

export const markAttendanceSchema = z.object({
  sessionId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  status: attendanceStatusSchema,
  note: z.string().trim().max(500).optional().default(''),
});

export const bulkAttendanceSchema = z.object({
  sessionId: z.string().trim().min(1),
  entries: z
    .array(
      z.object({
        studentId: z.string().trim().min(1),
        status: attendanceStatusSchema,
        note: z.string().trim().max(500).optional().default(''),
      })
    )
    .min(1, 'At least one student attendance entry is required.')
    .max(250),
});

export const createSessionSchema = z.object({
  courseId: z.string().trim().min(1),
  cohort: z.string().trim().min(2).max(120),
  cohortId: z.string().trim().optional(),
  title: z.string().trim().min(3).max(160),
  topic: z.string().trim().max(500).optional().default(''),
  room: z.string().trim().min(1).max(80),
  startIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start time required.'),
  durationHours: z.coerce.number().min(0.5).max(12).default(2),
});

export const createInvoiceSchema = z.object({
  studentId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  enrollmentId: z.string().trim().optional(),
  feeStructureId: z.string().trim().optional().nullable(),
  description: z.string().trim().min(3).max(240),
  amountDue: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Amount due must be a valid decimal.').refine((v) => Number(v) > 0, 'Amount due must be greater than zero.'),
  dueDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid due date required.'),
});

export const recordPaymentSchema = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Payment amount must be a valid decimal.').refine((v) => Number(v) > 0, 'Payment amount must be greater than zero.'),
  method: z.enum(['Card', 'Bank Transfer', 'Cash', 'Corporate Sponsorship']),
  referenceCode: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal.')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero.');

const nonNegativeDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal.')
  .refine((v) => Number(v) >= 0, 'Amount cannot be negative.');

export const createFeePlanSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional().default(''),
  installmentCount: z.coerce.number().int().min(1).max(24).default(1),
  isActive: z.boolean().optional().default(true),
});

export const updateFeePlanSchema = createFeePlanSchema.partial();

export const createFeeStructureSchema = z.object({
  courseId: z.string().trim().min(1, 'Course is required.'),
  batchId: z.string().trim().optional().nullable(),
  feePlanId: z.string().trim().optional().nullable(),
  tuitionAmount: positiveDecimalString,
  registrationFee: nonNegativeDecimalString.optional().default('0.00'),
  labFee: nonNegativeDecimalString.optional().default('0.00'),
  isActive: z.boolean().optional().default(true),
});

export const updateFeeStructureSchema = createFeeStructureSchema.partial();

export const createDiscountSchema = z
  .object({
    code: z.string().trim().min(2).max(32),
    name: z.string().trim().min(2).max(120),
    discountType: z.enum(['Percentage', 'Fixed']),
    value: positiveDecimalString,
    isActive: z.boolean().optional().default(true),
    validFrom: z
      .string()
      .trim()
      .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid start date required.')
      .optional()
      .nullable(),
    validTo: z
      .string()
      .trim()
      .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid end date required.')
      .optional()
      .nullable(),
  })
  .refine(
    (d) => d.discountType !== 'Percentage' || Number(d.value) <= 100,
    'Percentage discount cannot exceed 100%.'
  );

export const updateDiscountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  discountType: z.enum(['Percentage', 'Fixed']).optional(),
  value: positiveDecimalString.optional(),
  isActive: z.boolean().optional(),
  validFrom: z
    .string()
    .trim()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid start date required.')
    .optional()
    .nullable(),
  validTo: z
    .string()
    .trim()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Valid end date required.')
    .optional()
    .nullable(),
});

export const createScholarshipSchema = z
  .object({
    code: z.string().trim().min(2).max(32),
    name: z.string().trim().min(2).max(120),
    sponsorName: z.string().trim().max(120).optional().default(''),
    coverageType: z.enum(['Percentage', 'Fixed']),
    coverageValue: positiveDecimalString,
    maxRecipients: z.coerce.number().int().min(1).max(1000).default(10),
    academicYearId: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional().default(true),
  })
  .refine(
    (s) => s.coverageType !== 'Percentage' || Number(s.coverageValue) <= 100,
    'Percentage scholarship coverage cannot exceed 100%.'
  );

export const updateScholarshipSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  sponsorName: z.string().trim().max(120).optional(),
  coverageType: z.enum(['Percentage', 'Fixed']).optional(),
  coverageValue: positiveDecimalString.optional(),
  maxRecipients: z.coerce.number().int().min(1).max(1000).optional(),
  academicYearId: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const applyInvoiceAdjustmentSchema = z.object({
  kind: z.enum(['discount', 'scholarship']),
  targetId: z.string().trim().min(1, 'Select a discount or scholarship.'),
  notes: z.string().trim().max(300).optional().default(''),
});

export const refundPaymentSchema = z.object({
  amount: positiveDecimalString,
  reason: z.string().trim().min(4, 'Refund reason is required.').max(400),
});

export const uploadDocumentSchema = z.object({
  ownerUserId: z.string().trim().min(1).optional(),
  courseId: z.string().trim().optional(),
  title: z.string().trim().min(2).max(160),
  category: z.enum(['ID Verification', 'Transcript', 'Syllabus', 'Assignment', 'Receipt', 'Other']),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(4).max(3_000_000, 'File exceeds 2MB decoded upload limit.'),
});

export const issueCertificateSchema = z.object({
  studentId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
});

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().min(4, 'Revocation reason is required.').max(500),
});

// Phase 4 Admin & Master Data Schemas

export const createStudentSchema = z.object({
  name: z.string().trim().min(2, 'Student full name is required.').max(120),
  email: z.string().trim().email('Valid email address is required.'),
  phone: z.string().trim().max(40).optional().default(''),
  password: z
    .string()
    .min(8, 'Initial password must be at least 8 characters.')
    .max(128)
    .optional()
    .or(z.literal('')),
  requirePasswordChange: z.boolean().optional(),
  departmentId: z.string().trim().optional().nullable(),
  dateOfBirth: z.string().trim().optional().nullable(),
  address: z.string().trim().max(400).optional().default(''),
  emergencyContact: z.string().trim().max(240).optional().default(''),
  guardianName: z.string().trim().max(120).optional().default(''),
  guardianRelationship: z.string().trim().max(60).optional().default(''),
  guardianPhone: z.string().trim().max(40).optional().default(''),
  academicStanding: z.string().trim().max(60).optional().default('Good Standing'),
  initialCourseId: z.string().trim().optional(),
  initialCohortId: z.string().trim().optional(),
  enrollmentStatus: z.enum(['Active', 'Waitlisted']).optional().default('Active'),
  issueTuitionInvoice: z.boolean().optional().default(true),
});

export const updateStudentSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email('Valid email address is required.').optional(),
  phone: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'archived']).optional(),
  departmentId: z.string().trim().optional().nullable(),
  dateOfBirth: z.string().trim().optional().nullable(),
  address: z.string().trim().max(400).optional(),
  emergencyContact: z.string().trim().max(240).optional(),
  academicStanding: z.string().trim().max(60).optional(),
});

export const instructorPermissionKeySchema = z.enum([
  'enrollments:manage',
  'progress:manage',
  'grades:manage',
  'sessions:manage',
  'attendance:manage',
  'documents:upload',
  'certificates:issue',
]);

export const createInstructorSchema = z.object({
  name: z.string().trim().min(2, 'Instructor full name is required.').max(120),
  email: z.string().trim().email('Valid email address is required.'),
  phone: z.string().trim().max(40).optional().default(''),
  password: z
    .string()
    .min(8, 'Initial password must be at least 8 characters.')
    .max(128)
    .optional()
    .or(z.literal('')),
  requirePasswordChange: z.boolean().optional(),
  departmentId: z.string().trim().optional().nullable(),
  specialization: z.string().trim().max(160).optional().default(''),
  qualification: z.string().trim().max(160).optional().default(''),
  bio: z.string().trim().max(1000).optional().default(''),
  hireDate: z.string().trim().optional().nullable(),
  courseIds: z.array(z.string().trim().min(1)).optional().default([]),
  batchIds: z.array(z.string().trim().min(1)).optional().default([]),
  permissions: z.array(instructorPermissionKeySchema).optional(),
});

export const updateInstructorSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email('Valid email address is required.').optional(),
  phone: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'archived']).optional(),
  departmentId: z.string().trim().optional().nullable(),
  specialization: z.string().trim().max(160).optional(),
  qualification: z.string().trim().max(160).optional(),
  bio: z.string().trim().max(1000).optional(),
  hireDate: z.string().trim().optional().nullable(),
});

export const assignInstructorCoursesSchema = z.object({
  courseIds: z.array(z.string().trim().min(1)).default([]),
  batchIds: z.array(z.string().trim().min(1)).default([]),
});

export const updateInstructorPermissionsSchema = z.object({
  permissions: z.array(instructorPermissionKeySchema),
});

export const createDepartmentSchema = z.object({
  code: z.string().trim().min(2).max(24),
  name: z.string().trim().min(2).max(120),
  headUserId: z.string().trim().optional().nullable(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const createClassroomSchema = z.object({
  code: z.string().trim().min(2).max(24),
  name: z.string().trim().min(2).max(120),
  building: z.string().trim().min(1).max(120).default('Main Campus'),
  capacity: z.coerce.number().int().min(1).max(500),
  equipment: z.string().trim().max(400).optional().default(''),
  isActive: z.boolean().default(true),
});

export const updateClassroomSchema = createClassroomSchema.partial();

export const assignStudentToCohortSchema = z.object({
  studentId: z.string().trim().min(1),
  status: z.enum(['Active', 'Waitlisted']).default('Active'),
  issueTuitionInvoice: z.boolean().optional().default(true),
});

export const transferEnrollmentSchema = z.object({
  toBatchId: z.string().trim().min(1, 'Destination batch is required.'),
  reason: z.string().trim().min(3, 'Transfer reason is required.').max(300),
});

export const courseTransferSchema = z.object({
  toCourseId: z.string().trim().min(1, 'Destination course is required.'),
  toBatchId: z.string().trim().min(1, 'Destination batch is required.'),
  reason: z.string().trim().min(3, 'Course transfer reason is required.').max(300),
  status: z.enum(['Active', 'Waitlisted']).optional().default('Active'),
  issueTuitionInvoice: z.boolean().optional().default(true),
});

export const academicYearSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(120),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start date required.'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid end date required.'),
  isCurrent: z.boolean().optional().default(false),
  status: z.enum(['Planned', 'Active', 'Completed', 'Archived']).optional().default('Active'),
});

export const updateAcademicYearSchema = academicYearSchema.partial();

export const academicTermSchema = z.object({
  academicYearId: z.string().trim().min(1),
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(120),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start date required.'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid end date required.'),
  isCurrent: z.boolean().optional().default(false),
  status: z.enum(['Planned', 'Active', 'Completed', 'Archived']).optional().default('Active'),
});

export const updateAcademicTermSchema = academicTermSchema.partial();

export const updateAcademySettingsSchema = z.object({
  academy: z.object({
    name: z.string().trim().min(2).max(160),
    legalName: z.string().trim().max(240).optional().default(''),
    email: z.string().trim().email('Valid academy email is required.').or(z.literal('')),
    phone: z.string().trim().max(60).optional().default(''),
    website: z.string().trim().max(200).optional().default(''),
    address: z.string().trim().max(400).optional().default(''),
    logoDataUrl: z
      .string()
      .max(650_000, 'Logo image must be under 500 KB.')
      .refine(
        (v) => v === '' || /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v),
        'Logo must be a valid PNG, JPEG, WebP, or SVG image.'
      )
      .optional(),
    timezone: z.string().trim().min(2).max(80).default('Asia/Kolkata'),
    currency: z.string().trim().min(3).max(8).default('INR'),
  }),
  policies: z.object({
    studentIdPrefix: z
      .string()
      .trim()
      .min(2)
      .max(12)
      .regex(/^[A-Z0-9-]+$/i, 'Student ID prefix must contain only letters, numbers, or hyphens.')
      .optional()
      .default('IGS'),
    invoicePrefix: z.string().trim().min(2).max(24),
    invoiceNextSeq: z.coerce.number().int().min(1).max(9_999_999),
    feeDueDays: z.coerce.number().int().min(1).max(180),
    lateFeePct: z.coerce.number().min(0).max(50),
    passingScore: z.coerce.number().int().min(1).max(100),
    distinctionScore: z.coerce.number().int().min(1).max(100),
    minAttendanceRatePct: z.coerce.number().int().min(1).max(100),
    lateWeightPct: z.coerce.number().int().min(0).max(100),
    reminderWindowHours: z.coerce.number().int().min(1).max(168),
    certificateCodePrefix: z.string().trim().min(2).max(32),
    certificateMinCompletionPct: z.coerce.number().int().min(1).max(100),
    certificateMinScore: z.coerce.number().int().min(1).max(100),
    certificateMinAttendancePct: z.coerce.number().int().min(1).max(100),
    portalActivationPolicy: z
      .enum(['immediate', 'on_approval', 'manual_activation', 'after_first_payment'])
      .optional()
      .default('on_approval'),
  }),
  certificateTemplate: z
    .object({
      name: z.string().trim().min(2).max(160),
      titleFormat: z.string().trim().min(2).max(160),
      signatoryName: z.string().trim().min(2).max(120),
      signatoryTitle: z.string().trim().min(2).max(120),
    })
    .optional(),
});

export const notificationPreferencesUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        channel: z.enum(['in_app', 'email']),
        kind: z.string().trim().min(1).max(40),
        enabled: z.boolean(),
      })
    )
    .min(1)
    .max(40),
});
