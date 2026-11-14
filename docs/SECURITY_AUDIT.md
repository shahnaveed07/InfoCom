# InfoCom AMS — Security Audit & Remediation Report (Phase 1)

This audit evaluates authentication, session lifecycle, authorization/RBAC, IDOR exposure, rate limiting, CSRF defenses, input validation, and data isolation across InfoCom AMS.

---

## 1. Security Controls Verified as Already Present

1. **Public Instructor Registration Blocked (`server/routes/auth.routes.ts`, `server/ams-service.ts`):**
   - `registerSchema` (`src/shared/validation.ts`) accepts only `name`, `email`, `password`, and `phone` (any `role` supplied in the request body is stripped by Zod).
   - `registerStudentAccount()` explicitly hardcodes `role: 'student'`.
2. **Password Hashing (`server/auth.ts`):**
   - Uses Node `crypto.scryptSync` with a 16-byte random salt per call and `crypto.timingSafeEqual` during verification.
3. **Server-Side Firebase Token Verification (`server/middleware/auth.ts`, `server/routes/auth.routes.ts`):**
   - Google SSO verifies ID tokens via `adminAuth.verifyIdToken(idToken)` before provisioning/linking users.
   - Auto-admin provisioning is locked strictly to `snave9401@gmail.com`; all other SSO users default to `student`.
4. **Student Data Isolation (`server/ams-service.ts`):**
   - `buildDashboardForUser()` filters enrollments, sessions, attendance, grades, remarks, invoices, payments, certificates, notifications, and documents strictly to the authenticated student's `id`.
   - `getActiveDocumentContent()` rejects student downloads of other users' files or un-enrolled syllabi with `403`.
5. **Financial & Certificate Authority on Server (`server/ams-service.ts`):**
   - Invoice totals, remaining balances, overpayment rejection, and certificate eligibility (`computeCertificateEligibility`) are computed exclusively on the server inside DB transactions.

---

## 2. Vulnerabilities Identified & Fixed in Phase 1

| ID | Severity | Finding | Fix Applied in Phase 1 |
| --- | --- | --- | --- |
| **SEC-01** | **High** | **Predictable Fallback Session Secret (`server/auth.ts`):** If `SESSION_SECRET` env var was unset and `data/.session-secret` failed to read/write, fallback computed `sha256(process.cwd())`, a predictable workspace path (`/app/applet`). | Replaced fallback with `crypto.randomBytes(32).toString('hex')` (ephemeral CSPRNG key). |
| **SEC-02** | **High** | **Missing Session Revocation & DB Role Re-check (`server/auth.ts`, `auth.middleware.ts`, `auth.routes.ts`):** `SessionPayload` lacked a `jti`; `POST /api/auth/logout` only cleared the browser cookie so stolen tokens remained valid for 7 days. `resolveRequestUser()` did not re-verify that `userRow.role === payload.role`. | Added `jti: crypto.randomUUID()` to tokens, implemented server-side JTI revocation store (`revokeSessionJti` / `isSessionRevoked`) invoked on logout, and enforced `userRow.role === payload.role` in `resolveRequestUser()`. |
| **SEC-03** | **High** | **Cross-User Notification IDOR (`server/routes/admin-ops.routes.ts`):** `POST /api/notifications/read-all` ran an unfiltered `UPDATE notifications SET read = true` for `admin`/`instructor`, wiping unread notification badges for *all students*. `PATCH /api/notifications/:id/read` only checked `notif.userId === req.authUser.id` for students. | Restricted both `PATCH /api/notifications/:id/read` and `POST /api/notifications/read-all` strictly to `notif.userId === req.authUser.id` across all roles. |
| **SEC-04** | **High** | **Missing Brute-Force & Public Form Rate Limiting (`auth.routes.ts`, `admin-ops.routes.ts`):** Login, registration, Firebase token exchange, and public admission endpoints had no request throttling or failed-login audit trail. | Added `server/middleware/security.ts` (`createRateLimiter`) protecting `/auth/login`, `/auth/register`, `/auth/firebase`, and `/admissions/public` (`429` + `Retry-After`), plus `USER_LOGIN_FAILED` / `USER_LOGIN_BLOCKED` audit logs. |
| **SEC-05** | **Medium** | **Missing HTTPS `Secure` Cookie Flag & CSRF Origin Defense (`server.ts`, `middleware/auth.ts`, `middleware/security.ts`):** Session cookies lacked `secure` when served over HTTPS proxies, and mutating cookie-authenticated `/api` endpoints did not check `Origin`/`Referer`. | Added `isSecureRequest(req)` (`req.secure` / `x-forwarded-proto: https`) for cookies, mounted `csrfOriginGuard` on `/api`, and added `securityHeaders` (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`; intentionally omits `X-Frame-Options` for iframe preview compatibility). |
| **SEC-06** | **High** | **Missing Enrollment Integrity Checks in Academic Mutations (`academics.routes.ts`, `ams-service.ts`):** `PUT /api/grades`, `PUT /api/progress/remark`, and `POST /api/attendance` (`markAttendanceAndNotify`) did not verify the target student held a non-dropped enrollment in the target course/cohort (and `remark` could throw a 500 FK error on bad IDs). | Added explicit non-dropped enrollment verification in `PUT /api/grades`, `PUT /api/progress/remark`, `PUT /api/progress/module-completion` (rejects `Dropped`), and `markAttendanceAndNotify` (checks course + session cohort). |
| **SEC-07** | **Medium** | **Over-Broad Instructor Permission on Admissions & Missing Download Sniff Guard (`admin-ops.routes.ts`):** `POST /api/admissions` allowed `instructor` despite Admissions being Admin-only; `/documents/:id/download` lacked `X-Content-Type-Options: nosniff`. | Tightened `POST /api/admissions` to `requireRoles('admin')` and added `X-Content-Type-Options: nosniff` on document downloads. |

---

## 3. Remaining Security Backlog (Scoped for Phase 2–4)

| ID | Severity | Finding | Planned Phase & Mitigation |
| --- | --- | --- | --- |
| **SEC-08** | **Medium** | **Cross-Course Instructor Scope:** Any `instructor` can view/grade/mark attendance for *all* courses and view all non-receipt documents/notifications in `buildDashboardForUser()`. Currently required by shared demo flows (`InstructorOverview`, `AttendanceAlertsView` across `CS-204` and `CY-402`). | **Phase 2 / Phase 3:** Scope instructor mutations and dashboard feeds to courses/cohorts where `course.instructorId === user.id || cohort.instructorId === user.id || session.instructorId === user.id` (with Admin retaining global access and a dedicated Instructor Staff Notification view). |
| **SEC-09** | **Medium** | **Static Initial Password on Admission Conversion (`admin-ops.routes.ts:346`):** Converting an accepted applicant into a student sets a static initial password (`Student!2026`). | **Phase 2:** Generate random CSPRNG onboarding password + one-time password-setup token / forced first-login password change flow. |
| **SEC-10** | **Low** | **In-Memory Revocation & Rate-Limit Stores:** Revoked `jti` map and rate-limit buckets are process-local and clear on server restart. | **Phase 2 / Production:** Back revoked sessions (`user_sessions` table) and rate-limit state in PostgreSQL or shared Redis if scaling horizontally across multiple instances. |
| **SEC-11** | **Low** | **No Password Rotation / Self-Service Reset Endpoint:** Seeded demo users share passwords per role group in `migrate.ts`, and users lack a `/api/auth/change-password` route. | **Phase 2:** Add authenticated password change endpoint and invalidate prior session `jti`s / `sessionVersion` upon password change. |
| **SEC-12** | **Low** | **Document MIME Whitelist:** `uploadDocumentSchema` permits any MIME string up to 2 MB; downloading HTML/SVG as `attachment` is mitigated by `Content-Disposition: attachment` + `nosniff`, but strict MIME allowlisting (`pdf`, `png`, `jpg`, `txt`, `docx`, `csv`) is cleaner. | **Phase 4:** Enforce server-side MIME & magic-byte validation allowlist. |

---

## 4. Role-Based Access Control (RBAC) Matrix (Post-Phase 1)

| Capability / Endpoint Group | Unauthenticated | Student | Instructor | Admin |
| --- | --- | --- | --- | --- |
| Public Auth & Cert Verify (`/auth/*`, `/certificates/verify/:code`, `/admissions/public`) | Allowed (Rate-limited) | Allowed | Allowed | Allowed |
| Own Dashboard & Notification Read (`/dashboard`, `/notifications/*`) | `401` | Own data only | Own notifs / academic data | Own notifs / full academy data |
| User & Staff Provisioning (`/users`, `/users/:id`) | `401` | `403` | `403` | Allowed |
| Admissions Management (`/admissions`, `/admissions/:id`) | `401` | `403` | `403` | Allowed |
| Academic Operations (`/courses`, `/cohorts`, `/enrollments`, `/grades`, `/attendance`, `/sessions`, `/progress/*`) | `401` | `403` | Allowed (Staff) | Allowed |
| Finance & Invoices (`/invoices`, `/invoices/:id/void`, `/invoices/:id/payments`) | `401` | `403` (Own read-only in dashboard) | `403` | Allowed |
| Certificates Issue / Revoke | `401` | `403` | Issue only (`403` revoke) | Issue & Revoke |
| Document Upload / Download / Archive | `401` | Own & enrolled syllabi (`403` restricted categories) | Upload/Download non-receipts; Archive own/uploaded | Full Vault Access |
| Audit Logs (`/dashboard` slice) | `401` | Empty `[]` | Empty `[]` | Latest 80 events |
