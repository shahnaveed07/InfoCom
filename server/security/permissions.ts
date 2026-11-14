import type {
  InstructorPermissionKey,
  UserPublic,
  UserRole,
} from '../../src/shared/types.ts';
import { prisma } from '../db/prisma.ts';

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

export async function getEffectiveInstructorPermissions(
  instructorId: string
): Promise<InstructorPermissionKey[]> {
  const profile = await prisma.instructorProfile.findUnique({
    where: { userId: instructorId },
    select: { permissionsConfigured: true, permissions: true },
  });
  if (!profile || !profile.permissionsConfigured) {
    return [...DEFAULT_INSTRUCTOR_PERMISSIONS];
  }
  const raw = Array.isArray(profile.permissions) ? profile.permissions : [];
  const validSet = new Set<string>(DEFAULT_INSTRUCTOR_PERMISSIONS);
  return raw.filter(
    (p): p is InstructorPermissionKey => typeof p === 'string' && validSet.has(p)
  );
}

export async function hasInstructorPermission(
  actor: UserPublic,
  permission: InstructorPermissionKey
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'instructor') return false;
  if (!ROLE_PERMISSIONS.instructor.has(permission)) return false;
  const effective = await getEffectiveInstructorPermissions(actor.id);
  return effective.includes(permission);
}

export interface InstructorScope {
  courseIds: Set<string>;
  batchIds: Set<string>;
  studentIds: Set<string>;
}

/**
 * Resolves all courses, batches, and non-dropped students explicitly assigned
 * to an instructor via Course lead assignment, Batch lead assignment, or active InstructorAssignment.
 */
export async function getInstructorScope(instructorId: string): Promise<InstructorScope> {
  const [leadCourses, leadBatches, assignments] = await Promise.all([
    prisma.course.findMany({
      where: { instructorId },
      select: { id: true },
    }),
    prisma.batch.findMany({
      where: { instructorId },
      select: { id: true, courseId: true },
    }),
    prisma.instructorAssignment.findMany({
      where: { instructorId, isActive: true },
      select: { batchId: true, courseId: true },
    }),
  ]);

  const courseIds = new Set<string>(leadCourses.map((c) => c.id));
  const batchIds = new Set<string>();

  for (const b of leadBatches) {
    batchIds.add(b.id);
    courseIds.add(b.courseId);
  }
  for (const a of assignments) {
    batchIds.add(a.batchId);
    courseIds.add(a.courseId);
  }

  const courseIdList = Array.from(courseIds);
  const batchIdList = Array.from(batchIds);

  const studentIds = new Set<string>();
  if (courseIdList.length > 0 || batchIdList.length > 0) {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: { not: 'Dropped' },
        OR: [
          ...(courseIdList.length > 0 ? [{ courseId: { in: courseIdList } }] : []),
          ...(batchIdList.length > 0 ? [{ cohortId: { in: batchIdList } }] : []),
        ],
      },
      select: { studentId: true },
    });
    for (const e of enrollments) {
      studentIds.add(e.studentId);
    }
  }

  return { courseIds, batchIds, studentIds };
}

export async function canInstructorAccessCourse(
  instructorId: string,
  courseId: string
): Promise<boolean> {
  if (!courseId) return false;
  const [courseMatch, batchMatch, assignMatch] = await Promise.all([
    prisma.course.findFirst({
      where: { id: courseId, instructorId },
      select: { id: true },
    }),
    prisma.batch.findFirst({
      where: { courseId, instructorId },
      select: { id: true },
    }),
    prisma.instructorAssignment.findFirst({
      where: { courseId, instructorId, isActive: true },
      select: { id: true },
    }),
  ]);
  return Boolean(courseMatch || batchMatch || assignMatch);
}

export async function canInstructorAccessStudent(
  instructorId: string,
  studentId: string
): Promise<boolean> {
  const scope = await getInstructorScope(instructorId);
  return scope.studentIds.has(studentId);
}

export async function canAccessCourse(
  actor: UserPublic,
  courseId: string
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role === 'instructor') {
    return canInstructorAccessCourse(actor.id, courseId);
  }
  const enr = await prisma.enrollment.findFirst({
    where: {
      studentId: actor.id,
      courseId,
      status: { not: 'Dropped' },
    },
    select: { id: true },
  });
  return Boolean(enr);
}

export async function canAccessStudentRecord(
  actor: UserPublic,
  studentId: string
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role === 'student') return actor.id === studentId;
  return canInstructorAccessStudent(actor.id, studentId);
}
