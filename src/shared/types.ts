export type UserRole = 'admin' | 'instructor' | 'student';

export type UserAccountStatus = 'active' | 'inactive' | 'suspended' | 'archived';

export type EnrollmentStatus = 'Active' | 'Completed' | 'Waitlisted' | 'Dropped';

export type AttendanceStatus = 'Present' | 'Late' | 'Absent';

export type NotificationKind =
  | 'attendance'
  | 'reminder'
  | 'grade'
  | 'enrollment'
  | 'finance'
  | 'certificate'
  | 'admission';

export type AdmissionStatus =
  | 'Submitted'
  | 'Under Review'
  | 'Accepted'
  | 'Rejected'
  | 'Enrolled';

export type CohortStatus = 'Planned' | 'Active' | 'Completed' | 'Archived';

export type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid' | 'Voided';

export type PaymentMethod =
  | 'Card'
  | 'Bank Transfer'
  | 'Cash'
  | 'Corporate Sponsorship';

export type DocumentCategory =
  | 'ID Verification'
  | 'Transcript'
  | 'Syllabus'
  | 'Assignment'
  | 'Receipt'
  | 'Other';

export type CertificateStatus = 'Issued' | 'Revoked';

export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserAccountStatus;
  studentCode?: string | null;
  staffCode?: string | null;
  department?: string | null;
  phone?: string | null;
  createdAt?: string;
}

export interface CourseModule {
  id: string;
  code: string;
  title: string;
  weight: number;
  labHours: number;
  sortOrder?: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  track: string;
  category?: string;
  departmentId?: string | null;
  departmentName?: string | null;
  description?: string;
  prerequisites?: string;
  learningObjectives?: string[];
  passingScore?: number;
  minAttendanceRate?: number;
  gradingConfig?: {
    scaleName?: string;
    passingGrade?: string;
    rubricNotes?: string;
  };
  instructorId: string;
  instructorName: string;
  durationWeeks: number;
  tuitionFee: string;
  isArchived?: boolean;
  modules: CourseModule[];
}

export interface Cohort {
  id: string;
  code: string;
  name: string;
  courseId: string;
  termId?: string | null;
  instructorId: string;
  instructorName: string;
  classroomId?: string | null;
  classroomName?: string | null;
  capacity: number;
  startDate: string;
  endDate: string;
  status: CohortStatus;
}

export interface AdmissionApplication {
  id: string;
  applicantName: string;
  applicantEmail: string;
  phone: string;
  targetCourseId: string;
  preferredCohort: string;
  status: AdmissionStatus;
  notes: string;
  reviewedByUserId?: string | null;
  convertedUserId?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
}

export interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  cohortId?: string | null;
  cohort: string;
  status: EnrollmentStatus;
  enrolledAt: string;
  completedModuleIds: string[];
}

export interface EnrollmentHistoryEntry {
  id: string;
  enrollmentId: string;
  previousStatus: string | null;
  newStatus: string;
  previousBatchId: string | null;
  newBatchId: string | null;
  reason: string;
  changedByUserId: string | null;
  changedAt: string;
}

export interface ClassSession {
  id: string;
  courseId: string;
  cohortId?: string | null;
  classroomId?: string | null;
  cohort: string;
  title: string;
  topic: string;
  room: string;
  instructorId?: string | null;
  instructorName: string;
  startIso: string;
  endIso: string;
  status?: 'Scheduled' | 'Completed' | 'Cancelled';
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  courseId: string;
  studentId: string;
  status: AttendanceStatus;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ModuleGrade {
  id: string;
  studentId: string;
  courseId: string;
  moduleId: string;
  score: number;
  feedback: string;
  gradedAt: string;
  gradedBy: string;
}

export interface ProgressRemark {
  id: string;
  studentId: string;
  courseId: string;
  summary: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FeeInvoice {
  id: string;
  invoiceNumber: string;
  studentId: string;
  enrollmentId?: string | null;
  courseId: string;
  description: string;
  amountDue: string;
  amountPaid: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  isArchived: boolean;
  createdAt: string;
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  studentId: string;
  amount: string;
  method: PaymentMethod;
  referenceCode: string;
  recordedByUserId: string;
  notes: string;
  paidAt: string;
}

export interface DocumentRecord {
  id: string;
  ownerUserId: string;
  courseId?: string | null;
  title: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  isArchived: boolean;
  createdAt: string;
}

export interface CertificateRecord {
  id: string;
  certificateCode: string;
  verificationHash: string;
  studentId: string;
  studentName?: string;
  courseId: string;
  courseCode?: string;
  courseTitle?: string;
  enrollmentId: string;
  finalScore: string;
  letterGrade: string;
  attendanceRate: number;
  issuedByName: string;
  status: CertificateStatus;
  revokedReason?: string | null;
  issuedAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  relatedCourseId?: string | null;
  relatedSessionId?: string | null;
  dedupeKey?: string | null;
  read: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId?: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AcademyAnalytics {
  totalStudents: number;
  totalInstructors: number;
  activeEnrollments: number;
  completedEnrollments: number;
  pendingAdmissions: number;
  totalBilledCents: number;
  totalCollectedCents: number;
  outstandingCents: number;
  collectionRatePct: number;
  certificatesIssued: number;
  meanAttendanceRate: number;
}

export type AnalyticsPreset = '7d' | '30d' | '90d' | 'all' | 'custom';

export type InstructorPermissionKey =
  | 'enrollments:manage'
  | 'progress:manage'
  | 'grades:manage'
  | 'sessions:manage'
  | 'attendance:manage'
  | 'documents:upload'
  | 'certificates:issue';

export interface Department {
  id: string;
  code: string;
  name: string;
  headUserId?: string | null;
  status: string;
  courseCount?: number;
}

export interface Classroom {
  id: string;
  code: string;
  name: string;
  building: string;
  capacity: number;
  equipment: string;
  isActive: boolean;
}

export interface AcademicYear {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  status: string;
}

export interface AcademicTerm {
  id: string;
  academicYearId: string;
  academicYearName?: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  status: string;
}

export interface AcademyProfile {
  id: string;
  code: string;
  name: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  logoDataUrl: string;
  timezone: string;
  currency: string;
}

export interface CertificateTemplateInfo {
  id: string;
  code: string;
  name: string;
  titleFormat: string;
  signatoryName: string;
  signatoryTitle: string;
  minCompletionPct: number;
  minScore: number;
  minAttendancePct: number;
  isActive: boolean;
}

export interface AcademySettingsPayload {
  academy: AcademyProfile;
  policies: {
    invoicePrefix: string;
    invoiceNextSeq: number;
    feeDueDays: number;
    lateFeePct: number;
    passingScore: number;
    distinctionScore: number;
    minAttendanceRatePct: number;
    lateWeightPct: number;
    reminderWindowHours: number;
    certificateCodePrefix: string;
    certificateMinCompletionPct: number;
    certificateMinScore: number;
    certificateMinAttendancePct: number;
  };
  certificateTemplate: CertificateTemplateInfo | null;
  academicYears: AcademicYear[];
  academicTerms: AcademicTerm[];
  departments: Department[];
  classrooms: Classroom[];
}

export interface AdminAnalyticsDetail {
  dateRange: {
    preset: AnalyticsPreset;
    fromIso: string | null;
    toIso: string | null;
  };
  kpis: {
    activeStudents: number;
    activeInstructors: number;
    admissionsPending: number;
    activeCourses: number;
    totalBatches: number;
    todaysClassesCount: number;
    attendanceOverview: {
      present: number;
      late: number;
      absent: number;
      total: number;
      rate: number;
    };
    outstandingFeesCents: number;
    monthlyRevenueCents: number;
    totalCollectedCents: number;
    certificatesIssued: number;
    pendingAdminActionsCount: number;
  };
  monthlyRevenueSeries: Array<{
    monthKey: string;
    label: string;
    collectedCents: number;
    billedCents: number;
  }>;
  enrollmentTrendSeries: Array<{
    monthKey: string;
    label: string;
    enrollments: number;
    completions: number;
  }>;
  todaysClasses: ClassSession[];
  recentTransactions: Array<{
    id: string;
    receiptNumber: string;
    invoiceNumber: string;
    studentName: string;
    amount: string;
    method: PaymentMethod;
    paidAt: string;
  }>;
  pendingActions: Array<{
    id: string;
    kind: 'admission' | 'overdue_invoice' | 'low_attendance';
    title: string;
    detail: string;
    targetSection: string;
  }>;
}

export interface StudentDirectoryRow {
  user: UserPublic;
  profile: {
    id: string;
    departmentId: string | null;
    departmentName: string | null;
    dateOfBirth: string | null;
    address: string;
    emergencyContact: string;
    academicStanding: string;
    enrollmentDate: string;
  } | null;
  activeEnrollmentsCount: number;
  completedCoursesCount: number;
  outstandingCents: number;
  attendanceRate: number;
}

export interface PaginatedStudentsResult {
  items: StudentDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StudentDetailPayload {
  student: StudentDirectoryRow;
  enrollments: Array<
    Enrollment & {
      courseCode: string;
      courseTitle: string;
      batchCode: string | null;
      completionPct: number;
      weightedScore: number | null;
      letterGrade: string;
      attendanceRate: number;
    }
  >;
  enrollmentHistory: EnrollmentHistoryEntry[];
  documents: DocumentRecord[];
  certificates: CertificateRecord[];
  feeStatement: {
    totalBilledCents: number;
    totalPaidCents: number;
    outstandingCents: number;
    invoices: FeeInvoice[];
    payments: PaymentReceipt[];
  };
}

export interface InstructorDirectoryRow {
  user: UserPublic;
  profile: {
    id: string;
    staffCode: string;
    departmentId: string | null;
    departmentName: string | null;
    specialization: string;
    qualification: string;
    bio: string;
    hireDate: string | null;
    permissionsConfigured: boolean;
    permissions: InstructorPermissionKey[];
  };
  assignedCoursesCount: number;
  assignedBatchesCount: number;
  assignedStudentsCount: number;
  sessionsTaughtCount: number;
  upcomingSessionsCount: number;
  meanAttendanceRate: number;
  meanGradedScore: number | null;
}

export interface InstructorDetailPayload {
  instructor: InstructorDirectoryRow;
  assignedCourses: Course[];
  assignedBatches: Array<
    Cohort & {
      courseCode: string;
      courseTitle: string;
      enrolledCount: number;
    }
  >;
  sessions: ClassSession[];
}

export interface DashboardPayload {
  user: UserPublic;
  academy?: AcademyProfile;
  departments?: Department[];
  classrooms?: Classroom[];
  academicYears?: AcademicYear[];
  academicTerms?: AcademicTerm[];
  courses: Course[];
  cohorts: Cohort[];
  users: UserPublic[];
  students: UserPublic[];
  admissions: AdmissionApplication[];
  enrollments: Enrollment[];
  sessions: ClassSession[];
  attendance: AttendanceRecord[];
  grades: ModuleGrade[];
  remarks: ProgressRemark[];
  invoices: FeeInvoice[];
  payments: PaymentReceipt[];
  documents: DocumentRecord[];
  certificates: CertificateRecord[];
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  analytics: AcademyAnalytics;
}
