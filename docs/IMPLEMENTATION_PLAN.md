# InfoCom Global Services AMS — Master Implementation Plan (Phases A–J)

This roadmap executes the **InfoCom Global Services — Complete AMS Implementation Master Prompt** sequentially without discarding working modules or historical data.

---

## Phase A — Current Repository Audit & Documentation Sync (Current)
- Inspect live runtime code (`server/`, `src/`, `prisma/`, `scripts/`).
- Replace outdated Phase 1 Drizzle/mock documentation with accurate architecture, database, security, API, testing, and deployment documentation.
- Flag missing external brand asset (`igs-infocom-global-services.png`).

## Phase B — Official IGS Branding, Firebase Removal & Single Database Cleanup
- Apply official identity across metadata, HTML title/meta, login showcase, sidebar/topbar, transcripts, receipts, certificates, and seeded defaults:
  - **Name:** `IGS — InfoCom Global Services` (`Computer Institute`)
  - **Location:** `Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.`
  - **Slogan:** `"Learn Today, Build Tomorrow."`
  - **Defaults:** `Asia/Kolkata`, `INR` (`₹` / `en-IN`), configurable `IGS-YYYY-NNNNN` student ID prefix (preserving historical student IDs and paid invoices).
- Remove Firebase Auth & Admin SDK completely (`src/lib/firebase*`, `firebase-applet-config.json`, `/api/auth/firebase`, Bearer ID token auth, `syncFirebaseUser`, `firebase`/`firebase-admin` deps) and add a **new** Prisma migration dropping `users.firebase_uid`.
- Remove Drizzle ORM (`src/db/*`, `server/migrate.ts`, `drizzle-orm`, `drizzle-kit`) so PostgreSQL + Prisma ORM is the single database layer.
- Switch session cookie to `igs_session` (clearing legacy `nta_session`) and remove demo quick-fill credential buttons/passwords from production login UI.

## Phase C — Authentication, Forced Password Change & Secure Onboarding + History Bugfix
- Fix `GET /api/enrollments/:enrollmentId/history` response contract & `EnrollmentsView` modal.
- Enforce `mustChangePassword` gate immediately after login and inside `App.tsx` until password rotation succeeds.
- Replace static initial password provisioning on admin user creation / admission approval with cryptographic one-time onboarding/setup tokens and admin-triggered reset/invite tokens.
- Verify account suspension/deactivation/reactivation and session revocation end-to-end.

## Phase D — Admin Portal & People/Master Data Completeness
- Ensure all Admin Overview metrics/charts, Student Management, Instructor Management, Departments, Classrooms, Academic Years/Terms use live IGS defaults (`INR`, `Asia/Kolkata`, configurable ID prefix).
- Expose instructor permission toggles cleanly and audit every master-data mutation.

## Phase E — Admissions & Enrollment Workflows
- Add public "Apply for Admission" workflow in `AuthView.tsx` wired to `POST /api/admissions/public` (including document submission or draft creation).
- Ensure applicant portal self-registration separates cleanly from course enrollment without unintended silent auto-enrollment.
- Complete admissions approval -> student profile -> batch seat verification -> fee plan invoice -> onboarding token flow.

## Phase F — Academic Operations Completeness
- Expose multi-type `Assessment` creation/management (`Assignment`, `Quiz`, `Lab`, `Midterm`, `Final`) tied to courses/modules/batches.
- Add bulk session attendance marking, excused/leave status support, and attendance correction history UI.
- Wire configurable global/course grading & attendance thresholds (`AcademySetting` + `Course`) into progress reports and certificate eligibility.

## Phase G — Financial Management Completeness
- Add CRUD & UI for `FeePlan` and `FeeStructure`.
- Implement API routes & UI for `Discount`, `Scholarship`, and `Refund` management, recalculating invoice totals (`subtotal - discountTotal - scholarshipTotal`) and tracking `PaymentAllocation`.
- Provide printable official `INR` invoices & fee receipts (`RCPT-*`) with InfoCom Sopore letterhead.

## Phase H — Private Object Storage & Verified PDF Certificates with QR Codes
- Introduce a clean private storage provider (`local-private` disk store with S3/GCS-ready adapter interface), migrating new uploads out of `documents.content_base64` while supporting legacy Base64 fallback reads.
- Implement server-side / branded PDF certificate generation embedding certificate code, SHA-256 hash, and scannable verification QR code linking to public verification.

## Phase I — Background Job Queue, Email Delivery & Exportable Reports
- Replace in-process `setInterval` sweeps with a PostgreSQL-backed `BackgroundJob` queue supporting scheduling, idempotency keys, retries, and failure tracking.
- Add transactional SMTP/email notification adapter updating `DeliveryLog` (`Queued` / `Delivered` / `Failed`) alongside `NotificationPreference` UI.
- Add CSV and printable/PDF report exports for attendance, grades, enrollments, and fee collections.

## Phase J — Production Build, Hardening & CI Readiness
- Read `PORT` from `process.env.PORT` (`3000` fallback) in `server.ts`.
- Compile backend TypeScript to runnable JS (`dist-server/server.js`) so `npm start` executes `node dist-server/server.js` cleanly.
- Add GitHub Actions CI workflow (`lint`, `build`, `prisma validate`, `test`) and complete regression verification (`npm test`, `tsc --noEmit`, `vite build`, headless Chromium browser verification).
