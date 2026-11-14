# InfoCom AMS — Phased Implementation Plan (Post-Phase 1 Baseline)

This plan establishes the controlled, incremental roadmap from the stabilized Phase 1 repository to a complete, production-hardened Academy Management System without breaking working features.

---

## Phase 1 (Completed) — Repository Audit, Security Stabilization & Baseline

- Complete codebase, dependency, persistence, and feature inventory (`REPOSITORY_AUDIT.md`, `FEATURE_INVENTORY.md`).
- Byte-for-byte backup verified (`/data/centre-db.backup.json` === `/data/centre-db.json`).
- Critical immediate security remediations applied and unit-tested:
  - CSPRNG fallback session secret (`SEC-01`).
  - `jti`-based session revocation on logout & DB role re-validation (`SEC-02`).
  - Cross-user notification IDOR eliminated (`SEC-03`).
  - Rate limiting on login, registration, Firebase SSO, and public admissions + failed-login audit logs (`SEC-04`).
  - HTTPS-conditional `secure` session cookie flag, safe HTTP security headers, and CSRF same-origin guard (`SEC-05`).
  - Enrollment integrity validation on grades, remarks, module completion, and attendance (`SEC-06`).
  - Admissions creation locked to `admin` + `nosniff` on downloads (`SEC-07`).
- Build, TypeScript lint (`tsc --noEmit`), and unit test suites (`academic.test.ts`, `validation.test.ts`, `auth.test.ts`) verified green.

---

## Phase 2 — Identity Lifecycle, Scoped Instructor RBAC & Onboarding

**Dependencies:** Phase 1 baseline passing; Cloud SQL PostgreSQL instance active.

1. **Persistent Session & Password Lifecycle (`SEC-09`, `SEC-10`, `SEC-11`):**
   - Add `user_sessions` (or `sessionVersion` column on `users`) in `src/db/schema.ts` so logout/deactivation/role-change revocations survive server restarts.
   - Add authenticated `POST /api/auth/change-password` endpoint (`requireAuth`) and enforce password rotation for staff-provisioned / admission-converted students using temporary onboarding tokens instead of static `Student!2026`.
2. **Instructor Course-Assignment RBAC (`SEC-08`):**
   - Scope instructor write operations (`PUT /api/grades`, `PUT /api/progress/remark`, `PUT /api/progress/module-completion`, `POST /api/sessions`, `POST /api/attendance`, `POST /api/certificates`) to courses/cohorts where the instructor is assigned (`course.instructorId === user.id || cohort.instructorId === user.id || session.instructorId === user.id`), keeping `admin` unrestricted.
   - Add dedicated instructor notification preferences and ensure `buildDashboardForUser()` does not expose unrelated instructors' notifications/documents.
3. **Production Server Start Packaging (`INF-01`):**
   - Add `"build:server"` (`esbuild server.ts --bundle --platform=node --packages=external --outfile=dist-server/server.mjs` or `tsx` runtime entrypoint) and align `package.json` `"start"` script so `npm start` executes reliably in Node.js production environments.

---

## Phase 3 — Academic Workflows, Cohorts & Public Admissions Wiring

**Dependencies:** Phase 2 RBAC & schema updates.

1. **Dynamic Cohort Binding (`UI-01`, `UI-03`):**
   - Populate cohort dropdowns dynamically from `data.cohorts` in `EnrollmentsView.tsx` and `SchedulesView.tsx`, persisting `cohortId` FKs and enforcing cohort capacity checks on enrollment (`Active` count <= `cohort.capacity`, auto-suggesting `Waitlisted` when full).
2. **Session Lifecycle & Attendance Rules (`UI-02`, `UI-07`):**
   - Wire `PATCH /api/sessions/:id/status` controls (`Completed`, `Cancelled`) into `SchedulesView.tsx` and auto-dispatch cancellation notifications to enrolled cohort students.
   - Exclude `Waitlisted` enrollments from grading/attendance eligibility until promoted to `Active`.
3. **Public Admissions Portal & Self-Registration Separation (`UI-04`, `UI-05`):**
   - Add a public "Apply for Admission" tab in `AuthView.tsx` backed by `POST /api/admissions/public`.
   - Remove silent auto-enrollment from `registerStudentAccount()` or make course selection explicit via Admissions review.
4. **Course & Cohort Edit/Archive Operations:**
   - Add `PATCH /api/courses/:id` and `PATCH /api/cohorts/:id` with Zod validation, audit logging, and UI edit modals in `CoursesCohortsView.tsx`.

---

## Phase 4 — Financial Polish, Document Hardening & Paginated Reporting

**Dependencies:** Phase 3 academic/cohort completeness.

1. **Finance & Printable Receipts:**
   - Add printable official receipt view (`RCPT-2026-*`) in `FinanceView.tsx` and student fee statements in `StudentDashboard.tsx`.
   - Support overdue invoice flagging and automated fee reminder notifications.
2. **Document Vault Hardening (`SEC-12`):**
   - Enforce MIME & file-extension allowlisting and optional server-side storage adapter abstraction while keeping PostgreSQL persistence working seamlessly.
3. **Scalability & Export (`INF-03`):**
   - Add server-side pagination/filtering endpoints for `auditLogs`, `payments`, and `notifications`, plus CSV export for administrative finance & attendance summaries.
   - Clean up remaining internal copy strings (`UI-06`).
