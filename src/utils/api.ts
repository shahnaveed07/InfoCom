import type {
  AdmissionStatus,
  AttendanceStatus,
  CohortStatus,
  DashboardPayload,
  DocumentCategory,
  EnrollmentStatus,
  PaymentMethod,
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

  loginWithFirebase: (idToken: string) =>
    requestJson<{ user: UserPublic }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
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

  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  // Users (Admin)
  createUser: (payload: {
    name: string;
    email: string;
    role: UserRole;
    department?: string;
    phone?: string;
    password: string;
  }) =>
    requestJson<{ user: UserPublic; dashboard: DashboardPayload }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
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

  // Admissions
  createAdmission: (payload: {
    applicantName: string;
    applicantEmail: string;
    phone?: string;
    targetCourseId: string;
    preferredCohort: string;
    notes?: string;
  }) =>
    requestJson<{ admissionId: string; dashboard: DashboardPayload }>(
      '/api/admissions',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAdmission: (
    id: string,
    payload: {
      status: AdmissionStatus;
      notes?: string;
      convertToEnrollment?: boolean;
    }
  ) =>
    requestJson<{ dashboard: DashboardPayload }>(`/api/admissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Courses & Cohorts
  createCourse: (payload: {
    code: string;
    title: string;
    track: string;
    description: string;
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

  createCohort: (payload: {
    code: string;
    name: string;
    courseId: string;
    instructorId: string;
    capacity: number;
    startDate: string;
    endDate: string;
    status: CohortStatus;
  }) =>
    requestJson<{ cohortId: string; dashboard: DashboardPayload }>('/api/cohorts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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

  updateEnrollmentStatus: (enrollmentId: string, status: EnrollmentStatus) =>
    requestJson<{ dashboard: DashboardPayload }>(
      `/api/enrollments/${enrollmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
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
    description: string;
    amountDue: string;
    dueDate: string;
  }) =>
    requestJson<{ invoiceNumber: string; dashboard: DashboardPayload }>(
      '/api/invoices',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

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
};
