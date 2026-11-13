export type UserRole = 'instructor' | 'student';

export type EnrollmentStatus = 'Active' | 'Completed' | 'Waitlisted' | 'Dropped';

export type AttendanceStatus = 'Present' | 'Late' | 'Absent';

export type NotificationKind = 'attendance' | 'reminder' | 'grade' | 'enrollment';

export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  studentCode?: string;
  department?: string;
}

export interface CourseModule {
  id: string;
  code: string;
  title: string;
  weight: number; // percentage weight summing up to 100
  labHours: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  track: string;
  instructorId: string;
  instructorName: string;
  durationWeeks: number;
  modules: CourseModule[];
}

export interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  cohort: string;
  status: EnrollmentStatus;
  enrolledAt: string;
  completedModuleIds: string[];
}

export interface ClassSession {
  id: string;
  courseId: string;
  cohort: string;
  title: string;
  topic: string;
  room: string;
  instructorName: string;
  startIso: string;
  endIso: string;
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
  score: number; // 0 - 100
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

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  relatedCourseId?: string;
  relatedSessionId?: string;
  dedupeKey?: string;
  read: boolean;
  createdAt: string;
}

export interface DashboardPayload {
  user: UserPublic;
  courses: Course[];
  students: UserPublic[];
  enrollments: Enrollment[];
  sessions: ClassSession[];
  attendance: AttendanceRecord[];
  grades: ModuleGrade[];
  remarks: ProgressRemark[];
  notifications: NotificationItem[];
}
