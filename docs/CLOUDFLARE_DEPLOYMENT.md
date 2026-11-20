# IGS — InfoCom Global Services: Cloudflare Workers Deployment Guide

**Code & Local Validation Status:** **`COMPLETED` (First-Party WebAuthn Passkeys + 47-Table D1 + R2 + Assets + Queues + Cron)**  
**Hosted Staging 10 ms CPU Validation Gate:** **`PENDING` (Required Before Production Cutover)**

IGS runs natively as a **single-origin Cloudflare Worker** (`server/worker.ts`) serving both the Vite React SPA static assets (`./dist` via `env.ASSETS`) and all `/api/*` endpoints over **Cloudflare D1**, **R2**, **Queues**, **Cron Triggers**, **Rate Limiting**, and **First-Party WebAuthn Passkeys (`AUTH_MODE="webauthn"`)**.

---

## 1. One-Time Cloudflare Resource Provisioning (Manual Operator Steps)

> Do **not** commit real Cloudflare D1 database IDs, account IDs, or personal `workers.dev` subdomains into shared repository templates until configuring your deployment environment.

```bash
# 1. Create Cloudflare D1 Database
npx wrangler d1 create igs-infocom-db
# Replace "REPLACE_WITH_D1_DATABASE_ID" in wrangler.jsonc with your D1 UUID

# 2. Create Private R2 Bucket (keep public access DISABLED)
npx wrangler r2 bucket create igs-private-documents

# 3. Create Background Job Queue & Dead-Letter Queue
npx wrangler queues create igs-ams-jobs
npx wrangler queues create igs-ams-jobs-dlq
```

---

## 2. Configure Origin & Environment Variables (`wrangler.jsonc`)

1. Set your real Cloudflare `workers.dev` origin in `wrangler.jsonc`:
   - `"AUTH_MODE": "webauthn"` (already set)
   - `"APP_URL": "https://igs-infocom-ams-worker.<your-subdomain>.workers.dev"`
   - `"CORS_ALLOWED_ORIGINS": "https://igs-infocom-ams-worker.<your-subdomain>.workers.dev"`
   - `"EMAIL_PROVIDER": "disabled"` (zero external SMTP or paid email APIs required)
2. Optional future HTTP email secrets (never committed to git):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

---

## 3. Pre-Deploy Local Verification (Node.js >= 22.12)

```bash
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
```

---

## 4. Deploy to Staging & Bootstrap First Administrator

```bash
# 1. Apply migrations 0001, 0002, and 0003 (47 tables) to remote D1
npm run cf:d1:migrate:remote

# 2. Deploy Worker + Static Assets
npx wrangler deploy

# 3. Bootstrap the inaugural Administrator (refuses to overwrite existing admins)
npm run cf:admin:bootstrap -- \
  --remote \
  --database igs-infocom-db \
  --email director@infocomglobal.edu \
  --name "IGS Director" \
  --app-url https://igs-infocom-ams-worker.<your-subdomain>.workers.dev
```

Open the printed one-time `/login?enrollToken=...` URL immediately (15-minute TTL) in your browser to register your primary administrator passkey, then open **Security & Passkeys** in the sidebar to register a second backup passkey.

Do **not** run demo seeding (`scripts/d1-seed-demo.ts`) in production.

---

## 5. Mandatory Hosted Cloudflare Free 10 ms CPU Verification (Before Production Cutover)

```bash
# 1. Run staging endpoint latency probe & print cutover checklist
npm run cf:verify:cpu -- --url https://igs-infocom-ams-worker.<your-subdomain>.workers.dev

# 2. Stream live Worker telemetry during passkey enrollment, login, and PDF downloads
npx wrangler tail igs-infocom-ams-worker --format=pretty
```

Confirm in Cloudflare Dashboard Workers Analytics & `wrangler tail`:
- **Zero** `exceededCpu` / Error 1102 exceptions across `POST /api/auth/webauthn/register/verify`, `POST /api/auth/webauthn/login/verify`, `GET /api/certificates/:id/download`, and `GET /api/reports/financial-collections?format=pdf`.
- Workers CPU Time p99 stays strictly below **10 ms**.
- Cron trigger (`*/15 * * * *`) and Queue consumer (`igs-ams-jobs`) execute cleanly.
