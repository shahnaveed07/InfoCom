# InfoCom AMS — PostgreSQL & Prisma Operations Guide (Phase 2)

This guide documents database initialization, Prisma migrations, seeding, test environment isolation, JSON migration, backup/restore, and rollback procedures for InfoCom AMS.

---

## 1. Environment Configuration (Development, Test, Production)

Database connection resolution lives in `server/db/config.ts` and `server/db/prisma.ts`:

- **Cloud SQL Runtime (`development` / `production`):**
  - Application pool connects via `pg.Pool` (Object Method) + `@prisma/adapter-pg` using `SQL_HOST` (Cloud SQL Unix socket or host), `SQL_DB_NAME`, `SQL_USER`, and `SQL_PASSWORD`.
  - Schema management / migrations (`scripts/prisma-run.ts`) automatically use `SQL_ADMIN_USER` and `SQL_ADMIN_PASSWORD` so least-privilege runtime users never require DDL privileges.
- **Test Environment (`NODE_ENV=test`):**
  - If `TEST_DATABASE_URL` is set, Prisma CLI and `pg.Pool` connect to that isolated test PostgreSQL instance.
  - Otherwise, if `TEST_SQL_DB_NAME` is set alongside `SQL_HOST`, test runs target `TEST_SQL_DB_NAME` with smaller connection pools (`max: 5`).
- **Standard Local/CI Fallback:**
  - When `SQL_HOST` is unset, `DATABASE_URL` (or `TEST_DATABASE_URL` in test mode) is used.

---

## 2. Database Initialization & Prisma Migration Commands

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client (from prisma/schema.prisma)
npm run db:generate

# 3. Apply pending migrations to target database (development / staging / production)
npm run db:migrate:deploy

# 4. Verify migration status
npm run db:migrate:status
```

Creating a new migration in development after modifying `prisma/schema.prisma`:

```bash
npx tsx scripts/prisma-run.ts migrate dev --name <descriptive_change_name>
```

---

## 3. Seeding Commands & Production Guardrails

```bash
# Seed structural metadata + development demo accounts (NODE_ENV=development)
npm run db:seed

# Production seeding (NODE_ENV=production):
# ONLY seeds system roles, academy metadata, settings, classrooms, fee plans, and templates.
# Demo instructor/student accounts are NEVER created in production.
NODE_ENV=production npm run db:seed
```

---

## 4. Legacy JSON-to-PostgreSQL Migration (`scripts/migrate-json.ts`)

```bash
npm run db:migrate-json
```

Behavior & guarantees:
1. **Pre-Migration Backup:** Copies `data/centre-db.json` to `data/backups/centre-db.pre-migrate-<timestamp>.json` (and ensures `data/centre-db.backup.json` exists). Original JSON files are never modified or deleted.
2. **Pre-Import Validation & Duplicate Detection:** Validates emails, required fields, score ranges (`0..100`), foreign keys, and active enrollment uniqueness before opening a transaction, reporting any invalid or duplicate entries.
3. **Transactional & Idempotent:** All inserts/upserts execute inside `prisma.$transaction(...)` and link historical records (`EnrollmentHistory`, `Assessment`, `InvoiceItem`, `PaymentAllocation`, `StudentProfile`, `InstructorProfile`, `UserRole`).
4. **Post-Migration Verification:** Verifies imported table counts and reconciles academic weighted averages, completion percentages, attendance rates, and integer-cents invoice balances.
5. **Runtime Isolation:** Production API routes and `server/ams-service.ts` never read `data/centre-db.json` at runtime.

---

## 5. Test Database Setup

```bash
# Create an isolated test database (local PostgreSQL example)
createdb infocom_ams_test

# Run migrations against the test database
NODE_ENV=test TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/infocom_ams_test" \
  npm run db:migrate:deploy

# Seed test database
NODE_ENV=test TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/infocom_ams_test" \
  npm run db:seed

# Run unit tests
npm test
```

---

## 6. Backup & Restore Instructions

### Logical PostgreSQL Backup (`pg_dump`)
```bash
# Custom compressed archive (recommended before any production schema migration)
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --host="$SQL_HOST" \
  --username="$SQL_ADMIN_USER" \
  --dbname="$SQL_DB_NAME" \
  --file="data/backups/infocom-ams-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

### Logical PostgreSQL Restore (`pg_restore`)
```bash
# Restore into a target database (use --clean --if-exists for full replacement)
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --host="$SQL_HOST" \
  --username="$SQL_ADMIN_USER" \
  --dbname="$SQL_DB_NAME" \
  "data/backups/infocom-ams-<timestamp>.dump"
```

---

## 7. Migration Rollback Procedures

Prisma ORM uses forward-only migrations in production to prevent accidental data destruction:

1. **Before Deploying a Migration:** Always take a `pg_dump` snapshot (or Cloud SQL automated on-demand backup).
2. **If a Migration Fails Mid-Execution:**
   - Check status: `npm run db:migrate:status`
   - Restore the pre-migration backup (`pg_restore` or Cloud SQL Point-in-Time Recovery).
   - Mark the failed migration as rolled back:
     ```bash
     npx tsx scripts/prisma-run.ts migrate resolve --rolled-back <migration_folder_name>
     ```
3. **If a Deployed Migration Must Be Reverted After Application:**
   - Generate a compensating down-migration SQL script (`prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script`), review it manually for data safety, and deploy it as a new forward migration (`npx tsx scripts/prisma-run.ts migrate dev --name revert_<change>`), or restore the pre-deployment snapshot during a maintenance window.
