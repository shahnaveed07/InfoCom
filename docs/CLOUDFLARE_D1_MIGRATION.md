# IGS — InfoCom Global Services: PostgreSQL to Cloudflare D1 Migration Guide

This document describes the relational schema, SQL semantics, decimal accounting, and data migration verification from legacy Prisma/PostgreSQL to **Cloudflare D1 (SQLite)**.

---

## 1. D1 Schema & Migrations (45 / 45 Table Parity)

- **`migrations/0001_initial_schema.sql`**: Complete **45-table** D1 SQLite DDL matching all 45 `@@map` models in `prisma/schema.prisma`, enforcing `PRAGMA foreign_keys = ON`, unique constraints, lookup indexes, and ISO-8601 UTC timestamps (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).
- **`migrations/0002_seed_reference.sql`**: Production-safe, strictly idempotent seed (`INSERT OR IGNORE`) for:
  - System roles (`admin`, `instructor`, `student`)
  - Official academy profile (`IGS — InfoCom Global Services`, Sopore address, `Asia/Kolkata`, `INR`)
  - Institutional `academy_settings` thresholds (`passing_score`, `min_attendance_rate`, `admission.portal_activation_policy`, prefixes)
  - Administration department and default completion certificate template (`tmpl-default-2026`)
  - Contains **zero** hardcoded passwords or demo accounts.

---

## 2. Data Type & Transactional Mapping

| PostgreSQL / Prisma Construct | Cloudflare D1 (SQLite) Pattern (`server/d1/*`) |
| --- | --- |
| `Boolean` (`true`/`false`) | `INTEGER` (`0`/`1`) mapped via `sqlBool()` in `server/d1/client.ts` |
| `Decimal(12,2)` money amounts | `TEXT` fixed-point strings computed strictly in integer cents via `toCents()` / `fromCents()` in `src/shared/academic.ts` (zero floating-point drift) |
| `Json` arrays/objects | `TEXT` JSON strings parsed defensively via `sqlJson()` |
| Interactive transactions (`prisma.$transaction`) | Atomic `db.batch(statements)` prepared batches + conditional `UPDATE ... WHERE status = ...` optimistic guards |
| Production demo filtering | Public routes enforce `AND is_demo = 0` whenever `NODE_ENV=production` |
| Legacy `$argon2*` password hashes | Migrated user rows are **preserved intact**; Worker returns HTTP `501 ARGON2_REHASH_REQUIRED` prompting single-use reset (`scrypt$16384$8$1`) or future approved WebAuthn enrollment |

---

## 3. Existing Data Migration Preservation (`scripts/pg-to-d1-export.ts` & `scripts/migrate-json.ts`)

- **`scripts/pg-to-d1-export.ts`**: Exports all **45** PostgreSQL tables in foreign-key-safe order (`roles`, `users`, `user_roles`, ..., `background_jobs`) using `INSERT OR REPLACE` statements with explicit column mapping (`class_sessions.startIso -> start_at`, `endIso -> end_at`). **Zero user records are discarded** during export.
- **`scripts/migrate-json.ts`**: Legacy pre-Prisma JSON import script creates a timestamped pre-migration backup (`data/backups/`) before validating and upserting records, only skipping malformed rows lacking required `id`/`name`/valid `email` or duplicate emails (logged explicitly in `issues`).
- **Verification Scope:** `migrations/0001_initial_schema.sql` + `0002_seed_reference.sql` (45 tables + idempotency + decimal accounting + constraints) are executed and verified in local D1 (`npm run test:cloudflare`). Live remote D1 import of an existing production PostgreSQL dump has not yet been executed against a hosted Cloudflare account.

---

## 4. Local & Remote D1 CLI Commands

```bash
# Apply D1 schema & reference seed locally
npm run cf:d1:migrate:local

# Seed local development/demo academy data (never use in production; requires strong env passwords >=10 chars)
SEED_ADMIN_PASSWORD="StrongLocalAdmin!2026" \
SEED_INSTRUCTOR_PASSWORD="StrongLocalInst!2026" \
SEED_STUDENT_PASSWORD="StrongLocalStu!2026" \
ALLOW_DEMO_SEED="true" \
npm run cf:seed:demo:local

# Export existing PostgreSQL data to D1 SQL (run only when migrating an existing PostgreSQL instance)
DATABASE_URL="postgresql://..." npx tsx scripts/pg-to-d1-export.ts --out ./data/d1-export.sql

# Apply D1 migrations remotely to Cloudflare D1 before production deployment
npm run cf:d1:migrate:remote
```
