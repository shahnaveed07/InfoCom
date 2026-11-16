# InfoCom AMS — Resolved Gaps & Operational Notes

All architectural, security, branding, and operational gaps identified during earlier audits have been resolved:

- **Official Branding & Assets:** Official logo (`public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg`), `IGS — InfoCom Global Services` Sopore address, slogan `"Learn Today, Build Tomorrow."`, `INR` formatting, and `igs_session` cookies are active across UI, API, and PDF certificates.
- **Single-Stack Database & Auth:** Legacy ORM/SSO stacks have been completely removed; PostgreSQL + Prisma ORM and first-party `Argon2id` + SHA-256 `AuthSession` storage are the sole runtime layers.
- **Registration & Onboarding:** `POST /api/auth/register` returns `410 Gone`. Admins provision students/faculty and issue single-use onboarding/reset links (`/login?setupToken=...`).
- **Enrollment History & Academic Operations:** `GET /api/enrollments/:id/history` returns `{ enrollment, history }` cleanly; multi-type assessments, bulk attendance with excused status, and configurable passing/attendance thresholds are live.
- **Finance & Private Storage:** Fee plans, structures, discounts, scholarships, refunds, receipts, private storage (`STORAGE_PROVIDER=local|s3`), and `npm run db:migrate-documents` are active.
- **Background Email & CI:** `BackgroundJob` queues transactional email notifications for admissions, onboarding, password resets, class reminders, attendance alerts, fee invoices/reminders, and payment receipts; `npm ci` runs reproducibly against `package-lock.json` and CI executes Playwright browser E2E (`npm run test:e2e`).
- **404 Stabilization, Readiness & Public Demo Fallback:** `GET /api/health`, `GET /api/health/ready`, terminal `/api/*` JSON `404` handling, Vite ES image imports, `VITE_API_BASE_URL` support, and API-first `DEMO PREVIEW` fallback (`docs/404_ROOT_CAUSE.md`, `docs/PUBLIC_DEMO_FALLBACK.md`) ensure public routes remain browsable without compromising private portal or admission/certificate integrity.

## Remaining Operational Configuration (Per Deployment Environment)
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in production and verify with `npm run email:verify -- --strict` to deliver live emails instead of `Skipped` fallback mode.
- Supply `SEED_ADMIN_PASSWORD`, `SEED_INSTRUCTOR_PASSWORD`, and `SEED_STUDENT_PASSWORD` in `.env` when running `ALLOW_DEMO_SEED=true npm run db:seed:demo` in development if deterministic demo passwords are desired instead of ephemeral generated credentials.
