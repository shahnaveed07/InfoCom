# InfoCom AMS — Known Issues & Active Technical Debt

This list tracks verified live issues discovered during the Phase A full-codebase audit, prioritized for Phases B–J.

---

## 1. Brand, Architecture & Asset Gaps (Addressed in Phase B)

| ID | Area | Finding | Resolution Target |
| --- | --- | --- | --- |
| **GAP-01** | Missing Official Logo | No official `IGS — InfoCom Global Services` logo raster file was attached or exists in `src/assets/`. | Await user-supplied logo file for `src/assets/brand/igs-infocom-global-services.png`; do not invent or generate one. |
| **GAP-02** | Firebase Legacy Stack | `firebase` / `firebase-admin`, `src/lib/firebase*`, `/api/auth/firebase`, Bearer ID token resolution, Google SSO button, and `users.firebase_uid` remain present. | Remove completely in **Phase B** + forward Prisma migration dropping `users.firebase_uid`. |
| **GAP-03** | Dead Drizzle ORM Files | `src/db/schema.ts`, `src/db/index.ts`, `src/db/drizzle.config.ts`, `server/migrate.ts`, and `drizzle-orm`/`drizzle-kit` deps are unused dead code. | Remove completely in **Phase B**. |
| **GAP-04** | Outdated Branding & Currency | `Northbridge Tech Academy`, `nta_session`, `USD` / `en-US` formatting, and login demo quick-fill buttons remain across config/UI/seed. | Rebrand to `IGS — InfoCom Global Services` (Sopore, J&K), `"Learn Today, Build Tomorrow."`, `INR`, `Asia/Kolkata`, `igs_session` in **Phase B**. |

---

## 2. Live Application Bugs & Incomplete Flows (Addressed in Phases C–J)

| ID | Area | Finding | Resolution Target |
| --- | --- | --- | --- |
| **BUG-01** | `EnrollmentsView.tsx` & `GET /api/enrollments/:id/history` | Clicking **History** on an enrollment fails with `TypeError: Cannot read properties of undefined (reading 'studentName')` because backend returns flat fields instead of `{ enrollment: {...}, history: [...] }`. | **Phase C** |
| **GAP-05** | Forced Password Rotation & Onboarding | `User.mustChangePassword` is not enforced as a post-login gate, and admission approval / admin user creation lack one-time password setup tokens. | **Phase C** |
| **GAP-06** | Public Admissions UI | `POST /api/admissions/public` has no UI entry form in `AuthView.tsx`. | **Phase E** |
| **GAP-07** | Multi-Type Assessments & Bulk Attendance | Assessments lack standalone creation/type UI beyond 1:1 module auto-creation; attendance lacks bulk marking, excused/leave status, and correction history UI. | **Phase F** |
| **GAP-08** | Finance Extended Modules | `discounts`, `scholarships`, and `refunds` tables exist in Prisma schema with no routes or UI; `FeePlan`/`FeeStructure` lack CRUD UI. | **Phase G** |
| **GAP-09** | Object Storage & PDF QR Certificates | `documents` store Base64 payloads directly in PostgreSQL (`<=2 MB`); certificates download as `.json` without branded PDF + QR code. | **Phase H** |
| **GAP-10** | Background Jobs, Email & Exports | Reminder sweeps use in-process `setInterval`; `DeliveryLog` only records `in_app` (no SMTP adapter); no CSV/PDF reporting exports. | **Phase I** |
| **GAP-11** | Production `PORT` & Compiled Entry | `server.ts` hardcodes port `3000`; `npm start` executes `node server.ts` directly. | **Phase J** |
