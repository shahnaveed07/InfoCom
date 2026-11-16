# IGS AMS — Root Cause Analysis for 404 & Broken Asset Responses

This document records the concrete root causes and affected URLs diagnosed across the **IGS — InfoCom Global Services** web application and Express API server.

---

## Summary of Distinct Root Causes Diagnosed

| # | Root Cause Category | Affected URLs / Paths | Actual Behavior Found Prior to Fix | Resolution Implemented |
| --- | --- | --- | --- | --- |
| 1 | **Missing API Health & Readiness Endpoints** | `GET /api/health`<br>`GET /api/health/ready` | Neither endpoint existed in `server/app.ts` or any router under `server/routes/`. Requests fell through Express API routing into Vite/static catch-all middleware, returning `200 OK` HTML (`index.html`) or `404` static errors instead of JSON readiness telemetry. | Added `GET /api/health` (`200 { status: 'ok', service: 'igs-ams-api', ... }`) and `GET /api/health/ready` (`200 { status: 'ready', database: 'connected' }` vs `503 { status: 'degraded', database: 'unavailable' }`). |
| 2 | **Unmatched `/api/*` Fallthrough to HTML SPA Catch-All** | `GET /api/unknown-*`<br>Any missing `/api/*` endpoint | `server.ts` mounted Vite middleware and `app.get('*', ...)` after `createApiApp()` without an `/api` 404 JSON terminal handler. Unknown API routes fell through and received `200 text/html` (`index.html`) or static host HTML `404`, masking route/backend failures. | Added terminal `app.use('/api', ...)` JSON 404 handler in `server/app.ts` returning `404 { error: 'API endpoint not found.', code: 'API_ROUTE_NOT_FOUND' }`, and added `/api` exclusion guard in `server.ts` production `app.get('*', ...)`. |
| 3 | **Broken Static Image Asset URL in Production Bundles (`dist/`)** | `'/src/assets/images/academy_lab_studio_1794576422024.jpg'` loaded on:<br>- `/` (`PublicHomePage.tsx`)<br>- `/about` (`PublicAboutPage.tsx`)<br>- `/login` (`AuthView.tsx`) | Hardcoded unbundled `/src/assets/images/...` paths resolve in `vite dev`, but in production builds (`vite build` -> `dist/`), Vite emits hashed `/assets/academy_lab_studio_...jpg`. Requests to `/src/assets/images/...` hit the SPA fallback (`200 text/html` or `404`), breaking images (`naturalWidth === 0`). | Converted all three components (`PublicHomePage.tsx`, `PublicAboutPage.tsx`, `AuthView.tsx`) to standard ES module asset imports (`import studioLabImage from '.../academy_lab_studio_1794576422024.jpg'`) so Vite bundles and fingerprints the asset cleanly. |
| 4 | **Decoupled Static Frontend Hosting Without Backend Proxy** | `/courses`, `/courses/:slug`, `/about`, `/admissions`, `/contact`, `/verify-certificate`, `/api/public/academy`, `/api/public/courses`, `/api/public/courses/:slug` | When deployed as a static bundle without an active `/api` backend (or while database provisioning is pending), browsers fetched same-origin `/api/*` and received HTML `404`/`200 index.html`, `503`, or connection errors. `requestJson()` only surfaced generic errors, causing `/courses/:slug` to misreport `"Program Not Found"` and `/courses` / `/admissions` to show empty failure boxes. | Added typed `ApiError` classification, configurable `VITE_API_BASE_URL` + `CORS_ALLOWED_ORIGINS`, frontend-native demo fallback (`src/shared/demo-public-data.ts`, `src/utils/public-data.ts`), and genuine JSON `404` vs offline separation. |
| 5 | **Database Connection Failures Treated Identically to Missing Records** | `GET /api/public/courses`<br>`GET /api/public/courses/:slug`<br>`GET /api/admissions/public/catalog`<br>`GET /api/certificates/verify/:code` | `500`/`503`/network errors were collapsed into generic `Error` messages without checking `database: 'unavailable'` or `Content-Type`, making DB outages indistinguishable from valid `404` not-found responses. | Separated `kind: 'database_unavailable'`, `'service_unavailable'`, `'network_error'`, `'api_route_missing'`, `'html_fallback'`, `'invalid_response'` from `'not_found'`. |

---

## Architecture Notes: Unified Express vs. Decoupled Static Hosting

1. **Primary Deployment Architecture (Unified Express Server — `server.ts`):**
   - `server.ts` serves both `/api/*` endpoints and Vite (dev) or `dist/` (production) + React Router SPA fallback (`GET *` -> `dist/index.html`, excluding `/api/*` and `/assets/*`).
   - Direct visits and browser reloads on `/`, `/courses`, `/courses/:slug`, `/about`, `/admissions`, `/contact`, `/verify-certificate`, and `/login` work directly with `200 OK` when running `npm run dev` or `NODE_ENV=production npm start`.
2. **Decoupled Frontend Preview / Static CDN Hosting:**
   - Because this codebase does not use Cloudflare Pages (`_redirects`) or Vercel (`vercel.json`), no unrelated hosting manifests are forced into the unified Node deployment.
   - If the frontend (`dist/`) is ever served separately from a static host pointing to an external Express API, configure:
     - `VITE_API_BASE_URL="https://api.example.com"` at frontend build time.
     - `CORS_ALLOWED_ORIGINS="https://app.example.com"` and `CORS_CROSS_SITE_COOKIES="true"` on the Express API server (`server/middleware/security.ts` + `server/middleware/auth.ts`).
     - Standard SPA rewrite (`/* -> /index.html 200`) on your static host for client routes only (do not rewrite `/assets/*` or API URLs).
