# IGS — InfoCom Global Services: Cloudflare Free Tier Deployment Guide

Because IGS AMS preserves **OWASP Argon2id (`m=19456, t=2, p=1`)**, **Express 4**, and **PDFKit** certificate generation, the verified Cloudflare Free architecture uses **Cloudflare Pages** for the frontend SPA paired with the **external Node.js Express backend (`dist-server/server.js`)**, plus an optional **Cloudflare Worker (`server/worker.ts`)** for edge Cron/Queues, R2 private document storage, and Hyperdrive-accelerated public read endpoints.

---

## 1. Frontend Deployment on Cloudflare Pages

1. Build the static frontend:
   ```bash
   VITE_API_BASE_URL="https://api.yourdomain.example" \
   VITE_PUBLIC_DATA_MODE="auto" \
   VITE_ENABLE_PUBLIC_DEMO_FALLBACK="true" \
   npm run build
   ```
2. Verify `dist/` output includes:
   - `dist/index.html`
   - `dist/_redirects` (`/* /index.html 200` for SPA deep links)
   - `dist/_headers` (omits `X-Frame-Options` for iframe previews, applies `no-cache` to HTML and `immutable` caching to `/assets/*`)
3. Deploy `dist/` to Cloudflare Pages (via Dashboard Git integration or `npx wrangler pages deploy dist --project-name igs-infocom`).

---

## 2. External Node.js API Backend Configuration

Host `dist-server/server.js` on your Node.js 20+ runtime (`npm run build:server && NODE_ENV=production npm start`) backed by PostgreSQL:

- Set `APP_URL` to your frontend Pages URL (e.g., `https://igs-infocom.pages.dev` or `https://portal.yourdomain.example`).
- Set `CORS_ALLOWED_ORIGINS="https://igs-infocom.pages.dev"`.
- If the Pages frontend and Node API are on **different HTTPS origins** (e.g., `*.pages.dev` + `api.yourdomain.example`), set:
  ```env
  CORS_CROSS_SITE_COOKIES="true"
  ```
  If hosted under the **same parent domain** (e.g., `app.yourdomain.example` + `api.yourdomain.example` with a shared root cookie domain or reverse proxy), keep `CORS_CROSS_SITE_COOKIES="false"` so `SameSite=Lax` holds cleanly.
- Optionally configure R2 S3-compatible endpoint vars (`STORAGE_PROVIDER="s3"`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, credentials) so both Node and Worker share the same private Cloudflare R2 bucket.

---

## 3. Optional Edge Worker (`server/worker.ts`) Provisioning

1. Create Cloudflare resources (one-time per account):
   ```bash
   npx wrangler hyperdrive create igs-postgres --connection-string="postgresql://USER:PASSWORD@HOST:5432/DB"
   npx wrangler r2 bucket create igs-private-documents
   npx wrangler queues create igs-ams-jobs
   npx wrangler queues create igs-ams-jobs-dlq
   ```
2. Update `wrangler.jsonc` with your real Hyperdrive ID (`REPLACE_WITH_HYPERDRIVE_CONFIG_ID`). Never commit PostgreSQL credentials or API secrets to `wrangler.jsonc`.
3. Configure Worker secrets securely via Wrangler:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```
4. Validate bundle and types before deploying:
   ```bash
   npm run cf:types
   npm run cf:build
   ```
5. Deploy Worker:
   ```bash
   npx wrangler deploy
   ```
