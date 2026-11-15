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

- **Role-Based Workspaces (`admin`, `instructor`, `student`):** Server-enforced RBAC with instructor assignment scoping and student record isolation.
- **Academy Administration & Analytics:** Academy metadata/settings, departments, academic years, terms, classrooms, live KPI analytics, and audit logs.
- **Admissions Workflow:** Draft/Submitted/Review/Documents Required/Approved/Rejected/Withdrawn lifecycle, document verification, and transactional conversion into student + enrollment + fee plan invoice.
- **Academic Operations:** Course catalog & module weights, batches/cohorts, enrollments & transfers with enrollment history, schedules, attendance marking, module grading, progress remarks, and SHA-256 verified completion certificates.
- **Finance & Documents:** Tuition fee plans, structures, invoices, partial/full payments, receipts, notifications, and private document vault.

---

## Documentation Index

| Document | Purpose |
| --- | --- |
| [`docs/REPOSITORY_AUDIT.md`](docs/REPOSITORY_AUDIT.md) | Authoritative file-by-file inventory, active vs. legacy components, and transition gaps |
| [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md) | Live status matrix (Working / Partial / Broken / Schema Only / Not Implemented) |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phased execution roadmap (Phases A–J) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System layers, frontend/backend structure, and request flow |
| [`docs/DATABASE.md`](docs/DATABASE.md) | PostgreSQL + Prisma schema, migrations, seeding, backup/restore, and rollback |
| [`docs/SECURITY.md`](docs/SECURITY.md) | RBAC permissions matrix, Argon2id, opaque sessions, CSRF/CORS, and anti-IDOR rules |
| [`docs/API.md`](docs/API.md) | REST API endpoint catalog under `/api/*` |
| [`docs/TESTING.md`](docs/TESTING.md) | Unit, integration, typecheck, and build verification suite |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Environment setup, build, database migrations, and runtime notes |

---

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client and apply PostgreSQL migrations
npm run db:generate
npm run db:migrate:deploy

# 3. Seed base catalog & development data
npm run db:seed

# 4. Run full-stack dev server (port 3000)
npm run dev

# 5. Run TypeScript check, build, and test suite
npm run lint
npm run build
npm test
```

> **Note on Official Logo Asset:** Pending upload of the official `IGS — InfoCom Global Services` raster logo image into `src/assets/brand/igs-infocom-global-services.png`. Do not generate or substitute an unofficial logo.
