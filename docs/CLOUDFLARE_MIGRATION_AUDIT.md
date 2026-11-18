# IGS — InfoCom Global Services: Cloudflare Free Migration Audit

**Decision Gate Verdict:** **`BLOCKED — CLOUDFLARE FREE LIMITATION`**  
**Architecture Migrated To:** Single-Origin Cloudflare Workers + Static Assets (`./dist`), Cloudflare D1 (SQLite), Cloudflare R2 (`DOCUMENTS_BUCKET`), Cloudflare Queues (`JOBS_QUEUE` + DLQ), Cloudflare Cron Triggers (`*/15 * * * *`), Cloudflare Rate Limiting bindings, and Pure-JS PDF (`pdf-lib`) & CSV export — with **zero** Render, Railway, Vercel, external PostgreSQL, Supabase, Neon, Hyperdrive, external SMTP, or paid services in the Cloudflare target.

---

## 1. Mandatory Honest Decision Gate: Workers Free 10 ms CPU Ceiling

Preserving OWASP-compliant key stretching is non-negotiable. We benchmarked our actual password hashing implementations directly without weakening work factors or falling back to weak SHA-256 digests:

| Algorithm & Cost Parameters | Implementation | Measured Hash CPU Time | Measured Verify CPU Time | Workers Free 10 ms CPU Ceiling | Verdict |
| --- | --- | --- | --- | --- | --- |
| **scrypt (`N=16384, r=8, p=1`, 64-byte key)** | `node:crypto` `scrypt` (`server/worker-auth.ts`) | **61.54 ms** | **61.60 ms** | 10.00 ms | **Exceeds (~6.1x over limit)** |
| **Argon2id (`m=19456, t=2, p=1`)** | `hash-wasm` (`server/auth.benchmark.test.ts`) | **103.83 ms** | **91.80 ms** | 10.00 ms | **Exceeds (~9.2–10.4x over limit) + Wasm Codegen Disallowed** |

### Why This Blocks Unconditional Production Sign-In on Workers Free
- In local `workerd` (`wrangler dev` / `unstable_dev`), invocations succeed end-to-end because local Miniflare does not enforce production Workers Free 10 ms CPU termination.
- On Cloudflare's hosted **Workers Free** edge isolates, any request exceeding **10 ms CPU time** (`/api/auth/login`, `/api/auth/change-password`, `/api/auth/reset-password`, or admin `POST /api/users` / `POST /api/students`) risks **CPU limit termination (Error 1102)** even though all catalog reads, SPA assets, dashboard queries, admissions, finance, R2 storage, Queues, Cron, and pure-JS PDF downloads complete well inside 10 ms.
- Because `N=16384` is already the minimum interactive OWASP floor for `scrypt`, lowering `N` below `16384` or substituting plain SHA-256 is explicitly rejected.

### Compliant Production Resolution Paths
1. **Workers Paid ($5/month — Recommended):** Identical codebase and `wrangler.jsonc` deployed with **Unbound/Standard CPU (30 seconds default CPU time)** resolves password hashing, registration, onboarding, and login immediately with zero architectural changes.
2. **Passkeys (WebAuthn) / External OIDC on Workers Free:** Requires explicit institutional approval to replace password login on Workers Free with asymmetric P-256 WebAuthn assertions or OIDC verification (~1–2 ms CPU time via Web Crypto).

---

## 2. Complete Subsystem Migration Status

| Subsystem | Legacy Express / PostgreSQL | Cloudflare Native Migration | Bundle / Runtime Status |
| --- | --- | --- | --- |
| **Frontend SPA & Routing** | Vite + React 19 served by Express | `env.ASSETS` (`./dist`, `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`) | **Ready (Single Origin `workers.dev`)** |
| **HTTP Router** | Express 4 (`server/app.ts`) | Web Fetch API router (`server/worker.ts`, `server/worker-router.ts`, `server/worker-routes/*`) | **Ready** |
| **Database** | Prisma 6 + PostgreSQL + Hyperdrive | Native **Cloudflare D1** (`migrations/0001_initial_schema.sql`, `server/d1/*`) | **Ready (45 tables, zero Hyperdrive/Prisma)** |
| **Password Hashing & Sessions** | `argon2` native N-API + DB sessions | `scrypt` (`N=16384,r=8,p=1`) + SHA-256 hashed opaque cookies (`auth_sessions` in D1) | **Blocked on Workers Free 10 ms CPU (works locally / Paid $5 tier)** |
| **Document Storage** | Local disk / S3 | **Cloudflare R2** (`DOCUMENTS_BUCKET`, `server/worker-storage.ts`) | **Ready (2 MB limit, SHA-256, `private, no-store`)** |
| **Certificates & Reports PDF/CSV** | `pdfkit` + disk fonts | Pure-JS `pdf-lib` (`server/pdf/certificate-pdf.ts`, `server/pdf/report-pdf.ts`) + CSV escaping (`server/pdf/csv.ts`) | **Ready (zero `node:fs` / binary fonts)** |
| **Background Jobs & Cron** | PostgreSQL queue + Node interval | **Cloudflare Queues** (`JOBS_QUEUE` + DLQ) + **Cron** (`*/15 * * * *`) via `server/jobs/d1-worker.ts` | **Ready** |
| **Transactional Email** | `nodemailer` SMTP / HTTP | Default `EMAIL_PROVIDER="disabled"` logs safely in `delivery_logs` (`Skipped`) + in-app notifications & setup links; optional `fetch()` HTTP/Resend | **Ready** |
| **Rate Limiting & Security** | In-memory + CORS/CSRF | Cloudflare `AUTH_RATE_LIMITER` & `PUBLIC_RATE_LIMITER`, Origin/Referer CSRF guard, zero `X-Frame-Options` | **Ready** |

---

## 3. Worker Bundle Verification

Running `npm run cf:build` produces `dist-worker/worker.js`:
- **Bundle Size:** `2,324.63 KiB` uncompressed / `501.29 KiB` gzipped (~16% of Workers Free 3 MiB gzipped limit).
- **Zero Forbidden Node Libraries:** Confirmed zero `.wasm` Prisma engines, zero `@prisma/client`, zero `pg`, zero `express`, zero `pdfkit`, zero `nodemailer`, zero `argon2`, and zero `env.HYPERDRIVE`.
