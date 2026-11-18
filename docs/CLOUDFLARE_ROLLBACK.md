# IGS — Cloudflare Rollback & Recovery Playbook

Because all legacy Node/Express/PostgreSQL modules (`server/app.ts`, `server/db/prisma.ts`, `prisma/schema.prisma`, `server/routes/*`) were preserved cleanly alongside the Cloudflare D1 Worker stack (`server/worker.ts`, `server/d1/*`, `migrations/`), operators retain two straightforward rollback paths.

---

## 1. Roll Back a Cloudflare Worker Deployment

1. List recent Worker releases:
   ```bash
   npx wrangler deployments list
   ```
2. Roll back immediately to the previous healthy release:
   ```bash
   npx wrangler rollback
   ```
3. To pause background Cron or Queue processing safely without altering D1 data:
   - Remove/comment `"triggers"` or queue consumer entries in `wrangler.jsonc` and redeploy. Pending rows remain intact in `background_jobs`.

---

## 2. Database Recovery on Cloudflare D1

- Cloudflare D1 supports Time Travel point-in-time recovery (`npx wrangler d1 time-travel restore igs-infocom-db --timestamp="..."`) before any manual hotfix or migration.
- Never apply destructive `DROP TABLE` statements manually; write additive SQL migrations in `migrations/`.

---

## 3. Revert Storage or Email Behavior

- **Email Transport:** Reset `EMAIL_PROVIDER="disabled"` in `wrangler.jsonc` or dashboard vars if any external webhook/Resend endpoint becomes unavailable. All notifications remain preserved in `notifications` and `delivery_logs` (`Skipped`).
- **R2 Private Bucket:** Objects are keyed uniquely with SHA-256 checksums and `storage_provider = 'r2'`; avoid deleting buckets during rollback.

---

## 4. Fallback to Node.js + Express + PostgreSQL Hosting (If Required)

If Workers Free 10 ms CPU limits block user password authentication before upgrading to Workers Paid:
1. Build and boot the preserved Node backend (`npm run build && npm run build:server && NODE_ENV=production npm start`) backed by PostgreSQL (`prisma/schema.prisma`).
2. Both runtimes share identical API schemas (`/api/*`), React frontend (`src/`), RBAC policies, and business rules (`src/shared/*`).
