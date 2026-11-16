# InfoCom AMS — Testing & Verification Guide

## 1. Automated Verification Commands

| Check | Command | Description |
| --- | --- | --- |
| TypeScript static check | `npm run lint` | Runs `tsc --noEmit` across `src/`, `server/`, `scripts/`, and tests |
| Production frontend build | `npm run build` | Bundles React + Tailwind SPA via Vite (`dist/`) |
| Production backend build | `npm run build:server` | Bundles `server.ts` into `dist-server/server.js` via `esbuild` |
| Full automated test suite | `npm test` | Executes all unit + integration suites via Node's native test runner (`tsx --test`) |
| Migration status check | `npm run db:migrate:status` | Verifies all PostgreSQL Prisma migrations are applied cleanly |

---

## 2. Test Suite Coverage (`npm test`)

| File | Scope |
| --- | --- |
| `src/shared/academic.test.ts` | Weighted averages, letter grades, module completion, attendance rates, reminder deduplication, integer-cents money calculations, certificate eligibility, academy analytics |
| `src/shared/validation.test.ts` | Zod request schemas, bounds checks, privilege-escalation payload stripping |
| `server/auth.test.ts` | Argon2id hashing, legacy scrypt verification + rehash signal, opaque session token hashing, cookie parsing, CSRF origin guard, rate limiter |
| `server/db/config.test.ts` | Cloud SQL socket URL construction & `NODE_ENV=test` database isolation checks |
| `server/security.integration.test.ts` | Express API RBAC (`admin`/`instructor`/`student`), anti-IDOR isolation, session revocation on logout/suspension/password reset, `410 Gone` on `/api/auth/register` |
| `server/phase4.integration.test.ts` | Admin analytics, student/instructor master data CRUD, course/batch edits, settings, academic years/terms |
| `server/phase5.integration.test.ts` | Full admissions draft/submit/review/document-verify/approve/portal-activation workflow, batch & course transfers, enrollment history |
| `server/phase6.integration.test.ts` | Course weight validation, invoice payment receipts, enrollment & completion integrity |
| `server/phase7.integration.test.ts` | Role capabilities, password reset tokens, onboarding links, audit trail |
| `server/public-and-phase7.integration.test.ts` | Public website routes (`/api/public/*`, unpublished & tuition masking), `410` registration disable, local object storage upload/download + `.html` rejection, PDF+QR certificate rendering, and CSV/PDF RBAC report exports |


---

## 3. Isolated Test Database Configuration

Integration tests detect `TEST_DATABASE_URL` or `TEST_SQL_DB_NAME` when `NODE_ENV=test` (configured in `server/db/config.ts`) to prevent mutating production records and always clean up synthetic test records after assertions complete.

---

## 4. End-to-End Browser Verification

Every UI phase is additionally verified in headless Chromium via `playwright-cli` against `http://localhost:3000`:
- Viewport responsiveness (desktop `1440px` + mobile `390px`), horizontal overflow check (`scrollWidth <= clientWidth`), and zero console/network `5xx` errors across role views.
