# InfoCom AMS — System Architecture

## 1. Architectural Pattern

InfoCom AMS uses a **single-repository, modular full-stack TypeScript architecture**:
- **Frontend SPA (`src/`):** React 19 + React Router + TypeScript + Tailwind CSS v4 compiled by Vite 8.
  - **Public Website Routes (`src/components/public/`):** `/`, `/courses`, `/courses/:slug`, `/about`, `/admissions`, `/contact`, `/verify-certificate`.
  - **Portal Routes (`/login`, `/portal/*`):** Admin, Instructor, and Student AMS workspaces communicating via `fetch(..., { credentials: 'include' })` in `src/utils/api.ts`.
- **Shared Domain Core (`src/shared/`):** Pure deterministic TypeScript shared cleanly between browser and Node.js backend:
  - `src/shared/types.ts`: DTOs and domain models.
  - `src/shared/validation.ts`: Zod v4 schemas enforcing boundaries on both sides.
  - `src/shared/academic.ts`: Weighted grade averages, completion percentages, attendance rates, integer-cents financial math, certificate eligibility, and dashboard analytics.
- **Backend API (`server/`):** Express 4 application (`server/app.ts`) mounted on the unified HTTP server (`server.ts`, compiled to `dist-server/server.js`):
  - `server/middleware/`: Security headers (`helmet`), CORS origin allowlist, CSRF origin guard, fixed-window rate limiters, opaque session auth (`auth.ts`), and sanitized error handling.
  - `server/routes/`: Domain-partitioned Express routers (`public.routes.ts`, `auth.routes.ts`, `admissions.routes.ts`, `academics.routes.ts`, `admin-ops.routes.ts`, `admin-master.routes.ts`, `reports.routes.ts`).
  - `server/storage/`: Pluggable private file storage (`local.ts` under `STORAGE_LOCAL_DIR` and AWS S3-compatible `s3.ts`, plus legacy DB base64 fallback).
  - `server/email/mailer.ts` & `server/jobs/worker.ts`: Optional SMTP delivery (`nodemailer`) and PostgreSQL `BackgroundJob` queue for email notifications and reminder sweeps.
  - `server/security/permissions.ts`: Instructor assignment scope resolution (`Course.instructorId`, `Batch.instructorId`, `InstructorAssignment`) and role permission checks.
  - `server/repositories/ams.repository.ts`: Session lifecycle persistence & paginated queries.
  - `server/ams-service.ts`: Transactional business workflows (`prisma.$transaction`), dashboard aggregation, notifications, PDF certificate generation (`pdfkit` + `qrcode`), and audit logging.
- **Persistence (`prisma/` + `server/db/`):** PostgreSQL accessed solely via `@prisma/client` and `pg.Pool` (`@prisma/adapter-pg`).

---

## 2. Request Lifecycle

```text
Browser (React SPA — Public Website & Portal)
  │  Cookie: HttpOnly SameSite=Lax (igs_session)
  ▼
Express Server (server.ts -> dist-server/server.js -> server/app.ts)
  ├── securityHeaders (Helmet, X-Content-Type-Options: nosniff, Referrer-Policy)
  ├── createSafeCorsMiddleware (Explicit origin allowlist)
  ├── express.json (64 KB auth / 5 MB API cap)
  ├── csrfOriginGuard (Blocks cross-site / invalid Origin on mutations)
  └── Routers (/api/*)
        ├── Public: /api/public/*, /api/auth/login, /forgot-password, /reset-password,
        │           /api/admissions/public, /api/certificates/verify/:code (POST /register -> 410)
        └── Protected: requireAuth -> resolveRequestUser() -> PostgreSQL auth_sessions
              ├── requireRoles(...) + security/permissions.ts
              ├── Zod schema validation (src/shared/validation.ts)
              ├── Prisma transaction (server/ams-service.ts)
              ├── Storage provider (local/s3) & BackgroundJob queue
              └── AuditLog + Notification / DeliveryLog
```

