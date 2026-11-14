export type UserRole = 'admin' | 'instructor' | 'student';

export type UserAccountStatus = 'active' | 'inactive' | 'archived';

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
  description?: string;
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
  instructorId: string;
  instructorName: string;
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

export interface ClassSession {
  id: string;
  courseId: string;
  cohortId?: string | null;
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

export interface DashboardPayload {
  user: UserPublic;
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
