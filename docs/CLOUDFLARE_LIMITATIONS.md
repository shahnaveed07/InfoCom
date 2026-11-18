# IGS — Cloudflare Free Tier Limitations & Architectural Boundaries

While every API route, database table, PDF generator, storage adapter, and background worker has been migrated to run inside Cloudflare's V8 isolate runtime without external hosting, **Cloudflare Workers Free tier imposes hard runtime limits** that directly govern production readiness.

---

## 1. Critical Blocker: 10 ms CPU Time Limit vs Password Hashing (`BLOCKED — CLOUDFLARE FREE LIMITATION`)

- **Cloudflare Workers Free Plan:** Maximum **10 ms CPU time** per HTTP request invocation.
- **Measured IGS Password KDF Timings:**
  - `scrypt` (`N=16384, r=8, p=1`, 64-byte key, `server/worker-auth.ts`): **61.54 ms** hash / **61.60 ms** verify.
  - Argon2id WASM (`m=19456, t=2, p=1`, `hash-wasm`): **103.83 ms** hash / **91.80 ms** verify (plus WebAssembly codegen restriction in production Workers).
- **Policy Decision:** Security parameters are **not** weakened below OWASP baselines (`N=16384` minimum floor for scrypt; SHA-256 substitution is forbidden).
- **Impact:** Public browsing, SPA assets, certificate verification, read dashboards, finance/academic mutations, R2 streams, and pure-JS PDF exports run well under 10 ms CPU, **but** password logins, password changes, password resets, and creating credentialed users exceed the 10 ms Free CPU cap and require either:
  1. **Workers Paid ($5/month):** 30-second default CPU limit removes the blocker cleanly without changing any code.
  2. **Approved Passwordless / Passkey / OIDC Flow:** Asymmetric ECDSA P-256 verification completes in ~1–2 ms CPU within Free limits if explicitly approved.

---

## 2. Cloudflare Free Resource Quotas & Mitigations Built In

| Resource | Free Plan Ceiling | IGS Mitigation |
| --- | --- | --- |
| **Worker Requests** | 100,000 requests/day | Static SPA routes served directly by `env.ASSETS` (`run_worker_first: ["/api/*"]` skips Worker CPU for HTML/JS/CSS/images) |
| **Worker Script Size** | 3 MiB gzipped (Free) / 64 MiB uncompressed | `dist-worker/worker.js` stripped of Prisma/WASM/PDFKit/Nodemailer -> **501.29 KiB gzipped** |
| **Cloudflare D1** | 5M rows read/day, 100k rows written/day, 5 GB | Paginated queries, indexed lookups, transactional `db.batch()` statements |
| **Cloudflare R2** | 10 GB-month, 1M Class A ops, 10M Class B ops | Strict 2 MB upload limit per document (`contentBase64` capped), `private, no-store` cache control |
| **Cloudflare Queues** | 10,000 ops/day (on Queues Free / Paid bundling) | Reference-only `{ jobId, jobType }` messages; fallback Cron processor retries `Pending` D1 jobs every 15m |
| **Email Transport** | No built-in outbound SMTP in Workers | Default `EMAIL_PROVIDER="disabled"` records `Skipped` audit trails cleanly with in-app notifications & admin-issued setup links |
| **Legacy `$argon2` Accounts** | No native N-API in V8 Workers | Accounts migrated with `$argon2*` hashes receive HTTP `501 ARGON2_REHASH_REQUIRED` prompting single-use reset to `scrypt$16384$8$1` |
