import type {
  AttendanceStatus,
  DashboardPayload,
  EnrollmentStatus,
  UserPublic,
  UserRole,
} from '../shared/types';

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
  getMe: () => requestJson<{ user: UserPublic }>('/api/auth/me'),

  login: (email: string, password: string) =>
    requestJson<{ user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }) =>
    requestJson<{ user: UserPublic }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  createEnrollment: (payload: {
    studentId: string;
    courseId: string;
    cohort: string;
    status: 'Active' | 'Waitlisted';
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
