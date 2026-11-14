import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { count } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  admissions,
  attendanceRecords,
  auditLogs,
  certificates,
  classSessions,
  cohorts,
  courseModules,
  courses,
  documents,
  enrollments,
  feeInvoices,
  moduleGrades,
  notifications,
  payments,
  progressRemarks,
  users,
} from '../src/db/schema.ts';
import { hashPassword } from './auth.ts';

interface LegacyJsonDb {
  users?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    studentCode?: string;
    department?: string;
    passwordHash?: string;
  }>;
  courses?: Array<{
    id: string;
    code: string;
    title: string;
    track: string;
    instructorId: string;
    instructorName: string;
    durationWeeks: number;
    modules: Array<{
      id: string;
      code: string;
      title: string;
      weight: number;
      labHours: number;
    }>;
  }>;
  enrollments?: Array<{
    id: string;
    studentId: string;
    courseId: string;
    cohort: string;
    status: string;
    enrolledAt: string;
    completedModuleIds: string[];
  }>;
  sessions?: Array<{
    id: string;
    courseId: string;
    cohort: string;
    title: string;
    topic: string;
    room: string;
    instructorName: string;
    startIso: string;
    endIso: string;
  }>;
  attendance?: Array<{
    id: string;
    sessionId: string;
    courseId: string;
    studentId: string;
    status: string;
    note: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  grades?: Array<{
    id: string;
    studentId: string;
    courseId: string;
    moduleId: string;
    score: number;
    feedback: string;
    gradedAt: string;
    gradedBy: string;
  }>;
  remarks?: Array<{
    id: string;
    studentId: string;
    courseId: string;
    summary: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  notifications?: Array<{
    id: string;
    userId: string;
    kind: string;
    title: string;
    message: string;
    relatedCourseId?: string;
    relatedSessionId?: string;
    dedupeKey?: string;
    read: boolean;
    createdAt: string;
  }>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'centre-db.json');
const BACKUP_DB_PATH = path.join(DATA_DIR, 'centre-db.backup.json');

let migrationPromise: Promise<void> | null = null;

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function ensureDatabaseMigratedAndSeeded(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runControlledMigration().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

export async function runControlledMigration(): Promise<void> {
  const existingCountRows = await db.select({ total: count() }).from(users);
  const existingUserCount = Number(existingCountRows[0]?.total ?? 0);
  if (existingUserCount > 0) {
    return;
  }

  let legacy: LegacyJsonDb | null = null;
  if (fs.existsSync(LEGACY_DB_PATH)) {
    if (!fs.existsSync(BACKUP_DB_PATH)) {
      fs.copyFileSync(LEGACY_DB_PATH, BACKUP_DB_PATH);
    }
    const raw = fs.readFileSync(LEGACY_DB_PATH, 'utf8');
    legacy = JSON.parse(raw) as LegacyJsonDb;
  }

  const adminPasswordHash = hashPassword('Admin!2026');
  const instructorPasswordHash = hashPassword('Instructor!2026');
  const studentPasswordHash = hashPassword('Student!2026');

  await db.transaction(async (tx) => {
    // Re-check inside transaction to avoid race condition
    const innerCheck = await tx.select({ total: count() }).from(users);
    if (Number(innerCheck[0]?.total ?? 0) > 0) return;

    // 1. Seed Academy Admin account
    await tx
      .insert(users)
      .values({
        id: 'adm-director',
        name: 'Sarah Lin',
        email: 'admin@infocom.edu',
        role: 'admin',
        status: 'active',
        staffCode: 'INF-ADM-001',
        department: 'Academy Administration',
        phone: '+1 (555) 204-8800',
        passwordHash: adminPasswordHash,
      })
      .onConflictDoNothing();

    // 2. Migrate legacy users or create initial staff & students
    const legacyUsers = legacy?.users ?? [
      {
        id: 'inst-elena',
        name: 'Dr. Elena Vance',
        email: 'elena.vance@northbridge.edu',
        role: 'instructor',
        department: 'Software & Cloud Systems',
        passwordHash: instructorPasswordHash,
      },
      {
        id: 'inst-david',
        name: 'Prof. David Okonkwo',
        email: 'david.okonkwo@northbridge.edu',
        role: 'instructor',
        department: 'Data & Security Lab',
        passwordHash: instructorPasswordHash,
      },
      {
        id: 'stu-marcus',
        name: 'Marcus Chen',
        email: 'marcus.chen@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-041',
        passwordHash: studentPasswordHash,
      },
      {
        id: 'stu-priya',
        name: 'Priya Patel',
        email: 'priya.patel@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-042',
        passwordHash: studentPasswordHash,
      },
      {
        id: 'stu-liam',
        name: "Liam O'Connor",
        email: 'liam.oconnor@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-043',
        passwordHash: studentPasswordHash,
      },
      {
        id: 'stu-sofia',
        name: 'Sofia Alvarez',
        email: 'sofia.alvarez@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-044',
        passwordHash: studentPasswordHash,
      },
      {
        id: 'stu-noah',
        name: 'Noah Kim',
        email: 'noah.kim@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-045',
        passwordHash: studentPasswordHash,
      },
      {
        id: 'stu-amara',
        name: 'Amara Diallo',
        email: 'amara.diallo@student.northbridge.edu',
        role: 'student',
        studentCode: 'NTA-2026-046',
        passwordHash: studentPasswordHash,
      },
    ];

    for (let idx = 0; idx < legacyUsers.length; idx++) {
      const u = legacyUsers[idx];
      await tx
        .insert(users)
        .values({
          id: u.id,
          name: u.name,
          email: u.email.toLowerCase(),
          role: u.role === 'instructor' ? 'instructor' : u.role === 'admin' ? 'admin' : 'student',
          status: 'active',
          studentCode: u.studentCode ?? null,
          staffCode:
            u.role === 'instructor'
              ? `INF-INS-00${idx + 1}`
              : null,
          department: u.department ?? null,
          passwordHash:
            u.passwordHash ??
            (u.role === 'instructor' ? instructorPasswordHash : studentPasswordHash),
        })
        .onConflictDoNothing();
    }

    // 3. Migrate Courses & Modules
    const legacyCourses = legacy?.courses ?? [];
    const defaultTuitionByCode: Record<string, string> = {
      'CS-204': '1450.00',
      'CL-310': '1600.00',
      'DA-215': '1350.00',
      'CY-402': '1750.00',
    };

    for (const c of legacyCourses) {
      await tx
        .insert(courses)
        .values({
          id: c.id,
          code: c.code,
          title: c.title,
          track: c.track,
          description: `${c.title} — structured hands-on computer training track.`,
          instructorId: c.instructorId,
          durationWeeks: c.durationWeeks,
          tuitionFee: defaultTuitionByCode[c.code] ?? '1400.00',
          isArchived: false,
        })
        .onConflictDoNothing();

      for (let mIdx = 0; mIdx < c.modules.length; mIdx++) {
        const m = c.modules[mIdx];
        await tx
          .insert(courseModules)
          .values({
            id: m.id,
            courseId: c.id,
            code: m.code,
            title: m.title,
            weight: m.weight,
            labHours: m.labHours,
            sortOrder: mIdx + 1,
          })
          .onConflictDoNothing();
      }
    }

    // 4. Create structured Cohorts matching existing enrollments
    const seededCohorts = [
      {
        id: 'coh-ts-a',
        code: 'CS204-AUT26-A',
        name: 'Cohort A · Autumn',
        courseId: 'crs-ts',
        instructorId: 'inst-elena',
        capacity: 24,
        startDate: hoursFromNow(-24 * 40),
        endDate: hoursFromNow(24 * 44),
        status: 'Active',
      },
      {
        id: 'coh-cl-a',
        code: 'CL310-AUT26-A',
        name: 'Cohort A · Autumn',
        courseId: 'crs-cloud',
        instructorId: 'inst-elena',
        capacity: 20,
        startDate: hoursFromNow(-24 * 28),
        endDate: hoursFromNow(24 * 42),
        status: 'Active',
      },
      {
        id: 'coh-da-b',
        code: 'DA215-AUT26-B',
        name: 'Cohort B · Autumn',
        courseId: 'crs-data',
        instructorId: 'inst-david',
        capacity: 22,
        startDate: hoursFromNow(-24 * 75),
        endDate: hoursFromNow(24 * 15),
        status: 'Active',
      },
      {
        id: 'coh-cy-a',
        code: 'CY402-AUT26-A',
        name: 'Cohort A · Autumn',
        courseId: 'crs-sec',
        instructorId: 'inst-david',
        capacity: 18,
        startDate: hoursFromNow(-24 * 20),
        endDate: hoursFromNow(24 * 36),
        status: 'Active',
      },
    ];

    for (const coh of seededCohorts) {
      await tx.insert(cohorts).values(coh).onConflictDoNothing();
    }

    const resolveCohortId = (courseId: string, cohortName: string): string | null => {
      const match = seededCohorts.find(
        (c) => c.courseId === courseId && c.name === cohortName
      );
      return match?.id ?? null;
    };

    // 5. Migrate Enrollments
    for (const enr of legacy?.enrollments ?? []) {
      await tx
        .insert(enrollments)
        .values({
          id: enr.id,
          studentId: enr.studentId,
          courseId: enr.courseId,
          cohortId: resolveCohortId(enr.courseId, enr.cohort),
          cohort: enr.cohort,
          status: enr.status,
          enrolledAt: new Date(enr.enrolledAt),
          completedModuleIds: enr.completedModuleIds ?? [],
        })
        .onConflictDoNothing();
    }

    // 6. Migrate Sessions (shift relative timestamps if legacy sessions are already in the past so upcoming labs remain live)
    const nowMs = Date.now();
    for (const ses of legacy?.sessions ?? []) {
      let startDate = new Date(ses.startIso);
      let endDate = new Date(ses.endIso);
      if (ses.id.startsWith('ses-upcoming') && startDate.getTime() < nowMs) {
        const offsetHours =
          ses.id === 'ses-upcoming-1'
            ? 6
            : ses.id === 'ses-upcoming-2'
              ? 18
              : ses.id === 'ses-upcoming-3'
                ? 12
                : 48;
        startDate = hoursFromNow(offsetHours);
        endDate = hoursFromNow(offsetHours + 2);
      }

      const courseRec = legacyCourses.find((c) => c.id === ses.courseId);
      await tx
        .insert(classSessions)
        .values({
          id: ses.id,
          courseId: ses.courseId,
          cohortId: resolveCohortId(ses.courseId, ses.cohort),
          cohort: ses.cohort,
          title: ses.title,
          topic: ses.topic,
          room: ses.room,
          instructorId: courseRec?.instructorId ?? 'inst-elena',
          instructorName: ses.instructorName,
          startIso: startDate,
          endIso: endDate,
          status: startDate.getTime() < nowMs ? 'Completed' : 'Scheduled',
        })
        .onConflictDoNothing();
    }

    // 7. Migrate Attendance, Grades, Remarks, Notifications
    for (const att of legacy?.attendance ?? []) {
      await tx
        .insert(attendanceRecords)
        .values({
          id: att.id,
          sessionId: att.sessionId,
          courseId: att.courseId,
          studentId: att.studentId,
          status: att.status,
          note: att.note ?? '',
          updatedAt: new Date(att.updatedAt),
          updatedBy: att.updatedBy,
        })
        .onConflictDoNothing();
    }

    for (const g of legacy?.grades ?? []) {
      await tx
        .insert(moduleGrades)
        .values({
          id: g.id,
          studentId: g.studentId,
          courseId: g.courseId,
          moduleId: g.moduleId,
          score: g.score,
          feedback: g.feedback ?? '',
          gradedAt: new Date(g.gradedAt),
          gradedBy: g.gradedBy,
        })
        .onConflictDoNothing();
    }

    for (const r of legacy?.remarks ?? []) {
      await tx
        .insert(progressRemarks)
        .values({
          id: r.id,
          studentId: r.studentId,
          courseId: r.courseId,
          summary: r.summary,
          updatedAt: new Date(r.updatedAt),
          updatedBy: r.updatedBy,
        })
        .onConflictDoNothing();
    }

    for (const n of legacy?.notifications ?? []) {
      await tx
        .insert(notifications)
        .values({
          id: n.id,
          userId: n.userId,
          kind: n.kind,
          title: n.title,
          message: n.message,
          relatedCourseId: n.relatedCourseId ?? null,
          relatedSessionId: n.relatedSessionId ?? null,
          dedupeKey: n.dedupeKey ?? null,
          read: n.read,
          createdAt: new Date(n.createdAt),
        })
        .onConflictDoNothing();
    }

    // 8. Seed initial Admissions Pipeline records
    await tx
      .insert(admissions)
      .values([
        {
          id: 'adm-app-1',
          applicantName: 'Nadia Hassan',
          applicantEmail: 'nadia.hassan@example.com',
          phone: '+1 (555) 392-1140',
          targetCourseId: 'crs-ts',
          preferredCohort: 'Cohort A · Autumn',
          status: 'Accepted',
          notes: 'Completed technical placement assessment (91%). Ready to convert to active enrollment.',
          reviewedByUserId: 'adm-director',
          submittedAt: hoursFromNow(-72),
          reviewedAt: hoursFromNow(-24),
        },
        {
          id: 'adm-app-2',
          applicantName: 'Owen Gallagher',
          applicantEmail: 'owen.gallagher@example.com',
          phone: '+1 (555) 841-9920',
          targetCourseId: 'crs-sec',
          preferredCohort: 'Cohort A · Autumn',
          status: 'Under Review',
          notes: 'Network fundamentals portfolio submitted for instructor evaluation.',
          reviewedByUserId: 'adm-director',
          submittedAt: hoursFromNow(-36),
          reviewedAt: hoursFromNow(-12),
        },
      ])
      .onConflictDoNothing();

    // 9. Seed Financial Fee Invoices & Payments for enrolled students
    await tx
      .insert(feeInvoices)
      .values([
        {
          id: 'inv-1001',
          invoiceNumber: 'INV-2026-1001',
          studentId: 'stu-marcus',
          enrollmentId: 'enr-1',
          courseId: 'crs-ts',
          description: 'CS-204 Full-Stack TypeScript Engineering Tuition (Cohort A)',
          amountDue: '1450.00',
          amountPaid: '1450.00',
          currency: 'USD',
          status: 'Paid',
          dueDate: hoursFromNow(-24 * 14),
          issuedByUserId: 'adm-director',
        },
        {
          id: 'inv-1002',
          invoiceNumber: 'INV-2026-1002',
          studentId: 'stu-marcus',
          enrollmentId: 'enr-2',
          courseId: 'crs-cloud',
          description: 'CL-310 Cloud Infrastructure & DevOps Tuition (Cohort A)',
          amountDue: '1600.00',
          amountPaid: '800.00',
          currency: 'USD',
          status: 'Partial',
          dueDate: hoursFromNow(24 * 10),
          issuedByUserId: 'adm-director',
        },
        {
          id: 'inv-1003',
          invoiceNumber: 'INV-2026-1003',
          studentId: 'stu-priya',
          enrollmentId: 'enr-4',
          courseId: 'crs-data',
          description: 'DA-215 Applied Python & Data Analytics Tuition (Cohort B)',
          amountDue: '1350.00',
          amountPaid: '1350.00',
          currency: 'USD',
          status: 'Paid',
          dueDate: hoursFromNow(-24 * 30),
          issuedByUserId: 'adm-director',
        },
        {
          id: 'inv-1004',
          invoiceNumber: 'INV-2026-1004',
          studentId: 'stu-liam',
          enrollmentId: 'enr-5',
          courseId: 'crs-ts',
          description: 'CS-204 Full-Stack TypeScript Engineering Tuition (Cohort A)',
          amountDue: '1450.00',
          amountPaid: '0.00',
          currency: 'USD',
          status: 'Unpaid',
          dueDate: hoursFromNow(24 * 5),
          issuedByUserId: 'adm-director',
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(payments)
      .values([
        {
          id: 'pay-2001',
          receiptNumber: 'RCPT-2026-2001',
          invoiceId: 'inv-1001',
          studentId: 'stu-marcus',
          amount: '1450.00',
          method: 'Card',
          referenceCode: 'TXN-88412A',
          recordedByUserId: 'adm-director',
          notes: 'Paid in full on enrollment confirmation.',
          paidAt: hoursFromNow(-24 * 36),
        },
        {
          id: 'pay-2002',
          receiptNumber: 'RCPT-2026-2002',
          invoiceId: 'inv-1002',
          studentId: 'stu-marcus',
          amount: '800.00',
          method: 'Bank Transfer',
          referenceCode: 'WIRE-55210',
          recordedByUserId: 'adm-director',
          notes: 'First installment (50%).',
          paidAt: hoursFromNow(-24 * 20),
        },
        {
          id: 'pay-2003',
          receiptNumber: 'RCPT-2026-2003',
          invoiceId: 'inv-1003',
          studentId: 'stu-priya',
          amount: '1350.00',
          method: 'Corporate Sponsorship',
          referenceCode: 'CORP-9012',
          recordedByUserId: 'adm-director',
          notes: 'Employer sponsorship settlement.',
          paidAt: hoursFromNow(-24 * 68),
        },
      ])
      .onConflictDoNothing();

    // 10. Seed Syllabus Document & Verified Completion Certificate for Priya Patel
    const syllabusText =
      'INFOCOM ACADEMY — CS-204 SYLLABUS\nModules:\nM1: Type Systems & Generics (25%)\nM2: React Component Architecture (25%)\nM3: API Design & Authentication (25%)\nM4: Automated Testing & CI/CD (25%)\n';
    await tx
      .insert(documents)
      .values({
        id: 'doc-101',
        ownerUserId: 'inst-elena',
        courseId: 'crs-ts',
        title: 'CS-204 Course Syllabus & Lab Rubric',
        category: 'Syllabus',
        fileName: 'cs204-syllabus-2026.txt',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(syllabusText, 'utf8'),
        contentBase64: Buffer.from(syllabusText, 'utf8').toString('base64'),
        uploadedByUserId: 'inst-elena',
      })
      .onConflictDoNothing();

    const certCode = 'INF-CERT-2026-DA215-042';
    const certHash = crypto
      .createHash('sha256')
      .update(`${certCode}:stu-priya:crs-data:94.00`)
      .digest('hex')
      .slice(0, 24)
      .toUpperCase();

    await tx
      .insert(certificates)
      .values({
        id: 'cert-101',
        certificateCode: certCode,
        verificationHash: certHash,
        studentId: 'stu-priya',
        courseId: 'crs-data',
        enrollmentId: 'enr-4',
        finalScore: '94.00',
        letterGrade: 'A',
        attendanceRate: 100,
        issuedByUserId: 'adm-director',
        issuedByName: 'Sarah Lin',
        status: 'Issued',
        issuedAt: hoursFromNow(-24 * 10),
      })
      .onConflictDoNothing();

    // 11. Record Migration Audit Log
    await tx
      .insert(auditLogs)
      .values({
        id: 'aud-migration-001',
        actorUserId: 'adm-director',
        actorEmail: 'admin@infocom.edu',
        actorRole: 'admin',
        action: 'SYSTEM_MIGRATION',
        entityType: 'database',
        entityId: 'postgresql-cloudsql',
        summary: 'Controlled migration of legacy JSON centre-db.json records into Cloud SQL PostgreSQL completed with backup.',
        metadata: {
          backupCreated: fs.existsSync(BACKUP_DB_PATH),
          migratedUsers: legacyUsers.length,
          migratedCourses: legacyCourses.length,
        },
      })
      .onConflictDoNothing();
  });
}

// Allow running directly via `npx tsx server/migrate.ts`
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('migrate.ts')
) {
  runControlledMigration()
    .then(() => {
      console.log('Migration and reconciliation completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
