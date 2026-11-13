import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAttendanceNotification,
  findUpcomingSessionsNeedingReminders,
} from '../src/shared/academic';
import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  Course,
  Enrollment,
  EnrollmentStatus,
  ModuleGrade,
  NotificationItem,
  ProgressRemark,
  UserPublic,
  UserRole,
} from '../src/shared/types';
import { hashPassword } from './auth';

export interface StoredUser extends UserPublic {
  passwordHash: string;
}

export interface DatabaseState {
  users: StoredUser[];
  courses: Course[];
  enrollments: Enrollment[];
  sessions: ClassSession[];
  attendance: AttendanceRecord[];
  grades: ModuleGrade[];
  remarks: ProgressRemark[];
  notifications: NotificationItem[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'centre-db.json');

function hoursFromNowIso(hoursOffset: number): string {
  return new Date(Date.now() + hoursOffset * 60 * 60 * 1000).toISOString();
}

function createInitialSeed(): DatabaseState {
  const instructorPasswordHash = hashPassword('Instructor!2026');
  const studentPasswordHash = hashPassword('Student!2026');

  const users: StoredUser[] = [
    {
      id: 'inst-elena',
      name: 'Dr. Elena Vance',
      email: 'elena.vance@northbridge.edu',
      role: 'instructor',
      department: 'Software & Cloud Systems',
      passwordHash: instructorPasswordHash,
    },
    {
      id: 'inst-david',
      name: 'Prof. David Okonkwo',
      email: 'david.okonkwo@northbridge.edu',
      role: 'instructor',
      department: 'Data & Security Lab',
      passwordHash: instructorPasswordHash,
    },
    {
      id: 'stu-marcus',
      name: 'Marcus Chen',
      email: 'marcus.chen@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-041',
      passwordHash: studentPasswordHash,
    },
    {
      id: 'stu-priya',
      name: 'Priya Patel',
      email: 'priya.patel@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-042',
      passwordHash: studentPasswordHash,
    },
    {
      id: 'stu-liam',
      name: "Liam O'Connor",
      email: 'liam.oconnor@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-043',
      passwordHash: studentPasswordHash,
    },
    {
      id: 'stu-sofia',
      name: 'Sofia Alvarez',
      email: 'sofia.alvarez@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-044',
      passwordHash: studentPasswordHash,
    },
    {
      id: 'stu-noah',
      name: 'Noah Kim',
      email: 'noah.kim@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-045',
      passwordHash: studentPasswordHash,
    },
    {
      id: 'stu-amara',
      name: 'Amara Diallo',
      email: 'amara.diallo@student.northbridge.edu',
      role: 'student',
      studentCode: 'NTA-2026-046',
      passwordHash: studentPasswordHash,
    },
  ];

  const courses: Course[] = [
    {
      id: 'crs-ts',
      code: 'CS-204',
      title: 'Full-Stack TypeScript Engineering',
      track: 'Software Engineering',
      instructorId: 'inst-elena',
      instructorName: 'Dr. Elena Vance',
      durationWeeks: 12,
      modules: [
        { id: 'ts-m1', code: 'M1', title: 'Type Systems & Generics', weight: 25, labHours: 12 },
        { id: 'ts-m2', code: 'M2', title: 'React Component Architecture', weight: 25, labHours: 14 },
        { id: 'ts-m3', code: 'M3', title: 'API Design & Authentication', weight: 25, labHours: 16 },
        { id: 'ts-m4', code: 'M4', title: 'Automated Testing & CI/CD', weight: 25, labHours: 14 },
      ],
    },
    {
      id: 'crs-cloud',
      code: 'CL-310',
      title: 'Cloud Infrastructure & DevOps',
      track: 'Cloud & Systems',
      instructorId: 'inst-elena',
      instructorName: 'Dr. Elena Vance',
      durationWeeks: 10,
      modules: [
        { id: 'cl-m1', code: 'M1', title: 'Linux Networking & Containers', weight: 25, labHours: 12 },
        { id: 'cl-m2', code: 'M2', title: 'Kubernetes Orchestration', weight: 30, labHours: 16 },
        { id: 'cl-m3', code: 'M3', title: 'Terraform Infrastructure as Code', weight: 25, labHours: 14 },
        { id: 'cl-m4', code: 'M4', title: 'Observability & Incident Drills', weight: 20, labHours: 10 },
      ],
    },
    {
      id: 'crs-data',
      code: 'DA-215',
      title: 'Applied Python & Data Analytics',
      track: 'Data Science',
      instructorId: 'inst-david',
      instructorName: 'Prof. David Okonkwo',
      durationWeeks: 10,
      modules: [
        { id: 'da-m1', code: 'M1', title: 'Python Data Pipelines', weight: 25, labHours: 12 },
        { id: 'da-m2', code: 'M2', title: 'SQL & Relational Modeling', weight: 25, labHours: 12 },
        { id: 'da-m3', code: 'M3', title: 'Statistical Inference & Pandas', weight: 25, labHours: 14 },
        { id: 'da-m4', code: 'M4', title: 'Interactive Forecasting Capstone', weight: 25, labHours: 16 },
      ],
    },
    {
      id: 'crs-sec',
      code: 'CY-402',
      title: 'Cybersecurity & Network Defense',
      track: 'Security Operations',
      instructorId: 'inst-david',
      instructorName: 'Prof. David Okonkwo',
      durationWeeks: 8,
      modules: [
        { id: 'cy-m1', code: 'M1', title: 'Packet Analysis & Firewalls', weight: 25, labHours: 10 },
        { id: 'cy-m2', code: 'M2', title: 'Web Application Hardening', weight: 30, labHours: 14 },
        { id: 'cy-m3', code: 'M3', title: 'Identity & Zero-Trust Controls', weight: 25, labHours: 12 },
        { id: 'cy-m4', code: 'M4', title: 'Blue-Team Threat Response', weight: 20, labHours: 12 },
      ],
    },
  ];

  const enrollments: Enrollment[] = [
    {
      id: 'enr-1',
      studentId: 'stu-marcus',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 38),
      completedModuleIds: ['ts-m1', 'ts-m2', 'ts-m3'],
    },
    {
      id: 'enr-2',
      studentId: 'stu-marcus',
      courseId: 'crs-cloud',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 25),
      completedModuleIds: ['cl-m1', 'cl-m2'],
    },
    {
      id: 'enr-3',
      studentId: 'stu-priya',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 38),
      completedModuleIds: ['ts-m1', 'ts-m2'],
    },
    {
      id: 'enr-4',
      studentId: 'stu-priya',
      courseId: 'crs-data',
      cohort: 'Cohort B · Autumn',
      status: 'Completed',
      enrolledAt: hoursFromNowIso(-24 * 75),
      completedModuleIds: ['da-m1', 'da-m2', 'da-m3', 'da-m4'],
    },
    {
      id: 'enr-5',
      studentId: 'stu-liam',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 36),
      completedModuleIds: ['ts-m1'],
    },
    {
      id: 'enr-6',
      studentId: 'stu-sofia',
      courseId: 'crs-data',
      cohort: 'Cohort B · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 30),
      completedModuleIds: ['da-m1', 'da-m2', 'da-m3'],
    },
    {
      id: 'enr-7',
      studentId: 'stu-noah',
      courseId: 'crs-sec',
      cohort: 'Cohort A · Autumn',
      status: 'Active',
      enrolledAt: hoursFromNowIso(-24 * 20),
      completedModuleIds: ['cy-m1', 'cy-m2'],
    },
    {
      id: 'enr-8',
      studentId: 'stu-amara',
      courseId: 'crs-cloud',
      cohort: 'Cohort A · Autumn',
      status: 'Waitlisted',
      enrolledAt: hoursFromNowIso(-24 * 5),
      completedModuleIds: [],
    },
  ];

  const sessions: ClassSession[] = [
    {
      id: 'ses-past-1',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      title: 'Session Auth & Cookie Security Lab',
      topic: 'HMAC token verification, scrypt hashing, and RBAC route guards',
      room: 'Lab 204',
      instructorName: 'Dr. Elena Vance',
      startIso: hoursFromNowIso(-48),
      endIso: hoursFromNowIso(-46),
    },
    {
      id: 'ses-past-2',
      courseId: 'crs-cloud',
      cohort: 'Cohort A · Autumn',
      title: 'Kubernetes Ingress & Autoscaling',
      topic: 'HorizontalPodAutoscaler and TLS termination policies',
      room: 'Lab 301',
      instructorName: 'Dr. Elena Vance',
      startIso: hoursFromNowIso(-26),
      endIso: hoursFromNowIso(-24),
    },
    {
      id: 'ses-upcoming-1',
      courseId: 'crs-ts',
      cohort: 'Cohort A · Autumn',
      title: 'Integration Testing & CI Pipelines',
      topic: 'Node test runner, contract assertions, and deployment checks',
      room: 'Lab 204',
      instructorName: 'Dr. Elena Vance',
      startIso: hoursFromNowIso(6),
      endIso: hoursFromNowIso(8),
    },
    {
      id: 'ses-upcoming-2',
      courseId: 'crs-cloud',
      cohort: 'Cohort A · Autumn',
      title: 'Terraform State & Drift Remediation',
      topic: 'Remote state locking and modular VPC definitions',
      room: 'Lab 301',
      instructorName: 'Dr. Elena Vance',
      startIso: hoursFromNowIso(18),
      endIso: hoursFromNowIso(20),
    },
    {
      id: 'ses-upcoming-3',
      courseId: 'crs-data',
      cohort: 'Cohort B · Autumn',
      title: 'Time-Series Forecasting Studio',
      topic: 'Seasonal decomposition and rolling window validation',
      room: 'Lab 108',
      instructorName: 'Prof. David Okonkwo',
      startIso: hoursFromNowIso(12),
      endIso: hoursFromNowIso(14),
    },
    {
      id: 'ses-upcoming-4',
      courseId: 'crs-sec',
      cohort: 'Cohort A · Autumn',
      title: 'Zero-Trust Identity & Audit Lab',
      topic: 'Least-privilege policy verification and log triage',
      room: 'Security Range B',
      instructorName: 'Prof. David Okonkwo',
      startIso: hoursFromNowIso(52),
      endIso: hoursFromNowIso(54),
    },
  ];

  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      sessionId: 'ses-past-1',
      courseId: 'crs-ts',
      studentId: 'stu-marcus',
      status: 'Present',
      note: 'Completed lab verification early.',
      updatedAt: hoursFromNowIso(-47),
      updatedBy: 'Dr. Elena Vance',
    },
    {
      id: 'att-2',
      sessionId: 'ses-past-1',
      courseId: 'crs-ts',
      studentId: 'stu-priya',
      status: 'Present',
      note: '',
      updatedAt: hoursFromNowIso(-47),
      updatedBy: 'Dr. Elena Vance',
    },
    {
      id: 'att-3',
      sessionId: 'ses-past-1',
      courseId: 'crs-ts',
      studentId: 'stu-liam',
      status: 'Late',
      note: 'Joined 18 minutes after lab briefing.',
      updatedAt: hoursFromNowIso(-47),
      updatedBy: 'Dr. Elena Vance',
    },
    {
      id: 'att-4',
      sessionId: 'ses-past-2',
      courseId: 'crs-cloud',
      studentId: 'stu-marcus',
      status: 'Present',
      note: '',
      updatedAt: hoursFromNowIso(-25),
      updatedBy: 'Dr. Elena Vance',
    },
  ];

  const grades: ModuleGrade[] = [
    {
      id: 'grd-1',
      studentId: 'stu-marcus',
      courseId: 'crs-ts',
      moduleId: 'ts-m1',
      score: 94,
      feedback: 'Clear mastery of discriminated unions and mapped types.',
      gradedAt: hoursFromNowIso(-24 * 24),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-2',
      studentId: 'stu-marcus',
      courseId: 'crs-ts',
      moduleId: 'ts-m2',
      score: 91,
      feedback: 'Well-structured component composition and clean state flows.',
      gradedAt: hoursFromNowIso(-24 * 14),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-3',
      studentId: 'stu-marcus',
      courseId: 'crs-ts',
      moduleId: 'ts-m3',
      score: 89,
      feedback: 'Solid RBAC middleware; remember edge-case expiry assertions.',
      gradedAt: hoursFromNowIso(-24 * 3),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-4',
      studentId: 'stu-marcus',
      courseId: 'crs-cloud',
      moduleId: 'cl-m1',
      score: 92,
      feedback: 'Efficient multi-stage container builds.',
      gradedAt: hoursFromNowIso(-24 * 10),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-5',
      studentId: 'stu-priya',
      courseId: 'crs-ts',
      moduleId: 'ts-m1',
      score: 88,
      feedback: 'Good strict type coverage across shared contracts.',
      gradedAt: hoursFromNowIso(-24 * 24),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-6',
      studentId: 'stu-priya',
      courseId: 'crs-ts',
      moduleId: 'ts-m2',
      score: 90,
      feedback: 'Accessible form controls and clean error recovery.',
      gradedAt: hoursFromNowIso(-24 * 14),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-7',
      studentId: 'stu-priya',
      courseId: 'crs-data',
      moduleId: 'da-m1',
      score: 95,
      feedback: 'Outstanding ETL pipeline reliability.',
      gradedAt: hoursFromNowIso(-24 * 45),
      gradedBy: 'Prof. David Okonkwo',
    },
    {
      id: 'grd-8',
      studentId: 'stu-priya',
      courseId: 'crs-data',
      moduleId: 'da-m2',
      score: 93,
      feedback: 'Optimal indexing and normalized schema.',
      gradedAt: hoursFromNowIso(-24 * 35),
      gradedBy: 'Prof. David Okonkwo',
    },
    {
      id: 'grd-9',
      studentId: 'stu-liam',
      courseId: 'crs-ts',
      moduleId: 'ts-m1',
      score: 72,
      feedback: 'Review conditional types and narrow null checks before M2.',
      gradedAt: hoursFromNowIso(-24 * 22),
      gradedBy: 'Dr. Elena Vance',
    },
    {
      id: 'grd-10',
      studentId: 'stu-sofia',
      courseId: 'crs-data',
      moduleId: 'da-m1',
      score: 87,
      feedback: 'Clean vectorization and documentation.',
      gradedAt: hoursFromNowIso(-24 * 16),
      gradedBy: 'Prof. David Okonkwo',
    },
    {
      id: 'grd-11',
      studentId: 'stu-noah',
      courseId: 'crs-sec',
      moduleId: 'cy-m1',
      score: 91,
      feedback: 'Thorough pcap inspection and rule authoring.',
      gradedAt: hoursFromNowIso(-24 * 9),
      gradedBy: 'Prof. David Okonkwo',
    },
  ];

  const remarks: ProgressRemark[] = [
    {
      id: 'rem-1',
      studentId: 'stu-marcus',
      courseId: 'crs-ts',
      summary:
        'Marcus demonstrates consistent technical precision in TypeScript architecture and security labs. Ready for the M4 CI/CD capstone.',
      updatedAt: hoursFromNowIso(-24 * 2),
      updatedBy: 'Dr. Elena Vance',
    },
    {
      id: 'rem-2',
      studentId: 'stu-liam',
      courseId: 'crs-ts',
      summary:
        'Liam should attend Thursday open lab hours to reinforce module M2 React state patterns and improve punctuality.',
      updatedAt: hoursFromNowIso(-24 * 2),
      updatedBy: 'Dr. Elena Vance',
    },
  ];

  const notifications: NotificationItem[] = [
    buildAttendanceNotification({
      id: 'not-seed-1',
      studentId: 'stu-marcus',
      course: courses[0],
      session: sessions[0],
      status: 'Present',
      note: 'Completed lab verification early.',
      createdAt: hoursFromNowIso(-47),
    }),
    buildAttendanceNotification({
      id: 'not-seed-2',
      studentId: 'stu-liam',
      course: courses[0],
      session: sessions[0],
      status: 'Late',
      note: 'Joined 18 minutes after lab briefing.',
      createdAt: hoursFromNowIso(-47),
    }),
  ];

  const reminders = findUpcomingSessionsNeedingReminders({
    sessions,
    courses,
    enrollments,
    existingNotifications: notifications,
    nowMs: Date.now(),
    windowHours: 24,
  });

  for (const rem of reminders) {
    notifications.push({
      ...rem,
      id: `not-${crypto.randomUUID().slice(0, 8)}`,
    });
  }

  return {
    users,
    courses,
    enrollments,
    sessions,
    attendance,
    grades,
    remarks,
    notifications,
  };
}

function loadStateFromDisk(): DatabaseState {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seed = createInitialSeed();
    saveStateToDisk(seed);
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DatabaseState;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.courses)) {
      throw new Error('Invalid DB structure');
    }
    return parsed;
  } catch {
    const seed = createInitialSeed();
    saveStateToDisk(seed);
    return seed;
  }
}

function saveStateToDisk(state: DatabaseState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

let dbState: DatabaseState = loadStateFromDisk();

export function getState(): DatabaseState {
  return dbState;
}

export function commitState(mutator: (state: DatabaseState) => void): DatabaseState {
  mutator(dbState);
  saveStateToDisk(dbState);
  return dbState;
}

export function toPublicUser(user: StoredUser): UserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentCode: user.studentCode,
    department: user.department,
  };
}

export function runSessionReminderSweep(nowMs = Date.now()): NotificationItem[] {
  const created: NotificationItem[] = [];
  commitState((state) => {
    const pending = findUpcomingSessionsNeedingReminders({
      sessions: state.sessions,
      courses: state.courses,
      enrollments: state.enrollments,
      existingNotifications: state.notifications,
      nowMs,
      windowHours: 24,
    });
    for (const item of pending) {
      const full: NotificationItem = {
        ...item,
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
      };
      state.notifications.unshift(full);
      created.push(full);
    }
  });
  return created;
}

export function createUserAccount(params: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): { ok: true; user: StoredUser } | { ok: false; error: string } {
  const normalizedEmail = params.email.trim().toLowerCase();
  const exists = dbState.users.some(
    (u) => u.email.toLowerCase() === normalizedEmail
  );
  if (exists) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const nextNum = 47 + dbState.users.filter((u) => u.role === 'student').length;
  const newUser: StoredUser = {
    id: `${params.role === 'instructor' ? 'inst' : 'stu'}-${crypto.randomUUID().slice(0, 8)}`,
    name: params.name.trim(),
    email: normalizedEmail,
    role: params.role,
    studentCode: params.role === 'student' ? `NTA-2026-0${nextNum}` : undefined,
    department: params.role === 'instructor' ? 'Technical Instruction' : undefined,
    passwordHash: hashPassword(params.password),
  };

  commitState((state) => {
    state.users.push(newUser);
    if (newUser.role === 'student' && state.courses.length > 0) {
      const starterCourse = state.courses[0];
      state.enrollments.push({
        id: `enr-${crypto.randomUUID().slice(0, 8)}`,
        studentId: newUser.id,
        courseId: starterCourse.id,
        cohort: 'Cohort A · Autumn',
        status: 'Active',
        enrolledAt: new Date().toISOString(),
        completedModuleIds: [],
      });
      state.notifications.unshift({
        id: `not-${crypto.randomUUID().slice(0, 8)}`,
        userId: newUser.id,
        kind: 'enrollment',
        title: `Welcome · ${starterCourse.code}`,
        message: `You have been enrolled in ${starterCourse.title} (Cohort A · Autumn). Upcoming lab schedules and attendance alerts appear here.`,
        relatedCourseId: starterCourse.id,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  });

  return { ok: true, user: newUser };
}

export function upsertAttendanceAndNotify(params: {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  note: string;
  instructorName: string;
}): { record: AttendanceRecord; notification: NotificationItem } | null {
  const session = dbState.sessions.find((s) => s.id === params.sessionId);
  if (!session) return null;
  const course = dbState.courses.find((c) => c.id === session.courseId);
  if (!course) return null;
  const student = dbState.users.find(
    (u) => u.id === params.studentId && u.role === 'student'
  );
  if (!student) return null;

  const nowIso = new Date().toISOString();
  let savedRecord!: AttendanceRecord;
  let savedNotif!: NotificationItem;

  commitState((state) => {
    const existing = state.attendance.find(
      (a) => a.sessionId === params.sessionId && a.studentId === params.studentId
    );
    if (existing) {
      existing.status = params.status;
      existing.note = params.note.trim();
      existing.updatedAt = nowIso;
      existing.updatedBy = params.instructorName;
      savedRecord = existing;
    } else {
      savedRecord = {
        id: `att-${crypto.randomUUID().slice(0, 8)}`,
        sessionId: params.sessionId,
        courseId: course.id,
        studentId: params.studentId,
        status: params.status,
        note: params.note.trim(),
        updatedAt: nowIso,
        updatedBy: params.instructorName,
      };
      state.attendance.push(savedRecord);
    }

    savedNotif = buildAttendanceNotification({
      id: `not-${crypto.randomUUID().slice(0, 8)}`,
      studentId: params.studentId,
      course,
      session,
      status: params.status,
      note: params.note,
      createdAt: nowIso,
    });
    state.notifications.unshift(savedNotif);
  });

  return { record: savedRecord, notification: savedNotif };
}

export function updateEnrollmentStatus(
  enrollmentId: string,
  status: EnrollmentStatus
): Enrollment | null {
  let updated: Enrollment | null = null;
  commitState((state) => {
    const enr = state.enrollments.find((e) => e.id === enrollmentId);
    if (enr) {
      enr.status = status;
      updated = enr;
    }
  });
  return updated;
}
