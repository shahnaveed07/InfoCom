# InfoCom AMS — Feature Inventory & Verification Matrix (Phase 1)

This document catalogs every feature currently present in InfoCom AMS, mapping UI components to API routes, server business logic, and PostgreSQL tables, along with verified working status and identified gaps.

---

## 1. Feature Status Matrix

| Domain | Feature | UI Component | API Endpoint(s) | Status | Notes / Gaps |
| --- | --- | --- | --- | --- | --- |
| **Authentication** | Email & password sign-in | `AuthView.tsx` | `POST /api/auth/login` | Working | Rate-limited (Phase 1), `scrypt` verified, audit-logged. |
| **Authentication** | Student self-registration | `AuthView.tsx` | `POST /api/auth/register` | Working (Caveat) | Hardcodes `role: 'student'`. Silently auto-enrolls into first course (`Cohort A · Autumn`) instead of selecting course/admissions flow. |
| **Authentication** | Google Sign-In (Firebase SSO) | `AuthView.tsx` | `POST /api/auth/firebase` | Working | Server verifies Firebase ID token via `firebase-admin`. Restricted admin bootstrap to owner email. |
| **Authentication** | Session hydration & logout | `App.tsx`, `Sidebar.tsx` | `GET /api/auth/me`, `POST /api/auth/logout` | Working | Phase 1 added server-side `jti` revocation on logout. |
| **Role Dashboards** | Admin Academy Overview | `AdminOverview.tsx` | `GET /api/dashboard` | Working | Live PostgreSQL metrics via `computeAcademyAnalytics()`. Minor copy references internal DB engine name. |
| **Role Dashboards** | Instructor Overview | `InstructorOverview.tsx` | `GET /api/dashboard` | Working (Broad Scope) | Instructors currently view all courses/sessions/enrollments across the academy rather than strictly assigned courses. |
| **Role Dashboards** | Student Dashboard | `StudentDashboard.tsx` | `GET /api/dashboard` | Working | Strictly scoped to authenticated `studentId`: enrolled courses, module grades, schedule, fee invoices, certificates, notifications. |
| **User & Staff Mgmt** | Admin create/update users | `UsersManagementView.tsx` | `POST /api/users`, `PATCH /api/users/:id` | Working | Admin-only. Self-demotion & self-deactivation guarded server-side. |
| **Admissions** | Public admission endpoint | *No UI yet* | `POST /api/admissions/public` | Backend Only | Endpoint exists and is rate-limited, but `AuthView.tsx` has no public admissions application tab. |
| **Admissions** | Admin admissions triage & conversion | `AdmissionsView.tsx` | `GET /api/admissions`, `POST /api/admissions`, `PATCH /api/admissions/:id` | Working (Caveat) | 1-click conversion creates Student + Enrollment + Tuition Invoice + Notification in DB transaction. New users get static temp password `Student!2026`. |
| **Courses & Cohorts** | Course creation (with module weights) | `CoursesCohortsView.tsx` | `POST /api/courses` | Working | Enforces `sum(module.weight) === 100` server & client side. Missing course edit/archive UI. |
| **Courses & Cohorts** | Cohort creation | `CoursesCohortsView.tsx` | `POST /api/cohorts` | Working | Persists structured cohorts with capacity & date range. Missing cohort edit/archive UI. |
| **Enrollments** | Staff create & update enrollments | `EnrollmentsView.tsx` | `POST /api/enrollments`, `PATCH /api/enrollments/:id` | Partial Gap | Functional, optional tuition invoice generation works. UI form passes cohort text label without selecting/linking `cohortId` FK. |
| **Course Tracking** | Module completion toggle | `CourseTrackingView.tsx` | `PUT /api/progress/module-completion` | Working | Validates module belongs to enrolled course and enrollment is not Dropped. |
| **Grading** | Module grading & feedback | `CourseTrackingView.tsx` | `PUT /api/grades` | Working | Upserts grade (0–100), dispatches student notification, Phase 1 added enrollment guard. |
| **Scheduling** | Class session creation | `SchedulesView.tsx` | `POST /api/sessions` | Partial Gap | Persists session and triggers reminder sweep. Modal hardcodes `Cohort A/B · Autumn` options instead of reading `data.cohorts`. |
| **Scheduling** | Session status update (`Completed`/`Cancelled`) | *No UI yet* | `PATCH /api/sessions/:id/status` | Backend Only | `api.updateSessionStatus` exists in `src/utils/api.ts`, but `SchedulesView.tsx` exposes no status controls. |
| **Attendance & Alerts** | Attendance marking + automated alert | `AttendanceAlertsView.tsx` | `POST /api/attendance` | Working | Upserts attendance (`Present`/`Late`/`Absent`), dispatches automated student notification, Phase 1 added cohort enrollment validation. |
| **Attendance & Alerts** | Automated 24h session reminder sweep | `AttendanceAlertsView.tsx`, `server.ts` | `POST /api/notifications/run-reminders` | Working | Idempotent via `dedupeKey`; runs on interval, login/dashboard load, session creation, and manual trigger. |
| **Notifications** | Student inbox read / read-all | `StudentDashboard.tsx` | `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` | Working | Phase 1 fixed cross-user IDOR so both routes strictly scope to `req.authUser.id`. |
| **Progress Reports** | Printable / downloadable report + remarks | `ProgressReportView.tsx` | `PUT /api/progress/remark` | Working | Weighted GPA/average, letter grade, standing, attendance summary, print layout, `.txt` download. Phase 1 added enrollment check. |
| **Finance & Receipts** | Issue invoice, void invoice, record payment | `FinanceView.tsx` | `POST /api/invoices`, `PATCH /api/invoices/:id/void`, `POST /api/invoices/:id/payments` | Working | Integer-cents arithmetic via `toCents`/`fromCents`, prevents overpaying or voiding paid invoices, auto-generates `RCPT-2026-*` and student notification. |
| **Document Vault** | Upload, role-scoped download, archive | `DocumentsView.tsx` | `POST /api/documents`, `GET /api/documents/:id/download`, `PATCH /api/documents/:id/archive` | Working | Max 2 MB validation; students restricted to `ID Verification`, `Assignment`, `Other` and own docs + enrolled `Syllabus`. |
| **Certificates** | Issue, revoke & public verify | `CertificatesView.tsx`, `AuthView.tsx` | `POST /api/certificates`, `POST /api/certificates/:id/revoke`, `GET /api/certificates/verify/:code` | Working | Checks eligibility (100% completion, passing grade >= 60%, attendance >= 75%), SHA-256 hash verification. |
| **Audit Logs** | Read-only security/operations trail | `AuditLogsView.tsx` | `GET /api/dashboard` (admin) | Working | Displays latest 80 audit log rows for admins only. |

---

## 2. Incomplete UI / API Wiring Summary

1. **Session Lifecycle Controls Missing (`PATCH /api/sessions/:id/status`):** Backend route and `src/utils/api.ts` client method exist, but instructors/admins have no buttons in `SchedulesView.tsx` to mark sessions `Completed` or `Cancelled`.
2. **Public Admissions Form Missing (`POST /api/admissions/public`):** Backend endpoint exists and rate limiting is active, but prospective students have no UI entry point in `AuthView.tsx`.
3. **Hardcoded Cohort Strings in Forms (`EnrollmentsView.tsx`, `SchedulesView.tsx`):** Forms construct static `'Cohort A · Autumn'` / `'Cohort B · Autumn'` dropdowns rather than binding to `data.cohorts` (`cohortId` + `cohort` name), preventing newly created cohorts from appearing cleanly in scheduling/enrollment selects.
4. **Course/Cohort Edit & Archive UI Missing:** Creation exists (`POST /api/courses`, `POST /api/cohorts`), while update/archive endpoints and UI forms are not yet built.
5. **Document & Invoice Pagination / Receipt Print Template:** Document Vault stores Base64 payloads directly in `documents.content_base64` (capped at 2 MB) without dedicated search pagination, and payment receipts lack a standalone printable receipt slip modal.
