# Public Website Demo Fallback & Backend Readiness Behavior

The **IGS — InfoCom Global Services** public website remains cleanly browsable if the Express API or PostgreSQL database is temporarily unreachable, while keeping private portals and transactional workflows strictly protected.

---

## 1. Environment Configuration Flags

Defined in `.env.example` and resolved in `src/utils/api.ts` and `src/utils/public-data.ts`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `""` (empty = same-origin `/api/*`) | Optional base URL when hosting the SPA separately from the Express API server. |
| `VITE_PUBLIC_DATA_MODE` | `"auto"` | Controls catalog sourcing: `auto` (live API first, local demo fallback on outage), `demo` (always use local demo fixtures), `api` (strict live API only, fail on error). |
| `VITE_ENABLE_PUBLIC_DEMO_FALLBACK` | `"true"` | Set to `"false"` to disable demo fallback in `auto` mode. |
| `CORS_ALLOWED_ORIGINS` | `""` | Comma-separated frontend origins allowed by backend CORS & CSRF origin checks. |
| `CORS_CROSS_SITE_COOKIES` | `"false"` | Enables `SameSite=None; Secure` cookies only when deployed cross-origin over HTTPS. |

---

## 2. API-First Semantics & Typed Fallback Trigger Rules

`requestJson()` in `src/utils/api.ts` classifies every failure via `ApiError`:

- **Triggers demo fallback (in `VITE_PUBLIC_DATA_MODE=auto` with `VITE_ENABLE_PUBLIC_DEMO_FALLBACK=true`):**
  - `network_error`: connection refused / offline / DNS failure (`status: 0`)
  - `api_route_missing`: HTML `404` or JSON `API_ROUTE_NOT_FOUND`
  - `html_fallback`: SPA `200 text/html` returned for an `/api/*` path
  - `database_unavailable`: HTTP `503` `{ status: 'degraded', database: 'unavailable' }`
  - `service_unavailable`: HTTP `502` / `503` / `504`
  - `invalid_response`: malformed JSON or unexpected payload shape
- **Never triggers demo fallback (even when fallback is enabled):**
  - Live healthy empty catalog (`200 { courses: [], currency: 'INR', isDemoEnvironment: false }` -> renders live empty state)
  - Genuine backend JSON `404` for an unpublished or unknown course slug (`err.kind === 'not_found'` -> renders **Program Not Found**)
  - Unknown slug when offline -> `findDemoCourseBySlugOrId()` returns `null` and rejects with `not_found` (never substitutes another course)

---

## 3. Official Local Demo Fixtures (`src/shared/demo-public-data.ts`)

Provides read-only preview fixtures aligned with `prisma/seed-demo.ts` under official IGS branding:
- Institute identity: **IGS — InfoCom Global Services** · Computer Institute · `Learn Today, Build Tomorrow.` · `Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.` · `INR`
- 7 sample courses (`IGS-101` Basic Computer Applications, `IGS-102` Office Automation, `IGS-201` Programming Fundamentals, `IGS-202` Web Development, `IGS-203` Python Programming, `IGS-204` Database Management, `IGS-301` Data Analytics), full module weights, lab hours, sample cohorts, and fee plan names.
- Zero invented contact phone numbers, emails, websites, or accreditations.

---

## 4. UI Visibility & Safety Guarantees

1. **Visible `DEMO PREVIEW` Banner (`DemoPreviewBanner.tsx`):**
   - Rendered across public pages whenever `source === 'demo'`, clearly stating that data is illustrative while the IGS backend is being connected.
   - Completely hidden when the live production API is connected and serving live records (`isDemoEnvironment === false` and `source === 'live'`).
   - Preserves **Development Sample Catalog** badges when connected live to a `NODE_ENV=development` seeded backend.
2. **Admissions Form Protection (`PublicAdmissionsPage.tsx`):**
   - Populates course/batch/fee plan dropdowns from demo fixtures when offline.
   - Blocks submission or catches outage errors cleanly without clearing any typed form fields, showing:
     `"Admission submission is temporarily unavailable while the institute portal is being connected. Your information has not been submitted."`
3. **Certificate Verification (`PublicVerifyCertificatePage.tsx`):**
   - Never verifies fake certificates offline; displays `"Certificate verification service is temporarily unavailable."` when unreachable.
4. **Private Portal Isolation:**
   - `/portal`, `/portal/*`, authentication, student rosters, attendance, grades, invoices, payments, and receipts NEVER use demo fallback fixtures. Offline `/portal` redirects to `/login`.
5. **Automatic Recovery (`publicSiteStore`):**
   - Deduplicates initial public fetches cleanly with `AbortController`, retries outages using controlled exponential backoff (`4s`, `8s`, `15s`, `30s`), revalidates every 45s while the tab is visible, and switches seamlessly back to live data (`DEMO PREVIEW` disappears) once `/api/health/ready` and `/api/public/courses` recover.
