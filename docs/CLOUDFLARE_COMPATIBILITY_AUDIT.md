# IGS — InfoCom Global Services: Cloudflare Free Tier Compatibility Audit (Legacy Express/Hyperdrive Pre-Migration Audit)

> **Superseded:** This Phase 1 audit evaluated keeping an external Node.js/PostgreSQL + Hyperdrive backend. It has been superseded by the complete Cloudflare-native **D1 + R2 + Queues + Single-Origin Worker** migration documented in [`docs/CLOUDFLARE_MIGRATION_AUDIT.md`](./CLOUDFLARE_MIGRATION_AUDIT.md) and [`docs/CLOUDFLARE_LIMITATIONS.md`](./CLOUDFLARE_LIMITATIONS.md).

**Historical Status Classification:** `SUPERSEDED — MIGRATED TO D1 / WORKERS`  
**Audit Scope:** Historical baseline of React + Vite SPA, Express + TypeScript API, Prisma 6 (`6.16.2`) + PostgreSQL (`pg`), Argon2id auth, PDFKit certificates, R2 private storage, HTTP/SMTP email, Queues, Cron Triggers, and distributed Rate Limiting.

---

## 1. Empirical Runtime Findings (`wrangler` + `workerd`)

| Subsystem | Library / Module | Empirical `workerd` Probe Result | Verdict |
| --- | --- | --- | --- |
| **Frontend SPA** | Vite 8 + React 19 (`dist/`) | Static ES imports + `public/assets/...`, `_redirects`, `_headers` verified cleanly | **Ready for Cloudflare Pages** |
| **PostgreSQL + ORM** | `@prisma/client` (`6.16.2`) + `@prisma/adapter-pg` + `pg` | Initializes cleanly inside `workerd` when scoped lazily per-request via Hyperdrive + `AsyncLocalStorage` (`server/db/prisma.ts`) | **Ready (via Hyperdrive)** |
| **Password Hashing** | `argon2` (`0.45.2`) + `hash-wasm` (`m=19456, t=2, p=1`) | Native `argon2` `.node` N-API fails in V8; `hash-wasm` triggers `CompileError: Wasm code generation disallowed` in `workerd` AND measured **87.26 ms hash / 99.06 ms verify** (>9x over Workers Free **10 ms CPU limit**) | **Blocked on Workers Free -> Keep on Node.js** |
| **Express 4 API Router** | `express@4.21.2` (`body-parser` -> `raw-body` -> `iconv-lite`) | Fails at Worker startup in `workerd`: `TypeError: require_streams(...) is not a function` (`esbuild` browser shim vs `nodejs_compat`) | **Blocked -> Web Fetch Worker + External Node API** |
| **PDF Certificates** | `pdfkit@0.20.2` + `qrcode@1.5.4` | Fails at Worker startup (`TypeError: Invalid URL string.`), relies on disk `.afm` Helvetica metrics, disk logo `fs.existsSync`, and `QRCode.toBuffer` | **Blocked on Workers Free -> Keep on Node.js** |
| **Private Document Storage** | `server/storage/r2.ts` | Native Cloudflare `R2Bucket` binding adapter with traversal checks, `private, no-store` headers, SHA-256 metadata, and 2 MB cap | **Ready for Cloudflare R2** |
| **Transactional Email** | `server/email/mailer.ts` | HTTP `fetch` transport (`EMAIL_PROVIDER=http`, Resend or generic JSON webhook) works cleanly inside Workers alongside Node SMTP (`nodemailer`) | **Ready (HTTP Email API)** |
| **Background Jobs & Cron** | `server/jobs/cloudflare-queue.ts` | Queue producer sends only `{ jobId, jobType }` (no raw reset tokens in Queue messages); Queue consumer acks/retries; Cron (`*/15 * * * *`) runs recovery & sweeps | **Ready for Queues & Cron** |
| **Rate Limiting & CSRF** | `server/middleware/rate-limit.ts` & `security.ts` | Distributed `RateLimit` bindings (`AUTH_RATE_LIMITER`, `PUBLIC_RATE_LIMITER`); `csrfOriginGuard` permits cross-site fetches *only* when `CORS_CROSS_SITE_COOKIES=true` and `Origin` is allowlisted | **Ready** |

---

## 2. Recommended Free Tier Production Topology

1. **Cloudflare Pages** hosts the static React SPA (`dist/`, `_redirects`, `_headers`) globally with zero-`/src/` unbundled asset references.
2. **External Node.js Backend (`dist-server/server.js`)** runs the full Express API (`POST /api/auth/*`, portal CRUD, finance, admin operations, and PDFKit certificate generation) with PostgreSQL, preserving full OWASP Argon2id parameters (`m=19456, t=2, p=1`).
3. **Cloudflare Edge Worker (`server/worker.ts`)** handles optional Hyperdrive-backed public catalog/health/certificate-verification edge reads (`/api/health`, `/api/health/ready`, `/api/public/academy`, `/api/public/courses*`, `/api/certificates/verify/:code`), Cloudflare R2 storage operations, Cloudflare Queues batch consumption, and Cron Triggers (`*/15 * * * *`). Unsupported authenticated/Argon2id/PDF endpoints return an explicit `501 WORKER_RUNTIME_UNSUPPORTED` response pointing operators to the Node API backend.

---

## 3. Workers Free Tier Limits Guardrails (`server/telemetry/cloudflare-limits.ts`)

- **Worker CPU Time:** 10 ms ceiling per invocation (request telemetry emits a structured warning at >= 8 ms).
- **Bundle Size:** 64 MiB uncompressed limit (`server/worker.ts` dry-run bundle is ~3.35 MiB / 1.11 MiB gzipped — ~5% of limit).
- **Worker Memory:** 128 MB per isolate (Hyperdrive pools bounded to `max: 5` per request and closed via `ctx.waitUntil`).
- **Hyperdrive / Queues / R2 Free Quotas:** Respects 100k requests/day, 10k Queue operations/day (128 KB max message size, 24h retention), and 10 GB R2 storage.
