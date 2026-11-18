# IGS — Cloudflare Testing & Verification Runbook

This document details all automated and live browser checks validating the native Cloudflare Workers + D1 + R2 + Queues + Cron + Static Assets migration.

---

## 1. Automated Verification Commands

```bash
# 1. Build frontend SPA assets
npm run build

# 2. Regenerate Wrangler binding types & run full TypeScript typechecks (client + Node + Worker)
npm run cf:types
npm run lint

# 3. Verify Worker bundle excludes Node/Prisma/PDFKit/Nodemailer dependencies
npm run cf:build

# 4. Run non-database unit tests + password hashing benchmarks
npx tsx --test \
  src/shared/academic.test.ts \
  src/shared/validation.test.ts \
  src/utils/public-data.test.ts \
  server/auth.test.ts \
  server/auth.benchmark.test.ts \
  server/db/config.test.ts \
  server/storage/r2.test.ts \
  server/jobs/cloudflare-queue.test.ts \
  server/middleware/rate-limit.test.ts

# 5. Run real workerd + D1 + R2 + Static Assets + Queue/Cron test suite
npm run test:cloudflare
```

---

## 2. Coverage Summary (`test:cloudflare`)

1. **`server/worker.test.ts`**
   - Verifies `wrangler deploy --dry-run` binds `env.DB`, `env.ASSETS`, `env.DOCUMENTS_BUCKET`, `env.JOBS_QUEUE`, `env.AUTH_RATE_LIMITER`, `env.PUBLIC_RATE_LIMITER` with **zero** `HYPERDRIVE`, zero `.wasm` query engines, `@prisma/client`, `pdfkit`, or `nodemailer` in `dist-worker/worker.js` (`501.29 KiB` gzipped).
   - Boots `server/worker.ts` inside real `workerd` (`unstable_dev`) and tests `/api/health`, `/api/health/ready` (`D1_SCHEMA_NOT_APPLIED`), SPA routing (`/courses`, `/courses/web-development` -> `200 text/html`), CORS allowlist, security headers without `X-Frame-Options`, `401` protected boundary (zero `501` stubs), and distributed Cloudflare Rate Limiting (`429` + `Retry-After: 60`).

2. **`server/cloudflare-d1.worker.test.ts`**
   - Applies `migrations/` to isolated temporary local D1 state and runs end-to-end inside `workerd`:
     - `NODE_ENV=production` `is_demo = 1` course exclusion on `/api/public/courses`
     - Disabled `/api/auth/register` (`410`)
     - Legacy `$argon2id` hash rejection (`501 ARGON2_REHASH_REQUIRED`)
     - `must_change_password` portal lock (`403 PASSWORD_CHANGE_REQUIRED`) & unlock via `/api/auth/change-password`
     - RBAC & IDOR protection on student invoices and directories (`403`)
     - Origin/Referer CSRF rejection on state-changing requests (`403 CSRF_ORIGIN_REJECTED`)
     - Full admissions lifecycle: public submission with R2 PDF attachment -> admin download verification -> admission approval -> single-use onboarding password reset -> full tuition payment -> automatic portal activation -> module completions, assessments, grading, sessions, attendance -> certificate issuance -> pure-JS `pdf-lib` PDF bytes (`%PDF-1.`) -> public certificate verification -> payment refund -> R2 document upload/download -> CSV & PDF reports -> audit/email/worker telemetry endpoints.
     - Cloudflare Queue consumer `Skipped` email log under `EMAIL_PROVIDER="disabled"`, retry -> exhausted `Failed` transition with payload redaction on HTTP failures, and Cron housekeeping (`expiredSessionsDeleted`, `expiredResetTokensDeleted`).
