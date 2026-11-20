# IGS — Cloudflare Rollback & Recovery Playbook

Because the legacy Node/Express/PostgreSQL runtime (`server/app.ts`, `server/routes/auth.routes.ts`, `server/db/prisma.ts`, `prisma/schema.prisma`) and existing `users.password_hash` records are preserved untouched alongside the Cloudflare Workers + D1 + WebAuthn stack (`server/worker.ts`, `server/worker-routes/webauthn.ts`, `server/d1/*`, `migrations/`), operators have clean rollback and recovery options.

---

## 1. Roll Back a Cloudflare Worker Deployment

1. Inspect recent Worker releases:
   ```bash
   npx wrangler deployments list
   ```
2. Roll back immediately to the previous healthy release:
   ```bash
   npx wrangler rollback
   ```
3. Pause background Cron or Queue processing safely without altering D1 data by removing/commenting `"triggers"` or queue consumer entries in `wrangler.jsonc` and redeploying. Pending rows remain intact in `background_jobs`.

---

## 2. Passkey Lockout & Administrator Recovery (Zero Email Required)

- **Single User Lost All Passkeys:**
  1. Verify user identity through institutional office protocol.
  2. An active IGS Administrator opens **User Accounts -> Passkeys**, revokes lost passkeys (which immediately invalidates all active sessions for that user), and clicks **Enroll Link** to issue a single-use 72-hour `/?enrollToken=...` URL.
  3. If a link is misdirected, click **Revoke Link** immediately.
- **Last Administrator Locked Out:**
  1. Operator with remote Cloudflare Wrangler CLI access runs:
     ```bash
     npm run cf:admin:bootstrap -- \
       --remote \
       --allow-existing-enrollment \
       --database igs-infocom-db \
       --email <admin-email> \
       --app-url https://igs-infocom-ams-worker.<your-subdomain>.workers.dev
     ```
  2. Open the printed 15-minute single-use URL immediately and enroll a fresh passkey (plus a backup passkey in **Security & Passkeys**).

---

## 3. Database Recovery on Cloudflare D1

- Use Cloudflare D1 Time Travel for point-in-time recovery before any manual hotfix or migration:
  ```bash
  npx wrangler d1 time-travel restore igs-infocom-db --timestamp="<ISO-8601-UTC>"
  ```
- Migrations `0001`–`0003` are strictly additive. Never execute destructive `DROP TABLE` statements manually.

---

## 4. Fallback to Legacy Node.js + Express + PostgreSQL Hosting

If the institute ever needs to return to traditional password-based hosting:
1. All legacy `users.password_hash` hashes (`Argon2id` / `scrypt`) remain untouched; zero user accounts were dropped.
2. Build and start the preserved Node backend backed by PostgreSQL:
   ```bash
   npm run build && npm run build:server
   NODE_ENV=production npm start
   ```
3. `GET /api/auth/config` on the Express server automatically reports `authMode: "password"`, switching the React SPA back to standard email + password login with zero frontend code changes.
