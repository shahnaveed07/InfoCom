# InfoCom AMS — System Architecture

## 1. Architectural Pattern

InfoCom AMS uses a **single-repository, modular full-stack TypeScript architecture**:
- **Frontend SPA (`src/`):** React 19 + TypeScript + Tailwind CSS v4 compiled by Vite 8. Communicates with the backend strictly via `fetch(..., { credentials: 'include' })` in `src/utils/api.ts`.
- **Shared Domain Core (`src/shared/`):** Pure deterministic TypeScript shared cleanly between browser and Node.js backend:
  - `src/shared/types.ts`: DTOs and domain models.
  - `src/shared/validation.ts`: Zod v4 schemas enforcing boundaries on both sides.
  - `src/shared/academic.ts`: Weighted grade averages, completion percentages, attendance rates, integer-cents financial math, certificate eligibility, and dashboard analytics.
- **Backend API (`server/`):** Express 4 application (`server/app.ts`) mounted on the unified HTTP server (`server.ts`):
  - `server/middleware/`: Security headers (`helmet`), CORS origin allowlist, CSRF origin guard, fixed-window rate limiters, opaque session auth (`auth.ts`), and sanitized error handling.
  - `server/routes/`: Domain-partitioned Express routers (`auth.routes.ts`, `admissions.routes.ts`, `academics.routes.ts`, `admin-ops.routes.ts`, `admin-master.routes.ts`).
  - `server/security/permissions.ts`: Instructor assignment scope resolution (`Course.instructorId`, `Batch.instructorId`, `InstructorAssignment`) and role permission checks.
  - `server/repositories/ams.repository.ts`: Session lifecycle persistence & paginated queries.
  - `server/ams-service.ts`: Transactional business workflows (`prisma.$transaction`), dashboard aggregation, notifications, and audit logging.
- **Persistence (`prisma/` + `server/db/`):** PostgreSQL accessed solely via `@prisma/client` and `pg.Pool` (`@prisma/adapter-pg`).

---

## 2. Request Lifecycle

```text
Browser (React SPA)
  │  Cookie: HttpOnly SameSite=Lax (igs_session; currently nta_session until Phase B)
  ▼
Express Server (server.ts -> server/app.ts)
  ├── securityHeaders (Helmet, X-Content-Type-Options: nosniff, Referrer-Policy)
  ├── createSafeCorsMiddleware (Explicit origin allowlist)
  ├── express.json (64 KB auth / 5 MB API cap)
  ├── csrfOriginGuard (Blocks cross-site / invalid Origin on mutations)
  └── Routers (/api/*)
        ├── Public: /api/auth/login, /register, /forgot-password, /reset-password,
        │           /api/admissions/public, /api/certificates/verify/:code
        └── Protected: requireAuth -> resolveRequestUser() -> PostgreSQL auth_sessions
              ├── requireRoles(...) + security/permissions.ts
              ├── Zod schema validation (src/shared/validation.ts)
              ├── Prisma transaction (server/ams-service.ts)
              └── AuditLog + Notification / DeliveryLog
```

---

## 3. Target Cleanup (Phase B)
- **Remove Dual ORM:** Eliminate `src/db/*`, `server/migrate.ts`, `drizzle-orm`, and `drizzle-kit`.
- **Remove External Auth:** Eliminate `src/lib/firebase*`, `firebase-applet-config.json`, `/api/auth/firebase`, `Bearer` token check, `firebase`, `firebase-admin`, and `users.firebase_uid`.
- **Production Packaging (Phase J):** Compile `server.ts` into `dist-server/server.js` via `esbuild` and respect `process.env.PORT`.
