import type {
  InstructorPermissionKey,
  UserPublic,
} from '../../src/shared/types.ts';
import { prisma } from '../db/prisma.ts';
import {
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  INSTRUCTOR_PERMISSION_OPTIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  type Permission,
} from './permission-constants.ts';

export {
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  INSTRUCTOR_PERMISSION_OPTIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  type Permission,
};

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
        status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
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
      status: { notIn: ['Dropped', 'Cancelled', 'Withdrawn'] },
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
