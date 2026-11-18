import type { InstructorPermissionKey, UserRole } from '../../src/shared/types.ts';

export type Permission =
  | 'profile:self'
  | 'users:read'
  | 'users:manage'
  | 'admissions:manage'
  | 'courses:create'
  | 'cohorts:create'
  | 'enrollments:read'
  | 'enrollments:manage'
  | 'progress:manage'
  | 'grades:manage'
  | 'sessions:manage'
  | 'attendance:manage'
  | 'finance:read_own'
  | 'finance:manage'
  | 'documents:read'
  | 'documents:upload'
  | 'certificates:issue'
  | 'certificates:revoke'
  | 'audit:read';

export const INSTRUCTOR_PERMISSION_OPTIONS: ReadonlyArray<{
  key: InstructorPermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'enrollments:manage',
    label: 'Manage Course Enrollments',
    description: 'Enroll or update student enrollment status within assigned cohorts.',
  },
  {
    key: 'progress:manage',
    label: 'Update Module Completion & Remarks',
    description: 'Mark course modules completed and publish progress remarks.',
  },
  {
    key: 'grades:manage',
    label: 'Grade Assessments',
    description: 'Record and update module assessment scores and feedback.',
  },
  {
    key: 'sessions:manage',
    label: 'Schedule & Manage Class Sessions',
    description: 'Create class sessions and update session statuses for assigned courses.',
  },
  {
    key: 'attendance:manage',
    label: 'Mark Attendance',
    description: 'Record Present/Late/Absent attendance and send session alerts.',
  },
  {
    key: 'documents:upload',
    label: 'Upload Course & Student Documents',
    description: 'Upload syllabi, assignments, and academic records for assigned courses.',
  },
  {
    key: 'certificates:issue',
    label: 'Issue Course Certificates',
    description: 'Issue verified completion certificates for eligible students.',
  },
];

export const DEFAULT_INSTRUCTOR_PERMISSIONS: InstructorPermissionKey[] =
  INSTRUCTOR_PERMISSION_OPTIONS.map((o) => o.key);

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    'profile:self',
    'users:read',
    'users:manage',
    'admissions:manage',
    'courses:create',
    'cohorts:create',
    'enrollments:read',
    'enrollments:manage',
    'progress:manage',
    'grades:manage',
    'sessions:manage',
    'attendance:manage',
    'finance:read_own',
    'finance:manage',
    'documents:read',
    'documents:upload',
    'certificates:issue',
    'certificates:revoke',
    'audit:read',
  ]),
  instructor: new Set<Permission>([
    'profile:self',
    'enrollments:read',
    'enrollments:manage',
    'progress:manage',
    'grades:manage',
    'sessions:manage',
    'attendance:manage',
    'documents:read',
    'documents:upload',
    'certificates:issue',
  ]),
  student: new Set<Permission>([
    'profile:self',
    'finance:read_own',
    'documents:read',
    'documents:upload',
  ]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
