# IGS — Cloudflare Free Tier Limitations & Architectural Boundaries

IGS runs natively on **Cloudflare Workers Free**, **D1 (47 tables)**, **R2**, **Queues**, **Cron Triggers**, **Rate Limiting**, and **Workers Static Assets** without external PostgreSQL hosting, external authentication SaaS, or paid email providers. The boundaries below remain important for operators.

---

## 1. Password Authentication Disabled on Workers Free (Replaced by First-Party WebAuthn Passkeys)

- **Why:** Cloudflare Workers Free enforces a strict **10 ms CPU cap** per HTTP invocation. OWASP-compliant `scrypt` (`N=16384, r=8, p=1`, ~61.6 ms) and Argon2id WASM (`m=19456, t=2, p=1`, ~91–104 ms) exceed this ceiling by 6x–10x. IGS **never** weakens password hashing work factors or substitutes SHA-256/weak PBKDF2.
- **Solution Implemented (`AUTH_MODE="webauthn"`):**
  - First-party WebAuthn/Passkey authentication (`server/webauthn/core.ts`, `server/worker-routes/webauthn.ts`) verifies `ES256`/`RS256` assertions using native V8 `crypto.subtle` with zero WASM and zero external auth SaaS.
  - All Worker password endpoints (`POST /api/auth/login`, `/change-password`, `/forgot-password`, `/reset-password`) return HTTP `403` (`code: 'PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE'`).
  - Legacy local Node.js + Express + PostgreSQL (`server/routes/auth.routes.ts`) remains fully preserved with Argon2id/scrypt password auth (`authMode: 'password'`).
- **Campus Lab / Device Requirement:** Users need a passkey-capable browser/device (Windows Hello, macOS/iOS Touch ID/Face ID, Android biometric passkey, smartphone QR hybrid passkey, or a USB FIDO2 security key).
- **Hosted CPU Validation (`PENDING`):** Local `workerd` does **not** enforce the 10 ms hosted CPU cap. Hosted staging verification on live `workers.dev` via `npm run cf:verify:cpu` + `wrangler tail` remains **`PENDING`** prior to production cutover.

---

## 2. Outbound Email Disabled by Default (`EMAIL_PROVIDER="disabled"`)

To remain 100% free of external SMTP or paid email APIs on Cloudflare Free, `wrangler.jsonc` sets `EMAIL_PROVIDER="disabled"`.

### Honest Runtime Behavior
- Email delivery jobs **never** report `Delivered` when `EMAIL_PROVIDER="disabled"`; `delivery_logs` strictly records `channel='email', status='Skipped'` with an explicit reason.
- Sensitive enrollment payloads (`redactSensitive: true`) are redacted **at enqueue time** (`[REDACTED — EMAIL_PROVIDER=disabled]`) so raw one-time tokens are never persisted in `background_jobs` or `audit_logs`.
- Administrators can both **issue** (`POST /api/users/:id/reset-token`, `POST /api/students/:studentId/reset-password`) and **explicitly revoke** (`POST /api/users/:id/revoke-reset-tokens`, `POST /api/students/:studentId/revoke-reset-tokens`) single-use passkey enrollment/recovery links directly in the portal UI.

### Workflows Operating in Manual / In-Portal Mode Without Outbound Email
1. **Passkey Enrollment & Lost-Device Recovery:** Admins generate a single-use 72-hour `/?enrollToken=...` link in the portal (or bootstrap CLI for initial admin) and share it securely out-of-band; unused links can be revoked immediately.
2. **Class Session & Fee Reminders:** Cron sweeps (`*/15 * * * *`) deliver **in-app portal notifications** (`channel='in_app', status='Delivered'`) while recording `channel='email', status='Skipped'`.
3. **Admission Confirmations:** Applicants receive confirmation IDs immediately on submission and status updates in-portal.

---

## 3. Cloudflare Free Resource Quotas & Verification Status

| Resource | Free Plan Ceiling | IGS Mitigation | Status |
| --- | --- | --- | --- |
| **Worker CPU Time** | 10 ms CPU/invocation | Zero password KDFs; native Web Crypto WebAuthn; pure-JS `pdf-lib` | Locally verified; **Hosted staging validation `PENDING`** |
| **Worker Requests** | 100,000 requests/day | Static SPA routes served directly by `env.ASSETS` (`run_worker_first: ["/api/*"]`) | Locally verified; **Hosted `PENDING`** |
| **Worker Script Size** | 3 MiB gzipped (Free) | `dist-worker/worker.js` stripped of scrypt/argon2/hash-wasm/Prisma/pg/PDFKit/Nodemailer/WASM (~512 KiB gzipped) | **`COMPLETED`** (`npm run cf:build` + `server/worker.test.ts`) |
| **Cloudflare D1** | 5M rows read/day, 100k rows written/day, 5 GB | Paginated queries, indexed lookups, 47 tables (`0001`–`0003`), atomic updates | Local D1 verified; **Hosted `PENDING`** |
| **Cloudflare R2** | 10 GB-month, 1M Class A ops, 10M Class B ops | Strict 2 MB cap, MIME checks, SHA-256 integrity, `private, no-store` | Local Miniflare R2 verified; **Hosted `PENDING`** |
| **Cloudflare Queues** | Subject to account Queues tier availability | Reference-only `{ jobId, jobType }` messages + idempotent `delivery_logs` guard + 15m Cron fallback | Local harness verified; **Hosted `PENDING`** |
| **Custom Domain / RP ID** | Currently `*.workers.dev` | Passkeys are bound to `rpId`; future custom domain cutover requires fresh enrollment links on the new domain | Documented |
