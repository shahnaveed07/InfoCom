# IGS — InfoCom Global Services: PostgreSQL to Cloudflare D1 Migration Guide

This document describes the relational schema, SQL queries, decimal accounting, and transactional workflows migrated from Prisma/PostgreSQL to **Cloudflare D1 (SQLite)**.

---

## 1. D1 Schema & Migrations

- **`migrations/0001_initial_schema.sql`**: Complete 45-table D1 SQLite DDL mirroring `prisma/schema.prisma`, enforcing `PRAGMA foreign_keys = ON`, unique constraints, lookup indexes, and ISO-8601 UTC timestamps (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).
- **`migrations/0002_seed_reference.sql`**: Production-safe idempotent seed for:
  - System roles (`admin`, `instructor`, `student`)
  - Official academy profile (`IGS — InfoCom Global Services`, Sopore address, `Asia/Kolkata`, `INR`)
  - Institutional `academy_settings` thresholds (`passing_score`, `min_attendance_rate`, `admission.portal_activation_policy`, prefixes)
  - Administration department and default completion certificate template (`tmpl-default-2026`).
  - Contains **zero** hardcoded passwords or demo accounts.

---

## 2. Data Type & Semantics Mapping

| PostgreSQL / Prisma Construct | Cloudflare D1 (SQLite) Pattern (`server/d1/*`) |
| --- | --- |
| `Boolean` (`true`/`false`) | `INTEGER` (`0`/`1`) mapped via `sqlBool()` in `server/d1/client.ts` |
| `Decimal(12,2)` money amounts | `TEXT` fixed-point strings processed strictly in integer cents via `toCents()` / `fromCents()` in `src/shared/academic.ts` |
| `Json` arrays/objects | `TEXT` JSON strings parsed defensively via `sqlJson()` |
| Interactive transactions (`prisma.$transaction`) | Atomic `db.batch(statements)` prepared batches + conditional `UPDATE ... WHERE status = ...` optimistic guards |
| Production demo filtering | Public routes enforce `AND is_demo = 0` whenever `NODE_ENV=production` |
| Legacy `$argon2*` password hashes | Migrated users whose `password_hash` begins with `$argon2` return HTTP `501 ARGON2_REHASH_REQUIRED` prompting single-use reset/re-hash to `scrypt$16384$8$1` |

---

## 3. Local & Remote D1 CLI Commands

```bash
# Apply D1 schema & reference seed locally
npm run cf:d1:migrate:local

# Seed local development/demo academy data (never use in production; requires strong env passwords >=10 chars)
SEED_ADMIN_PASSWORD="StrongLocalAdmin!2026" \
SEED_INSTRUCTOR_PASSWORD="StrongLocalInst!2026" \
SEED_STUDENT_PASSWORD="StrongLocalStu!2026" \
ALLOW_DEMO_SEED="true" \
npm run cf:seed:demo:local

# Apply D1 migrations remotely to Cloudflare D1 before production deployment
npm run cf:d1:migrate:remote
```
