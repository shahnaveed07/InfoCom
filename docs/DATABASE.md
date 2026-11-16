# InfoCom AMS — PostgreSQL & Prisma Database Guide

PostgreSQL (Cloud SQL `asia-southeast1` or standard PostgreSQL) accessed solely via **Prisma ORM** (`prisma/schema.prisma`, `@prisma/adapter-pg`, `pg.Pool`) is the single source of truth for runtime persistence.

*(Detailed operational runbooks for `pg_dump`, `pg_restore`, legacy document migration, and forward migration rollback are maintained in [`docs/DATABASE_OPERATIONS.md`](DATABASE_OPERATIONS.md).)*

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
| **Communication & Jobs** | `Notification`, `NotificationPreference`, `DeliveryLog`, `BackgroundJob` |
| **Documents** | `FileAsset` (`documents`) |
| **Governance** | `AuditLog` |

---

## 2. Applied Migrations (`prisma/migrations/`)

1. `20261114000000_init_ams_schema` — Initial normalized relational schema.
2. `20261114010000_phase3_session_token_hash` — Added `auth_sessions.token_hash` unique index and session revocation metadata.
3. `20261114020000_phase4_admin_master_data` — Added instructor permissions configuration and master data relations.
4. `20261114030000_phase5_admissions_enrollments` — Added extended admissions workflow fields, status history, document verification, batch/fee plan links, and enrollment history snapshots.
5. `20261115000000_igs_remove_firebase_uid_and_inr_defaults` — Removed legacy identity columns and standardized `INR` / `Asia/Kolkata` / IGS defaults.
6. `20261115010000_phase_f_multi_assessments` — Added multi-type assessment support (`Assessment`, `Grade`) and course grading configuration.
7. `20261115020000_public_website_storage_jobs` — Added public course publishing metadata (`slug`, `isPublished`, `showTuitionPublicly`, `isDemo`), object storage metadata (`storageProvider`, `storageKey`, `checksumSha256`), and `BackgroundJob` queue table.

**Rule:** Never edit already-applied migration files. Always create a new forward migration (`npx tsx scripts/prisma-run.ts migrate dev --name <change>`).

---

## 3. Database Connection Resolution (`server/db/config.ts`)

- **Test (`NODE_ENV=test`):** Uses `TEST_DATABASE_URL`, or `TEST_SQL_DB_NAME` with `SQL_HOST` (`max: 5` pool).
- **Cloud SQL (`SQL_HOST` set):** Connects over Unix socket or host using `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` (and `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` inside `scripts/prisma-run.ts` for migrations).
- **Standard URL:** Falls back to `DATABASE_URL`.

---

## 4. Document Storage & Legacy Migration

- New file uploads (`POST /api/documents` and admission documents) persist binary data to the configured private storage adapter (`STORAGE_PROVIDER=local` or `s3`), storing only metadata (`storageProvider`, `storageKey`, `checksumSha256`, `contentBase64 = ''`) in PostgreSQL.
- `npm run db:migrate-documents` (`scripts/migrate-legacy-documents.ts`) safely migrates any legacy PostgreSQL Base64 rows (`storageProvider = 'postgres'`) to private object storage with round-trip SHA-256 checksum verification (`--dry-run` and `--keep-base64` supported).
- `data/centre-db.json` and `data/centre-db.backup.json` are preserved for historical reference and **never read at runtime**.
