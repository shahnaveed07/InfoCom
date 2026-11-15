# InfoCom AMS — PostgreSQL & Prisma Database Guide

PostgreSQL (Cloud SQL `asia-southeast1` or standard PostgreSQL) accessed solely via **Prisma ORM** (`prisma/schema.prisma`, `@prisma/adapter-pg`, `pg.Pool`) is the single source of truth for runtime persistence.

*(Detailed operational runbooks for `pg_dump`, `pg_restore`, and forward migration rollback are also maintained in [`docs/DATABASE_OPERATIONS.md`](DATABASE_OPERATIONS.md).)*

---

## 1. Schema Domain Map (`prisma/schema.prisma`)

| Domain | Models |
| --- | --- |
| **Identity & Access** | `User`, `Role`, `UserRole`, `AuthSession`, `PasswordResetToken` |
| **Academy & Facilities** | `Academy`, `AcademySetting`, `Department`, `AcademicYear`, `AcademicTerm`, `Classroom` |
| **People Profiles** | `StudentProfile`, `InstructorProfile`, `Guardian` |
| **Academics** | `Course`, `CourseModule`, `Batch` (`cohorts`), `InstructorAssignment`, `Enrollment`, `EnrollmentHistory`, `ClassSession`, `Attendance`, `Assessment`, `Grade`, `ProgressRemark` |
| **Admissions** | `AdmissionApplication`, `AdmissionStatusHistory`, `AdmissionDocument` |
| **Finance** | `FeePlan`, `FeeStructure`, `Invoice` (`fee_invoices`), `InvoiceItem`, `Payment`, `PaymentAllocation`, `Refund`, `Discount`, `Scholarship` |
| **Certificates** | `CertificateTemplate`, `Certificate` |
| **Communication** | `Notification`, `NotificationPreference`, `DeliveryLog` |
| **Documents** | `FileAsset` (`documents`) |
| **Governance** | `AuditLog` |

---

## 2. Applied Migrations (`prisma/migrations/`)

1. `20261114000000_init_ams_schema` — Initial normalized 35-table relational schema.
2. `20261114010000_phase3_session_token_hash` — Added `auth_sessions.token_hash` unique index and session revocation metadata.
3. `20261114020000_phase4_admin_master_data` — Added instructor permissions configuration, master data relations.
4. `20261114030000_phase5_admissions_enrollments` — Added extended admissions workflow fields, status history, document verification, batch/fee plan links, and enrollment history snapshots.

**Rule:** Never edit already-applied migration files. Schema updates (such as removing `users.firebase_uid` in Phase B or adding background jobs in Phase I) always use a new forward migration (`npx tsx scripts/prisma-run.ts migrate dev --name <change>`).

---

## 3. Database Connection Resolution (`server/db/config.ts`)

- **Test (`NODE_ENV=test`):** Uses `TEST_DATABASE_URL`, or `TEST_SQL_DB_NAME` with `SQL_HOST` (`max: 5` pool).
- **Cloud SQL (`SQL_HOST` set):** Connects over Unix socket or host using `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` (and `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` inside `scripts/prisma-run.ts` for migrations).
- **Standard URL:** Falls back to `DATABASE_URL`.

---

## 4. Legacy Data Preservation & Migration Cleanup

- `data/centre-db.json` and `data/centre-db.backup.json` are preserved verbatim and **never read at runtime**.
- `scripts/migrate-json.ts` (`npm run db:migrate-json`) performs idempotent, transactional import via Prisma into PostgreSQL while reconciling relational profiles, assessments, and invoice line items.
- Legacy Drizzle files (`src/db/*` and `server/migrate.ts`) are unused and scheduled for removal in Phase B.
