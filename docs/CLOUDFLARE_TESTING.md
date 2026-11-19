# IGS — Cloudflare Testing & Verification Runbook

This document defines the exact automated and browser verification commands for the **Cloudflare Workers + D1 production target**, kept strictly separate from legacy local Node.js + PostgreSQL verification.

---

## 1. Verification Tiers (What Each Command Proves)

| Command | Verification Tier | Requires PostgreSQL? | Proves Hosted Workers Free 10 ms CPU Compliance? |
| --- | --- | --- | --- |
| `npm ci` | Clean dependency graph & lockfile integrity (Node >= 22.12) | No | No |
| `npm run db:generate && npm run lint` | TypeScript compilation across Client, Node, and Worker (`tsconfig.worker.json`) | No | No |
| `npm run test:unit` | Pure logic, cents accounting, validation, R2/Queue adapters, pure-JS `pdf-lib` PDFs, KDF CPU benchmarks | No | **Proves scrypt (61.6 ms) & Argon2id (91.8 ms) EXCEED 10 ms** |
| `npm run build` + SPA checks | Production Vite static bundle & zero `/src/` asset leaks | No | No |
| `npm run cf:types && npm run cf:build` | Wrangler binding types + Worker bundle free of Prisma/pg/PDFKit/Nodemailer | No | No |
| `npm run cf:d1:migrate:local` | Fresh local D1 SQLite migrations (`0001` 45 tables + `0002` reference seed) | No | No |
| `npm run test:cloudflare` | Real local `workerd` runtime + D1 + R2 + Static Assets + Queue/Cron + PDF + token revocation | No | **No** (local `workerd` does not enforce 10 ms Free CPU cap) |
| `npm run test:e2e:worker` | Real headless Chromium Playwright suite against `wrangler dev` + local D1 | No | **No** (local simulation only) |
| `npm test` & `npm run test:e2e` | **Legacy local Node/Express + PostgreSQL suite** (CI `legacy-postgres-verify` job) | **Yes (PostgreSQL 16)** | No |

---

## 2. Cloudflare Target Validation Sequence (Zero PostgreSQL)

```bash
# 1. Clean dependency installation (requires Node.js >= 22.12)
npm ci

# 2. Generate Prisma types (needed by shared legacy TS project check) & run full TypeScript checks
npm run db:generate
npm run lint

# 3. Run unit tests, pure-JS pdf-lib tests, and KDF CPU benchmarks
npm run test:unit

# 4. Build SPA static assets & verify built bundle hygiene
npm run build
test -f dist/index.html && test -f dist/_redirects && test -f dist/_headers
! grep -rnE '"/src/|/src/assets/' dist/index.html dist/assets/*.js

# 5. Generate Worker types & dry-run Worker bundle
npm run cf:types
npm run cf:build

# 6. Apply fresh local D1 migrations & run real workerd + D1 + R2 + Queue/Cron suite
npm run cf:d1:migrate:local
npm run test:cloudflare

# 7. Run headless Chromium Playwright E2E suite against Cloudflare Worker + local D1
npm run test:e2e:worker
```

---

## 3. Coverage Summary

1. **`server/pdf/pdf.test.ts` (`test:unit`)**
   - Verifies pure-JS `pdf-lib` certificate generation (A4 landscape, embedded logo, QR vector, revoked watermark, custom PNG logo, corrupt logo fallback), WinAnsi INR `₹` sanitization, and multi-page + empty table reports.
2. **`server/worker.test.ts` (`test:cloudflare`)**
   - Verifies `dist-worker/worker.js` binds `DB`, `ASSETS`, `DOCUMENTS_BUCKET`, `JOBS_QUEUE`, `AUTH_RATE_LIMITER`, `PUBLIC_RATE_LIMITER` with zero `HYPERDRIVE`, `@prisma/client`, `pg`, `pdfkit`, `nodemailer`, or `.wasm` query engines.
   - Boots `server/worker.ts` inside real `workerd` (`unstable_dev`) and checks `/api/health`, `/api/health/ready`, SPA deep-link fallback, CORS, security headers, `401` auth boundary, and `429` Cloudflare rate limiting.
3. **`server/cloudflare-d1.worker.test.ts` (`test:cloudflare`)**
   - Verifies all **45 D1 tables** exist after fresh migration and `0002_seed_reference.sql` is idempotent on repeat execution.
   - Verifies production demo exclusion (`is_demo = 1`), disabled public registration (`410`), `$argon2id` rejection (`501 ARGON2_REHASH_REQUIRED`), `must_change_password` lock/unlock, RBAC/IDOR checks, CSRF origin check, full admissions -> onboarding -> payment -> activation -> academics -> certificate PDF -> refund -> R2 vault -> CSV/PDF reports lifecycle.
   - Verifies explicit admin onboarding token issuance, non-exposure in `audit_logs` and `background_jobs` under `EMAIL_PROVIDER="disabled"`, explicit token revocation (`POST /api/users/:id/revoke-reset-tokens` & `/api/students/:studentId/revoke-reset-tokens`), `Skipped` disabled-email logging, HTTP failure retry/redaction, and Cron sweep cleanup.
4. **`e2e-worker/cloudflare-worker.spec.ts` (`test:e2e:worker`)**
   - Launches `wrangler dev` backed by a fresh migrated & demo-seeded local D1 instance and verifies public routes, deep-link reloads, certificate verification, zero broken images, mobile (`390x844`) responsive layout, admin login, and UI onboarding token issuance + revocation in headless Chromium.
