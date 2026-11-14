import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120),
  email: z.string().trim().email('Valid email address is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  phone: z.string().trim().max(40).optional().default(''),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required.').max(120),
  email: z.string().trim().email('Valid email is required.'),
  role: z.enum(['admin', 'instructor', 'student']),
  department: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  password: z.string().min(8, 'Initial password must be at least 8 characters.').max(128),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['admin', 'instructor', 'student']).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  department: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
});

export const createAdmissionSchema = z.object({
  applicantName: z.string().trim().min(2, 'Applicant name is required.').max(120),
  applicantEmail: z.string().trim().email('Valid applicant email is required.'),
  phone: z.string().trim().max(40).optional().default(''),
  targetCourseId: z.string().trim().min(1, 'Target course is required.'),
  preferredCohort: z.string().trim().min(2, 'Preferred cohort is required.').max(120),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const updateAdmissionSchema = z.object({
  status: z.enum(['Submitted', 'Under Review', 'Accepted', 'Rejected', 'Enrolled']),
  notes: z.string().trim().max(1000).optional(),
  convertToEnrollment: z.boolean().optional(),
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(3).max(160),
  track: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().default(''),
  instructorId: z.string().trim().min(1),
  durationWeeks: z.coerce.number().int().min(1).max(104),
  tuitionFee: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Tuition fee must be a valid non-negative decimal.'),
  modules: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(16),
        title: z.string().trim().min(2).max(160),
        weight: z.coerce.number().int().min(1).max(100),
        labHours: z.coerce.number().int().min(1).max(200),
      })
    )
    .min(1, 'At least one module is required.'),
});

export const createCohortSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(120),
  courseId: z.string().trim().min(1),
  instructorId: z.string().trim().min(1),
  capacity: z.coerce.number().int().min(1).max(500),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid start date required.'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Valid end date required.'),
  status: z.enum(['Planned', 'Active', 'Completed', 'Archived']).default('Active'),
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
  status: z.enum(['Active', 'Completed', 'Waitlisted', 'Dropped']),
});

export const toggleModuleSchema = z.object({
  enrollmentId: z.string().trim().min(1),
  moduleId: z.string().trim().min(1),
  completed: z.boolean(),
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

export const markAttendanceSchema = z.object({
  sessionId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  status: z.enum(['Present', 'Late', 'Absent']),
  note: z.string().trim().max(500).optional().default(''),
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
