# InfoCom AMS — Repository Audit (Authoritative Current State)

**Repository:** `https://github.com/shahnaveed07/InfoCom.git`  
**Audit Scope:** Full-stack inspection of actual source code prior to Phase B–J execution.

---

## 1. Reality vs. Legacy Documentation Findings

Inspection of actual runtime source files established that earlier Phase 1 documentation had become outdated:

1. **Active ORM is Prisma, Not Drizzle:**
   - All live API routes (`server/routes/*.ts`), `server/ams-service.ts`, `server/repositories/ams.repository.ts`, `server/middleware/auth.ts`, `prisma/seed.ts`, and `scripts/bootstrap-admin.ts` execute exclusively against **Prisma ORM** (`@prisma/client` + `@prisma/adapter-pg` + `pg.Pool`) across **35+ PostgreSQL models** in `prisma/schema.prisma` (4 applied migrations in `prisma/migrations/`).
   - Drizzle ORM (`src/db/index.ts`, `src/db/schema.ts`, `src/db/drizzle.config.ts`) and `server/migrate.ts` are unreferenced dead legacy code left over from Phase 1 and slated for complete removal in **Phase B**.
2. **Firebase Remains Wired and Must Be Removed in Phase B:**
   - Client SSO (`src/lib/firebase.ts`, `src/components/AuthView.tsx` Google button, `src/utils/api.ts` `loginWithFirebase`) and server token exchange (`src/lib/firebase-admin.ts`, `POST /api/auth/firebase`, Bearer header resolution in `server/middleware/auth.ts`, `syncFirebaseUser` in `server/ams-service.ts`, `User.firebaseUid` in `prisma/schema.prisma`, `firebase-applet-config.json`) remain present and are scheduled for clean removal in **Phase B**.
3. **Brand Identity & Localization Transition Pending (Phase B):**
   - Several files (`metadata.json`, `index.html`, `src/components/AuthView.tsx`, `ProgressReportView.tsx`, `CertificatesView.tsx`, `server/auth.ts`, `prisma/seed.ts`, and shared formatters) still contain `Northbridge Tech Academy`, `nta_session`, `USD` / `en-US` formatting, and quick-fill demo credential buttons.
   - **Missing Official Logo Asset:** No official `IGS — InfoCom Global Services` logo image is currently present in `src/assets/` (`src/assets/images/academy_lab_studio_1794576422024.jpg` is the only image asset). No unofficial logo will be generated or substituted.
4. **Known Contract Bug Detected in Live Code:**
   - `GET /api/enrollments/:enrollmentId/history` (`server/routes/admin-master.routes.ts:1578`) returns flat enrollment fields alongside `history[]`, whereas `src/utils/api.ts:513` and `src/components/EnrollmentsView.tsx` read `res.enrollment.studentName`, throwing a runtime `TypeError` when viewing enrollment history.
5. **Runtime & Production Packaging Gaps:**
   - `server.ts` hardcodes `const PORT = 3000;` instead of reading `process.env.PORT`.
   - `package.json` `"start": "node server.ts"` executes raw TypeScript without a compiled JavaScript server build (`Phase J`).
   - Background reminder sweeps run via in-process `setInterval` in `server.ts` + dashboard load hook rather than a database-backed job queue (`Phase I`).

---

## 2. Authoritative File Inventory

### Root & Configuration
| Path | Status | Purpose |
| --- | --- | --- |
| `package.json` | Active | Scripts (`dev`, `build`, `lint`, `test`, `admin:bootstrap`, `db:*`) & dependencies |
| `server.ts` | Active | Express app mount, Vite dev middleware / `dist/` static serving, 5m reminder interval |
| `tsconfig.json` | Active | TypeScript compiler config (`noEmit: true`) |
| `vite.config.ts` | Active | Vite + React + Tailwind CSS v4 build config |
| `index.html` | Active (Needs Phase B rebrand) | SPA HTML shell & meta tags |
| `metadata.json` | Active (Needs Phase B rebrand) | AI Studio app metadata |
| `firebase-applet-config.json` | Legacy (Remove Phase B) | Unused/legacy Firebase project config |

### Backend (`/server/`, `/prisma/`, `/scripts/`)
| Path | Status | Responsibility |
| --- | --- | --- |
| `prisma/schema.prisma` | Active | 35-model normalized PostgreSQL schema (Identity, Academy, People, Academics, Admissions, Finance, Certificates, Communication, Documents, Governance) |
| `prisma/migrations/` | Active | 4 applied forward migrations (`init_ams_schema`, `phase3_session_token_hash`, `phase4_admin_master_data`, `phase5_admissions_enrollments`) |
| `prisma/seed.ts` | Active | Idempotent database seeder (`NODE_ENV=production` safe metadata-only mode) |
| `server/app.ts` | Active | Express router wiring + `helmet`, CORS allowlist, CSRF origin guard, safe API error handler |
| `server/auth.ts` | Active | Argon2id + scrypt password hashing, 256-bit opaque session token + SHA-256 token hashing, reset token helpers |
| `server/ams-service.ts` | Active | Domain transactions, dashboard payload builder, analytics, admissions conversion, finance, certificates, notifications |
| `server/db/config.ts` | Active | PostgreSQL connection URL/Unix socket builder for Cloud SQL & `NODE_ENV=test` isolation |
| `server/db/prisma.ts` | Active | Singleton `PrismaClient` with `@prisma/adapter-pg` and graceful disconnect |
| `server/middleware/auth.ts` | Active | Session cookie resolution against `auth_sessions` (+ legacy Firebase Bearer removal target) |
| `server/middleware/security.ts` | Active | Rate limiter, CORS middleware, CSRF origin guard, Helmet CSP/headers, error sanitizer |
| `server/security/permissions.ts` | Active | Instructor course/batch assignment scope calculation and permission checks |
| `server/repositories/ams.repository.ts` | Active | DB-backed session revocation/rotation, paginated audit/payments/notifications/enrollments queries |
| `server/routes/auth.routes.ts` | Active | Auth lifecycle, password change/forgot/reset, `/api/dashboard` |
| `server/routes/admissions.routes.ts` | Active | Public & admin admissions applications, draft/status history, document verification, approval & portal activation |
| `server/routes/academics.routes.ts` | Active | Courses, cohorts, enrollments, module completion, grades, remarks, sessions, attendance |
| `server/routes/admin-ops.routes.ts` | Active | Certificates, public cert verify, users, invoices, payments, documents, notifications, audit logs |
| `server/routes/admin-master.routes.ts` | Active | Analytics, students/instructors master data, departments, classrooms, settings, academic years/terms, transfers, history |
| `scripts/bootstrap-admin.ts` | Active | Protected CLI to bootstrap initial or authorized additional admin account |
| `scripts/migrate-json.ts` | Active | Transactional idempotent migrator from `data/centre-db.json` into PostgreSQL via Prisma |
| `scripts/prisma-run.ts` | Active | Prisma CLI wrapper injecting resolved `SQL_ADMIN_USER` / `TEST_DATABASE_URL` |
| `server/migrate.ts` | Legacy Dead Code (Remove Phase B) | Superseded Phase 1 Drizzle migrator |

### Frontend & Shared (`/src/`)
| Path | Status | Responsibility |
| --- | --- | --- |
| `src/shared/types.ts` | Active | Full-stack TypeScript domain contracts |
| `src/shared/validation.ts` | Active | Zod v4 schemas for all API endpoints |
| `src/shared/academic.ts` | Active | Deterministic weighted GPA, letter grade, completion, attendance, integer-cents money, eligibility, and analytics calculations |
| `src/utils/api.ts` | Active | Typed `fetch` client (`credentials: 'include'`) |
| `src/lib/firebase.ts`, `src/lib/firebase-admin.ts` | Legacy (Remove Phase B) | Firebase Web & Admin SDK wrappers |
| `src/db/index.ts`, `src/db/schema.ts`, `src/db/drizzle.config.ts` | Legacy (Remove Phase B) | Superseded Drizzle ORM files |
| `src/components/*.tsx` (23 components) | Active | Role-based AMS portals and management modules |
| `data/centre-db.json`, `data/centre-db.backup.json` | Preserved Legacy Data | Historical JSON records (untouched at runtime) |
