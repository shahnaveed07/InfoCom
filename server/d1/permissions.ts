import type { InstructorPermissionKey, UserPublic } from '../../src/shared/types.ts';
import {
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../security/permission-constants.ts';
import { d1All, d1First, getActiveD1, inPlaceholders, sqlBool, sqlJson, type D1DatabaseLike } from './client.ts';

export interface InstructorScope {
  courseIds: Set<string>;
  batchIds: Set<string>;
  studentIds: Set<string>;
}

export async function getEffectiveInstructorPermissionsD1(
  instructorId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<InstructorPermissionKey[]> {
  const row = await d1First<{ permissions_configured: number; permissions: string }>(
    'SELECT permissions_configured, permissions FROM instructor_profiles WHERE user_id = ? LIMIT 1',
    [instructorId],
    db
  );
  if (!row || !sqlBool(row.permissions_configured)) {
    return [...DEFAULT_INSTRUCTOR_PERMISSIONS];
  }
  const raw = sqlJson<unknown[]>(row.permissions, []);
  const validSet = new Set<string>(DEFAULT_INSTRUCTOR_PERMISSIONS);
  return raw.filter(
    (p): p is InstructorPermissionKey => typeof p === 'string' && validSet.has(p)
  );
}

export async function hasInstructorPermissionD1(
  actor: UserPublic,
  permission: InstructorPermissionKey,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'instructor') return false;
  if (!ROLE_PERMISSIONS.instructor.has(permission)) return false;
  const effective = await getEffectiveInstructorPermissionsD1(actor.id, db);
  return effective.includes(permission);
}

export async function getInstructorScopeD1(
  instructorId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<InstructorScope> {
  const [leadCourses, leadBatches, assignments] = await Promise.all([
    d1All<{ id: string }>('SELECT id FROM courses WHERE instructor_id = ?', [instructorId], db),
    d1All<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM cohorts WHERE instructor_id = ?',
      [instructorId],
      db
    ),
    d1All<{ batch_id: string; course_id: string }>(
      'SELECT batch_id, course_id FROM instructor_assignments WHERE instructor_id = ? AND is_active = 1',
      [instructorId],
      db
    ),
  ]);

  const courseIds = new Set<string>(leadCourses.map((c) => c.id));
  const batchIds = new Set<string>();

  for (const b of leadBatches) {
    batchIds.add(b.id);
    courseIds.add(b.course_id);
  }
  for (const a of assignments) {
    batchIds.add(a.batch_id);
    courseIds.add(a.course_id);
  }

  const courseList = Array.from(courseIds);
  const batchList = Array.from(batchIds);
  const studentIds = new Set<string>();

  if (courseList.length > 0 || batchList.length > 0) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (courseList.length > 0) {
      clauses.push(`course_id IN (${inPlaceholders(courseList.length)})`);
      params.push(...courseList);
    }
    if (batchList.length > 0) {
      clauses.push(`cohort_id IN (${inPlaceholders(batchList.length)})`);
      params.push(...batchList);
    }
    const enrollments = await d1All<{ student_id: string }>(
      `SELECT DISTINCT student_id FROM enrollments WHERE status NOT IN ('Dropped', 'Cancelled', 'Withdrawn') AND (${clauses.join(' OR ')})`,
      params,
      db
    );
    for (const e of enrollments) {
      studentIds.add(e.student_id);
    }
  }

  return { courseIds, batchIds, studentIds };
}

export async function canInstructorAccessCourseD1(
  instructorId: string,
  courseId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  if (!courseId) return false;
  const [courseMatch, batchMatch, assignMatch] = await Promise.all([
    d1First<{ id: string }>(
      'SELECT id FROM courses WHERE id = ? AND instructor_id = ? LIMIT 1',
      [courseId, instructorId],
      db
    ),
    d1First<{ id: string }>(
      'SELECT id FROM cohorts WHERE course_id = ? AND instructor_id = ? LIMIT 1',
      [courseId, instructorId],
      db
    ),
    d1First<{ id: string }>(
      'SELECT id FROM instructor_assignments WHERE course_id = ? AND instructor_id = ? AND is_active = 1 LIMIT 1',
      [courseId, instructorId],
      db
    ),
  ]);
  return Boolean(courseMatch || batchMatch || assignMatch);
}

export async function canInstructorAccessStudentD1(
  instructorId: string,
  studentId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  const scope = await getInstructorScopeD1(instructorId, db);
  return scope.studentIds.has(studentId);
}

export async function canAccessCourseD1(
  actor: UserPublic,
  courseId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role === 'instructor') {
    return canInstructorAccessCourseD1(actor.id, courseId, db);
  }
  const enr = await d1First<{ id: string }>(
    "SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND status NOT IN ('Dropped', 'Cancelled', 'Withdrawn') LIMIT 1",
    [actor.id, courseId],
    db
  );
  return Boolean(enr);
}

export async function canAccessStudentRecordD1(
  actor: UserPublic,
  studentId: string,
  db: D1DatabaseLike = getActiveD1()
): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role === 'student') return actor.id === studentId;
  return canInstructorAccessStudentD1(actor.id, studentId, db);
}
