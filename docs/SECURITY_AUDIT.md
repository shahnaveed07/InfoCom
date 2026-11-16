# InfoCom AMS — Security Audit & Remediation Status

**Status:** All identified authentication, session, RBAC, storage, and background token hygiene controls are implemented and verified by automated integration tests.

---

## 1. Active Controls Verified in Source Code

- **Password Hashing (`server/auth.ts`):** Argon2id (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`) with constant-time legacy `scrypt` verification and automatic Argon2id rehash on login.
- **Opaque Server Sessions (`server/auth.ts`, `server/repositories/ams.repository.ts`):** 256-bit random tokens (`igs_session`) hashed with SHA-256 into `auth_sessions.token_hash`; invalidated immediately on logout, role change, deactivation, password reset, and sibling revocation on password change.
- **Account Provisioning & Onboarding (`server/routes/auth.routes.ts`, `admin-master.routes.ts`, `admissions.routes.ts`):**
  - `POST /api/auth/register` returns `410 Gone`; no public role self-registration exists.
  - `User.mustChangePassword` blocks portal workspace routes in `App.tsx` until password setup/rotation succeeds.
  - Admin user creation, admission approval, and password resets issue single-use SHA-256 `PasswordResetToken` setup links.
  - `processPendingJobs()` redacts sensitive link/token bodies in `BackgroundJob.payload` once email delivery finishes.
- **No Hardcoded Seed Credentials (`prisma/seed.ts`, `prisma/seed-demo.ts`):** Production seeding creates zero user accounts; development demo seeding requires explicit `NODE_ENV=development` + `ALLOW_DEMO_SEED=true` and uses env-configured or ephemeral generated passwords.
- **Private Document Storage (`server/storage/`):** Uploaded files are stored outside PostgreSQL in private storage with extension/MIME allowlisting and `X-Content-Type-Options: nosniff` downloads guarded by RBAC (`403` for unauthorized students/instructors).
- **RBAC & Anti-IDOR (`server/security/permissions.ts`, `server/routes/*.ts`):** Strict admin-only routes (`/users`, `/admissions`, `/finance`, `/settings`, `/audit-logs`, `/admin/email-delivery`), instructor assignment scoping (`getInstructorScope`), and self-only student scoping.
- **HTTP & Input Hardening (`server/middleware/security.ts`, `server/app.ts`):** Helmet security headers, explicit CORS allowlist, `csrfOriginGuard`, per-endpoint fixed-window rate limiters, Zod v4 validation, `64kb`/`5mb` JSON limits, and sanitized `safeApiErrorHandler`.
