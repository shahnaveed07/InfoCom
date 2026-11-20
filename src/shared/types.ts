export type UserRole = 'admin' | 'instructor' | 'student';

export type UserAccountStatus = 'active' | 'inactive' | 'suspended' | 'archived';

export type EnrollmentStatus =
  | 'Active'
  | 'Waitlisted'
  | 'Completed'
  | 'Cancelled'
  | 'Withdrawn'
  | 'Dropped';

export type AttendanceStatus = 'Present' | 'Late' | 'Absent' | 'Excused';

export type AssessmentType =
  | 'Module Assessment'
  | 'Assignment'
  | 'Quiz'
  | 'Lab'
  | 'Midterm'
  | 'Final';

export type NotificationKind =
  | 'attendance'
  | 'reminder'
  | 'grade'
  | 'enrollment'
  | 'finance'
  | 'certificate'
  | 'admission';

export type AdmissionStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Documents Required'
  | 'Approved'
  | 'Rejected'
  | 'Withdrawn'
  | 'Accepted'
  | 'Enrolled';

export type AdmissionDocumentStatus =
  | 'Pending'
  | 'Verified'
  | 'Replacement Required'
  | 'Rejected';

export type PortalActivationPolicy =
  | 'immediate'
  | 'on_approval'
  | 'manual_activation'
  | 'after_first_payment';

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
  mustChangePassword?: boolean;
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
  slug?: string;
  isPublished?: boolean;
  showTuitionPublicly?: boolean;
  isDemo?: boolean;
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

export interface FeePlanSummary {
  id: string;
  code: string;
  name: string;
  description: string;
  installmentCount: number;
  currency: string;
  isActive: boolean;
}

export interface AdmissionStatusHistoryEntry {
  id: string;
  applicationId: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string;
  actorUserId?: string | null;
  actorName: string;
  actorRole: string;
  changedAt: string;
}

export interface AdmissionDocumentRecord {
  id: string;
  applicationId: string;
  fileAssetId: string;
  documentType: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  verifiedStatus: AdmissionDocumentStatus;
  verificationRemarks: string;
  verifiedByUserId?: string | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  isLatest: boolean;
  createdAt: string;
}

export interface AdmissionApplication {
  id: string;
  applicationNumber?: string | null;
  applicantName: string;
  applicantEmail: string;
  phone: string;
  dateOfBirth?: string | null;
  gender?: string;
  nationality?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  guardianName?: string;
  guardianRelationship?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  previousQualification?: string;
  previousInstitution?: string;
  graduationYear?: string;
  previousScore?: string;
  targetCourseId: string;
  targetBatchId?: string | null;
  allocatedBatchId?: string | null;
  feePlanId?: string | null;
  preferredCohort: string;
  status: AdmissionStatus;
  notes: string;
  applicantRemarks?: string;
  reviewRemarks?: string;
  rejectionReason?: string;
  reviewedByUserId?: string | null;
  convertedUserId?: string | null;
  portalActivated?: boolean;
  portalActivatedAt?: string | null;
  submittedAt: string;
  draftSavedAt?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  updatedAt?: string | null;
  documentsCount?: number;
  verifiedDocumentsCount?: number;
  documents?: AdmissionDocumentRecord[];
  statusHistory?: AdmissionStatusHistoryEntry[];
}

export interface AdmissionDetailPayload {
  application: AdmissionApplication;
  documents: AdmissionDocumentRecord[];
  statusHistory: AdmissionStatusHistoryEntry[];
  eligibleBatches: Array<Cohort & { enrolledCount: number; seatsRemaining: number }>;
  feePlans: FeePlanSummary[];
  linkedStudent: UserPublic | null;
  portalActivationPolicy: PortalActivationPolicy;
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
  previousBatchName?: string | null;
  newBatchName?: string | null;
  reason: string;
  changedByUserId: string | null;
  changedByName?: string | null;
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

export interface AttendanceAuditEntry {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  previousStatus: AttendanceStatus | null;
  newStatus: AttendanceStatus;
  previousNote: string;
  newNote: string;
  actorEmail: string;
  actorRole: string;
  summary: string;
  createdAt: string;
}

export interface AssessmentRecord {
  id: string;
  courseId: string;
  moduleId?: string | null;
  batchId?: string | null;
  title: string;
  assessmentType: AssessmentType;
  maxScore: number;
  weight: number;
  dueDate?: string | null;
  createdAt: string;
}

export interface AssessmentGradeRecord {
  id: string;
  assessmentId: string;
  studentId: string;
  courseId: string;
  moduleId?: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  feedback: string;
  gradedAt: string;
  gradedBy: string;
}

export interface ModuleGrade {
  id: string;
  studentId: string;
  courseId: string;
  moduleId: string;
  assessmentId?: string;
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
  feeStructureId?: string | null;
  description: string;
  subtotal?: string;
  discountTotal?: string;
  scholarshipTotal?: string;
  amountDue: string;
  amountPaid: string;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  isArchived: boolean;
  createdAt: string;
}

export interface FeeStructureRecord {
  id: string;
  courseId: string;
  courseCode?: string;
  courseTitle?: string;
  batchId?: string | null;
  feePlanId?: string | null;
  feePlanName?: string | null;
  tuitionAmount: string;
  registrationFee: string;
  labFee: string;
  totalAmount: string;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
}

export interface DiscountRecord {
  id: string;
  code: string;
  name: string;
  discountType: 'Percentage' | 'Fixed';
  value: string;
  isActive: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  createdAt: string;
}

export interface ScholarshipRecord {
  id: string;
  code: string;
  name: string;
  sponsorName: string;
  coverageType: 'Percentage' | 'Fixed';
  coverageValue: string;
  maxRecipients: number;
  academicYearId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RefundRecord {
  id: string;
  refundNumber: string;
  paymentId: string;
  receiptNumber?: string;
  invoiceId: string;
  invoiceNumber?: string;
  studentId: string;
  studentName?: string;
  amount: string;
  reason: string;
  status: 'Pending' | 'Processed' | 'Cancelled';
  processedByUserId: string;
  processedByName?: string;
  processedAt: string;
}

export interface InvoiceItemRecord {
  id: string;
  invoiceId: string;
  itemType: 'Tuition' | 'Registration' | 'Lab' | 'Discount' | 'Scholarship' | 'Other';
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  createdAt: string;
}

export interface PaymentAllocationRecord {
  id: string;
  paymentId: string;
  receiptNumber: string;
  method: PaymentMethod;
  referenceCode: string;
  allocatedAmount: string;
  allocatedAt: string;
}

export interface InvoiceDetailPayload {
  invoice: FeeInvoice;
  student: {
    id: string;
    name: string;
    email: string;
    studentCode?: string | null;
    phone?: string | null;
  };
  course: {
    id: string;
    code: string;
    title: string;
  };
  academy: {
    name: string;
    legalName: string;
    email: string;
    phone: string;
    website: string;
    address: string;
    logoDataUrl: string;
    currency: string;
  };
  items: InvoiceItemRecord[];
  allocations: PaymentAllocationRecord[];
  refunds: RefundRecord[];
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  studentId: string;
  amount: string;
  refundedAmount?: string;
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
    studentIdPrefix: string;
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
    portalActivationPolicy: PortalActivationPolicy;
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
      excused: number;
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

export interface AcademyPolicySummary {
  passingScore: number;
  distinctionScore: number;
  minAttendanceRatePct: number;
  lateWeightPct: number;
  certificateMinCompletionPct: number;
  certificateMinScore: number;
  certificateMinAttendancePct: number;
}

export interface DashboardPayload {
  user: UserPublic;
  academy?: AcademyProfile;
  policies?: AcademyPolicySummary;
  departments?: Department[];
  classrooms?: Classroom[];
  academicYears?: AcademicYear[];
  academicTerms?: AcademicTerm[];
  feePlans?: FeePlanSummary[];
  feeStructures?: FeeStructureRecord[];
  discounts?: DiscountRecord[];
  scholarships?: ScholarshipRecord[];
  refunds?: RefundRecord[];
  courses: Course[];
  cohorts: Cohort[];
  users: UserPublic[];
  students: UserPublic[];
  admissions: AdmissionApplication[];
  enrollments: Enrollment[];
  sessions: ClassSession[];
  attendance: AttendanceRecord[];
  assessments?: AssessmentRecord[];
  assessmentGrades?: AssessmentGradeRecord[];
  grades: ModuleGrade[];
  remarks: ProgressRemark[];
  invoices: FeeInvoice[];
  payments: PaymentReceipt[];
  documents: DocumentRecord[];
  certificates: CertificateRecord[];
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  analytics: AcademyAnalytics;
  isDemoEnvironment?: boolean;
}

export interface PublicAcademyInfo {
  name: string;
  legalName: string;
  slogan: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logoDataUrl: string;
  timezone: string;
  currency: string;
}

export interface PublicCourseSummary {
  id: string;
  code: string;
  slug: string;
  title: string;
  track: string;
  category: string;
  departmentName: string | null;
  description: string;
  durationWeeks: number;
  tuitionFee: string | null;
  showTuitionPublicly: boolean;
  isDemo?: boolean;
  currency: string;
  moduleCount: number;
  totalLabHours: number;
  activeCohorts: Array<{
    id: string;
    code: string;
    name: string;
    status: CohortStatus;
    startDate: string;
    endDate: string;
    capacity: number;
  }>;
}

export interface PublicCourseDetail extends PublicCourseSummary {
  prerequisites: string;
  learningObjectives: string[];
  modules: Array<{
    id: string;
    code: string;
    title: string;
    weight: number;
    labHours: number;
    sortOrder: number;
  }>;
}

export interface NotificationPreferenceItem {
  channel: 'in_app' | 'email';
  kind: string;
  enabled: boolean;
}

export type AuthMode = 'password' | 'webauthn';

export interface AuthConfigPayload {
  authMode: AuthMode;
  passwordAuthEnabled: boolean;
  passkeySupported: boolean;
  rpId?: string;
  rpName?: string;
}

export interface WebAuthnCredentialMetadata {
  id: string;
  credentialId: string;
  deviceLabel: string;
  coseAlgorithm: number;
  transports: string[];
  aaguid: string | null;
  backupEligible: boolean;
  backupState: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

