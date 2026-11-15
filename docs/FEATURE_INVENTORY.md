# InfoCom AMS — Feature Inventory & Verification Matrix

This matrix reflects the verified implementation state of every module across UI, API, business logic, and PostgreSQL/Prisma persistence.

Status Legend:
- **Working**: Implemented end-to-end across UI, API, and database.
- **Partial**: Core flow works; specific sub-features or UI wiring remain incomplete.
- **Broken**: Runtime or contract mismatch breaks the implemented flow.
- **Schema Only**: Database table(s) exist in `prisma/schema.prisma`, with no runtime API/UI.
- **Not Implemented**: Missing across schema, backend, and UI.

---

| Domain | Feature | UI Component | API / Service | Status | Verified Notes & Gaps |
| --- | --- | --- | --- | --- | --- |
| **Auth & Security** | Email/password sign-in (`Argon2id` + `scrypt` upgrade) | `AuthView.tsx` | `POST /api/auth/login` | Working | Rate-limited, audit-logged, sets HttpOnly opaque session cookie. Still uses `nta_session` cookie name & shows demo quick-fill buttons (Phase B cleanup). |
| **Auth & Security** | Google SSO (Firebase) | `AuthView.tsx` | `POST /api/auth/firebase` | Legacy Active (To Remove) | Must be completely removed in Phase B along with Firebase packages and `User.firebaseUid`. |
| **Auth & Security** | Student self-registration | `AuthView.tsx` | `POST /api/auth/register` | Working (Needs Policy Polish) | Hardcodes `student` role; currently auto-enrolls into first active cohort instead of pure portal creation or Admissions link. |
| **Auth & Security** | Password change / forgot / reset | `App.tsx`, `AuthView.tsx` | `POST /api/auth/{change,forgot,reset}-password` | Working (Partial Onboarding) | Forgot-password creates reset token in DB but does not deliver via email (`Phase I`). `mustChangePassword` flag is cleared on change, but app shell does not yet block navigation with a forced-change gate (`Phase C`). |
| **Auth & Security** | Protected initial Admin bootstrap CLI | CLI | `scripts/bootstrap-admin.ts` | Working | Enforces >=12 char password & secret if admin exists. |
| **Admin Portal** | Admin Dashboard & Date-Filtered Analytics | `AdminOverview.tsx` | `GET /api/dashboard`, `GET /api/admin/analytics` | Working | Live DB metrics (students, instructors, pending admissions, revenue, outstanding fees, today's classes, charts). |
| **Admin Portal** | Academy Settings, Academic Years & Terms, Departments, Classrooms | `AcademySettingsView.tsx`, `BatchesManagementView.tsx` | `/api/settings`, `/api/academic-years*`, `/api/academic-terms*`, `/api/departments*`, `/api/classrooms*` | Working | Defaults to `USD` instead of `INR` and lacks official IGS Sopore seed defaults (`Phase B`). |
| **Student Mgmt** | Student Directory, Create, Edit, Profile, Search/Filter/Sort/Pagination | `StudentsManagementView.tsx` | `/api/students*` | Working | Server-generated student codes (`STU-YYYY-###` currently; shifting to configurable `IGS-` prefix in Phase B). |
| **Instructor Mgmt** | Instructor Directory, Create, Edit, Assign Courses/Batches, Permissions | `InstructorsManagementView.tsx` | `/api/instructors*` | Working | Scoped RBAC enforced in `server/security/permissions.ts`. |
| **Admissions** | Public Admission Application Form | *Missing in `AuthView.tsx`* | `POST /api/admissions/public` | Partial | Backend endpoint exists; `AuthView.tsx` has no public "Apply for Admission" tab (`Phase E`). |
| **Admissions** | Admin Admissions Workflow (Draft/Submit/Review/Docs/Approve/Reject/Withdraw) | `AdmissionsView.tsx` | `/api/admissions*` | Working (Onboarding Gap) | Document upload & verification (`Pending`/`Verified`/`Replacement Required`/`Rejected`), status history, batch allocation, and fee plan association all work. Approval sets static/generated password without sending onboarding setup token (`Phase C`). |
| **Academics** | Courses, Modules & Batches CRUD | `CoursesCohortsView.tsx`, `BatchesManagementView.tsx` | `POST/PATCH /api/courses*`, `POST/PATCH /api/cohorts*` | Working | Validates module weight sum = 100%, batch capacity, classroom & term links. |
| **Academics** | Enrollments, Status Lifecycle & Batch/Course Transfers | `EnrollmentsView.tsx` | `/api/enrollments*` | Working | Capacity waitlist awareness & automated fee invoice option work. |
| **Academics** | Enrollment History Modal | `EnrollmentsView.tsx` | `GET /api/enrollments/:enrollmentId/history` | **Broken** | Backend returns flat fields (`studentName`, `courseCode`), while frontend `api.fetchEnrollmentHistory` reads `res.enrollment.studentName` (`TypeError`). Fix in Phase C. |
| **Academics** | Module Completion & Grading | `CourseTrackingView.tsx` | `PUT /api/progress/module-completion`, `PUT /api/grades` | Working (Partial Assessments) | Auto-creates 1:1 `Assessment` per module on grading. Dedicated multi-type assessment management (assignments, quizzes, labs, exams) UI/API is incomplete (`Phase F`). |
| **Academics** | Class Scheduling & Status Transitions | `SchedulesView.tsx` | `POST /api/sessions`, `PATCH /api/sessions/:id/status` | Working | Session creation & `Completed`/`Cancelled` status updates dispatch notifications. |
| **Academics** | Attendance Marking, Reminders & Progress Reports | `AttendanceAlertsView.tsx`, `ProgressReportView.tsx` | `POST /api/attendance`, `PUT /api/progress/remark`, `POST /api/notifications/run-reminders` | Working (Partial Policy/Bulk) | Individual marking & printable/`.txt` transcript work. Bulk attendance marking, leave/excused status, correction history UI, and global configurable pass/attendance thresholds need completion (`Phase F`). |
| **Finance** | Invoices, Voiding, Partial/Full Payments & Receipt Modal | `FinanceView.tsx` | `/api/invoices*`, `/api/payments` | Working (Currency/Slip Polish) | Integer-cents math, receipt preview (`window.print()`). Needs INR currency formatting, fee plan/structure CRUD UI (`Phase G`). |
| **Finance** | Discounts, Scholarships & Refunds | *None* | *None* | **Schema Only** | `discounts`, `scholarships`, and `refunds` tables exist in `prisma/schema.prisma`, but no API routes or UI exist (`Phase G`). |
| **Documents** | Private Document Vault | `DocumentsView.tsx` | `/api/documents*` | Working (Postgres Storage) | Stores `contentBase64` inside `documents` table (<=2 MB). Needs migration to private object storage adapter (`Phase H`). |
| **Certificates** | Issue, Revoke & Public Verify | `CertificatesView.tsx`, `AuthView.tsx` | `/api/certificates*` | Partial | Eligibility check & SHA-256 verification work. Download returns raw `.json` file instead of printable/PDF certificate with QR verification code (`Phase H`). |
| **Communication** | In-App Notifications & Delivery Logs | `StudentDashboard.tsx`, `AttendanceAlertsView.tsx` | `/api/notifications*` | Partial | In-app notifications and `DeliveryLog` (`channel: 'in_app'`) work. Real SMTP/email provider & user notification preferences UI are not wired (`Phase I`). |
| **Background Jobs & Exports** | Reliable Job Queue & Scheduled Reports | *In-process `setInterval`* | `runSessionReminderSweep` | Not Implemented | Reminder sweeps run in-process without persistence/retries. CSV/PDF reporting exports are not yet implemented (`Phase I`). |
