import type {
  AcademySettingsPayload,
  AcademicTerm,
  AcademicYear,
  AdminAnalyticsDetail,
  AdmissionDetailPayload,
  AdmissionDocumentStatus,
  AdmissionStatus,
  AnalyticsPreset,
  AssessmentRecord,
  AssessmentType,
  AttendanceAuditEntry,
  AttendanceStatus,
  Classroom,
  CohortStatus,
  DashboardPayload,
  Department,
  DocumentCategory,
  EnrollmentHistoryEntry,
  EnrollmentStatus,
  FeePlanSummary,
  InstructorDetailPayload,
  InstructorDirectoryRow,
  InstructorPermissionKey,
  InvoiceDetailPayload,
  PaginatedStudentsResult,
  PaymentMethod,
  StudentDetailPayload,
  UserAccountStatus,
  UserPublic,
  UserRole,
} from '../shared/types';

export interface VerifiedCertificateInfo {
  certificateCode: string;
  verificationHash: string;
  studentName: string;
  studentCode: string;
  courseCode: string;
  courseTitle: string;
  finalScore: string;
  letterGrade: string;
  attendanceRate: number;
  issuedByName: string;
  status: string;
  revokedReason?: string | null;
  issuedAt: string;
}

export interface PublicAdmissionCatalog {
  academyName: string;
  currency: string;
  courses: Array<{
    id: string;
    code: string;
    title: string;
    track: string;
    category: string;
    durationWeeks: number;
    tuitionFee: string;
  }>;
  batches: Array<{
    id: string;
    code: string;
    name: string;
    courseId: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  feePlans: FeePlanSummary[];
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  getMe: () => requestJson<{ user: UserPublic | null }>('/api/auth/me'),

  login: (email: string, password: string) =>
    requestJson<{ user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) =>
    requestJson<{ user: UserPublic }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    requestJson<{ ok: boolean; message: string; user: UserPublic }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  forgotPassword: (email: string) =>
    requestJson<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (payload: { token: string; newPassword: string }) =>
    requestJson<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  // Users (Admin)
  createUser: (payload: {
    name: string;
    email: string;
    role: UserRole;
    department?: string;
    phone?: string;
    password?: string;
    requirePasswordChange?: boolean;
  }) =>
    requestJson<{
      user: UserPublic;
      onboardingToken?: string;
      onboardingPath?: string;
      onboardingExpiresAt?: string;
      dashboard: DashboardPayload;
    }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  issueUserResetToken: (userId: string) =>
    requestJson<{
      ok: boolean;
      onboardingToken: string;
      onboardingPath: string;
      onboardingExpiresAt: string;
      user: UserPublic;
    }>(`/api/users/${userId}/reset-token`, {
      method: 'POST',
    }),

  updateUser: (
    userId: string,
    payload: {
      name?: string;
      role?: UserRole;
      status?: UserAccountStatus;
      department?: string;
      phone?: string;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Admissions (Phase 5)
  fetchAdmissions: (params?: {
    status?: string;
    courseId?: string;
    search?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.courseId) query.set('courseId', params.courseId);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return requestJson<{
      admissions: DashboardPayload['admissions'];
      feePlans: FeePlanSummary[];
      total: number;
    }>(`/api/admissions${qs ? `?${qs}` : ''}`);
  },

  fetchAdmissionDetail: (id: string) =>
    requestJson<AdmissionDetailPayload>(`/api/admissions/${id}`),

  fetchPublicAdmissionCatalog: () =>
    requestJson<PublicAdmissionCatalog>('/api/admissions/public/catalog'),

  submitPublicAdmission: (payload: Record<string, unknown>) =>
    requestJson<{ admissionId: string; applicationNumber: string; status: AdmissionStatus }>(
      '/api/admissions/public',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createAdmission: (payload: {
    applicantName?: string;
    applicantEmail?: string;
    phone?: string;
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
    feePlanId?: string | null;
    preferredCohort?: string;
    status?: 'Draft' | 'Submitted';
    notes?: string;
    applicantRemarks?: string;
    documents?: Array<{
      documentType: string;
      title: string;
      category: DocumentCategory;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    }>;
  }) =>
    requestJson<{
      admissionId: string;
      applicationNumber?: string;
      status?: AdmissionStatus;
      dashboard: DashboardPayload;
    }>('/api/admissions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdmission: (
    id: string,
    payload: {
      applicantName?: string;
      applicantEmail?: string;
      phone?: string;
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
      targetCourseId?: string;
      targetBatchId?: string | null;
      feePlanId?: string | null;
      preferredCohort?: string;
      status?: AdmissionStatus;
      notes?: string;
      applicantRemarks?: string;
      reviewRemarks?: string;
      rejectionReason?: string;
      reason?: string;
      convertToEnrollment?: boolean;
      waitlistIfFull?: boolean;
    }
  ) =>
    requestJson<{
      detail?: AdmissionDetailPayload;
      dashboard: DashboardPayload;
    }>(`/api/admissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  uploadAdmissionDocument: (
    admissionId: string,
    payload: {
      documentType: string;
      title: string;
      category: DocumentCategory;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    }
  ) =>
    requestJson<{
      documentId: string;
      detail: AdmissionDetailPayload;
      dashboard: DashboardPayload;
    }>(`/api/admissions/${admissionId}/documents`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyAdmissionDocument: (
    admissionId: string,
    docId: string,
    payload: {
      status: Exclude<AdmissionDocumentStatus, 'Pending'>;
      verificationRemarks?: string;
    }
  ) =>
    requestJson<{
      detail: AdmissionDetailPayload;
      dashboard: DashboardPayload;
    }>(`/api/admissions/${admissionId}/documents/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  downloadAdmissionDocument: async (
    admissionId: string,
    docId: string,
    fallbackFileName = 'document'
  ) => {
    const res = await fetch(
      `/api/admissions/${admissionId}/documents/${docId}/download`,
      { credentials: 'same-origin' }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        typeof errData?.error === 'string'
          ? errData.error
          : `Failed to download document (${res.status}).`
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fallbackFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  approveAdmission: (
    id: string,
    payload: {
      targetCourseId?: string;
      targetBatchId: string;
      feePlanId?: string | null;
      waitlistIfFull?: boolean;
      reviewRemarks?: string;
      issueInvoice?: boolean;
    }
  ) =>
    requestJson<{
      admissionId: string;
      applicationNumber?: string | null;
      studentId: string;
      studentName: string;
      studentCode: string;
      enrollmentId: string;
      enrollmentStatus: 'Active' | 'Waitlisted';
      invoiceId: string | null;
      courseCode: string;
      batchName: string;
      portalActivated: boolean;
      portalActivationPolicy: string;
      onboardingToken?: string;
      onboardingPath?: string;
      onboardingExpiresAt?: string;
      detail: AdmissionDetailPayload;
      dashboard: DashboardPayload;
    }>(`/api/admissions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  activateAdmissionPortal: (id: string) =>
    requestJson<{
      portalActivated: boolean;
      detail: AdmissionDetailPayload;
      dashboard: DashboardPayload;
    }>(`/api/admissions/${id}/activate-portal`, {
      method: 'POST',
    }),

  // Courses & Cohorts
  createCourse: (payload: {
    code: string;
    title: string;
    track: string;
    category?: string;
    departmentId?: string | null;
    description: string;
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
    durationWeeks: number;
    tuitionFee: string;
    modules: Array<{
      code: string;
      title: string;
      weight: number;
      labHours: number;
    }>;
  }) =>
    requestJson<{ courseId: string; dashboard: DashboardPayload }>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCourse: (
    courseId: string,
    payload: {
      title?: string;
      track?: string;
      category?: string;
      departmentId?: string | null;
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
      instructorId?: string;
      durationWeeks?: number;
      tuitionFee?: string;
      isArchived?: boolean;
      modules?: Array<{
        id?: string;
        code: string;
        title: string;
        weight: number;
        labHours: number;
      }>;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/courses/${courseId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createCohort: (payload: {
    code: string;
    name: string;
    courseId: string;
    termId?: string | null;
    instructorId: string;
    classroomId?: string | null;
    capacity: number;
    startDate: string;
    endDate: string;
    status: CohortStatus;
  }) =>
    requestJson<{ cohortId: string; dashboard: DashboardPayload }>('/api/cohorts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCohort: (
    cohortId: string,
    payload: {
      name?: string;
      termId?: string | null;
      instructorId?: string;
      classroomId?: string | null;
      capacity?: number;
      startDate?: string;
      endDate?: string;
      status?: CohortStatus;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/cohorts/${cohortId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  assignStudentToCohort: (
    cohortId: string,
    payload: {
      studentId: string;
      status?: 'Active' | 'Waitlisted';
      issueTuitionInvoice?: boolean;
    }
  ) =>
    requestJson<{ enrollmentId: string; dashboard: DashboardPayload }>(
      `/api/cohorts/${cohortId}/assign-student`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  transferEnrollment: (
    enrollmentId: string,
    payload: { toBatchId: string; reason: string }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/enrollments/${enrollmentId}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  transferEnrollmentCourse: (
    enrollmentId: string,
    payload: {
      toCourseId: string;
      toBatchId: string;
      reason: string;
      status?: 'Active' | 'Waitlisted';
      issueTuitionInvoice?: boolean;
    }
  ) =>
    requestJson<{
      enrollmentId: string;
      dashboard: DashboardPayload;
    }>(`/api/enrollments/${enrollmentId}/course-transfer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  fetchEnrollmentHistory: (enrollmentId: string) =>
    requestJson<{
      enrollment: {
        id: string;
        studentId: string;
        studentName: string;
        studentCode: string | null;
        courseId: string;
        courseCode: string;
        courseTitle: string;
        cohortId: string | null;
        cohort: string;
        status: EnrollmentStatus;
        enrolledAt: string;
      };
      history: EnrollmentHistoryEntry[];
    }>(`/api/enrollments/${enrollmentId}/history`),

  // Enrollments & Academics
  createEnrollment: (payload: {
    studentId: string;
    courseId: string;
    cohort: string;
    cohortId?: string;
    status: 'Active' | 'Waitlisted';
    issueTuitionInvoice?: boolean;
  }) =>
    requestJson<{ dashboard: DashboardPayload }>('/api/enrollments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateEnrollmentStatus: (
    enrollmentId: string,
    status: EnrollmentStatus,
    reason?: string
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/enrollments/${enrollmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      }
    ),

  toggleModuleCompletion: (payload: {
    enrollmentId: string;
    moduleId: string;
    completed: boolean;
  }) =>
    requestJson<{ dashboard: DashboardPayload }>(
      '/api/progress/module-completion',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  saveGrade: (payload: {
    studentId: string;
    courseId: string;
    moduleId: string;
    score: number;
    feedback: string;
  }) =>
    requestJson<{ dashboard: DashboardPayload }>('/api/grades', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listAssessments: (courseId?: string) =>
    requestJson<{ assessments: AssessmentRecord[] }>(
      `/api/assessments${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`
    ),

  createAssessment: (payload: {
    courseId: string;
    moduleId?: string | null;
    batchId?: string | null;
    title: string;
    assessmentType: AssessmentType;
    maxScore: number;
    weight: number;
    dueDate?: string | null;
  }) =>
    requestJson<{ assessmentId: string; dashboard: DashboardPayload }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAssessment: (
    assessmentId: string,
    payload: {
      title?: string;
      assessmentType?: AssessmentType;
      moduleId?: string | null;
      batchId?: string | null;
      maxScore?: number;
      weight?: number;
      dueDate?: string | null;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/assessments/${assessmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAssessment: (assessmentId: string) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/assessments/${assessmentId}`, {
      method: 'DELETE',
    }),

  saveAssessmentGrade: (
    assessmentId: string,
    payload: {
      studentId: string;
      score: number;
      feedback: string;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/assessments/${assessmentId}/grades`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  saveProgressRemark: (payload: {
    studentId: string;
    courseId: string;
    summary: string;
  }) =>
    requestJson<{ dashboard: DashboardPayload }>('/api/progress/remark', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  markAttendance: (payload: {
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    note: string;
  }) =>
    requestJson<{ dashboard: DashboardPayload }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  bulkMarkAttendance: (payload: {
    sessionId: string;
    entries: Array<{ studentId: string; status: AttendanceStatus; note: string }>;
  }) =>
    requestJson<{ updatedCount: number; dashboard: DashboardPayload }>(
      '/api/attendance/bulk',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getAttendanceHistory: (sessionId: string) =>
    requestJson<{ entries: AttendanceAuditEntry[] }>(
      `/api/attendance/history?sessionId=${encodeURIComponent(sessionId)}`
    ),

  createSession: (payload: {
    courseId: string;
    cohort: string;
    cohortId?: string;
    title: string;
    topic: string;
    room: string;
    startIso: string;
    durationHours: number;
  }) =>
    requestJson<{ dashboard: DashboardPayload; remindersCreatedCount: number }>(
      '/api/sessions',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateSessionStatus: (
    sessionId: string,
    status: 'Scheduled' | 'Completed' | 'Cancelled'
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/sessions/${sessionId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    ),

  // Finance & Payments
  createInvoice: (payload: {
    studentId: string;
    courseId: string;
    enrollmentId?: string;
    feeStructureId?: string | null;
    description: string;
    amountDue: string;
    dueDate: string;
  }) =>
    requestJson<{ invoiceId?: string; invoiceNumber: string; dashboard: DashboardPayload }>(
      '/api/invoices',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getInvoiceDetail: (invoiceId: string) =>
    requestJson<InvoiceDetailPayload>(`/api/invoices/${invoiceId}`),

  voidInvoice: (invoiceId: string) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/invoices/${invoiceId}/void`, {
      method: 'PATCH',
    }),

  recordPayment: (
    invoiceId: string,
    payload: {
      amount: string;
      method: PaymentMethod;
      referenceCode: string;
      notes: string;
    }
  ) =>
    requestJson<{ receiptNumber: string; dashboard: DashboardPayload }>(
      `/api/invoices/${invoiceId}/payments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  applyInvoiceAdjustment: (
    invoiceId: string,
    payload: {
      kind: 'discount' | 'scholarship';
      targetId: string;
      notes?: string;
    }
  ) =>
    requestJson<{ adjustmentCents: number; dashboard: DashboardPayload }>(
      `/api/invoices/${invoiceId}/adjustments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  refundPayment: (
    paymentId: string,
    payload: {
      amount: string;
      reason: string;
    }
  ) =>
    requestJson<{ refundNumber: string; dashboard: DashboardPayload }>(
      `/api/payments/${paymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createFeePlan: (payload: {
    code: string;
    name: string;
    description?: string;
    installmentCount: number;
    isActive?: boolean;
  }) =>
    requestJson<{ feePlanId: string; dashboard: DashboardPayload }>('/api/fee-plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateFeePlan: (
    id: string,
    payload: {
      code?: string;
      name?: string;
      description?: string;
      installmentCount?: number;
      isActive?: boolean;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/fee-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createFeeStructure: (payload: {
    courseId: string;
    batchId?: string | null;
    feePlanId?: string | null;
    tuitionAmount: string;
    registrationFee?: string;
    labFee?: string;
    isActive?: boolean;
  }) =>
    requestJson<{ feeStructureId: string; dashboard: DashboardPayload }>('/api/fee-structures', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateFeeStructure: (
    id: string,
    payload: {
      courseId?: string;
      batchId?: string | null;
      feePlanId?: string | null;
      tuitionAmount?: string;
      registrationFee?: string;
      labFee?: string;
      isActive?: boolean;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/fee-structures/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createDiscount: (payload: {
    code: string;
    name: string;
    discountType: 'Percentage' | 'Fixed';
    value: string;
    isActive?: boolean;
    validFrom?: string | null;
    validTo?: string | null;
  }) =>
    requestJson<{ discountId: string; dashboard: DashboardPayload }>('/api/discounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDiscount: (
    id: string,
    payload: {
      name?: string;
      discountType?: 'Percentage' | 'Fixed';
      value?: string;
      isActive?: boolean;
      validFrom?: string | null;
      validTo?: string | null;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/discounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createScholarship: (payload: {
    code: string;
    name: string;
    sponsorName?: string;
    coverageType: 'Percentage' | 'Fixed';
    coverageValue: string;
    maxRecipients: number;
    academicYearId?: string | null;
    isActive?: boolean;
  }) =>
    requestJson<{ scholarshipId: string; dashboard: DashboardPayload }>('/api/scholarships', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateScholarship: (
    id: string,
    payload: {
      name?: string;
      sponsorName?: string;
      coverageType?: 'Percentage' | 'Fixed';
      coverageValue?: string;
      maxRecipients?: number;
      academicYearId?: string | null;
      isActive?: boolean;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/scholarships/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Documents
  uploadDocument: (payload: {
    ownerUserId?: string;
    courseId?: string;
    title: string;
    category: DocumentCategory;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }) =>
    requestJson<{ documentId: string; dashboard: DashboardPayload }>(
      '/api/documents',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  archiveDocument: (docId: string) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/documents/${docId}/archive`, {
      method: 'PATCH',
    }),

  // Certificates
  issueCertificate: (payload: { studentId: string; courseId: string }) =>
    requestJson<{ certificateCode: string; dashboard: DashboardPayload }>(
      '/api/certificates',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  revokeCertificate: (certId: string, reason: string) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/certificates/${certId}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  verifyCertificate: (codeOrHash: string) =>
    requestJson<{ certificate: VerifiedCertificateInfo }>(
      `/api/certificates/verify/${encodeURIComponent(codeOrHash.trim())}`
    ),

  // Notifications
  runSessionReminders: () =>
    requestJson<{ createdCount: number; dashboard: DashboardPayload }>(
      '/api/notifications/run-reminders',
      { method: 'POST' }
    ),

  markNotificationRead: (id: string) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/notifications/${id}/read`,
      { method: 'PATCH' }
    ),

  markAllNotificationsRead: () =>
    requestJson<{ dashboard: DashboardPayload }>(
      '/api/notifications/read-all',
      { method: 'POST' }
    ),

  // Phase 4 Admin Analytics & Master Data
  getAdminAnalytics: (params?: {
    preset?: AnalyticsPreset;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.preset) query.set('preset', params.preset);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return requestJson<AdminAnalyticsDetail>(
      `/api/admin/analytics${qs ? `?${qs}` : ''}`
    );
  },

  // Students (Admin)
  listStudents: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    courseId?: string;
    sortBy?: 'name' | 'studentCode' | 'createdAt';
    sortDir?: 'asc' | 'desc';
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.courseId) query.set('courseId', params.courseId);
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortDir) query.set('sortDir', params.sortDir);
    const qs = query.toString();
    return requestJson<PaginatedStudentsResult>(
      `/api/students${qs ? `?${qs}` : ''}`
    );
  },

  createStudent: (payload: {
    name: string;
    email: string;
    phone?: string;
    password?: string;
    requirePasswordChange?: boolean;
    departmentId?: string | null;
    dateOfBirth?: string | null;
    address?: string;
    emergencyContact?: string;
    academicStanding?: string;
    initialCourseId?: string;
    initialCohortId?: string;
  }) =>
    requestJson<{
      student: UserPublic;
      onboardingToken?: string;
      onboardingPath?: string;
      onboardingExpiresAt?: string;
      dashboard: DashboardPayload;
    }>(
      '/api/students',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getStudentDetail: (studentId: string) =>
    requestJson<StudentDetailPayload>(`/api/students/${studentId}/detail`),

  updateStudent: (
    studentId: string,
    payload: {
      name?: string;
      email?: string;
      phone?: string;
      status?: UserAccountStatus;
      departmentId?: string | null;
      dateOfBirth?: string | null;
      address?: string;
      emergencyContact?: string;
      academicStanding?: string;
    }
  ) =>
    requestJson<{ detail: StudentDetailPayload; dashboard: DashboardPayload }>(
      `/api/students/${studentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  // Instructors (Admin)
  listInstructors: () =>
    requestJson<{ items: InstructorDirectoryRow[] }>('/api/instructors'),

  createInstructor: (payload: {
    name: string;
    email: string;
    phone?: string;
    password?: string;
    requirePasswordChange?: boolean;
    departmentId?: string | null;
    specialization?: string;
    qualification?: string;
    bio?: string;
    hireDate?: string | null;
    courseIds?: string[];
    batchIds?: string[];
    permissions?: InstructorPermissionKey[];
  }) =>
    requestJson<{
      instructor: UserPublic;
      onboardingToken?: string;
      onboardingPath?: string;
      onboardingExpiresAt?: string;
      items: InstructorDirectoryRow[];
      dashboard: DashboardPayload;
    }>('/api/instructors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getInstructorDetail: (instructorId: string) =>
    requestJson<InstructorDetailPayload>(
      `/api/instructors/${instructorId}/detail`
    ),

  updateInstructor: (
    instructorId: string,
    payload: {
      name?: string;
      email?: string;
      phone?: string;
      status?: UserAccountStatus;
      departmentId?: string | null;
      specialization?: string;
      qualification?: string;
      bio?: string;
      hireDate?: string | null;
    }
  ) =>
    requestJson<{
      detail: InstructorDetailPayload;
      items: InstructorDirectoryRow[];
      dashboard: DashboardPayload;
    }>(`/api/instructors/${instructorId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  assignInstructorCourses: (
    instructorId: string,
    payload: { courseIds: string[]; batchIds: string[] }
  ) =>
    requestJson<{
      detail: InstructorDetailPayload;
      items: InstructorDirectoryRow[];
      dashboard: DashboardPayload;
    }>(`/api/instructors/${instructorId}/assignments`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  updateInstructorPermissions: (
    instructorId: string,
    permissions: InstructorPermissionKey[]
  ) =>
    requestJson<{
      detail: InstructorDetailPayload;
      items: InstructorDirectoryRow[];
    }>(`/api/instructors/${instructorId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),

  // Departments & Classrooms
  listDepartments: () =>
    requestJson<{ items: Department[] }>('/api/departments'),

  createDepartment: (payload: {
    code: string;
    name: string;
    headUserId?: string | null;
    status?: 'active' | 'inactive' | 'archived';
  }) =>
    requestJson<{ departmentId: string; dashboard: DashboardPayload }>(
      '/api/departments',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateDepartment: (
    id: string,
    payload: {
      code?: string;
      name?: string;
      headUserId?: string | null;
      status?: 'active' | 'inactive' | 'archived';
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listClassrooms: () =>
    requestJson<{ items: Classroom[] }>('/api/classrooms'),

  createClassroom: (payload: {
    code: string;
    name: string;
    building?: string;
    capacity: number;
    equipment?: string;
    isActive?: boolean;
  }) =>
    requestJson<{ classroomId: string; dashboard: DashboardPayload }>(
      '/api/classrooms',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateClassroom: (
    id: string,
    payload: {
      code?: string;
      name?: string;
      building?: string;
      capacity?: number;
      equipment?: string;
      isActive?: boolean;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/classrooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Academy Settings, Academic Years & Terms
  getSettings: () => requestJson<AcademySettingsPayload>('/api/settings'),

  updateSettings: (payload: {
    academy: {
      name: string;
      legalName?: string;
      email: string;
      phone?: string;
      website?: string;
      address?: string;
      logoDataUrl?: string;
      timezone: string;
      currency: string;
    };
    policies: AcademySettingsPayload['policies'];
    certificateTemplate?: {
      name: string;
      titleFormat: string;
      signatoryName: string;
      signatoryTitle: string;
    };
  }) =>
    requestJson<{ settings: AcademySettingsPayload; dashboard: DashboardPayload }>(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  createAcademicYear: (payload: {
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
    status?: 'Planned' | 'Active' | 'Completed' | 'Archived';
  }) =>
    requestJson<{ settings: AcademySettingsPayload; dashboard: DashboardPayload }>(
      '/api/academic-years',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAcademicYear: (
    id: string,
    payload: {
      name?: string;
      startDate?: string;
      endDate?: string;
      isCurrent?: boolean;
      status?: 'Planned' | 'Active' | 'Completed' | 'Archived';
    }
  ) =>
    requestJson<{ settings: AcademySettingsPayload; dashboard: DashboardPayload }>(
      `/api/academic-years/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  createAcademicTerm: (payload: {
    academicYearId: string;
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
    status?: 'Planned' | 'Active' | 'Completed' | 'Archived';
  }) =>
    requestJson<{ settings: AcademySettingsPayload; dashboard: DashboardPayload }>(
      '/api/academic-terms',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAcademicTerm: (
    id: string,
    payload: {
      name?: string;
      startDate?: string;
      endDate?: string;
      isCurrent?: boolean;
      status?: 'Planned' | 'Active' | 'Completed' | 'Archived';
    }
  ) =>
    requestJson<{ settings: AcademySettingsPayload; dashboard: DashboardPayload }>(
      `/api/academic-terms/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),
};
