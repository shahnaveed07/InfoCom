# IGS — InfoCom Global Services: Cloudflare Free Migration Audit

**Decision Gate Verdict:** **`BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION`**  
**Architecture Target:** Single-Origin Cloudflare Workers + Static Assets (`./dist`), Cloudflare D1 (SQLite), Cloudflare R2 (`DOCUMENTS_BUCKET`), Cloudflare Queues (`JOBS_QUEUE` + DLQ), Cloudflare Cron Triggers (`*/15 * * * *`), Cloudflare Rate Limiting bindings, and Pure-JS PDF (`pdf-lib`) & CSV export — with **zero** Render, Railway, Vercel, external PostgreSQL, Supabase, Neon, Hyperdrive, external SMTP, or paid services in the Cloudflare target.

---

## 1. Mandatory Honest Decision Gate: Workers Free 10 ms CPU Ceiling

Preserving OWASP-compliant key stretching is non-negotiable. We benchmarked the actual password hashing implementations directly without weakening work factors or falling back to weak SHA-256 digests:

| Algorithm & Cost Parameters | Implementation | Measured Hash CPU Time | Measured Verify CPU Time | Workers Free 10 ms CPU Ceiling | Verdict |
| --- | --- | --- | --- | --- | --- |
| **scrypt (`N=16384, r=8, p=1`, 64-byte key)** | `node:crypto` `scrypt` (`server/worker-auth.ts`) | **61.54 ms** | **61.60 ms** | 10.00 ms | **Exceeds (~6.1x over limit)** |
| **Argon2id (`m=19456, t=2, p=1`)** | `hash-wasm` (`server/auth.benchmark.test.ts`) | **103.83 ms** | **91.80 ms** | 10.00 ms | **Exceeds (~9.2–10.4x over limit) + Wasm Codegen Disallowed** |
| **Legacy `$argon2*` rows in D1** | `server/worker-routes/auth.ts` | N/A | Rejected safely (`HTTP 501 ARGON2_REHASH_REQUIRED`) | N/A | **Requires single-use reset or passkey migration** |

### Why This Blocks Unconditional Production Deployment on Workers Free
- Local `wrangler dev` / `unstable_dev` (`workerd` / Miniflare) succeeds end-to-end **only** because local simulation does **not** enforce hosted Workers Free 10 ms CPU termination.
- On Cloudflare's hosted **Workers Free** edge isolates, any password-hashing request (`/api/auth/login`, `/api/auth/change-password`, `/api/auth/reset-password`, or creating credentialed users) risks **CPU limit termination (Error 1102)**.
- Because `N=16384` is already the minimum OWASP interactive floor for `scrypt`, lowering `N` or substituting SHA-256 is explicitly rejected.

### Compliant Production Resolution Paths (Approval Required)
1. **Option A — Workers Paid ($5/month):** Identical codebase and `wrangler.jsonc` deployed with Standard/Unbound CPU (30 seconds default CPU) resolves password authentication immediately with zero UX changes.
2. **Option B — First-Party WebAuthn / Passkeys on Workers Free:** Full technical design documented in `docs/CLOUDFLARE_WEBAUTHN_DESIGN.md` (Web Crypto ECDSA P-256 verification, D1 single-use challenges, zero external IdP). **Not yet implemented** — requires explicit institutional approval and live hosted Cloudflare Free CPU benchmarking before lifting this gate.

---

## 2. Verification Status Matrix (Strict Evidence Separation)

Do **not** conflate local build/test checks with hosted Cloudflare Free verification:

| Subsystem | Implemented in Code | Unit / Integration Tested | Verified in Local `workerd` / Wrangler | Verified on Hosted Cloudflare Free | Blocked by Free Plan Constraints |
| --- | --- | --- | --- | --- | --- |
| **Frontend SPA & `env.ASSETS` Routing** | Yes (`./dist`, SPA fallback, `/api/*` first) | Yes (SPA asset assertions) | Yes (`worker.test.ts` + Playwright `test:e2e:worker`) | **Not yet** (no live deploy performed) | No |
| **Cloudflare D1 Schema (45 tables) & Queries** | Yes (`migrations/0001` + `0002`, `server/d1/*`) | Yes (cents math, validation, schema parity) | Yes (`cloudflare-d1.worker.test.ts` + Playwright) | **Not yet** | No (within 5M read / 100k write/day) |
| **Cloudflare R2 Private Documents** | Yes (`server/worker-storage.ts`, 2 MB cap) | Yes (`server/storage/r2.test.ts`) | Yes (upload/download + SHA-256 verified) | **Not yet** | No (within 10 GB Free R2) |
| **Pure-JS PDF (`pdf-lib`) & CSV Exports** | Yes (`server/pdf/certificate-pdf.ts`, `report-pdf.ts`, `csv.ts`) | Yes (`server/pdf/pdf.test.ts`) | Yes (certificate + financial PDF endpoints) | **Not yet** | No (zero `pdfkit` / `node:fs`) |
| **Cloudflare Queues & 15m Cron Triggers** | Yes (`server/jobs/d1-worker.ts`) | Yes (`cloudflare-queue.test.ts`, D1 queue/cron tests) | Yes (bundle + queue consumer/cron harness) | **Not yet** | Verify Queues billing/plan entitlement on target account |
| **Notifications & Onboarding Token Lifecycle** | Yes (`EMAIL_PROVIDER=disabled`, in-app alerts, issue + explicit revoke endpoints/UI, enqueue redaction) | Yes (disabled `Skipped` + enqueue redaction tests) | Yes (API + Playwright UI issue/revoke test) | **Not yet** | Outbound email disabled by default (see `CLOUDFLARE_LIMITATIONS.md`) |
| **Password Authentication (`scrypt` / `$argon2`)** | Yes (`server/worker-auth.ts`, opaque D1 sessions) | Yes (`auth.test.ts`, `auth.benchmark.test.ts`) | Works locally (no 10 ms cap enforced) | **Not verified — exceeds 10 ms** | **YES — `BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION`** |
| **First-Party WebAuthn / Passkeys** | **Design only** (`docs/CLOUDFLARE_WEBAUTHN_DESIGN.md`) | Not yet implemented | Not yet implemented | Not yet implemented | Awaiting approval + live Free CPU benchmark |

---

## 3. Worker Bundle & Dependency Purity Verification

Running `npm run cf:build` produces `dist-worker/worker.js`:
- **Bundle Size:** ~`501 KiB` gzipped (~16% of Workers Free 3 MiB gzipped limit).
- **Zero Forbidden Production Dependencies in Worker Bundle:** Verified zero `.wasm` Prisma engines, zero `@prisma/client`, zero `pg`, zero `express`, zero `pdfkit`, zero `nodemailer`, zero `argon2`, and zero `env.HYPERDRIVE`.
- **Legacy PostgreSQL Preservation:** Existing PostgreSQL/Prisma files and tests remain cleanly separated in CI (`legacy-postgres-verify`) and are not imported by any Cloudflare Worker production code path.
