# InfoCom Global Services AMS — Implementation Plan (Completed Baseline)

All phases below have been implemented and stabilized against the single **PostgreSQL + Prisma ORM** backend and **React + TypeScript + Vite** frontend for **IGS — InfoCom Global Services**.

---

## Completed Milestones
1. **Official Brand Identity & Single-Stack Cleanup:**
   - Integrated official IGS logo (`public/assets/aistudio/IMG-20261110-WA0004_ac23d401.jpg`), campus address (`Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.`), slogan (`"Learn Today, Build Tomorrow."`), `INR`, `Asia/Kolkata`, and `igs_session` cookies.
   - Standardized exclusively on Prisma ORM + first-party `Argon2id` authentication (with legacy `scrypt` transparent upgrade).
2. **Public Institute Website & Admin-Controlled Onboarding:**
   - Built public pages (`/`, `/courses`, `/courses/:slug`, `/about`, `/admissions`, `/contact`, `/verify-certificate`) backed by `/api/public/*`.
   - Disabled public self-registration (`410 Gone` on `POST /api/auth/register`) and enforced admin-controlled student/staff onboarding with single-use setup tokens and `mustChangePassword` enforcement.
3. **Production vs. Development Seed Isolation:**
   - `npm run db:seed` (`prisma/seed.ts`) seeds only structural metadata (roles, IGS academy record, policies, `ADMIN` department, default certificate template).
   - `npm run db:seed:demo` (`prisma/seed-demo.ts`) requires `NODE_ENV=development` and `ALLOW_DEMO_SEED=true`, uses env-provided or ephemeral generated passwords (zero hardcoded secrets), and hides `isDemo` courses from public endpoints in production.
4. **Academic, Admissions, Finance, Storage, Email & Reporting Operations:**
   - Completed multi-type assessments, bulk attendance & audit history, fee plans/structures/discounts/scholarships/refunds, private object storage (`local`/`s3`) + SHA-256 verified legacy Base64 migration (`npm run db:migrate-documents`), branded PDF+QR certificates, persistent `BackgroundJob` email queue + `npm run email:verify`, and role-scoped CSV/PDF exports.
5. **CI, Package Management & 404/Fallback Stabilization:**
   - Standardized on `npm` with a synchronized `package-lock.json` and full Playwright browser E2E verification (`npm run test:e2e`) in GitHub Actions (`.github/workflows/ci.yml`).
   - Added `/api/health`, `/api/health/ready`, terminal `/api/*` JSON `404` handler, bundled Vite ES asset imports, configurable `VITE_API_BASE_URL`, and API-first `DEMO PREVIEW` fallback (`docs/404_ROOT_CAUSE.md`, `docs/PUBLIC_DEMO_FALLBACK.md`).

