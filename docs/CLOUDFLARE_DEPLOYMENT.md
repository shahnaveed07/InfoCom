# IGS — InfoCom Global Services: Cloudflare Workers Deployment Guide

**Current Release Gate:** **`BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION`**

IGS runs natively as a **single-origin Cloudflare Worker** (`server/worker.ts`) serving both the Vite React SPA static assets (`./dist` via `env.ASSETS`) and all `/api/*` endpoints over **Cloudflare D1**, **R2**, **Queues**, **Cron Triggers**, and **Rate Limiting**.

> **Mandatory Pre-Deployment Gate:** Do **not** deploy to production on Cloudflare Workers Free for live password sign-in until an authentication path is approved and verified:
> - Measured strong `scrypt` (`N=16384, r=8, p=1`) takes **~61.6 ms CPU**, exceeding Workers Free's **10 ms CPU ceiling**.
> - **Path 1 (Workers Paid — $5/month):** Uses this exact codebase and `wrangler.jsonc` immediately under a 30-second CPU ceiling.
> - **Path 2 (Workers Free + Passkeys):** Requires approving, implementing, and live-benchmarking the first-party WebAuthn design in `docs/CLOUDFLARE_WEBAUTHN_DESIGN.md`.

---

## 1. One-Time Cloudflare Resource Provisioning (Operator Action Only)

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
2. Default `"EMAIL_PROVIDER": "disabled"` requires **no** SMTP or paid email API keys:
   - `delivery_logs` records `Skipped` (never `Delivered`) for email channel attempts.
   - Sensitive setup/reset token bodies are redacted before insertion into `background_jobs`.
   - In-app notifications and admin-issued (and explicitly revocable) single-use setup links operate without outbound email.
3. Optional future HTTP email secrets (never committed to git):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

---

## 3. Build, Migrate, and Deploy (Manual Operator Steps After Gate Approval)

```bash
# 1. Clean install & validate Cloudflare D1 target locally (Node.js >= 22.12)
npm ci
npm run db:generate
npm run lint
npm run test:unit
npm run build
npm run cf:types
npm run cf:build
npm run cf:d1:migrate:local
npm run test:cloudflare
npm run test:e2e:worker

# 2. Apply schema and idempotent reference seed to remote Cloudflare D1
npm run cf:d1:migrate:remote

# 3. Deploy single-origin Worker + Static Assets
npx wrangler deploy

# 4. Verify live readiness endpoint & hosted CPU timings (wrangler tail / Cloudflare Analytics)
curl -fsS https://igs-infocom-ams-worker.<your-subdomain>.workers.dev/api/health/ready
```

---

## 4. Initial Production Administrator Bootstrap

Do **not** run demo seeding (`scripts/d1-seed-demo.ts`) in production.
- **If deploying on Workers Paid (password auth):** Generate an `scrypt$16384$8$1$...` hash locally using `hashPasswordWorker()`, insert a single active `admin` row in remote D1 with `must_change_password = 1`, sign in immediately, and rotate the password.
- **If deploying on Workers Free after WebAuthn approval:** Follow the CLI bootstrap passkey enrollment ceremony specified in `docs/CLOUDFLARE_WEBAUTHN_DESIGN.md` §6.1.
