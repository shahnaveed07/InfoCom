import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  firebaseUid: text('firebase_uid').unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').notNull().default('student'), // 'admin' | 'instructor' | 'student'
  status: text('status').notNull().default('active'), // 'active' | 'inactive' | 'archived'
  studentCode: text('student_code').unique(),
  staffCode: text('staff_code').unique(),
  department: text('department'),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courses = pgTable('courses', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  track: text('track').notNull(),
  description: text('description').notNull().default(''),
  instructorId: text('instructor_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  durationWeeks: integer('duration_weeks').notNull().default(8),
  tuitionFee: numeric('tuition_fee', { precision: 12, scale: 2 })
    .notNull()
    .default('1200.00'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseModules = pgTable(
  'course_modules',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    weight: integer('weight').notNull(),
    labHours: integer('lab_hours').notNull().default(10),
    sortOrder: integer('sort_order').notNull().default(1),
  },
  (table) => [
    uniqueIndex('course_modules_course_code_idx').on(table.courseId, table.code),
  ]
);

export const cohorts = pgTable('cohorts', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  courseId: text('course_id')
    .references(() => courses.id, { onDelete: 'restrict' })
    .notNull(),
  instructorId: text('instructor_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  capacity: integer('capacity').notNull().default(24),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('Active'), // 'Planned' | 'Active' | 'Completed' | 'Archived'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const admissions = pgTable('admissions', {
  id: text('id').primaryKey(),
  applicantName: text('applicant_name').notNull(),
  applicantEmail: text('applicant_email').notNull(),
  phone: text('phone').notNull().default(''),
  targetCourseId: text('target_course_id')
    .references(() => courses.id, { onDelete: 'restrict' })
    .notNull(),
  preferredCohort: text('preferred_cohort').notNull(),
  status: text('status').notNull().default('Submitted'), // 'Submitted' | 'Under Review' | 'Accepted' | 'Rejected' | 'Enrolled'
  notes: text('notes').notNull().default(''),
  reviewedByUserId: text('reviewed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  convertedUserId: text('converted_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

export const enrollments = pgTable('enrollments', {
  id: text('id').primaryKey(),
  studentId: text('student_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  courseId: text('course_id')
    .references(() => courses.id, { onDelete: 'restrict' })
    .notNull(),
  cohortId: text('cohort_id').references(() => cohorts.id, {
    onDelete: 'set null',
  }),
  cohort: text('cohort').notNull(),
  status: text('status').notNull().default('Active'), // 'Active' | 'Completed' | 'Waitlisted' | 'Dropped'
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
  completedModuleIds: jsonb('completed_module_ids')
    .$type<string[]>()
    .notNull()
    .default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const classSessions = pgTable('class_sessions', {
  id: text('id').primaryKey(),
  courseId: text('course_id')
    .references(() => courses.id, { onDelete: 'cascade' })
    .notNull(),
  cohortId: text('cohort_id').references(() => cohorts.id, {
    onDelete: 'set null',
  }),
  cohort: text('cohort').notNull(),
  title: text('title').notNull(),
  topic: text('topic').notNull().default(''),
  room: text('room').notNull(),
  instructorId: text('instructor_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  instructorName: text('instructor_name').notNull(),
  startIso: timestamp('start_at', { withTimezone: true }).notNull(),
  endIso: timestamp('end_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('Scheduled'), // 'Scheduled' | 'Completed' | 'Cancelled'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .references(() => classSessions.id, { onDelete: 'cascade' })
      .notNull(),
    courseId: text('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    studentId: text('student_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull(), // 'Present' | 'Late' | 'Absent'
    note: text('note').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('attendance_session_student_idx').on(
      table.sessionId,
      table.studentId
    ),
  ]
);

export const moduleGrades = pgTable(
  'module_grades',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    courseId: text('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    moduleId: text('module_id')
      .references(() => courseModules.id, { onDelete: 'cascade' })
      .notNull(),
    score: integer('score').notNull(),
    feedback: text('feedback').notNull().default(''),
    gradedAt: timestamp('graded_at', { withTimezone: true }).defaultNow().notNull(),
    gradedByUserId: text('graded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    gradedBy: text('graded_by').notNull(),
  },
  (table) => [
    uniqueIndex('module_grades_student_course_mod_idx').on(
      table.studentId,
      table.courseId,
      table.moduleId
    ),
  ]
);

export const progressRemarks = pgTable(
  'progress_remarks',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    courseId: text('course_id')
      .references(() => courses.id, { onDelete: 'cascade' })
      .notNull(),
    summary: text('summary').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('progress_remarks_student_course_idx').on(
      table.studentId,
      table.courseId
    ),
  ]
);

export const feeInvoices = pgTable('fee_invoices', {
  id: text('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull().unique(),
  studentId: text('student_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  enrollmentId: text('enrollment_id').references(() => enrollments.id, {
    onDelete: 'set null',
  }),
  courseId: text('course_id')
    .references(() => courses.id, { onDelete: 'restrict' })
    .notNull(),
  description: text('description').notNull(),
  amountDue: numeric('amount_due', { precision: 12, scale: 2 }).notNull(),
  amountPaid: numeric('amount_paid', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('Unpaid'), // 'Unpaid' | 'Partial' | 'Paid' | 'Voided'
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  issuedByUserId: text('issued_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  receiptNumber: text('receipt_number').notNull().unique(),
  invoiceId: text('invoice_id')
    .references(() => feeInvoices.id, { onDelete: 'restrict' })
    .notNull(),
  studentId: text('student_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  method: text('method').notNull(), // 'Card' | 'Bank Transfer' | 'Cash' | 'Corporate Sponsorship'
  referenceCode: text('reference_code').notNull().default(''),
  recordedByUserId: text('recorded_by_user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  notes: text('notes').notNull().default(''),
  paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  courseId: text('course_id').references(() => courses.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  category: text('category').notNull(), // 'ID Verification' | 'Transcript' | 'Syllabus' | 'Assignment' | 'Receipt' | 'Other'
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentBase64: text('content_base64').notNull(),
  uploadedByUserId: text('uploaded_by_user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const certificates = pgTable(
  'certificates',
  {
    id: text('id').primaryKey(),
    certificateCode: text('certificate_code').notNull().unique(),
    verificationHash: text('verification_hash').notNull().unique(),
    studentId: text('student_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    courseId: text('course_id')
      .references(() => courses.id, { onDelete: 'restrict' })
      .notNull(),
    enrollmentId: text('enrollment_id')
      .references(() => enrollments.id, { onDelete: 'restrict' })
      .notNull(),
    finalScore: numeric('final_score', { precision: 5, scale: 2 }).notNull(),
    letterGrade: text('letter_grade').notNull(),
    attendanceRate: integer('attendance_rate').notNull(),
    issuedByUserId: text('issued_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    issuedByName: text('issued_by_name').notNull(),
    status: text('status').notNull().default('Issued'), // 'Issued' | 'Revoked'
    revokedReason: text('revoked_reason'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('certificates_student_course_idx').on(
      table.studentId,
      table.courseId
    ),
  ]
);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  kind: text('kind').notNull(), // 'attendance' | 'reminder' | 'grade' | 'enrollment' | 'finance' | 'certificate' | 'admission'
  title: text('title').notNull(),
  message: text('message').notNull(),
  relatedCourseId: text('related_course_id'),
  relatedSessionId: text('related_session_id'),
  dedupeKey: text('dedupe_key').unique(),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  summary: text('summary').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  coursesTaught: many(courses),
  enrollments: many(enrollments),
  invoices: many(feeInvoices),
  payments: many(payments),
  certificates: many(certificates),
  notifications: many(notifications),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  instructor: one(users, {
    fields: [courses.instructorId],
    references: [users.id],
  }),
  modules: many(courseModules),
  cohorts: many(cohorts),
  enrollments: many(enrollments),
  sessions: many(classSessions),
}));

export const courseModulesRelations = relations(courseModules, ({ one }) => ({
  course: one(courses, {
    fields: [courseModules.courseId],
    references: [courses.id],
  }),
}));

export const cohortsRelations = relations(cohorts, ({ one, many }) => ({
  course: one(courses, {
    fields: [cohorts.courseId],
    references: [courses.id],
  }),
  instructor: one(users, {
    fields: [cohorts.instructorId],
    references: [users.id],
  }),
  enrollments: many(enrollments),
  sessions: many(classSessions),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(users, {
    fields: [enrollments.studentId],
    references: [users.id],
  }),
  course: one(courses, {
    fields: [enrollments.courseId],
    references: [courses.id],
  }),
  cohortRef: one(cohorts, {
    fields: [enrollments.cohortId],
    references: [cohorts.id],
  }),
}));

export const feeInvoicesRelations = relations(feeInvoices, ({ one, many }) => ({
  student: one(users, {
    fields: [feeInvoices.studentId],
    references: [users.id],
  }),
  course: one(courses, {
    fields: [feeInvoices.courseId],
    references: [courses.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(feeInvoices, {
    fields: [payments.invoiceId],
    references: [feeInvoices.id],
  }),
  student: one(users, {
    fields: [payments.studentId],
    references: [users.id],
  }),
}));
