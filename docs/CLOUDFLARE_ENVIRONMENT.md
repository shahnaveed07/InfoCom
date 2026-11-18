# IGS — Cloudflare Environment & Bindings Matrix

Never store secrets, database credentials, API keys, or demo passwords in `.env.example`, `wrangler.jsonc`, or Git. Production secrets belong exclusively in `wrangler secret put` or Cloudflare Dashboard Secrets.

---

## 1. Cloudflare Worker Bindings (`wrangler.jsonc`)

| Binding / Config | Type | Resource / Target | Purpose |
| --- | --- | --- | --- |
| `ASSETS` | Static Assets Fetcher | `./dist` (`not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`) | Serves React SPA directly and delegates deep links to `index.html` while routing `/api/*` first to Worker |
| `DB` | Cloudflare D1 Database | `igs-infocom-db` (`migrations/`) | Primary relational database for identity, admissions, academics, finance, certificates, jobs, audit |
| `DOCUMENTS_BUCKET` | Cloudflare R2 Bucket | `igs-private-documents` | Private non-public document storage (2 MB max, MIME-checked, SHA-256 verified) |
| `JOBS_QUEUE` | Cloudflare Queue | `igs-ams-jobs` + `igs-ams-jobs-dlq` | Asynchronous email/notification job dispatch & retry handling |
| `AUTH_RATE_LIMITER` | Cloudflare Rate Limit | Namespace `1001` (`10 req / 60s`) | Edge brute-force protection for `/api/auth/login`, `forgot-password`, `reset-password`, `change-password`, `register` |
| `PUBLIC_RATE_LIMITER` | Cloudflare Rate Limit | Namespace `1002` (`30 req / 60s`) | Rate limiting for `/api/public/*`, `/api/admissions/public*`, `/api/certificates/verify/*` |
| `triggers.crons` | Cron Trigger | `*/15 * * * *` | Stale job lease recovery, 24h session reminders, fee due reminders, expired token/session purge |

---

## 2. Worker Environment Variables & Secrets

| Variable | Default (`wrangler.jsonc`) | Classification | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | Var | Enforces `is_demo = 0` filtering on public catalog routes |
| `APP_URL` | `https://igs-infocom-ams-worker.<your-subdomain>.workers.dev` | Var | Canonical origin for CORS, CSRF host check, onboarding URLs, and certificate QR verification |
| `CORS_ALLOWED_ORIGINS` | Matches `APP_URL` | Var | Comma-separated allowlisted origins permitted credentialed API requests |
| `CORS_CROSS_SITE_COOKIES` | `false` | Var | Keep `false` (`SameSite=Lax; HttpOnly`) in single-origin Worker deployment |
| `STORAGE_PROVIDER` | `r2` | Var | Selects Cloudflare R2 private document storage |
| `EMAIL_PROVIDER` | `disabled` | Var | `"disabled"` logs `Skipped` in `delivery_logs` cleanly; `"http"` uses optional fetch webhook or Resend |
| `LOG_OPERATIONAL_METRICS` | `false` | Var | Emits structured telemetry warnings whenever requests approach `>= 8 ms` CPU |
| `EMAIL_FROM` | Unset | Secret (optional) | Sender address if HTTP email is later enabled |
| `EMAIL_HTTP_URL` / `RESEND_API_KEY` | Unset | Secret (optional) | Endpoint / bearer key for HTTP email API transport |

---

## 3. Local Development & Demo Seeding Variables (`.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_PUBLIC_DATA_MODE` | `auto` | `auto` (API-first with fallback), `api`, or `demo` |
| `VITE_ENABLE_PUBLIC_DEMO_FALLBACK` | `true` | Keeps public catalog pages browsable when offline |
| `ALLOW_DEMO_SEED` | `false` | Must remain `false` in production |
| `SEED_ADMIN_PASSWORD`, `SEED_INSTRUCTOR_PASSWORD`, `SEED_STUDENT_PASSWORD` | Unset | Required (`>= 10` chars) only when explicitly invoking `npm run cf:seed:demo:local` |
