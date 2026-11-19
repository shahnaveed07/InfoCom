# IGS — Cloudflare Free Tier Limitations & Architectural Boundaries

While all API routes, all 45 D1 tables, pure-JS PDF generation, R2 private storage, Queues, Cron triggers, and Static Assets have been migrated to Cloudflare-native Worker code without external hosting, **Cloudflare Workers Free tier imposes hard runtime and feature limits** that govern production readiness.

---

## 1. Critical Blocker: 10 ms CPU Limit vs Password Hashing (`BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION`)

- **Cloudflare Workers Free Plan:** Hard **10 ms CPU time** cap per HTTP request invocation.
- **Measured IGS Password KDF Timings:**
  - `scrypt` (`N=16384, r=8, p=1`, 64-byte key, `server/worker-auth.ts`): **61.54 ms** hash / **61.60 ms** verify.
  - Argon2id WASM (`m=19456, t=2, p=1`, `hash-wasm`): **103.83 ms** hash / **91.80 ms** verify (plus WebAssembly codegen restrictions in production Workers).
- **Security Policy:** Work factors are **never** weakened below OWASP baselines (`N=16384` floor for scrypt; SHA-256 substitution is forbidden).
- **Local vs Hosted Runtime Warning:** Local `wrangler dev` / `unstable_dev` (`workerd`) does **not** enforce the hosted 10 ms CPU termination limit. Local login tests passing do not certify hosted Workers Free execution.
- **Resolution Paths (Requires Explicit Approval):**
  1. **Workers Paid ($5/month):** 30-second default CPU limit unblocks password auth with zero code changes.
  2. **First-Party WebAuthn / Passkeys (`docs/CLOUDFLARE_WEBAUTHN_DESIGN.md`):** Asymmetric Web Crypto verification (~1–2 ms CPU) — requires institutional approval, implementation, and hosted Cloudflare Free CPU benchmarking.

---

## 2. Outbound Email Disabled by Default (`EMAIL_PROVIDER="disabled"`)

To remain 100% free of external SMTP or paid email APIs on Cloudflare Free, `wrangler.jsonc` sets `EMAIL_PROVIDER="disabled"`.

### Honest Runtime Behavior
- Email delivery jobs **never** report `Delivered` when `EMAIL_PROVIDER="disabled"`; `delivery_logs` strictly records `channel='email', status='Skipped'` with an explicit reason.
- Sensitive onboarding/reset payloads (`redactSensitive: true`) are redacted **at enqueue time** (`[REDACTED — EMAIL_PROVIDER=disabled]`) so raw one-time tokens are never persisted in `background_jobs` or `audit_logs`.
- Administrators can both **issue** (`POST /api/users/:id/reset-token`, `POST /api/students/:studentId/reset-password`) and **explicitly revoke** (`POST /api/users/:id/revoke-reset-tokens`, `POST /api/students/:studentId/revoke-reset-tokens`) single-use onboarding/reset links directly in the portal UI.

### Workflows Requiring Future Outbound Email Capability
Until an external HTTP email provider (`EMAIL_PROVIDER="http"` / Resend + `EMAIL_FROM`) is approved and configured, the following workflows operate in manual/in-portal mode rather than sending external emails:
1. **Self-Service Forgot Password (`/api/auth/forgot-password`):** Safely logs `Skipped` without sending email; users must obtain a single-use link from an IGS Administrator.
2. **Automated Onboarding Link Emails:** New user/student/admission-approved accounts generate single-use setup URLs shown once to the administrator to share securely instead of emailing automatically.
3. **Automated Class Session & Fee Due Reminder Emails:** Cron sweeps (`*/15 * * * *`) deliver **in-app portal notifications** (`channel='in_app', status='Delivered'`) while recording `channel='email', status='Skipped'`.
4. **Admission Confirmation / Decision Emails:** Applicants see confirmation IDs immediately on submission and in-portal status updates; external applicant emails require an outbound email provider.

---

## 3. Cloudflare Free Resource Quotas & Mitigations

| Resource | Free Plan Ceiling | IGS Mitigation | Verification Status |
| --- | --- | --- | --- |
| **Worker Requests** | 100,000 requests/day | Static SPA routes served directly by `env.ASSETS` (`run_worker_first: ["/api/*"]`) | Verified locally; not yet live-benchmarked |
| **Worker Script Size** | 3 MiB gzipped (Free) | `dist-worker/worker.js` stripped of Prisma/WASM/PDFKit/Nodemailer (~501 KiB gzipped) | Verified via `npm run cf:build` |
| **Cloudflare D1** | 5M rows read/day, 100k rows written/day, 5 GB | Paginated queries, indexed lookups, atomic `db.batch()` statements | Verified in local D1 (`45` tables); not yet hosted |
| **Cloudflare R2** | 10 GB-month, 1M Class A ops, 10M Class B ops | Strict 2 MB document cap, MIME checks, SHA-256 integrity, `private, no-store` | Verified in local Miniflare R2; not yet hosted |
| **Cloudflare Queues** | Subject to Cloudflare account Queues tier availability | Reference-only `{ jobId, jobType }` messages + 15m Cron fallback processing `Pending` D1 rows | Verified in unit/harness tests; confirm account entitlement before deploy |
| **Legacy `$argon2` Accounts** | No native N-API in V8 Workers | Returns HTTP `501 ARGON2_REHASH_REQUIRED` prompting single-use reset or future passkey enrollment | Verified in `cloudflare-d1.worker.test.ts` |
