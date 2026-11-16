# InfoCom AMS — Deployment & Operations Guide

## 1. Environment Variables (`.env.example`)

Configure runtime environment variables cleanly without committing secrets:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` or `SQL_HOST` + `SQL_DB_NAME` + `SQL_USER` + `SQL_PASSWORD` | Yes | PostgreSQL runtime connection (Cloud SQL Unix socket in GCP or standard URI) |
| `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` | Migrations only | Least-privilege split for Prisma CLI DDL migrations |
| `SESSION_SECRET` | Recommended in Prod | Cryptographic entropy secret (32+ bytes) |
| `ADMIN_BOOTSTRAP_SECRET` | Multi-admin CLI | Required when running `npm run admin:bootstrap -- --allow-additional` after first admin exists |
| `APP_URL` | Yes in Prod | Public canonical URL used for CORS allowlist, CSRF origin validation, onboarding/reset links, and QR certificate verification |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated extra allowed origins (checked by both CORS and CSRF origin guards) |
| `CORS_CROSS_SITE_COOKIES` | Optional | Set `true` only if frontend and API are deployed on separate HTTPS origins requiring `SameSite=None; Secure` cookies (default `false`) |
| `VITE_API_BASE_URL` | Optional (Build-time) | Optional base URL (e.g. `https://api.example.com`) when static frontend is decoupled from Express `/api/*`; defaults to same-origin relative `/api/*` |
| `VITE_PUBLIC_DATA_MODE` | Optional (Build-time) | `auto` (default, API-first with demo fallback on outage), `demo`, or `api` |
| `VITE_ENABLE_PUBLIC_DEMO_FALLBACK` | Optional (Build-time) | `true` (default) or `false` to toggle automatic fallback in `auto` mode |
| `PORT` | Optional | HTTP listening port (`Number(process.env.PORT) || 3000`) |
| `NODE_ENV` | `production` / `development` | Switches Vite dev middleware vs. static `dist/` serving, `Secure` cookie flag, and hides `isDemo` courses in public endpoints |
| `STORAGE_PROVIDER` | Optional | Private document storage driver: `local` (default, uses `STORAGE_LOCAL_DIR`) or `s3` (`STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`, credentials) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional | Enables transactional email notifications and onboarding/reset delivery via `nodemailer` (`npm run email:verify` verifies reachability) |
| `ALLOW_DEMO_SEED`, `SEED_*_PASSWORD` | Dev only | Demo seed requires `NODE_ENV=development` and `ALLOW_DEMO_SEED=true`; uses configured env passwords or generates ephemeral secrets |

---

## 2. Production Deployment Sequence

```bash
# 1. Install dependencies reproducibly from package-lock.json
npm ci

# 2. Generate Prisma Client & deploy pending schema migrations (forward-only)
npm run db:generate
npm run db:migrate:deploy

# 3. Seed mandatory system roles & official IGS metadata (production-safe, zero demo users)
NODE_ENV=production npm run db:seed

# 4. Migrate any legacy Base64 documents into private storage (dry-run first)
npm run db:migrate-documents -- --dry-run
npm run db:migrate-documents

# 5. Verify SMTP transport readiness (pass --strict in environments requiring live email)
npm run email:verify

# 6. Build frontend SPA (dist/), compiled Express server (dist-server/server.js), and validate TypeScript
npm run lint
npm run build
npm run build:server

# 7. Bootstrap initial Admin account (once on fresh instance)
npm run admin:bootstrap -- --email "admin@yourdomain.example" --name "Academy Director"

# 8. Start the compiled production server
NODE_ENV=production npm start
```

---

## 3. Operational Notes

- `npm start` runs `node dist-server/server.js`, compiled by `npm run build:server` (`esbuild`).
- Always run a combined PostgreSQL (`pg_dump`) + private storage snapshot prior to deploying migrations (`docs/DATABASE_OPERATIONS.md`).
- When SMTP env vars are unset, transactional email jobs safely fall back to `DeliveryLog` status `Skipped` without breaking workflows.
