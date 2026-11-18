# InfoCom Academy Management System — Security & Authorization Architecture

## 1. Account Roles & Permission Matrix

InfoCom enforces server-side Role-Based Access Control (RBAC) across three explicit roles defined in `server/security/permissions.ts`:

| Capability / Resource | Admin | Instructor | Student |
| :--- | :--- | :--- | :--- |
| Own profile & password (`profile:self`) | Yes | Yes | Yes |
| Manage all users & roles (`users:read`, `users:manage`) | Yes | No | No |
| Admissions review & conversion (`admissions:manage`) | Yes | No | No |
| Create courses & cohort batches (`courses:create`, `cohorts:create`) | Yes | No | No |
| Manage enrollments (`enrollments:read`, `enrollments:manage`) | All courses | Assigned courses/batches only (no tuition invoice creation) | No |
| Manage modules, grades, remarks, sessions, attendance | All courses | Assigned courses/batches only | No |
| View/manage tuition invoices, payments & receipts | All students (`finance:manage`) | **Denied** (403 on all finance endpoints) | Own records only (`finance:read_own`) |
| Documents (`documents:read`, `documents:upload`) | All documents | Course-scoped & enrolled students (no `Receipt` uploads) | Own docs & enrolled course syllabi |
| Certificates (`certificates:issue`, `certificates:revoke`) | Issue & Revoke | Issue for assigned courses only | Download own certificates; public verification by code/hash |
| Audit logs (`audit:read`) | Yes | No | No |

### Privilege Escalation Prevention & Protected Admin Bootstrap
- **Public Registration Disabled (`POST /api/auth/register`)**: Returns `410 Gone`. Public account self-registration is disabled; student, instructor, and admin accounts are created exclusively by authorized academy administrators.
- **Protected Initial-Admin Bootstrap CLI (`npm run admin:bootstrap`)**: Executed via `scripts/bootstrap-admin.ts`. Creates an initial `admin` account with Argon2id hashing and minimum 12-character password enforcement. If an active admin already exists, creation is blocked unless both `--allow-additional` and `ADMIN_BOOTSTRAP_SECRET` are supplied.
- **Authorized Admin Creation**: Existing admins provision student accounts via **Students → Create Student** (`POST /api/students`) and instructor/admin accounts via `POST /api/users` or `POST /api/instructors`, generating single-use onboarding tokens (`/login?setupToken=...`).

## 2. Authentication, Opaque Sessions & Lifecycle Controls

### Opaque Session Architecture
- `server/auth.ts` generates 256-bit cryptographically random session tokens (`crypto.randomBytes(32).toString('base64url')`).
- Only the **SHA-256 hash** (`auth_sessions.token_hash`) is persisted in PostgreSQL; the raw cookie token is never stored in the database.
- `server/middleware/auth.ts` sets `igs_session` cookies with:
  - `HttpOnly: true` (inaccessible to client JavaScript)
  - `SameSite: 'lax'` (or `'none'` with `Secure: true` when `CORS_CROSS_SITE_COOKIES=true` for separated origins over HTTPS)
  - `Path: '/'`
  - `Secure: true` automatically in production or when served over HTTPS (`req.secure` or `x-forwarded-proto: https`)
  - 7-day absolute TTL (`SESSION_TTL_MS`)

### Session Validation, Expiration & Revocation
Every protected request resolves `igs_session` by hashing the cookie value and querying `auth_sessions` in PostgreSQL:
- Rejects expired sessions (`expiresAt <= now`) and marks them expired.
- Rejects revoked sessions (`revokedAt !== null`), including logout (`POST /api/auth/logout`), password change (`POST /api/auth/change-password` revokes sibling sessions), password reset (`POST /api/auth/reset-password` revokes all sessions), role change, and account deactivation/suspension (`PATCH /api/users/:id`).
- Enforces `user.status === 'active'` and verifies `session.roleCode === user.role`.

### Password Lifecycle Endpoints
- `POST /api/auth/change-password`: Authenticated users change passwords after verifying their current password; revokes other active sessions and logs `PASSWORD_CHANGED`.
- `POST /api/auth/forgot-password`: Issues a single-use SHA-256-hashed `PasswordResetToken` (30-minute TTL) for active users while returning a generic `200` message to prevent account enumeration.
- `POST /api/auth/reset-password`: Validates token expiry and single-use `usedAt === null`, stores new Argon2id hash, increments `sessionVersion`, revokes all active sessions, and clears the current session cookie.
- `PATCH /api/users/:id`: Supports `'active'`, `'suspended'`, `'inactive'`, and `'archived'` statuses. Setting any non-active status immediately revokes all active sessions for that user.

## 3. Password Hashing & Legacy Migration

- **Primary Algorithm**: **Argon2id** via the `argon2` package (`type: argon2.argon2id`, `memoryCost: 19456` KiB, `timeCost: 2`, `parallelism: 1`).
- **Backward Compatibility & Transparent Upgrade**: `verifyPassword()` detects legacy salted `scrypt` digests (`<salt>:<128-hex-digest>`), verifies them in constant time via `crypto.timingSafeEqual`, and returns `{ valid: true, needsRehash: true }`.
- Upon successful sign-in (`POST /api/auth/login`), `auth.routes.ts` transparently rehashes the verified password with Argon2id, updates `users.password_hash` and `users.password_updated_at`, and records a `PASSWORD_HASH_UPGRADED` audit event.

## 4. Security Middleware Stack

Implemented in `server/app.ts` and `server/middleware/security.ts`:
- **Security Headers (`helmet`)**: Sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Permissions-Policy`, and `Strict-Transport-Security` over HTTPS (omits `X-Frame-Options` so embedded preview iframes function properly).
- **Safe CORS (`createSafeCorsMiddleware`)**: Restricts credentialed browser cross-origin access to an explicit allowlist (`localhost:3000`, `127.0.0.1:3000`, `APP_URL`, and `CORS_ALLOWED_ORIGINS`).
- **CSRF Protection (`csrfOriginGuard`)**: Protects all cookie-authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) by rejecting `Origin: null`, malformed origins, and `Origin`/`Referer` hosts outside the request host/`APP_URL`/`CORS_ALLOWED_ORIGINS`. Rejects `Sec-Fetch-Site: cross-site` unconditionally unless `CORS_CROSS_SITE_COOKIES=true` is explicitly enabled AND an explicit non-null `Origin` matches an origin allowlisted in `APP_URL` or `CORS_ALLOWED_ORIGINS`.
- **Rate Limiting (`createRateLimiter`)**: Applied to `/api/auth/login` (10 req / 15m per IP+email), `/api/auth/register` (10 req / 15m), `/api/auth/forgot-password` (5 req / 15m), `/api/auth/reset-password` (10 req / 15m), `/api/auth/change-password` (10 req / 15m), and `/api/admissions/public` (15 req / 15m). Delegates automatically to distributed Cloudflare Rate Limiting bindings (`AUTH_RATE_LIMITER`, `PUBLIC_RATE_LIMITER`) when active in Worker request context and returns `429` with `Retry-After`.
- **Background Token Redaction**: After transactional onboarding/password-reset email jobs complete (or exhaust retries), `processPendingJobs()` redacts raw token links from `BackgroundJob.payload` (`[REDACTED AFTER DELIVERY]`), and Cloudflare Queue messages carry only `{ jobId, jobType }` references (never raw reset tokens).
- **Input Validation & Size Limits**: Strict Zod schemas (`src/shared/validation.ts`), `64kb` JSON cap on `/api/auth/*`, and `5mb` cap on `/api/*`.
- **Sanitized Error Handling (`safeApiErrorHandler`)**: Maps malformed payloads (`400`) and oversized payloads (`413`) cleanly and suppresses internal database errors and stack traces behind generic JSON error messages.

## 5. Resource Ownership & Anti-IDOR Enforcement

- **Students**:
  - `GET /api/students/:studentId`, `GET /api/students/:studentId/finance`, `GET /api/payments`, `GET /api/certificates/:id/download`, `GET /api/documents/:id/download`, and `GET /api/courses/:courseId` reject access (`403`) whenever a student requests another student's data or an unenrolled course.
  - `POST /api/documents` forces `ownerUserId = req.authUser.id` for students and restricts categories to `ID Verification`, `Assignment`, or `Other`.
- **Instructors**:
  - `getInstructorScope(instructorId)` computes assigned courses, batches, and active enrolled students from `Course.instructorId`, `Batch.instructorId`, and active `InstructorAssignment` records.
  - Dashboard payloads, `/api/enrollments`, `/api/students/:id`, `/api/courses/:id`, `/api/progress/*`, `/api/grades`, `/api/sessions*`, `/api/attendance`, `/api/certificates`, and `/api/documents` all enforce assignment checks (`403` on unassigned courses or students).
  - Instructors are blocked (`403`) from all finance/tuition operations (`/api/payments`, `/api/invoices*`, `/api/students/:id/finance`, `issueTuitionInvoice: true`, and `Receipt` documents).
