import 'dotenv/config';
import { hashPassword } from '../server/auth.ts';
import { disconnectPrisma, prisma } from '../server/db/prisma.ts';

const isProduction = process.env.NODE_ENV === 'production';

async function main() {
  console.log(`Running InfoCom AMS Prisma seed (NODE_ENV=${process.env.NODE_ENV || 'development'})...`);

  await prisma.$transaction(async (tx) => {
    // 1. System Roles (Safe in all environments)
    const systemRoles = [
      {
        id: 'role-admin',
        code: 'admin',
        name: 'Academy Administrator',
        description: 'Full institutional, admissions, financial, and audit governance access.',
        isSystem: true,
      },
      {
        id: 'role-instructor',
        code: 'instructor',
        name: 'Faculty Instructor',
        description: 'Academic delivery, curriculum tracking, grading, attendance, and schedules.',
        isSystem: true,
      },
      {
        id: 'role-student',
        code: 'student',
        name: 'Enrolled Student',
        description: 'Personal dashboard, grades, attendance alerts, schedules, and documents.',
        isSystem: true,
      },
    ];

    for (const r of systemRoles) {
      await tx.role.upsert({
        where: { code: r.code },
        update: { name: r.name, description: r.description },
        create: r,
      });
    }

    // 2. Academy & Baseline Settings (Safe in all environments)
    await tx.academy.upsert({
      where: { code: 'INFOCOM-MAIN' },
      update: {
        name: 'IGS — InfoCom Global Services',
        legalName: 'InfoCom Global Services — Computer Institute',
        email: '',
        phone: '',
        website: '',
        address:
          'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      },
      create: {
        id: 'acad-infocom',
        code: 'INFOCOM-MAIN',
        name: 'IGS — InfoCom Global Services',
        legalName: 'InfoCom Global Services — Computer Institute',
        email: '',
        phone: '',
        website: '',
        address:
          'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      },
    });

    const settings = [
      { key: 'academy.student_id_prefix', value: 'IGS', valueType: 'string' },
      { key: 'academy.invoice_prefix', value: 'INV-2026', valueType: 'string' },
      { key: 'academy.invoice_next_seq', value: '1050', valueType: 'number' },
      { key: 'academy.fee_due_days', value: '14', valueType: 'number' },
      { key: 'academy.late_fee_pct', value: '5', valueType: 'number' },
      { key: 'grading.passing_score', value: '60', valueType: 'number' },
      { key: 'grading.distinction_score', value: '90', valueType: 'number' },
      { key: 'attendance.min_rate_pct', value: '75', valueType: 'number' },
      { key: 'attendance.late_weight_pct', value: '75', valueType: 'number' },
      { key: 'certificate.code_prefix', value: 'INF-CERT-2026', valueType: 'string' },
      { key: 'certificate.min_completion_pct', value: '100', valueType: 'number' },
      { key: 'certificate.min_weighted_score', value: '60', valueType: 'number' },
      { key: 'certificate.min_attendance_pct', value: '75', valueType: 'number' },
      { key: 'session.reminder_window_hours', value: '24', valueType: 'number' },
      { key: 'admission.portal_activation_policy', value: 'on_approval', valueType: 'string' },
    ];

    for (const s of settings) {
      await tx.academySetting.upsert({
        where: {
          academyId_key: { academyId: 'acad-infocom', key: s.key },
        },
        update: {},
        create: {
          id: `set-${s.key.replace(/[^a-z0-9]/gi, '-')}`,
          academyId: 'acad-infocom',
          key: s.key,
          value: s.value,
          valueType: s.valueType,
        },
      });
    }

    // 3. Standard Departments, Academic Year, Term, Classrooms & Fee Plan
    const departments = [
      { id: 'dept-admin', code: 'ADMIN', name: 'Academy Administration' },
      { id: 'dept-swe', code: 'SWE-CLOUD', name: 'Software & Cloud Systems' },
      { id: 'dept-data-sec', code: 'DATA-SEC', name: 'Data & Security Lab' },
    ];

    for (const d of departments) {
      await tx.department.upsert({
        where: { code: d.code },
        update: { name: d.name },
        create: {
          id: d.id,
          academyId: 'acad-infocom',
          code: d.code,
          name: d.name,
          status: 'active',
        },
      });
    }

    await tx.academicYear.upsert({
      where: { code: 'AY-2026' },
      update: { isCurrent: true, status: 'Active' },
      create: {
        id: 'ay-2026',
        academyId: 'acad-infocom',
        code: 'AY-2026',
        name: 'Academic Year 2026',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T23:59:59Z'),
        isCurrent: true,
        status: 'Active',
      },
    });

    await tx.academicTerm.upsert({
      where: { code: 'AUT-2026' },
      update: { isCurrent: true, status: 'Active' },
      create: {
        id: 'term-aut-2026',
        academicYearId: 'ay-2026',
        code: 'AUT-2026',
        name: 'Autumn 2026',
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-12-20T23:59:59Z'),
        isCurrent: true,
        status: 'Active',
      },
    });

    const classrooms = [
      { id: 'room-a101', code: 'LAB-A101', name: 'Lab A-101', building: 'Engineering Wing', capacity: 28, equipment: 'Dual-monitor workstations, Docker lab host' },
      { id: 'room-b204', code: 'LAB-B204', name: 'Lab B-204', building: 'Cloud Wing', capacity: 24, equipment: 'Kubernetes cluster sandbox' },
      { id: 'room-c102', code: 'ROOM-C102', name: 'Room C-102', building: 'Analytics Center', capacity: 24, equipment: 'JupyterHub GPU terminals' },
      { id: 'room-s3', code: 'SEC-S3', name: 'Security Lab S-3', building: 'Cyber Defense Annex', capacity: 20, equipment: 'Isolated red/blue team VLAN' },
    ];

    for (const rm of classrooms) {
      await tx.classroom.upsert({
        where: { code: rm.code },
        update: { name: rm.name, capacity: rm.capacity },
        create: {
          ...rm,
          academyId: 'acad-infocom',
          isActive: true,
        },
      });
    }

    await tx.feePlan.upsert({
      where: { code: 'PLAN-STANDARD' },
      update: { name: 'Standard Tuition Plan', currency: 'INR', isActive: true },
      create: {
        id: 'plan-standard',
        code: 'PLAN-STANDARD',
        name: 'Standard Tuition Plan',
        description: 'Single or 2-installment tuition schedule.',
        installmentCount: 2,
        currency: 'INR',
        isActive: true,
      },
    });

    await tx.feePlan.upsert({
      where: { code: 'PLAN-FULL' },
      update: { name: 'Full Upfront Tuition', currency: 'INR', isActive: true },
      create: {
        id: 'plan-full',
        code: 'PLAN-FULL',
        name: 'Full Upfront Tuition',
        description: 'Single lump-sum tuition payment upon enrollment.',
        installmentCount: 1,
        currency: 'INR',
        isActive: true,
      },
    });

    await tx.certificateTemplate.upsert({
      where: { code: 'CERT-DEFAULT-2026' },
      update: { isActive: true, name: 'IGS InfoCom Global Services Completion Template' },
      create: {
        id: 'tmpl-default-2026',
        code: 'CERT-DEFAULT-2026',
        name: 'IGS InfoCom Global Services Completion Template',
        titleFormat: 'Verified Certificate of Technical Mastery',
        signatoryName: 'Academy Director',
        signatoryTitle: 'IGS — InfoCom Global Services',
        minCompletionPct: 100,
        minScore: 60,
        minAttendancePct: 75,
        isActive: true,
      },
    });

    // 4. Development & Test Demo Data Guard:
    // NEVER create publicly known demo instructor/student passwords in production!
    if (isProduction) {
      console.log('Production mode detected: skipping demo instructor/student credential seeding.');
      return;
    }

    const demoAccounts = [
      {
        id: 'adm-director',
        name: 'Academy Director',
        email: 'admin@infocom.edu',
        role: 'admin',
        staffCode: 'IGS-ADM-001',
        department: 'Academy Administration',
        password: process.env.SEED_ADMIN_PASSWORD || 'Admin!2026',
      },
      {
        id: 'inst-elena',
        name: 'Dr. Elena Vance',
        email: 'elena.vance@infocom-faculty.local',
        role: 'instructor',
        staffCode: 'IGS-INS-001',
        department: 'Software & Cloud Systems',
        password: process.env.SEED_INSTRUCTOR_PASSWORD || 'Instructor!2026',
      },
      {
        id: 'inst-david',
        name: 'Prof. David Okonkwo',
        email: 'david.okonkwo@infocom-faculty.local',
        role: 'instructor',
        staffCode: 'IGS-INS-002',
        department: 'Data & Security Lab',
        password: process.env.SEED_INSTRUCTOR_PASSWORD || 'Instructor!2026',
      },
    ];

    for (const acct of demoAccounts) {
      const existing = await tx.user.findFirst({
        where: { OR: [{ id: acct.id }, { email: acct.email }] },
      });
      if (!existing) {
        const pwHash = await hashPassword(acct.password);
        await tx.user.create({
          data: {
            id: acct.id,
            name: acct.name,
            email: acct.email,
            role: acct.role,
            status: 'active',
            staffCode: acct.staffCode,
            department: acct.department,
            passwordHash: pwHash,
          },
        });
      } else if (existing.id === acct.id) {
        await tx.user.update({
          where: { id: existing.id },
          data: {
            name: acct.name,
            staffCode: acct.staffCode,
            department: acct.department,
          },
        });
      }
      const resolvedUserId = existing?.id ?? acct.id;
      const roleRow = await tx.role.findUnique({ where: { code: acct.role } });
      if (roleRow) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: resolvedUserId, roleId: roleRow.id } },
          update: {},
          create: {
            id: `ur-${acct.id}-${roleRow.code}`,
            userId: resolvedUserId,
            roleId: roleRow.id,
          },
        });
      }
    }
  });

  console.log('Prisma seed completed successfully.');
}

main()
  .catch((err) => {
    console.error('Prisma seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
