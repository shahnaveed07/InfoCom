# InfoCom AMS — Known Issues, Data Anomalies & Technical Debt (Phase 1)

This document records data anomalies detected in `/data/centre-db.json`, API/UI inconsistencies, build/runtime issues, and deferred enhancements.

---

## 1. Data Audit Anomalies (`/data/centre-db.json` & Migrated Seed State)

All source records in `/data/centre-db.json` were preserved verbatim without alteration and backed up identically to `/data/centre-db.backup.json`. The following data-level inconsistencies exist in the historical dataset:

| ID | Category | Finding | Impact / Remediation Plan |
| --- | --- | --- | --- |
| **D1** | Academic Consistency | Student **Priya Patel** (`stu-priya`) enrollment `enr-4` (`crs-data`, `DA-215`) has `status: 'Completed'` and all 4 module IDs (`da-m1`..`da-m4`) marked completed, yet `grades` contains scores only for `da-m1` (`95`) and `da-m2` (`93`). Modules `da-m3` and `da-m4` have no grade records (`weightedAverage` resolves to `94` only over graded weights). | Documented; Phase 3 should decide whether "Completed" + Certificate issuance requires 100% *graded* modules or permits partial graded weights. |
| **D2** | Completion vs. Grade Parity | Modules `cl-m2` (`stu-marcus`), `da-m2` & `da-m3` (`stu-sofia`), and `cy-m2` (`stu-noah`) are checked off in `completedModuleIds` without corresponding `moduleGrades` entries. | Normal in instructor-paced labs where completion precedes grading, or needs an explicit "Awaiting Grade" indicator in `CourseTrackingView`. |
| **D3** | Attendance Audit Mismatch | Legacy record `att-618e834b` marks **Noah Kim** (`stu-noah`) `Present` on `ses-upcoming-4` (`CY-402` taught by `Prof. David Okonkwo`, originally scheduled `2026-11-15T17:32Z`), with `updatedBy: "Dr. Elena Vance"` and empty `note`. | Cross-instructor attendance audit anomaly; will be constrained once course-assigned instructor scoping (`SEC-08`) is enabled in Phase 2/3. |
| **D4** | Legacy Denormalization | `/data/centre-db.json` stores `courses[].instructorName` and `sessions[].instructorName` without `sessions[].instructorId` or `sessions[].status`, and lacks `cohorts`, `admissions`, `feeInvoices`, `payments`, `documents`, `certificates`, or `admin` accounts. | `server/migrate.ts` reconciles these into relational FKs (`courses.instructorId`, `classSessions.instructorId`, `cohorts`, `adm-director`), while preserving `instructorName` snapshots on sessions. |
| **D5** | Shared Demo Password Salts | In `/data/centre-db.json`, both instructors share a single `scrypt` salt/hash (`18ce0edbccf65dcdce361ff6bd8dc279:...`) and all 6 students share a single `scrypt` salt/hash (`506d1375e4e8b1be092f003a9f768cd6:...`). `migrate.ts` also seeds one hash per role group. | Acceptable only for seeded local evaluation accounts; enforce unique per-user password rotation and onboarding tokens in Phase 2. |

---

## 2. Application & UX Bugs / Incomplete Wiring

| ID | Area | Description |
| --- | --- | --- |
| **UI-01** | `SchedulesView.tsx` | Session creation modal hardcodes `<option value="Cohort A · Autumn">` and `<option value="Cohort B · Autumn">` instead of reading `data.cohorts`, so newly created cohorts cannot be selected for scheduled sessions or linked via `cohortId`. |
| **UI-02** | `SchedulesView.tsx` | `PATCH /api/sessions/:id/status` (`api.updateSessionStatus`) has no buttons/controls in the UI, preventing staff from marking sessions `Completed` or `Cancelled`. |
| **UI-03** | `EnrollmentsView.tsx` | Enrollment creation modal uses a free-text/static cohort label without resolving/sending `cohortId`, leaving `enrollments.cohort_id` `NULL` on newly created enrollments. |
| **UI-04** | `AuthView.tsx` | `POST /api/admissions/public` exists on the backend, but `AuthView.tsx` has no "Apply for Admission" tab for prospective applicants. |
| **UI-05** | `server/ams-service.ts` | `registerStudentAccount()` automatically enrolls every newly registered student into the first course (`Cohort A · Autumn`) rather than letting students start un-enrolled or apply through Admissions. |
| **UI-06** | `AdminOverview.tsx` & `DocumentsView.tsx` | Minor UI copy (`AdminOverview.tsx:239`, `DocumentsView.tsx:77`) still contains technical infrastructure phrasing (`PostgreSQL`) instead of pure user-facing academy terminology. |
| **UI-07** | `CourseTrackingView.tsx` & `AttendanceAlertsView.tsx` | Waitlisted students appear in active course/session rosters (`status !== 'Dropped'`), whereas waitlisted seats typically should not be graded or marked present until activated. |

---

## 3. Infrastructure & Build / Packaging Issues

| ID | Area | Description |
| --- | --- | --- |
| **INF-01** | `package.json` (`start` script) | `"start": "node server.ts"` invokes raw Node on TypeScript files using `.ts` relative imports. While `"dev": "tsx server.ts"` works cleanly, production startup requires either compiling the server bundle (`esbuild` / `tsc`) to `dist-server/server.js` or running `tsx server.ts`. |
| **INF-02** | Prisma vs. Drizzle Schema Alignment | Master instructions reference Prisma ORM, whereas the existing codebase is built cleanly on Drizzle ORM (`src/db/schema.ts`) against Cloud SQL PostgreSQL. Any future schema additions must evaluate whether to stay on Drizzle ORM (already working) or formalize a controlled ORM standard without data loss. |
| **INF-03** | Scalability of `buildDashboardForUser()` | `buildDashboardForUser()` fetches full table slices in parallel on every mutation response. While fast for academy sizes <5,000 rows, Phase 4 should introduce paginated endpoints for `auditLogs`, `documents`, `notifications`, and `payments`. |
