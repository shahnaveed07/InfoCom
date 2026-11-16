# InfoCom AMS — Repository Audit (Authoritative Live State)

**Repository:** `https://github.com/shahnaveed07/InfoCom.git`  
**Audit Scope:** Authoritative full-stack inventory of live `server/`, `src/`, `prisma/`, and `scripts/` modules.

---

## 1. Architecture Summary

1. **Single Database Stack (PostgreSQL + Prisma ORM):**
   - All live API routes (`server/routes/*.ts`), `server/ams-service.ts`, `server/repositories/ams.repository.ts`, `server/middleware/auth.ts`, `prisma/seed.ts`, `prisma/seed-demo.ts`, `scripts/bootstrap-admin.ts`, and `scripts/migrate-legacy-documents.ts` execute exclusively against **Prisma ORM** (`@prisma/client` + `@prisma/adapter-pg` + `pg.Pool`) across **36 PostgreSQL models** in `prisma/schema.prisma` (7 applied migrations in `prisma/migrations/`).
2. **First-Party Authentication & Admin-Controlled Onboarding:**
   - Cookie-based opaque sessions (`igs_session`, SHA-256 stored in `auth_sessions`) and `Argon2id` password hashing (+ transparent `scrypt` upgrade) are the sole auth layer.
   - Public self-registration (`POST /api/auth/register`) returns `410 Gone`; students and instructors are provisioned by Academy Administration with single-use setup tokens.
3. **Official IGS Branding & Currency:**
   - Official brand logo at `public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg`, Sopore campus identity, slogan `"Learn Today, Build Tomorrow."`, `INR` (`₹` / `en-IN`), and `Asia/Kolkata` timezone are applied consistently across public pages, portals, receipts, and generated PDF certificates.
4. **Private Object Storage, Persistent Job Queue & npm CI:**
   - `server/storage/` manages private file uploads (`local` / `s3`) and `server/storage/migrate-legacy.ts` handles legacy Base64 migration.
   - `server/jobs/worker.ts` + `server/email/mailer.ts` queue and deliver transactional emails with retry backoff and token payload redaction.
   - Dependencies are standardized on `npm` via `package-lock.json`.

---

## 2. Authoritative File Inventory

### Root & Configuration
| Path | Status | Purpose |
| --- | --- | --- |
| `package.json`, `package-lock.json` | Active | Locked npm scripts (`dev`, `start`, `build`, `build:server`, `lint`, `test`, `admin:bootstrap`, `db:*`, `email:verify`) |
| `.github/workflows/ci.yml` | Active | CI pipeline (`npm ci`, Prisma generate/deploy/seed, `lint`, `test`, `build`, `build:server`) |
| `server.ts` | Active | Unified HTTP/Express mount (`PORT` env), Vite dev middleware / `dist/` static serving, background worker startup |
| `tsconfig.json`, `vite.config.ts` | Active | TypeScript checking & Vite 8 + React 19 + Tailwind CSS v4 build configuration |
| `index.html`, `metadata.json` | Active | SPA HTML shell, favicon, and metadata synced to `IGS — InfoCom Global Services` |

### Backend (`/server/`, `/prisma/`, `/scripts/`)
| Path | Status | Responsibility |
| --- | --- | --- |
| `prisma/schema.prisma` | Active | 36-model normalized PostgreSQL schema including `BackgroundJob`, `AdmissionStatusHistory`, `FeePlan`, `Refund`, `CertificateTemplate` |
| `prisma/migrations/` | Active | 7 applied forward migrations |
| `prisma/seed.ts` | Active | Production-safe structural seed (roles, IGS academy record, settings, `ADMIN` department, certificate template) |
| `prisma/seed-demo.ts` | Dev-Only | Guarded demo catalog & sample accounts (`NODE_ENV=development` + `ALLOW_DEMO_SEED=true`, zero hardcoded passwords) |
| `server/app.ts` | Active | Express router wiring + Helmet, CORS allowlist, CSRF origin guard, safe API error handler |
| `server/auth.ts` | Active | Argon2id + scrypt hashing, 256-bit opaque session token + SHA-256 hashing, reset token helpers |
| `server/ams-service.ts` | Active | Transactional business workflows, dashboard aggregation, analytics, finance adjustments, certificates, notifications |
| `server/db/config.ts`, `server/db/prisma.ts` | Active | PostgreSQL connection URL/Unix socket builder & singleton Prisma Client |
| `server/middleware/auth.ts`, `security.ts` | Active | Session cookie resolution, rate limiters, CORS, CSRF origin guard, Helmet headers, error sanitizer |
| `server/security/permissions.ts` | Active | Instructor assignment scope calculation and RBAC permission checks |
| `server/repositories/ams.repository.ts` | Active | DB-backed session revocation/rotation and paginated queries |
| `server/storage/` (`index.ts`, `local.ts`, `s3.ts`, `migrate-legacy.ts`) | Active | Pluggable private object storage + checksum-verified legacy Base64 migration |
| `server/email/mailer.ts`, `server/jobs/worker.ts` | Active | Optional SMTP adapter (`verifySmtpConnection`, `sendTransactionalEmail`) and persistent `BackgroundJob` queue |
| `server/routes/*.routes.ts` | Active | `public`, `auth`, `admissions`, `academics`, `admin-ops`, `admin-master`, `reports` routers |
| `scripts/` | Active | `bootstrap-admin.ts`, `migrate-json.ts`, `migrate-legacy-documents.ts`, `verify-email.ts`, `prisma-run.ts` |

### Frontend & Shared (`/src/`, `/public/`)
| Path | Status | Responsibility |
| --- | --- | --- |
| `public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg` | Active | Official `IGS — InfoCom Global Services` brand logo |
| `src/shared/types.ts`, `validation.ts`, `academic.ts` | Active | Shared TypeScript DTOs, Zod v4 schemas, and deterministic calculations |
| `src/utils/api.ts` | Active | Typed `fetch` client (`credentials: 'include'`) |
| `src/components/public/*` | Active | Public institute website pages & `BrandCrest` |
| `src/components/*.tsx` | Active | Role-based AMS portals and management modules |
