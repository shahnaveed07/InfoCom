import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './server/auth';
import {
  commitState,
  createUserAccount,
  getState,
  runSessionReminderSweep,
  toPublicUser,
  updateEnrollmentStatus,
  upsertAttendanceAndNotify,
  type StoredUser,
} from './server/store';
import type {
  AttendanceStatus,
  DashboardPayload,
  EnrollmentStatus,
  UserRole,
} from './src/shared/types';

interface AuthenticatedRequest extends Request {
  authUser?: StoredUser;
}

const PORT = 3000;

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (!payload) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user = getState().users.find((u) => u.id === payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Session account no longer exists.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireInstructor(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser || req.authUser.role !== 'instructor') {
    res.status(403).json({ error: 'Instructor authorization required.' });
    return;
  }
  next();
}

function buildDashboardForUser(user: StoredUser): DashboardPayload {
  const state = getState();
  const publicUser = toPublicUser(user);

  if (user.role === 'instructor') {
    return {
      user: publicUser,
      courses: state.courses,
      students: state.users
        .filter((u) => u.role === 'student')
        .map(toPublicUser),
      enrollments: state.enrollments,
      sessions: state.sessions,
      attendance: state.attendance,
      grades: state.grades,
      remarks: state.remarks,
      notifications: state.notifications,
    };
  }

  // Student scope: strictly isolated to the signed-in student's enrollments, grades, attendance, remarks, and notifications
  const myEnrollments = state.enrollments.filter((e) => e.studentId === user.id);
  const myCourseIds = new Set(myEnrollments.map((e) => e.courseId));

  return {
    user: publicUser,
    courses: state.courses,
    students: [publicUser],
    enrollments: myEnrollments,
    sessions: state.sessions.filter((s) => myCourseIds.has(s.courseId)),
    attendance: state.attendance.filter((a) => a.studentId === user.id),
    grades: state.grades.filter((g) => g.studentId === user.id),
    remarks: state.remarks.filter((r) => r.studentId === user.id),
    notifications: state.notifications.filter((n) => n.userId === user.id),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Initial sweep + periodic 5-minute automated reminder scheduler
  runSessionReminderSweep();
  setInterval(() => {
    runSessionReminderSweep();
  }, 5 * 60 * 1000);

  // Auth routes
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = getState().users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signSessionToken(user.id, user.role);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const roleRaw = req.body?.role;
    const role: UserRole = roleRaw === 'instructor' ? 'instructor' : 'student';

    if (name.length < 2) {
      res.status(400).json({ error: 'Full name must be at least 2 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const created = createUserAccount({ name, email, password, role });
    if (!created.ok) {
      res.status(409).json({ error: created.error });
      return;
    }

    const token = signSessionToken(created.user.id, created.user.role);
    setSessionCookie(res, token);
    res.status(201).json({ user: toPublicUser(created.user) });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: toPublicUser(req.authUser!) });
  });

  // Dashboard snapshot
  app.get('/api/dashboard', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    runSessionReminderSweep();
    res.json(buildDashboardForUser(req.authUser!));
  });

  // Enrollment management (Instructor only)
  app.post(
    '/api/enrollments',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
      const cohort =
        typeof req.body?.cohort === 'string' && req.body.cohort.trim()
          ? req.body.cohort.trim()
          : 'Cohort A · Autumn';
      const status: EnrollmentStatus =
        req.body?.status === 'Waitlisted' ? 'Waitlisted' : 'Active';

      const state = getState();
      const student = state.users.find(
        (u) => u.id === studentId && u.role === 'student'
      );
      const course = state.courses.find((c) => c.id === courseId);
      if (!student || !course) {
        res.status(400).json({ error: 'Valid student and course are required.' });
        return;
      }

      const duplicate = state.enrollments.find(
        (e) =>
          e.studentId === studentId &&
          e.courseId === courseId &&
          e.status !== 'Dropped'
      );
      if (duplicate) {
        res.status(409).json({
          error: `${student.name} already has an active or waitlisted enrollment in ${course.code}.`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const newEnrollment = {
        id: `enr-${crypto.randomUUID().slice(0, 8)}`,
        studentId,
        courseId,
        cohort,
        status,
        enrolledAt: nowIso,
        completedModuleIds: [],
      };

      commitState((s) => {
        s.enrollments.unshift(newEnrollment);
        s.notifications.unshift({
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: studentId,
          kind: 'enrollment',
          title: `Enrollment Confirmed · ${course.code}`,
          message: `You were enrolled in ${course.title} (${cohort}) with status ${status}.`,
          relatedCourseId: course.id,
          read: false,
          createdAt: nowIso,
        });
      });

      runSessionReminderSweep();
      res.status(201).json({
        enrollment: newEnrollment,
        dashboard: buildDashboardForUser(req.authUser!),
      });
    }
  );

  app.patch(
    '/api/enrollments/:id',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const allowed: EnrollmentStatus[] = ['Active', 'Completed', 'Waitlisted', 'Dropped'];
      const status = req.body?.status as EnrollmentStatus;
      if (!allowed.includes(status)) {
        res.status(400).json({ error: 'Invalid enrollment status.' });
        return;
      }
      const updated = updateEnrollmentStatus(req.params.id, status);
      if (!updated) {
        res.status(404).json({ error: 'Enrollment not found.' });
        return;
      }
      res.json({
        enrollment: updated,
        dashboard: buildDashboardForUser(req.authUser!),
      });
    }
  );

  // Module completion toggle (Instructor only)
  app.put(
    '/api/progress/module-completion',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const enrollmentId = typeof req.body?.enrollmentId === 'string' ? req.body.enrollmentId : '';
      const moduleId = typeof req.body?.moduleId === 'string' ? req.body.moduleId : '';
      const completed = Boolean(req.body?.completed);

      let found = false;
      commitState((state) => {
        const enr = state.enrollments.find((e) => e.id === enrollmentId);
        if (!enr) return;
        found = true;
        const set = new Set(enr.completedModuleIds);
        if (completed) set.add(moduleId);
        else set.delete(moduleId);
        enr.completedModuleIds = Array.from(set);
      });

      if (!found) {
        res.status(404).json({ error: 'Enrollment not found.' });
        return;
      }
      res.json({ dashboard: buildDashboardForUser(req.authUser!) });
    }
  );

  // Grade entry / update (Instructor only)
  app.put(
    '/api/grades',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
      const moduleId = typeof req.body?.moduleId === 'string' ? req.body.moduleId : '';
      const score = Number(req.body?.score);
      const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';

      if (Number.isNaN(score) || score < 0 || score > 100) {
        res.status(400).json({ error: 'Score must be a number between 0 and 100.' });
        return;
      }

      const course = getState().courses.find((c) => c.id === courseId);
      const mod = course?.modules.find((m) => m.id === moduleId);
      if (!course || !mod) {
        res.status(400).json({ error: 'Valid course and module are required.' });
        return;
      }

      const nowIso = new Date().toISOString();
      commitState((state) => {
        const existing = state.grades.find(
          (g) =>
            g.studentId === studentId &&
            g.courseId === courseId &&
            g.moduleId === moduleId
        );
        if (existing) {
          existing.score = Math.round(score);
          existing.feedback = feedback;
          existing.gradedAt = nowIso;
          existing.gradedBy = req.authUser!.name;
        } else {
          state.grades.push({
            id: `grd-${crypto.randomUUID().slice(0, 8)}`,
            studentId,
            courseId,
            moduleId,
            score: Math.round(score),
            feedback,
            gradedAt: nowIso,
            gradedBy: req.authUser!.name,
          });
        }

        state.notifications.unshift({
          id: `not-${crypto.randomUUID().slice(0, 8)}`,
          userId: studentId,
          kind: 'grade',
          title: `Grade Posted · ${course.code} ${mod.code}`,
          message: `Score ${Math.round(score)}% recorded for "${mod.title}" by ${req.authUser!.name}.`,
          relatedCourseId: course.id,
          read: false,
          createdAt: nowIso,
        });
      });

      res.json({ dashboard: buildDashboardForUser(req.authUser!) });
    }
  );

  // Progress report remark (Instructor only)
  app.put(
    '/api/progress/remark',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
      const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';

      if (!studentId || !courseId || summary.length < 4) {
        res.status(400).json({ error: 'Student, course, and remark text are required.' });
        return;
      }

      const nowIso = new Date().toISOString();
      commitState((state) => {
        const existing = state.remarks.find(
          (r) => r.studentId === studentId && r.courseId === courseId
        );
        if (existing) {
          existing.summary = summary;
          existing.updatedAt = nowIso;
          existing.updatedBy = req.authUser!.name;
        } else {
          state.remarks.push({
            id: `rem-${crypto.randomUUID().slice(0, 8)}`,
            studentId,
            courseId,
            summary,
            updatedAt: nowIso,
            updatedBy: req.authUser!.name,
          });
        }
      });

      res.json({ dashboard: buildDashboardForUser(req.authUser!) });
    }
  );

  // Attendance marking + automatic student notification (Instructor only)
  app.post(
    '/api/attendance',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
      const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
      const status = req.body?.status as AttendanceStatus;
      const note = typeof req.body?.note === 'string' ? req.body.note : '';

      if (!['Present', 'Late', 'Absent'].includes(status)) {
        res.status(400).json({ error: 'Status must be Present, Late, or Absent.' });
        return;
      }

      const result = upsertAttendanceAndNotify({
        sessionId,
        studentId,
        status,
        note,
        instructorName: req.authUser!.name,
      });

      if (!result) {
        res.status(404).json({ error: 'Session or student not found.' });
        return;
      }

      res.json({
        record: result.record,
        notification: result.notification,
        dashboard: buildDashboardForUser(req.authUser!),
      });
    }
  );

  // Schedule new class session (Instructor only)
  app.post(
    '/api/sessions',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
      const cohort =
        typeof req.body?.cohort === 'string' && req.body.cohort.trim()
          ? req.body.cohort.trim()
          : 'Cohort A · Autumn';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const room = typeof req.body?.room === 'string' ? req.body.room.trim() : '';
      const startIso = typeof req.body?.startIso === 'string' ? req.body.startIso : '';
      const durationHours = Number(req.body?.durationHours || 2);

      const course = getState().courses.find((c) => c.id === courseId);
      const startMs = Date.parse(startIso);
      if (!course || title.length < 3 || !room || Number.isNaN(startMs)) {
        res.status(400).json({
          error: 'Valid course, session title, room, and start time are required.',
        });
        return;
      }

      const endIso = new Date(startMs + Math.max(1, durationHours) * 60 * 60 * 1000).toISOString();
      const newSession = {
        id: `ses-${crypto.randomUUID().slice(0, 8)}`,
        courseId,
        cohort,
        title,
        topic: topic || 'Instructor-led lab session',
        room,
        instructorName: req.authUser!.name,
        startIso: new Date(startMs).toISOString(),
        endIso,
      };

      commitState((state) => {
        state.sessions.push(newSession);
      });

      const remindersCreated = runSessionReminderSweep();
      res.status(201).json({
        session: newSession,
        remindersCreatedCount: remindersCreated.length,
        dashboard: buildDashboardForUser(req.authUser!),
      });
    }
  );

  // Manual trigger for automated 24h session reminder sweep (Instructor only)
  app.post(
    '/api/notifications/run-reminders',
    requireAuth,
    requireInstructor,
    (req: AuthenticatedRequest, res: Response) => {
      const created = runSessionReminderSweep();
      res.json({
        createdCount: created.length,
        dashboard: buildDashboardForUser(req.authUser!),
      });
    }
  );

  // Notification read state (Instructor or owning student)
  app.patch(
    '/api/notifications/:id/read',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      let updated = false;
      commitState((state) => {
        const notif = state.notifications.find((n) => n.id === req.params.id);
        if (!notif) return;
        if (req.authUser!.role !== 'instructor' && notif.userId !== req.authUser!.id) {
          return;
        }
        notif.read = true;
        updated = true;
      });
      if (!updated) {
        res.status(404).json({ error: 'Notification not found.' });
        return;
      }
      res.json({ dashboard: buildDashboardForUser(req.authUser!) });
    }
  );

  app.post(
    '/api/notifications/read-all',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      commitState((state) => {
        for (const notif of state.notifications) {
          if (req.authUser!.role === 'instructor' || notif.userId === req.authUser!.id) {
            notif.read = true;
          }
        }
      });
      res.json({ dashboard: buildDashboardForUser(req.authUser!) });
    }
  );

  // Frontend serving (Vite dev middleware in development, static dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Northbridge Tech Academy server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
