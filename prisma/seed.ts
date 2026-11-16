import 'dotenv/config';
import { disconnectPrisma, prisma } from '../server/db/prisma.ts';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED === 'true') {
  throw new Error(
    'SECURITY ABORT: ALLOW_DEMO_SEED=true is forbidden when NODE_ENV=production.'
  );
}

export async function seedProductionFoundation() {
  console.log(
    `Running InfoCom AMS production foundation seed (NODE_ENV=${process.env.NODE_ENV || 'development'})...`
  );

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

    // 2. Official Academy & Baseline Settings (No invented contact data)
    await tx.academy.upsert({
      where: { code: 'INFOCOM-MAIN' },
      update: {
        name: 'IGS — InfoCom Global Services',
        legalName: 'InfoCom Global Services — Computer Institute',
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
      { key: 'academy.invoice_next_seq', value: '1001', valueType: 'number' },
      { key: 'academy.fee_due_days', value: '14', valueType: 'number' },
      { key: 'academy.late_fee_pct', value: '5', valueType: 'number' },
      { key: 'grading.passing_score', value: '60', valueType: 'number' },
      { key: 'grading.distinction_score', value: '90', valueType: 'number' },
      { key: 'attendance.min_rate_pct', value: '75', valueType: 'number' },
      { key: 'attendance.late_weight_pct', value: '75', valueType: 'number' },
      { key: 'certificate.code_prefix', value: 'IGS-CERT-2026', valueType: 'string' },
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

    // 3. Administration Department
    await tx.department.upsert({
      where: { code: 'ADMIN' },
      update: { name: 'Academy Administration' },
      create: {
        id: 'dept-admin',
        academyId: 'acad-infocom',
        code: 'ADMIN',
        name: 'Academy Administration',
        status: 'active',
      },
    });

    // 4. Default Certificate Template (structural metadata only, no personal accounts)
    await tx.certificateTemplate.upsert({
      where: { code: 'CERT-DEFAULT-2026' },
      update: {
        isActive: true,
        name: 'IGS — InfoCom Global Services Completion Template',
      },
      create: {
        id: 'tmpl-default-2026',
        code: 'CERT-DEFAULT-2026',
        name: 'IGS — InfoCom Global Services Completion Template',
        titleFormat: 'Verified Certificate of Completion',
        signatoryName: 'Academy Director',
        signatoryTitle: 'IGS — InfoCom Global Services',
        minCompletionPct: 100,
        minScore: 60,
        minAttendancePct: 75,
        isActive: true,
      },
    });
  });

  console.log('Production foundation seed completed (roles, academy profile, policies, ADMIN department, certificate template).');
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('seed.ts');

if (isDirectExecution) {
  seedProductionFoundation()
    .catch((err) => {
      console.error('Production seed failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
