# IGS — InfoCom Global Services: Cloudflare Workers Deployment Guide

IGS runs natively as a **single-origin Cloudflare Worker** (`server/worker.ts`) serving both the Vite React SPA static assets (`./dist` via `env.ASSETS`) and all `/api/*` endpoints over **Cloudflare D1**, **R2**, **Queues**, **Cron Triggers**, and **Rate Limiting**.

> **Important Prerequisite Check:** Review `docs/CLOUDFLARE_MIGRATION_AUDIT.md` before deploying to Cloudflare's free tier. Strong `scrypt` (`N=16384, r=8, p=1`) password hashing exceeds Workers Free's 10 ms CPU ceiling (~61.6 ms measured). Production password login requires upgrading to **Workers Paid ($5/month)** or implementing passkey/OIDC authentication.

---

## 1. One-Time Cloudflare Resource Provisioning

```bash
# 1. Create Cloudflare D1 Database
npx wrangler d1 create igs-infocom-db
# Update "database_id" in wrangler.jsonc with the output UUID

# 2. Create Private R2 Bucket (do NOT enable public bucket access)
npx wrangler r2 bucket create igs-private-documents

# 3. Create Background Job Queue & Dead-Letter Queue
npx wrangler queues create igs-ams-jobs
npx wrangler queues create igs-ams-jobs-dlq
```

---

## 2. Configure Origin & Optional Secrets

1. In `wrangler.jsonc`, replace:
   - `REPLACE_WITH_D1_DATABASE_ID` with your D1 `database_id`
   - `APP_URL` & `CORS_ALLOWED_ORIGINS` with your assigned `https://igs-infocom-ams-worker.<your-subdomain>.workers.dev` URL
2. Default `"EMAIL_PROVIDER": "disabled"` requires **no** SMTP or paid email API keys; all system/onboarding notifications log cleanly in `delivery_logs` (`Skipped`) while in-app alerts and admin-issued setup links remain fully functional.
3. Optional HTTP email secrets (never committed to git):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

---

## 3. Build, Migrate, and Deploy (Manual Operator Steps)

```bash
# 1. Build frontend SPA + validate types + verify dry-run Worker bundle
npm run build
npm run cf:types
npm run lint
npm run cf:build

# 2. Apply schema and reference seed to remote D1
npm run cf:d1:migrate:remote

# 3. Deploy single-origin Worker + Static Assets
npx wrangler deploy

# 4. Verify live readiness endpoint
curl -fsS https://igs-infocom-ams-worker.<your-subdomain>.workers.dev/api/health/ready
```

---

## 4. Initial Production Administrator Bootstrap

Do **not** run demo seeding (`d1-seed-demo.ts`) in production. Provision the inaugural administrator directly in remote D1 or via a one-time reset token generated against a scrypt-hashed bootstrap account:
- Generate an `scrypt$16384$8$1$...` password hash locally using `hashPasswordWorker()` from `server/worker-auth.ts`.
- Insert the single active admin user row into `users` with `must_change_password = 1`, sign in immediately, and rotate the password.
