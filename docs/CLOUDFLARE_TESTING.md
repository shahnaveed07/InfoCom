# IGS — Cloudflare Testing & Verification Runbook

This runbook documents the automated and browser verification commands for the **Cloudflare Workers + D1 + WebAuthn production target**, kept strictly separate from the legacy local Node.js + PostgreSQL verification suite.

---

## 1. Verification Tiers (Local vs Hosted Distinction)

| Command | Verification Tier | Requires PostgreSQL? | Proves Hosted Workers Free 10 ms CPU Compliance? |
| --- | --- | --- | --- |
| `npm ci` | Clean lockfile & dependency graph (Node >= 22.12) | No | No |
| `npm run db:generate && npm run lint` | TypeScript compilation across Client, Node, and Worker (`tsconfig.worker.json`) | No | No |
| `npm run test:unit` | Academic rules, cents accounting, Zod schemas, **WebAuthn ES256/RS256 & negative crypto tests**, **DB retry & email idempotency tests**, pure-JS `pdf-lib` PDFs, R2/Queue/RateLimit adapters, KDF benchmarks | No | Confirms password KDFs exceed 10 ms & WebAuthn crypto runs sub-ms locally |
| `npm run build` + SPA checks | Production Vite static bundle & zero `/src/` asset leaks | No | No |
| `npm run cf:types && npm run cf:build` | Wrangler binding types + Worker bundle (`~512 KiB` gzipped) with zero `scrypt`, `argon2`, `hash-wasm`, `@prisma/client`, `pg`, `pdfkit`, `nodemailer`, or `.wasm` | No | No |
| `npm run cf:d1:migrate:local` | Fresh local D1 SQLite migrations (`0001` + `0002` + `0003` = **47 tables**) | No | No |
| `npm run test:cloudflare` | Real local `workerd` runtime + D1 + WebAuthn full security matrix + Bootstrap CLI + R2 + Static Assets + Queue/Cron + PDF + token revocation | No | **No** (local Miniflare does not enforce hosted 10 ms CPU termination) |
| `npm run test:e2e:worker` | Real headless Chromium Playwright + **CDP Virtual Authenticator** against `wrangler dev` + local D1 | No | **No** (local simulation only) |
| `npm run cf:verify:cpu -- --url <staging>` + `wrangler tail` | **Hosted Cloudflare Workers Free staging probe & CPU telemetry** | No | **Yes — `PENDING` until executed on live `workers.dev`** |
| `npm test` & `npm run test:e2e` | **Legacy local Node/Express + PostgreSQL suite** (`legacy-postgres-verify` CI job) | **Yes (PostgreSQL 16)** | No |

---

## 2. Complete Cloudflare Target Validation Sequence (Zero PostgreSQL)

```bash
# 1. Clean dependency installation (Node.js >= 22.12)
npm ci

# 2. Generate Prisma Client (for shared TypeScript check) & run full TypeScript lint
npm run db:generate
npm run lint

# 3. Run all unit tests (61 tests including WebAuthn crypto & retry/idempotency safety)
npm run test:unit

# 4. Build SPA static assets & verify built bundle hygiene
npm run build
test -f dist/index.html && test -f dist/_redirects && test -f dist/_headers
! grep -rnE '"/src/|/src/assets/' dist/index.html dist/assets/*.js

# 5. Generate Worker types, dry-run bundle, & verify zero forbidden packages/KDFs
npm run cf:types
npm run cf:build
! ls dist-worker/*.wasm 2>/dev/null
! grep -E 'crypto\.scrypt|hashPasswordWorker|verifyPasswordWorker|argon2|hash-wasm|@prisma/client|pdfkit|nodemailer' dist-worker/worker.js

# 6. Apply fresh local D1 migrations & run real workerd + D1 + WebAuthn suite
npm run cf:d1:migrate:local
npm run test:cloudflare

# 7. Run headless Chromium Playwright + CDP Virtual Authenticator E2E suite
npm run test:e2e:worker
```

---

## 3. Test Suite Coverage Summary

1. **`server/webauthn/core.test.ts` (`test:unit`)**
   - Verifies ES256 & RS256 registration and authentication, synced passkey counter (`0 -> 0`), monotonic counter (`1 -> 2`), and rejects tampered signatures, wrong RP ID, wrong Origin, `crossOrigin: true`, missing UV flag, wrong ceremony type, and clone counter regressions (`CLONE_SUSPECTED`).
2. **`server/jobs/worker.retry.test.ts` (`test:unit`)**
   - Verifies transient PostgreSQL disconnect retry recovery, fail-fast on non-transient SQL constraint errors (`23505`), credential masking in `sanitizePoolErrorSummary`, and email job idempotency (`delivery_logs.status = 'Delivered'` prevents duplicate sends).
3. **`server/worker.test.ts` (`test:cloudflare`)**
   - Verifies `dist-worker/worker.js` contains zero `scrypt`, `argon2`, `hash-wasm`, `hashPasswordWorker`, `verifyPasswordWorker`, `@prisma/client`, `pg`, `pdfkit`, `nodemailer`, or `.wasm`.
   - Boots `server/worker.ts` inside real `workerd` (`unstable_dev`) and checks `/api/health`, `/api/auth/config` (`authMode: 'webauthn'`), `/api/health/ready`, SPA deep-link fallback, CORS, `401` auth boundary, and `429` Cloudflare rate limiting on WebAuthn endpoints.
4. **`server/cloudflare-d1.worker.test.ts` (`test:cloudflare`)**
   - Verifies all **47 D1 tables** exist after fresh migration (`0001`–`0003`) and `0002_seed_reference.sql` is idempotent.
   - Verifies First-Admin Passkey Bootstrap CLI creates initial admin and refuses to overwrite existing admins.
   - Verifies `403 PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE` on all Worker password routes.
   - Verifies full WebAuthn lifecycle (bootstrap enrollment, single-use token replay rejection, ES256 synced `0->0` login, RS256 backup key, rename, step-up reauth & self-revocation, admin passkey inspection & revocation invalidating active sessions) + full negative security matrix (replayed challenge, expired challenge, unknown credential, tampered signature, wrong RP ID, wrong Origin, clone regression `WEBAUTHN_CLONE_SUSPECTED`, suspended account block, cross-user enrollment guard, legacy `password_hash` preservation).
   - Verifies all core academy workflows (public catalog, admissions + R2 PDF upload/download, payment auto-activation, IDOR checks, modules/grades/attendance, certificate PDF & verification, refunds, CSV/PDF reports, audit log & queue payload token redaction, Cron sweep including WebAuthn challenge purge).
5. **`e2e-worker/cloudflare-worker.spec.ts` (`test:e2e:worker`)**
   - Runs real headless Chromium with a **CDP Virtual Authenticator** (`WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator`) against `wrangler dev` on `http://localhost:3107` to verify public routes, Passkey Sign In UI, bootstrap enrollment via `/?enrollToken=...`, sign-out + passkey sign-in, `excludeCredentials` duplicate rejection, 2nd roaming virtual authenticator registration, rename, live step-up reauth + revoke, and admin enrollment link issuance/revocation + user passkey inspection with zero console, page, or 5xx errors.
