# IGS — Cloudflare Environment & Bindings Matrix

All secrets must be stored in Cloudflare Dashboard / `wrangler secret put` or your Node host secret manager — never committed to `.env.example`, `wrangler.jsonc`, or Git.

---

## 1. Frontend Build-Time Variables (Cloudflare Pages)

| Variable | Example Value | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://api.yourdomain.example` | Target API origin when SPA is hosted separately on Cloudflare Pages |
| `VITE_PUBLIC_DATA_MODE` | `auto` | `auto` (API-first + fallback), `api`, or `demo` |
| `VITE_ENABLE_PUBLIC_DEMO_FALLBACK` | `true` | Keeps public pages browsable offline while backend is starting or unreachable |

---

## 2. External Node.js API Runtime Variables

| Variable | Default / Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | Direct PostgreSQL URI (Node backend) |
| `SESSION_SECRET` | Required (32+ chars) | Cookie & token cryptographic secret |
| `APP_URL` | Required in Prod | Canonical frontend URL used for onboarding links & certificate QR URLs |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated allowlisted Pages/custom frontend origins |
| `CORS_CROSS_SITE_COOKIES` | `false` | Set `true` only when SPA & API run on distinct HTTPS origins (`SameSite=None; Secure`) |
| `STORAGE_PROVIDER` | `local` \| `s3` \| `r2` | Private upload storage backend (`s3` works with R2 S3-compatible API on Node) |
| `EMAIL_PROVIDER` | `auto` \| `http` \| `smtp` | Selects HTTP (`RESEND_API_KEY`/`EMAIL_HTTP_URL`) or Node `nodemailer` SMTP |
| `EMAIL_FROM` | Optional | Verified sender identity for HTTP email delivery |
| `RESEND_API_KEY` | Optional secret | Bearer token for Resend HTTP email transport (`POST https://api.resend.com/emails`) |

---

## 3. Cloudflare Worker Bindings (`wrangler.jsonc`)

| Binding Name | Type | Purpose |
| --- | --- | --- |
| `HYPERDRIVE` | Hyperdrive | Connection pooler + smart routing to PostgreSQL for `server/worker.ts` |
| `DOCUMENTS_BUCKET` | R2 Bucket | Private object storage (`igs-private-documents`, non-public, SHA-256 verified) |
| `JOBS_QUEUE` | Queue (Producer & Consumer) | Background email dispatch (`{ jobId, jobType }` reference only; no tokens queued) |
| `AUTH_RATE_LIMITER` | Rate Limit | Distributed rate limiting for `/api/auth/*` (10 req / 60s) |
| `PUBLIC_RATE_LIMITER` | Rate Limit | Distributed rate limiting for `/api/public/*` (30 req / 60s) |
| `triggers.crons` | Cron (`*/15 * * * *`) | Stale job recovery, session/fee reminders, and expired session/reset token cleanup |
