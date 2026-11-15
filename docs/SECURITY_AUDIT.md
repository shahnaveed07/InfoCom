# InfoCom AMS — Security Audit & Remediation Status

**Baseline:** Phases 1–5 have replaced Phase 1 HMAC cookies with PostgreSQL SHA-256 `AuthSession` records, upgraded password hashing to Argon2id (+ transparent scrypt migration), enforced server-side RBAC in `server/security/permissions.ts`, and closed earlier IDOR/CSRF gaps.

---

## 1. Active Controls Verified in Source Code

- **Password Hashing (`server/auth.ts`):** Argon2id (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`) with constant-time legacy `scrypt` verification and automatic Argon2id rehash on login.
- **Opaque Server Sessions (`server/auth.ts`, `server/repositories/ams.repository.ts`):** 256-bit random tokens hashed with SHA-256 into `auth_sessions.token_hash`; invalidated immediately on logout, role change, deactivation, password reset, and sibling revocation on password change.
- **RBAC & Anti-IDOR (`server/security/permissions.ts`, `server/routes/*.ts`):** Strict admin-only routes (`/users`, `/admissions`, `/finance`, `/settings`, `/audit-logs`), instructor assignment scoping (`getInstructorScope`), and self-only student scoping.
- **HTTP & Input Hardening (`server/middleware/security.ts`, `server/app.ts`):** Helmet security headers, explicit CORS allowlist, `csrfOriginGuard`, per-endpoint fixed-window rate limiters, Zod v4 validation, `64kb`/`5mb` JSON limits, `X-Content-Type-Options: nosniff` on downloads, and sanitized `safeApiErrorHandler`.

---

## 2. Active Security Action Items (Phases B–J)

| ID | Severity | Finding | Remediation Phase |
| --- | --- | --- | --- |
| **SEC-B1** | High | Legacy Firebase SSO & Bearer ID token handler still mounted (`POST /api/auth/firebase`, `src/lib/firebase*`) and demo credential quick-fill buttons exposed in `AuthView.tsx`. | **Phase B** (complete Firebase & demo credential removal) |
| **SEC-B2** | Low | Session cookie currently named `nta_session`. | **Phase B** (rename to `igs_session` and expire legacy `nta_session`) |
| **SEC-C1** | High | `mustChangePassword` flag is not enforced on authenticated UI/API access, and admin-created / approved accounts still rely on manually entered or static fallback passwords rather than one-time setup tokens. | **Phase C** |
| **SEC-H1** | Medium | Uploaded documents reside as Base64 strings in `documents.content_base64` instead of private filesystem/object storage with MIME allowlisting. | **Phase H** |
