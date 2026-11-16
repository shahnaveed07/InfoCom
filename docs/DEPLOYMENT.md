# InfoCom AMS — Deployment & Operations Guide

## 1. Environment Variables (`.env.example`)

Configure runtime environment variables cleanly without committing secrets:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` or `SQL_HOST` + `SQL_DB_NAME` + `SQL_USER` + `SQL_PASSWORD` | Yes | PostgreSQL runtime connection (Cloud SQL Unix socket in GCP or standard URI) |
| `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` | Migrations only | Least-privilege split for Prisma CLI DDL migrations |
| `SESSION_SECRET` | Recommended in Prod | Secret entropy override if used by signing helpers |
| `ADMIN_BOOTSTRAP_SECRET` | Multi-admin CLI | Required when running `npm run admin:bootstrap -- --allow-additional` after first admin exists |
| `APP_URL` | Yes in Prod | Public canonical URL used for CORS allowlist, CSRF origin validation, and reset/verification links |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated extra allowed origins |
| `PORT` | Optional | HTTP listening port (`Number(process.env.PORT) || 3000`) |
| `NODE_ENV` | `production` / `development` | Switches Vite dev middleware vs. static `dist/` serving and `Secure` cookie enforcement |
| `STORAGE_PROVIDER` | Optional | Private document storage driver: `local` (default, uses `STORAGE_LOCAL_DIR`) or `s3` (`STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`, credentials) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional | Enables transactional email notifications and onboarding/reset links via `nodemailer` |
| `ALLOW_DEMO_SEED` | Dev only | Must be `"true"` (with `NODE_ENV=development`) to run `npm run db:seed:demo` |

---

## 2. Production Deployment Sequence

```bash
# 1. Install production + build dependencies
npm ci

# 2. Generate Prisma Client & deploy pending schema migrations (forward-only)
npm run db:generate
npm run db:migrate:deploy

# 3. Seed mandatory system roles & academy structure (production-safe, no demo users)
NODE_ENV=production npm run db:seed

# 4. Build frontend SPA (dist/), compiled Express server (dist-server/server.js), and validate TypeScript
npm run lint
npm run build
npm run build:server

# 5. Bootstrap initial Admin account (once on fresh instance)
npm run admin:bootstrap -- --email "admin@yourdomain.example" --name "Academy Director"

# 6. Start the production server
NODE_ENV=production npm start
```

---

## 3. Operational Notes

- `npm start` runs `node dist-server/server.js`, compiled by `npm run build:server` (`esbuild`).
- Always run a PostgreSQL `pg_dump` snapshot prior to deploying migrations (`docs/DATABASE_OPERATIONS.md`).

