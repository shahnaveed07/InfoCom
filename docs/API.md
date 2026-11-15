# InfoCom AMS — REST API Specification

All endpoints are mounted under `/api` via `server/app.ts` and protected by `securityHeaders`, `createSafeCorsMiddleware`, `csrfOriginGuard`, Zod validation, and `safeApiErrorHandler`.

---

## 1. Authentication & Workspace (`server/routes/auth.routes.ts`)

| Method & Path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/auth/me` | Public (Cookie) | Returns authenticated `{ user }` or `{ user: null }` |
| `POST /api/auth/login` | Public (Rate-limited) | Authenticates email/password (`Argon2id` / `scrypt` upgrade), creates `AuthSession`, sets HttpOnly cookie |
| `POST /api/auth/firebase` | Public (Rate-limited) | *Legacy Firebase SSO — scheduled for removal in Phase B* |
| `POST /api/auth/register` | Public (Rate-limited) | Student-only self-registration (rejects non-student roles with `403`) |
| `POST /api/auth/logout` | Cookie | Revokes active `AuthSession` by `tokenHash` and clears cookie |
| `POST /api/auth/change-password` | `requireAuth` (Rate-limited) | Updates password, clears `mustChangePassword`, revokes sibling sessions |
| `POST /api/auth/forgot-password` | Public (Rate-limited) | Generates SHA-256 `PasswordResetToken` (30m TTL) with enumeration-safe `200` |
| `POST /api/auth/reset-password` | Public (Rate-limited) | Validates single-use reset token, updates hash, revokes all active sessions |
| `GET /api/dashboard` | `requireAuth` | Runs reminder sweep and returns role-scoped `DashboardPayload` |

---

## 2. Admissions (`server/routes/admissions.routes.ts`)

| Method & Path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/admissions/public` | Public (Rate-limited) | Prospective student application submission |
| `GET /api/admissions` | `admin` | Filtered & paginated admissions queue |
| `GET /api/admissions/:id` | `admin` | Detailed application payload with documents, history, batches, fee plans |
| `POST /api/admissions` | `admin` | Create draft or submitted application |
| `PATCH /api/admissions/:id` | `admin` | Update application fields and transition statuses with audit history |
| `POST /api/admissions/:id/documents` | `admin` | Attach applicant document (`FileAsset` + `AdmissionDocument`) |
| `PATCH /api/admissions/:id/documents/:docId` | `admin` | Verify, request replacement, or reject admission document |
| `GET /api/admissions/:id/documents/:docId/download` | `requireAuth` | Permission-checked binary download (`nosniff`) |
| `POST /api/admissions/:id/approve` | `admin` | Approve application, create/link student profile, batch enrollment & fee invoice |
| `POST /api/admissions/:id/activate-portal` | `admin` | Activate approved student portal access according to academy policy |

---

## 3. Academics (`server/routes/academics.routes.ts`)

| Method & Path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/enrollments` | `admin`, `instructor` | Paginated enrollments (instructor scoped to assigned courses/batches) |
| `GET /api/courses/:courseId` | `requireAuth` | Course modules & cohorts (students restricted to enrolled courses) |
| `GET /api/students/:studentId` | `requireAuth` | Student academic detail (IDOR-guarded) |
| `GET /api/students/:studentId/finance` | `admin`, `student` (self) | Student invoices & payments (`403` for instructors & other students) |
| `POST /api/courses` | `admin` | Create course with modules totaling 100% weight |
| `POST /api/cohorts` | `admin` | Create batch/cohort with classroom, term, instructor & capacity |
| `POST /api/enrollments` | `admin`, `instructor` | Enroll student with capacity checks & optional invoice (`admin` only) |
| `PATCH /api/enrollments/:id` | `admin`, `instructor` | Transition enrollment status & record `EnrollmentHistory` |
| `PUT /api/progress/module-completion` | `admin`, `instructor` | Toggle completed module ID on active enrollment |
| `PUT /api/grades` | `admin`, `instructor` | Upsert module grade (`0–100`), feedback & student notification |
| `PUT /api/progress/remark` | `admin`, `instructor` | Save instructor evaluation remark |
| `POST /api/sessions` | `admin`, `instructor` | Schedule class session & trigger reminder check |
| `PATCH /api/sessions/:id/status` | `admin`, `instructor` | Mark session `Scheduled` / `Completed` / `Cancelled` |
| `POST /api/attendance` | `admin`, `instructor` | Mark attendance (`Present` / `Late` / `Absent`) & notify student |

---

## 4. Operations, Finance, Documents & Certificates (`server/routes/admin-ops.routes.ts`)

| Method & Path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/certificates/verify/:code` | Public | Verify certificate authenticity by code or SHA-256 hash |
| `GET /api/audit-logs` | `admin` | Paginated audit trail (`action`, `entityType` filters) |
| `GET /api/payments` | `admin`, `student` (self) | Paginated payment receipts |
| `GET /api/notifications` | `requireAuth` | Paginated user notifications |
| `POST /api/users` / `PATCH /api/users/:id` | `admin` | User provisioning & status/role management (revokes sessions on disable/role change) |
| `POST /api/invoices` | `admin` | Issue tuition invoice (`toCents` exact math) |
| `PATCH /api/invoices/:id/void` | `admin` | Void unpaid invoice |
| `POST /api/invoices/:id/payments` | `admin` | Record full/partial payment & generate receipt (`RCPT-*`) |
| `POST /api/certificates` | `admin`, `instructor` | Issue verified certificate if eligible |
| `POST /api/certificates/:id/revoke` | `admin` | Revoke issued certificate with reason |
| `GET /api/certificates/:id/download` | `requireAuth` | Owner/staff certificate download |
| `POST /api/notifications/run-reminders` | `admin`, `instructor` | Trigger idempotent 24h upcoming session reminder sweep |
| `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` | `requireAuth` | Mark own notifications read |
| `POST /api/documents`, `GET /api/documents/:id/download`, `PATCH /api/documents/:id/archive` | `requireAuth` | Role-scoped private document upload, download (`nosniff`), and archive |

---

## 5. Admin Master Data & Lifecycle (`server/routes/admin-master.routes.ts`)

| Method & Path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/admin/analytics` | `admin` | Date-windowed revenue, enrollment, attendance & admission analytics |
| `GET/POST/GET detail/PATCH /api/students*` | `admin` | Student directory, creation, profile detail, update/archival |
| `GET/POST/GET detail/PATCH /api/instructors*` | `admin` | Instructor directory, creation, profile detail, update |
| `PUT /api/instructors/:id/assignments`, `/permissions` | `admin` | Manage instructor course/batch assignments & capability flags |
| `GET/POST/PATCH /api/departments*`, `/classrooms*` | `admin` (GET `staff`) | Academy departments & classrooms master data |
| `PATCH /api/courses/:courseId`, `/cohorts/:cohortId` | `admin` | Update or archive courses & batches |
| `POST /api/cohorts/:id/assign-student` | `admin` | Direct student batch allocation |
| `POST /api/enrollments/:id/transfer`, `/course-transfer` | `admin` | Batch transfer & course transfer with optional invoice void/re-issue |
| `GET /api/enrollments/:id/history` | `admin`, `instructor` | Enrollment audit trail *(Phase C fixes `{ enrollment, history }` response wrapper)* |
| `GET/PUT /api/settings`, `POST/PATCH /api/academic-years*`, `/academic-terms*` | `admin` | Academy configuration, timezone/currency/prefix, years & terms |
