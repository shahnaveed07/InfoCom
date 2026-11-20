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
  AuthConfigPayload,
  AuthMode,
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
  NotificationPreferenceItem,
  PaginatedStudentsResult,
  PaymentMethod,
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
  StudentDetailPayload,
  UserAccountStatus,
  UserPublic,
  UserRole,
  WebAuthnCredentialMetadata,
} from '../shared/types';
import type {
  SerializedCreationOptions,
  SerializedRequestOptions,
} from './webauthn';

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

export type ApiErrorKind =
  | 'network_error'
  | 'api_route_missing'
  | 'html_fallback'
  | 'database_unavailable'
  | 'service_unavailable'
  | 'not_found'
  | 'invalid_response'
  | 'http_error';

export class ApiError extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly isNetworkError: boolean;
  readonly isHtmlResponse: boolean;

  constructor(
    message: string,
    opts: {
      status: number;
      contentType: string;
      code: string;
      kind: ApiErrorKind;
      isNetworkError?: boolean;
      isHtmlResponse?: boolean;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.contentType = opts.contentType;
    this.code = opts.code;
    this.kind = opts.kind;
    this.isNetworkError = Boolean(opts.isNetworkError);
    this.isHtmlResponse = Boolean(opts.isHtmlResponse);
  }
}

export function isBackendUnavailableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return (
      err.kind === 'network_error' ||
      err.kind === 'api_route_missing' ||
      err.kind === 'html_fallback' ||
      err.kind === 'database_unavailable' ||
      err.kind === 'service_unavailable' ||
      err.kind === 'invalid_response' ||
      err.status >= 500
    );
  }
  return false;
}

export interface BackendReadinessResult {
  backendReachable: boolean;
  databaseReady: boolean;
  status: 'ready' | 'degraded' | 'offline';
  reason?: string;
}

function readEnvValue(key: string): string | undefined {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
  if (metaEnv && typeof metaEnv[key] === 'string') {
    return metaEnv[key];
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key];
  }
  return undefined;
}

export function resolveApiBaseUrl(): string {
  const raw = (readEnvValue('VITE_API_BASE_URL') ?? '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = resolveApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function resolveFetchCredentials(): RequestCredentials {
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) return 'same-origin';
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      const targetOrigin = new URL(baseUrl, window.location.origin).origin;
      return targetOrigin === window.location.origin ? 'same-origin' : 'include';
    } catch {
      return 'include';
    }
  }
  return 'include';
}

function looksLikeHtml(contentType: string, rawBody: string): boolean {
  if (contentType.toLowerCase().includes('text/html')) return true;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(rawBody);
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const targetUrl = resolveApiUrl(url);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      credentials: resolveFetchCredentials(),
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error && err.message
        ? `Backend service unreachable: ${err.message}`
        : 'Unable to reach the IGS backend service.',
      {
        status: 0,
        contentType: '',
        code: 'NETWORK_ERROR',
        kind: 'network_error',
        isNetworkError: true,
      }
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    throw new ApiError('Failed to read response body from API.', {
      status: res.status,
      contentType,
      code: 'READ_ERROR',
      kind: 'invalid_response',
    });
  }

  if (looksLikeHtml(contentType, rawText)) {
    throw new ApiError(
      res.status === 404
        ? 'API route returned a static hosting HTML 404 page instead of JSON.'
        : 'API endpoint returned an HTML page instead of JSON.',
      {
        status: res.status,
        contentType,
        code: res.status === 404 ? 'HOSTING_HTML_404' : 'HTML_RESPONSE',
        kind: res.status === 404 ? 'api_route_missing' : 'html_fallback',
        isHtmlResponse: true,
      }
    );
  }

  let parsed: Record<string, unknown> | null = null;
  if (rawText.trim().length > 0) {
    try {
      const jsonVal = JSON.parse(rawText);
      if (jsonVal === null || typeof jsonVal !== 'object') {
        throw new Error('Non-object JSON payload');
      }
      parsed = jsonVal as Record<string, unknown>;
    } catch {
      throw new ApiError(`API returned malformed JSON (${res.status}).`, {
        status: res.status,
        contentType,
        code: 'INVALID_JSON',
        kind: 'invalid_response',
      });
    }
  }

  if (!res.ok) {
    const serverMessage =
      typeof parsed?.error === 'string'
        ? parsed.error
        : `Request failed (${res.status})`;
    const serverCode = typeof parsed?.code === 'string' ? parsed.code : '';
    const dbState = typeof parsed?.database === 'string' ? parsed.database : '';

    if (res.status === 503 && dbState === 'unavailable') {
      throw new ApiError(serverMessage, {
        status: res.status,
        contentType,
        code: serverCode || 'DATABASE_UNAVAILABLE',
        kind: 'database_unavailable',
      });
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new ApiError(serverMessage, {
        status: res.status,
        contentType,
        code: serverCode || 'SERVICE_UNAVAILABLE',
        kind: 'service_unavailable',
      });
    }
    if (res.status === 404 && serverCode === 'API_ROUTE_NOT_FOUND') {
      throw new ApiError(serverMessage, {
        status: res.status,
        contentType,
        code: 'API_ROUTE_NOT_FOUND',
        kind: 'api_route_missing',
      });
    }
    if (res.status === 404) {
      throw new ApiError(serverMessage, {
        status: res.status,
        contentType,
        code: serverCode || 'NOT_FOUND',
        kind: 'not_found',
      });
    }

    throw new ApiError(serverMessage, {
      status: res.status,
      contentType,
      code: serverCode || `HTTP_${res.status}`,
      kind: 'http_error',
    });
  }

  if (!parsed) {
    throw new ApiError('API returned an empty non-JSON response.', {
      status: res.status,
      contentType,
      code: 'EMPTY_RESPONSE',
      kind: 'invalid_response',
    });
  }

  return parsed as T;
}

async function downloadBinaryFile(url: string, fallbackFileName: string): Promise<void> {
  const res = await fetch(resolveApiUrl(url), { credentials: resolveFetchCredentials() });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      typeof errData?.error === 'string'
        ? errData.error
        : `Failed to download file (${res.status}).`
    );
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match?.[1] || fallbackFileName;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  getHealth: (signal?: AbortSignal) =>
    requestJson<{
      status: string;
      service?: string;
      environment?: string;
      timestamp?: string;
    }>('/api/health', { signal }),

  getReadiness: async (signal?: AbortSignal): Promise<BackendReadinessResult> => {
    try {
      const data = await requestJson<{ status: string; database: string }>(
        '/api/health/ready',
        { signal }
      );
      if (data.status === 'ready' && data.database === 'connected') {
        return { backendReachable: true, databaseReady: true, status: 'ready' };
      }
      return {
        backendReachable: true,
        databaseReady: false,
        status: 'degraded',
        reason: 'Database unavailable',
      };
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'database_unavailable') {
        return {
          backendReachable: true,
          databaseReady: false,
          status: 'degraded',
          reason: err.message,
        };
      }
      if (err instanceof ApiError && err.kind === 'service_unavailable' && err.status === 503) {
        return {
          backendReachable: true,
          databaseReady: false,
          status: 'degraded',
          reason: err.message,
        };
      }
      return {
        backendReachable: false,
        databaseReady: false,
        status: 'offline',
        reason: err instanceof Error ? err.message : 'Backend unreachable',
      };
    }
  },

  getPublicAcademy: (signal?: AbortSignal) =>
    requestJson<PublicAcademyInfo>('/api/public/academy', { signal }),

  getPublicCourses: (signal?: AbortSignal) =>
    requestJson<{
      courses: PublicCourseSummary[];
      currency: string;
      isDemoEnvironment?: boolean;
    }>('/api/public/courses', { signal }),

  getPublicCourseDetail: (slugOrId: string, signal?: AbortSignal) =>
    requestJson<{
      course: PublicCourseDetail;
      isDemoEnvironment?: boolean;
    }>(`/api/public/courses/${encodeURIComponent(slugOrId)}`, { signal }),

  getAuthConfig: (signal?: AbortSignal) =>
    requestJson<AuthConfigPayload>('/api/auth/config', { signal }),

  getMe: () =>
    requestJson<{ user: UserPublic | null; authMode?: AuthMode }>('/api/auth/me'),

  login: (email: string, password: string) =>
    requestJson<{ user: UserPublic; authMode?: AuthMode }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  webauthnRegisterOptions: (payload?: { enrollmentToken?: string; deviceLabel?: string }) =>
    requestJson<{
      challengeId: string;
      expiresAt: string;
      targetUser: { name: string; email: string; role: UserRole };
      options: SerializedCreationOptions;
    }>('/api/auth/webauthn/register/options', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),

  webauthnRegisterVerify: (payload: {
    challengeId: string;
    credentialId: string;
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    deviceLabel?: string;
    enrollmentToken?: string;
  }) =>
    requestJson<{
      ok: boolean;
      user: UserPublic;
      authMode?: AuthMode;
      credential: WebAuthnCredentialMetadata;
    }>('/api/auth/webauthn/register/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  webauthnLoginOptions: (payload?: { email?: string }) =>
    requestJson<{
      challengeId: string;
      expiresAt: string;
      options: SerializedRequestOptions;
    }>('/api/auth/webauthn/login/options', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),

  webauthnLoginVerify: (payload: {
    challengeId: string;
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  }) =>
    requestJson<{ user: UserPublic; authMode?: AuthMode }>('/api/auth/webauthn/login/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  webauthnReauthOptions: () =>
    requestJson<{
      challengeId: string;
      expiresAt: string;
      options: SerializedRequestOptions;
    }>('/api/auth/webauthn/reauth/options', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  webauthnReauthVerify: (payload: {
    challengeId: string;
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  }) =>
    requestJson<{ ok: boolean; reauthProof: string; expiresAt: string }>(
      '/api/auth/webauthn/reauth/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listMyPasskeys: () =>
    requestJson<{ credentials: WebAuthnCredentialMetadata[]; activeCount: number }>(
      '/api/auth/webauthn/credentials'
    ),

  renameMyPasskey: (id: string, deviceLabel: string) =>
    requestJson<{ ok: boolean; credential: WebAuthnCredentialMetadata }>(
      `/api/auth/webauthn/credentials/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ deviceLabel }),
      }
    ),

  revokeMyPasskey: (id: string, payload: { reauthProof: string; reason?: string }) =>
    requestJson<{ ok: boolean; revokedId: string; remainingActiveCount: number }>(
      `/api/auth/webauthn/credentials/${encodeURIComponent(id)}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listUserPasskeys: (userId: string) =>
    requestJson<{
      userId: string;
      userEmail: string;
      credentials: WebAuthnCredentialMetadata[];
      activeCount: number;
    }>(`/api/users/${encodeURIComponent(userId)}/webauthn`),

  revokeUserPasskey: (userId: string, credId: string) =>
    requestJson<{ ok: boolean; revokedId: string; sessionsRevoked: boolean }>(
      `/api/users/${encodeURIComponent(userId)}/webauthn/${encodeURIComponent(credId)}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),

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

  revokeUserResetTokens: (userId: string) =>
    requestJson<{
      ok: boolean;
      revokedCount: number;
      user: UserPublic;
    }>(`/api/users/${userId}/revoke-reset-tokens`, {
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

  fetchPublicAdmissionCatalog: (signal?: AbortSignal) =>
    requestJson<PublicAdmissionCatalog>('/api/admissions/public/catalog', { signal }),

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
      resolveApiUrl(`/api/admissions/${admissionId}/documents/${docId}/download`),
      { credentials: resolveFetchCredentials() }
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
    slug?: string;
    title: string;
    track: string;
    category?: string;
    departmentId?: string | null;
    description: string;
    prerequisites?: string;
    learningObjectives?: string[];
    passingScore?: number;
    minAttendanceRate?: number;
    isPublished?: boolean;
    showTuitionPublicly?: boolean;
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
    requestJson<{ courseId: string; slug?: string; dashboard: DashboardPayload }>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCourse: (
    courseId: string,
    payload: {
      slug?: string;
      title?: string;
      track?: string;
      category?: string;
      departmentId?: string | null;
      description?: string;
      prerequisites?: string;
      learningObjectives?: string[];
      passingScore?: number;
      minAttendanceRate?: number;
      isPublished?: boolean;
      showTuitionPublicly?: boolean;
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

  downloadDocumentAsset: (docId: string, fallbackFileName = 'document') =>
    downloadBinaryFile(`/api/documents/${encodeURIComponent(docId)}/download`, fallbackFileName),

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

  downloadCertificatePdf: (certId: string, certificateCode: string) =>
    downloadBinaryFile(
      `/api/certificates/${encodeURIComponent(certId)}/download`,
      `${certificateCode}.pdf`
    ),

  // Notifications & Reports
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

  getNotificationPreferences: () =>
    requestJson<{ preferences: NotificationPreferenceItem[] }>(
      '/api/notifications/preferences'
    ),

  updateNotificationPreferences: (preferences: NotificationPreferenceItem[]) =>
    requestJson<{ ok: boolean; preferences: NotificationPreferenceItem[] }>(
      '/api/notifications/preferences',
      {
        method: 'PUT',
        body: JSON.stringify({ preferences }),
      }
    ),

  downloadReport: (
    kind:
      | 'academic-progress'
      | 'attendance-summary'
      | 'financial-collections'
      | 'admissions-funnel',
    format: 'csv' | 'pdf'
  ) =>
    downloadBinaryFile(
      `/api/reports/${encodeURIComponent(kind)}?format=${format}`,
      `igs-${kind}.${format}`
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
    guardianName?: string;
    guardianRelationship?: string;
    guardianPhone?: string;
    academicStanding?: string;
    initialCourseId?: string;
    initialCohortId?: string;
    enrollmentStatus?: 'Active' | 'Waitlisted';
    issueTuitionInvoice?: boolean;
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

  resetStudentPassword: (studentId: string) =>
    requestJson<{
      ok: boolean;
      onboardingToken: string;
      onboardingPath: string;
      onboardingExpiresAt: string;
      user: UserPublic;
    }>(`/api/students/${encodeURIComponent(studentId)}/reset-password`, {
      method: 'POST',
    }),

  revokeStudentResetTokens: (studentId: string) =>
    requestJson<{
      ok: boolean;
      revokedCount: number;
      user: UserPublic;
    }>(`/api/students/${encodeURIComponent(studentId)}/revoke-reset-tokens`, {
      method: 'POST',
    }),

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
