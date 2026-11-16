# InfoCom AMS — PostgreSQL & Prisma Operations Guide

This guide documents database initialization, Prisma migrations, production vs. development seeding, legacy document migration, backup/restore, and rollback procedures for InfoCom AMS.

---

## 1. Environment Configuration (Development, Test, Production)

Database connection resolution lives in `server/db/config.ts` and `server/db/prisma.ts`:

- **Cloud SQL Runtime (`development` / `production`):**
  - Application pool connects via `pg.Pool` + `@prisma/adapter-pg` using `SQL_HOST` (Cloud SQL Unix socket or host), `SQL_DB_NAME`, `SQL_USER`, and `SQL_PASSWORD`.
  - Schema management / migrations (`scripts/prisma-run.ts`) automatically use `SQL_ADMIN_USER` and `SQL_ADMIN_PASSWORD` so least-privilege runtime users never require DDL privileges.
- **Test Environment (`NODE_ENV=test`):**
  - If `TEST_DATABASE_URL` is set, Prisma CLI and `pg.Pool` connect to that isolated test PostgreSQL instance.
  - Otherwise, if `TEST_SQL_DB_NAME` is set alongside `SQL_HOST`, test runs target `TEST_SQL_DB_NAME` with smaller connection pools (`max: 5`).
- **Standard Local/CI Fallback:**
  - When `SQL_HOST` is unset, `DATABASE_URL` (or `TEST_DATABASE_URL` in test mode) is used.

---

## 2. Database Initialization & Prisma Migration Commands

```bash
# 1. Install reproducible dependencies from package-lock.json
npm ci

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
# Production-safe seed (NODE_ENV=production or development):
# ONLY seeds system roles, official IGS Sopore academy metadata, policy settings, ADMIN department, and certificate template.
# NEVER creates demo users, demo courses, enrollments, or invoices.
npm run db:seed

# Development demo seed (strictly guarded: aborts unless NODE_ENV=development AND ALLOW_DEMO_SEED=true):
# Uses SEED_ADMIN_PASSWORD / SEED_INSTRUCTOR_PASSWORD / SEED_STUDENT_PASSWORD if provided,
# or generates ephemeral random credentials per run (no hardcoded passwords in source).
ALLOW_DEMO_SEED=true npm run db:seed:demo
```

In production (`NODE_ENV=production`), `GET /api/public/courses` automatically excludes any course flagged `isDemo = true`.

---

## 4. Legacy Base64 Document Migration (`scripts/migrate-legacy-documents.ts`)

Migrates legacy `documents` rows with `storage_provider = 'postgres'` and inline `content_base64` payloads to the active private storage backend (`local` or `s3`) with read-back SHA-256 verification before clearing `content_base64`:

```bash
# Dry-run audit (no files written or rows modified)
npm run db:migrate-documents -- --dry-run

# Live migration, retaining Base64 temporarily until final verification
npm run db:migrate-documents -- --keep-base64

# Live migration (clears content_base64 after verified round-trip SHA-256 match)
npm run db:migrate-documents -- --report=data/backups/doc-migration-report.json
```

---

## 5. Legacy JSON-to-PostgreSQL Migration (`scripts/migrate-json.ts`)

```bash
npm run db:migrate-json
```

- Creates a pre-migration backup in `data/backups/`, validates records before opening a transaction, and reconciles relational tables idempotently. Runtime code never reads `data/centre-db.json`.

---

## 6. Test Database Setup

```bash
createdb infocom_ams_test

NODE_ENV=test TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/infocom_ams_test" \
  npm run db:migrate:deploy

NODE_ENV=test TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/infocom_ams_test" \
  npm run db:seed

npm test
```

---

## 7. Backup & Restore Instructions

### Logical PostgreSQL Backup (`pg_dump`) + Private Storage Files
Always back up **both** PostgreSQL and the private storage directory (`STORAGE_LOCAL_DIR`, default `data/storage`) together before schema migrations or upgrades:

```bash
BACKUP_DIR="data/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

# 1. PostgreSQL custom compressed archive
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  --file="$BACKUP_DIR/infocom-ams.dump"

# 2. Private document object store snapshot (for STORAGE_PROVIDER=local)
tar -czf "$BACKUP_DIR/private-storage.tar.gz" -C "${STORAGE_LOCAL_DIR:-data/storage}" .
```

### Logical PostgreSQL Restore (`pg_restore`) + Private Storage Restore
```bash
# 1. Restore PostgreSQL database
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  "$BACKUP_DIR/infocom-ams.dump"

# 2. Restore private document files
mkdir -p "${STORAGE_LOCAL_DIR:-data/storage}"
tar -xzf "$BACKUP_DIR/private-storage.tar.gz" -C "${STORAGE_LOCAL_DIR:-data/storage}"
```

---

## 8. Migration Rollback Procedures

Prisma ORM uses forward-only migrations in production to prevent accidental data loss:

1. **Before Deploying a Migration:** Take a `pg_dump` + private storage backup snapshot (Section 7).
2. **If a Migration Fails Mid-Execution:**
   - Check status: `npm run db:migrate:status`
   - Restore the pre-migration backup (`pg_restore`).
   - Mark the failed migration as rolled back:
     ```bash
     npx tsx scripts/prisma-run.ts migrate resolve --rolled-back <migration_folder_name>
     ```
3. **If a Deployed Migration Must Be Reverted After Application:**
   - Generate a compensating SQL script (`prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script`), verify data safety, and deploy it as a forward migration (`npx tsx scripts/prisma-run.ts migrate dev --name revert_<change>`), or restore the pre-deployment snapshot.
