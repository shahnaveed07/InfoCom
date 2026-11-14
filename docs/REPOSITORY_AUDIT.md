# InfoCom AMS — Repository Audit (Phase 1)

**Repository:** `https://github.com/shahnaveed07/InfoCom.git`  
**Audit Date:** Phase 1 Audit & Stabilization  
**Architecture Model:** Single-repository full-stack TypeScript monorepo (React 19 + Vite frontend, Express.js backend, PostgreSQL via Cloud SQL `asia-southeast1` + Drizzle ORM, Firebase Auth / Admin SDK).

---

## 1. Repository Structure & File Inventory

### Root Configuration & Entry Points
| Path | Purpose | Notes |
| --- | --- | --- |
| `package.json` | Package manifest & scripts (`dev`, `start`, `build`, `preview`, `clean`, `lint`) | ESM (`"type": "module"`). Runs Express + Vite via `tsx server.ts`. |
| `server.ts` | Unified Express HTTP server & Vite middleware entry point | Serves `/api/*` routers, mounts security headers + CSRF origin guard, schedules 5-minute `runSessionReminderSweep()`, serves Vite in dev / `dist/` in prod on port `3000`. |
| `tsconfig.json` | TypeScript compiler configuration (`ES2022`, `react-jsx`, `noEmit: true`) | Used by `npm run lint` (`tsc --noEmit`). |
| `vite.config.ts` | Vite bundler + React + Tailwind v4 plugin config | Output directory `dist/`. |
| `index.html` | HTML entry point for SPA | Synced title & metadata for InfoCom AMS. |
| `metadata.json` | App identity & capabilities manifest | Configured at project initialization. |
| `.env.example` | Environment variable template | Documents `GEMINI_API_KEY`, `APP_URL`, and runtime env vars (no secrets stored). |

### Backend (`/server/`)
| Path | Responsibility |
| --- | --- |
| `server/auth.ts` | `scrypt` password hashing/verification, HMAC-SHA256 signed `nta_session` token signing/verification with `jti`, in-memory JTI revocation list (`revokeSessionJti`), cookie parser, secret bootstrap (`SESSION_SECRET` / `data/.session-secret` / CSPRNG fallback). |
| `server/middleware/auth.ts` | Dual authentication resolver (`Authorization: Bearer <Firebase ID Token>` or signed HttpOnly `nta_session` cookie), HTTPS-aware cookie setter/clearer, active-status and DB role re-validation, `requireAuth`, `requireRoles(...)`. |
| `server/middleware/security.ts` | Phase 1 hardening: fixed-window `createRateLimiter()`, `securityHeaders` (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; preserves iframe embedding), and `csrfOriginGuard` for cookie-authenticated mutations. |
| `server/routes/auth.routes.ts` | Auth & session routes: `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/firebase`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/dashboard`. |
| `server/routes/academics.routes.ts` | Academic APIs: `POST /api/courses`, `POST /api/cohorts`, `POST /api/enrollments`, `PATCH /api/enrollments/:id`, `PUT /api/progress/module-completion`, `PUT /api/grades`, `PUT /api/progress/remark`, `POST /api/sessions`, `PATCH /api/sessions/:id/status`, `POST /api/attendance`. |
| `server/routes/admin-ops.routes.ts` | Admin/Ops APIs: public certificate verify, public & admin admissions, admin user management, invoices/voiding/payments, certificate issue/revoke, reminder sweep, notification read state, document vault upload/download/archive. |
| `server/ams-service.ts` | Transactional domain & dashboard aggregation layer (`buildDashboardForUser`, `createEnrollmentWithOptionalInvoice`, `recordInvoicePayment`, `issueVerifiedCertificate`, `verifyCertificateByCode`, `markAttendanceAndNotify`, `runSessionReminderSweep`, `registerStudentAccount`, `syncFirebaseUser`, `recordAuditLog`). |
| `server/migrate.ts` | Controlled, idempotent startup/CLI migration from legacy `/data/centre-db.json` into PostgreSQL + backup creation (`/data/centre-db.backup.json`) + Academy Admin, Cohorts, Admissions, Invoices, Payments, Syllabus Document, and Certificate seeding. |
| `server/auth.test.ts` | Unit tests for password hashing, session signing/tampering, JTI revocation, rate limiter, and CSRF origin guard. |

### Database & Firebase Integration (`/src/db/` & `/src/lib/`)
| Path | Responsibility |
| --- | --- |
| `src/db/index.ts` | PostgreSQL `pg` connection pool + Drizzle ORM instance (reads Cloud SQL socket/host config or `DATABASE_URL`). |
| `src/db/schema.ts` | 16 PostgreSQL tables + relations: `users`, `courses`, `course_modules`, `cohorts`, `admissions`, `enrollments`, `class_sessions`, `attendance_records`, `module_grades`, `progress_remarks`, `fee_invoices`, `payments`, `documents`, `certificates`, `notifications`, `audit_logs`. |
| `src/db/drizzle.config.ts` | Drizzle Kit schema & migration config. |
| `src/lib/firebase.ts` | Client Firebase Auth initialization (`GoogleAuthProvider`). |
| `src/lib/firebase-admin.ts` | Server Firebase Admin SDK initialization for ID token verification. |

### Shared Contracts, Academic Utilities & Tests (`/src/shared/`)
| Path | Responsibility |
| --- | --- |
| `src/shared/types.ts` | Shared TypeScript interfaces for roles (`admin`, `instructor`, `student`), `DashboardPayload`, academic entities, financial entities, documents, certificates, and audit logs. |
| `src/shared/validation.ts` | Zod v4 runtime request validation schemas (`loginSchema`, `registerSchema`, `createUserSchema`, `createCourseSchema`, `createCohortSchema`, `createEnrollmentSchema`, `saveGradeSchema`, `createInvoiceSchema`, `recordPaymentSchema`, etc.). |
| `src/shared/academic.ts` | Pure deterministic academic & financial helpers: `calculateWeightedAverage`, `calculateLetterGrade`, `calculateCourseCompletion`, `calculateAttendanceStats`, `computeStudentProgressReport`, `formatReportAsText`, `findUpcomingSessionsNeedingReminders`, `buildAttendanceNotification`, `toCents`/`fromCents`, `computeInvoiceStatus`, `computeCertificateEligibility`, `computeAcademyAnalytics`. |
| `src/shared/academic.test.ts` | Unit tests for weighted grades, completion %, attendance rates, reminder dedupe, money math, and certificate eligibility. |
| `src/shared/validation.test.ts` | Unit tests for Zod validation edge cases. |

### Frontend (`/src/`)
| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Top-level SPA state, auth hydration, role-based navigation tabs, API dispatch handlers, and print CSS container. |
| `src/utils/api.ts` | Typed `fetch` client (`credentials: 'include'`) wrapping all REST endpoints. |
| `src/components/AuthView.tsx` | Email/password login, student-only self-registration, Google Sign-In, demo role quick-fill buttons (for evaluation), and public certificate verifier. |
| `src/components/Sidebar.tsx` | Role-filtered navigation sidebar (`admin`, `instructor`, `student`) + role badge + sign-out. |
| `src/components/TopBar.tsx` | Active section title, student code / department metadata, refresh trigger. |
| `src/components/AdminOverview.tsx` | Academy KPIs (students, enrollments, tuition billed/collected, certificates), admissions queue snapshot, cohort capacity utilization, recent audit events. |
| `src/components/InstructorOverview.tsx` | Active courses, upcoming sessions, roster completion/grade summary, quick navigation. |
| `src/components/StudentDashboard.tsx` | Student KPI cards, enrolled courses & progress bars, module scores, upcoming schedules, automated attendance & session reminder notifications with read/mark-all-read controls, student fee summary & certificates. |
| `src/components/UsersManagementView.tsx` | Admin directory for creating staff/student accounts and toggling status/role/department. |
| `src/components/AdmissionsView.tsx` | Admin admissions triage, status updates (`Submitted` -> `Under Review` -> `Accepted`/`Rejected` -> `Enrolled`), and 1-click conversion into Student + Enrollment + Tuition Invoice. |
| `src/components/CoursesCohortsView.tsx` | Course catalog with module weight validation (sum = 100%) and cohort management. |
| `src/components/EnrollmentsView.tsx` | Staff enrollment creation (with optional automatic tuition invoice) and status lifecycle updates (`Active`, `Completed`, `Waitlisted`, `Dropped`). |
| `src/components/CourseTrackingView.tsx` | Course module completion toggles and module grading modal with score (0–100) + feedback. |
| `src/components/AttendanceAlertsView.tsx` | Session attendance roll (`Present`, `Late`, `Absent`), optional note, automated notification trigger, and manual 24-hour reminder sweep button. |
| `src/components/SchedulesView.tsx` | Training timetable creation modal and upcoming/past session listing. |
| `src/components/ProgressReportView.tsx` | Printable & `.txt`-downloadable academic transcript/progress report + instructor evaluation remark editor. |
| `src/components/FinanceView.tsx` | Tuition invoice issuance, voiding unpaid invoices, payment settlement with receipt generation (`RCPT-2026-*`), and payment ledger. |
| `src/components/DocumentsView.tsx` | Base64 database-backed document vault (upload up to 2 MB, role-scoped download, archival). |
| `src/components/CertificatesView.tsx` | Eligibility checker, SHA-256 verified certificate issuance, revocation with audit reason, and verification lookup. |
| `src/components/AuditLogsView.tsx` | Admin-only read-only security & operational audit stream (latest 80 events). |

---

## 2. Data Persistence & Migration State Audit

- **Legacy JSON Store (`data/centre-db.json`):** Contains 21,481 bytes of legacy training centre state:
  - **8 Users:** 2 instructors (`inst-elena`, `inst-david`), 6 students (`stu-marcus`, `stu-priya`, `stu-liam`, `stu-sofia`, `stu-noah`, `stu-amara`), 0 admins.
  - **4 Courses / 16 Modules:** `CS-204` (`crs-ts`), `CL-310` (`crs-cloud`), `DA-215` (`crs-data`), `CY-402` (`crs-sec`). Each course has 4 modules whose weights sum cleanly to `100`.
  - **9 Enrollments:** 7 `Active`, 1 `Completed` (`enr-4` Priya Patel in `DA-215`), 1 `Waitlisted` (`enr-8` Amara Diallo in `CY-402`).
  - **6 Class Sessions:** 2 past (`ses-past-1`, `ses-past-2`) and 4 upcoming (`ses-upcoming-1`..`4`).
  - **5 Attendance Records**, **11 Module Grades**, **2 Progress Remarks**, **10 Notifications**.
- **Protected Backup (`data/centre-db.backup.json`):** Present and verified byte-for-byte identical (`diff -q` returned 0) to `data/centre-db.json`. Neither file is modified during operation.
- **Note on `server/store.ts`:** The legacy JSON file store `server/store.ts` was already superseded prior to this audit by `server/migrate.ts` (controlled migration + backup) and `server/ams-service.ts` (PostgreSQL via Drizzle ORM on Cloud SQL `asia-southeast1`).

---

## 3. Build, Runtime & Test Baseline

| Check | Command | Baseline Status |
| --- | --- | --- |
| TypeScript check / lint | `npm run lint` (`tsc --noEmit`) | Passing |
| Frontend production bundle | `npm run build` (`vite build`) | Passing (`dist/` generated) |
| Unit tests (Academic, Validation, Auth/Security) | `npx tsx --test src/shared/academic.test.ts src/shared/validation.test.ts server/auth.test.ts` | Passing |
| Unified Dev Server | `npm run dev` (`tsx server.ts`) | Listening on `0.0.0.0:3000` |
| Production Start Script | `npm start` (`node server.ts`) | **Warning:** Uses `node server.ts` on `.ts` source importing `.ts` extensions (`tsx` or compiled JS needed on Node < 22.6 without flags; see `KNOWN_ISSUES.md`). |
