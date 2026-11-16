# InfoCom Global Services — Academy Management System (IGS AMS)

Single-repository full-stack Academy Management System built for **IGS — InfoCom Global Services (Computer Institute)**.

- **Location:** Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.
- **Official Slogan:** "Learn Today, Build Tomorrow."
- **Repository:** `https://github.com/shahnaveed07/InfoCom.git`

---

## Technology Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide icons
- **Backend:** Node.js, Express 4, TypeScript (`tsx` in development)
- **Database:** PostgreSQL (Cloud SQL `asia-southeast1` / standard PostgreSQL) via **Prisma ORM** (`@prisma/client`, `@prisma/adapter-pg`, `pg`)
- **Authentication:** First-party email/password authentication (`Argon2id` + transparent `scrypt` verification upgrade) with SHA-256 hashed server-side sessions (`AuthSession` table)
- **Validation:** Shared Zod v4 request/response contracts (`src/shared/validation.ts`) and deterministic calculation helpers (`src/shared/academic.ts`)

---

## Key Features

- **Public Institute Website (`/`, `/courses`, `/about`, `/admissions`, `/contact`, `/verify-certificate`):** Public website for **IGS — InfoCom Global Services**, serving live published courses, cohort schedules, online admissions applications, public certificate verification, and portal sign-in (`/login`), with API-first demo catalog fallback (`VITE_PUBLIC_DATA_MODE=auto`) when the backend is unavailable.
- **Admin-Controlled Student & Staff Onboarding (`/portal`):** Public self-registration is disabled (`410 Gone`). Admins create students, instructors, and admin accounts and issue single-use onboarding/password-reset links (`/login?setupToken=...` / `/login?resetToken=...`).
- **Role-Based Workspaces (`admin`, `instructor`, `student`):** Server-enforced RBAC with instructor assignment scoping and strict student record isolation.
- **Academy Administration & Analytics:** Academy branding/settings, departments, academic years, terms, classrooms, live KPI analytics, and audit logs.
- **Admissions Workflow:** Draft/Submitted/Review/Documents Required/Approved/Rejected/Withdrawn lifecycle, private document verification, and transactional conversion into student + enrollment + fee plan invoice.
- **Academic Operations & Official Certificates:** Course catalog & public publishing toggles (`slug`, `isPublished`, `showTuitionPublicly`), module weights, cohorts, enrollments & transfers, schedules, attendance marking, module grading, progress remarks, SHA-256 + QR-verified PDF certificates (`pdfkit` + `qrcode`), and role-scoped CSV/PDF reports.
- **Finance, Storage, Mailer & Jobs:** Tuition fee plans, invoices, partial/full payments, receipts, local or S3-compatible private object storage (`STORAGE_PROVIDER`), optional SMTP email delivery (`SMTP_*`), notification channel preferences, and PostgreSQL `BackgroundJob` processing.

---

## Documentation Index

| Document | Purpose |
| --- | --- |
| [`docs/REPOSITORY_AUDIT.md`](docs/REPOSITORY_AUDIT.md) | Authoritative file-by-file inventory, active vs. legacy components, and transition gaps |
| [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md) | Live status matrix (Working / Partial / Broken / Schema Only / Not Implemented) |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phased execution roadmap |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System layers, frontend/backend structure, storage, jobs, and request flow |
| [`docs/DATABASE.md`](docs/DATABASE.md) | PostgreSQL + Prisma schema, migrations, seeding, backup/restore, and rollback |
| [`docs/SECURITY.md`](docs/SECURITY.md) | RBAC permissions matrix, Argon2id, opaque sessions, CSRF/CORS, and anti-IDOR rules |
| [`docs/API.md`](docs/API.md) | REST API endpoint catalog under `/api/*` |
| [`docs/TESTING.md`](docs/TESTING.md) | Unit, integration, typecheck, Playwright E2E, and build verification suite |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Environment setup, build, database migrations, and runtime notes |
| [`docs/404_ROOT_CAUSE.md`](docs/404_ROOT_CAUSE.md) | Root-cause analysis for SPA routing, `/api/*` 404s, health endpoints, and bundled asset fixes |
| [`docs/PUBLIC_DEMO_FALLBACK.md`](docs/PUBLIC_DEMO_FALLBACK.md) | API-first public demo fallback modes, error classification, recovery, and portal boundaries |

---

## Quick Start (Development & Production)

```bash
# 1. Install dependencies reproducibly from package-lock.json
npm ci

# 2. Generate Prisma Client and apply PostgreSQL migrations
npm run db:generate
npm run db:migrate:deploy

# 3. Seed mandatory roles & base academy settings (production-safe)
npm run db:seed

# Optional (dev-only): load demo catalog/users (requires NODE_ENV=development & ALLOW_DEMO_SEED=true)
# Uses SEED_ADMIN_PASSWORD / SEED_INSTRUCTOR_PASSWORD / SEED_STUDENT_PASSWORD or generates ephemeral secrets
ALLOW_DEMO_SEED=true npm run db:seed:demo

# 4. Run full-stack dev server (port 3000)
npm run dev

# 5. Operational utilities (legacy storage migration & SMTP check)
npm run db:migrate-documents -- --dry-run
npm run email:verify

# 6. TypeScript check, production builds (dist/ + dist-server/server.js), unit/integration tests, and Playwright E2E
npm run lint
npm run build
npm run build:server
npm test
npm run test:e2e

# 7. Run compiled production server
NODE_ENV=production npm start
```

> **Official Brand Logo:** Stored at `public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg` and rendered across the public website, portal navigation, login view, invoices, printable certificates, and generated PDF credentials. Administrators can optionally upload an override in **Admin → Academy Settings**.

