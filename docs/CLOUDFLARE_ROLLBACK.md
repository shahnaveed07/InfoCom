# IGS — Cloudflare Rollback & Recovery Playbook

All Cloudflare Free tier changes preserve PostgreSQL schema integrity (`prisma/schema.prisma`) with zero destructive database migrations and zero changes to existing Argon2id hashes or session records.

---

## 1. Rollback Scenarios

### A. Roll Back Cloudflare Pages Frontend
1. Open **Cloudflare Dashboard -> Workers & Pages -> `igs-infocom` -> Deployments**.
2. Select the last verified green deployment and click **Rollback to this deployment** (instant edge cutover).

### B. Roll Back Edge Worker (`server/worker.ts`)
1. Inspect recent Worker deployments:
   ```bash
   npx wrangler deployments list
   ```
2. Revert to the previous stable version:
   ```bash
   npx wrangler rollback
   ```
3. To disable Cron/Queue consumption cleanly without touching PostgreSQL data:
   - Comment or remove `"triggers"` / queue consumers in `wrangler.jsonc` and redeploy; PostgreSQL `background_jobs` rows continue being processed safely by the Node worker (`npm run worker` or `ENABLE_BACKGROUND_WORKER="true"`).

### C. Revert Storage or Email Adapter
- **Storage:** Set `STORAGE_PROVIDER="s3"` (with R2 S3 credentials) or `STORAGE_PROVIDER="local"` on the Node server. Existing R2-stored rows (`storage_provider = 'r2'`) remain readable via S3-compatible R2 keys or R2 Worker binding.
- **Email:** Switch `EMAIL_PROVIDER="smtp"` (with `SMTP_*` env vars) or unset HTTP keys; any unconfigured emails log safely as `Skipped` in `DeliveryLog` with zero request crashes.

### D. Full Fallback to Single-Origin Node Hosting
1. Point DNS / reverse proxy traffic directly back to the Express Node server (`NODE_ENV=production npm start` serving both `dist/` and `/api/*` on port 3000).
2. Set `CORS_CROSS_SITE_COOKIES="false"` if serving frontend and API from the same origin again (`SameSite=Lax`).
3. Ensure `ENABLE_BACKGROUND_WORKER="true"` (or run `npm run worker` separately) so PostgreSQL `FOR UPDATE SKIP LOCKED` handles all queued jobs without Cloudflare Queues.
