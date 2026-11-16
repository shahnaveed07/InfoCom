import 'dotenv/config';
import crypto from 'node:crypto';
import { hashPassword } from '../server/auth.ts';
import { disconnectPrisma, prisma } from '../server/db/prisma.ts';
import { seedProductionFoundation } from './seed.ts';

if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error(
    'Refusing to run demo seed. Demo data is strictly restricted to NODE_ENV=development and ALLOW_DEMO_SEED=true.'
  );
}

const WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  '1234567890',
  'admin12345',
  'changeme12',
  'infocom123',
  'qwerty1234',
]);

function requireStrongDemoPassword(envVarName: string): string {
  const value = process.env[envVarName]?.trim() || '';
  if (!value) {
    throw new Error(
      `Missing required local development password: ${envVarName}. ` +
        'Configure SEED_ADMIN_PASSWORD, SEED_INSTRUCTOR_PASSWORD, and SEED_STUDENT_PASSWORD in your local .env file before running "npm run db:seed:demo".'
    );
  }
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  if (value.length < 10 || !hasLower || !hasUpper || !hasDigit || WEAK_PASSWORDS.has(value.toLowerCase())) {
    throw new Error(
      `Invalid ${envVarName}: local development seed passwords must be at least 10 characters long and contain uppercase, lowercase, and numeric characters.`
    );
  }
  return value;
}

async function main() {
  const adminPassword = requireStrongDemoPassword('SEED_ADMIN_PASSWORD');
  const instructorPassword = requireStrongDemoPassword('SEED_INSTRUCTOR_PASSWORD');
  const studentPassword = requireStrongDemoPassword('SEED_STUDENT_PASSWORD');

  await seedProductionFoundation();

  console.log('Seeding IGS — InfoCom Global Services development demo dataset...');
  console.log(
    '[demo-seed] Validated SEED_ADMIN_PASSWORD, SEED_INSTRUCTOR_PASSWORD, and SEED_STUDENT_PASSWORD from environment (existing user credentials will not be overwritten).'
  );

  const adminPwHash = await hashPassword(adminPassword);
  const instructorPwHash = await hashPassword(instructorPassword);
  const studentPwHash = await hashPassword(studentPassword);

  await prisma.$transaction(async (tx) => {
    // 1. Academic Departments
    const departments = [
      { id: 'dept-cs-core', code: 'CS-CORE', name: 'Core Computer Applications' },
      { id: 'dept-swe-dev', code: 'SWE-DEV', name: 'Software & Web Engineering' },
      { id: 'dept-data-ai', code: 'DATA-AI', name: 'Data Science & Analytics' },
    ];
    for (const d of departments) {
      await tx.department.upsert({
        where: { code: d.code },
        update: { name: d.name, status: 'active' },
        create: {
          id: d.id,
          academyId: 'acad-infocom',
          code: d.code,
          name: d.name,
          status: 'active',
        },
      });
    }

    // 2. Academic Year, Term, Classrooms & Fee Plans
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
      {
        id: 'room-sop-lab1',
        code: 'LAB-101',
        name: 'Sopore Computer Lab 1',
        building: 'Main Campus · Downtown Sopore',
        capacity: 24,
        equipment: 'Desktop workstations, Linux/Windows dual boot, projector',
      },
      {
        id: 'room-sop-lab2',
        code: 'LAB-102',
        name: 'Software Engineering Lab 2',
        building: 'Main Campus · Downtown Sopore',
        capacity: 22,
        equipment: 'Development workstations, local Git server, fiber LAN',
      },
      {
        id: 'room-sop-201',
        code: 'ROOM-201',
        name: 'Analytics & Seminar Room 201',
        building: 'Main Campus · Downtown Sopore',
        capacity: 28,
        equipment: 'Interactive display, Python/SQL lab terminals',
      },
    ];
    for (const rm of classrooms) {
      await tx.classroom.upsert({
        where: { code: rm.code },
        update: { name: rm.name, capacity: rm.capacity, building: rm.building },
        create: { ...rm, academyId: 'acad-infocom', isActive: true },
      });
    }

    await tx.feePlan.upsert({
      where: { code: 'PLAN-STANDARD' },
      update: { name: 'Standard Tuition Plan', currency: 'INR', isActive: true },
      create: {
        id: 'plan-standard',
        code: 'PLAN-STANDARD',
        name: 'Standard Tuition Plan',
        description: 'Two-installment tuition schedule.',
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
        description: 'Single upfront payment on enrollment.',
        installmentCount: 1,
        currency: 'INR',
        isActive: true,
      },
    });

    // 3. Demo Users (Admin, Instructors, Students)
    const demoUsers = [
      {
        id: 'adm-director',
        name: 'Academy Director',
        email: 'admin@infocom.edu',
        role: 'admin',
        staffCode: 'IGS-ADM-001',
        studentCode: null,
        department: 'Academy Administration',
        passwordHash: adminPwHash,
      },
      {
        id: 'inst-elena',
        name: 'Dr. Elena Vance',
        email: 'elena.vance@infocom-faculty.local',
        role: 'instructor',
        staffCode: 'IGS-INS-001',
        studentCode: null,
        department: 'Software & Web Engineering',
        passwordHash: instructorPwHash,
      },
      {
        id: 'inst-david',
        name: 'Prof. David Okonkwo',
        email: 'david.okonkwo@infocom-faculty.local',
        role: 'instructor',
        staffCode: 'IGS-INS-002',
        studentCode: null,
        department: 'Data Science & Analytics',
        passwordHash: instructorPwHash,
      },
      {
        id: 'stu-aarav',
        name: 'Aarav Sharma',
        email: 'aarav.sharma@igs-demo.local',
        role: 'student',
        staffCode: null,
        studentCode: 'IGS-2026-0001',
        department: 'Software & Web Engineering',
        passwordHash: studentPwHash,
      },
      {
        id: 'stu-zoya',
        name: 'Zoya Mir',
        email: 'zoya.mir@igs-demo.local',
        role: 'student',
        staffCode: null,
        studentCode: 'IGS-2026-0002',
        department: 'Data Science & Analytics',
        passwordHash: studentPwHash,
      },
      {
        id: 'stu-faizan',
        name: 'Faizan Lone',
        email: 'faizan.lone@igs-demo.local',
        role: 'student',
        staffCode: null,
        studentCode: 'IGS-2026-0003',
        department: 'Core Computer Applications',
        passwordHash: studentPwHash,
      },
    ];

    for (const acct of demoUsers) {
      const existing = await tx.user.findFirst({
        where: { OR: [{ id: acct.id }, { email: acct.email }] },
      });
      if (!existing) {
        await tx.user.create({
          data: {
            id: acct.id,
            name: acct.name,
            email: acct.email,
            role: acct.role,
            status: 'active',
            staffCode: acct.staffCode,
            studentCode: acct.studentCode,
            department: acct.department,
            passwordHash: acct.passwordHash,
            mustChangePassword: false,
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
            id: `ur-${resolvedUserId}-${roleRow.code}`,
            userId: resolvedUserId,
            roleId: roleRow.id,
          },
        });
      }
    }

    await tx.instructorProfile.upsert({
      where: { userId: 'inst-elena' },
      update: {},
      create: {
        id: 'ip-inst-elena',
        userId: 'inst-elena',
        staffCode: 'IGS-INS-001',
        departmentId: 'dept-swe-dev',
        specialization: 'Web Engineering & Software Foundations',
        qualification: 'M.Tech Computer Science',
        bio: 'Leads practical full-stack web engineering and structured programming cohorts.',
        permissionsConfigured: true,
        permissions: [
          'enrollments:manage',
          'progress:manage',
          'grades:manage',
          'sessions:manage',
          'attendance:manage',
          'documents:upload',
          'certificates:issue',
        ],
        hireDate: new Date('2025-01-15T00:00:00Z'),
        status: 'active',
      },
    });

    await tx.instructorProfile.upsert({
      where: { userId: 'inst-david' },
      update: {},
      create: {
        id: 'ip-inst-david',
        userId: 'inst-david',
        staffCode: 'IGS-INS-002',
        departmentId: 'dept-data-ai',
        specialization: 'Python, SQL Databases & Applied Analytics',
        qualification: 'M.Sc Data Systems',
        bio: 'Leads relational database systems, Python automation, and business analytics labs.',
        permissionsConfigured: true,
        permissions: [
          'progress:manage',
          'grades:manage',
          'sessions:manage',
          'attendance:manage',
          'documents:upload',
        ],
        hireDate: new Date('2025-02-01T00:00:00Z'),
        status: 'active',
      },
    });

    const studentProfiles = [
      { id: 'sp-stu-aarav', userId: 'stu-aarav', studentCode: 'IGS-2026-0001', departmentId: 'dept-swe-dev' },
      { id: 'sp-stu-zoya', userId: 'stu-zoya', studentCode: 'IGS-2026-0002', departmentId: 'dept-data-ai' },
      { id: 'sp-stu-faizan', userId: 'stu-faizan', studentCode: 'IGS-2026-0003', departmentId: 'dept-cs-core' },
    ];
    for (const sp of studentProfiles) {
      await tx.studentProfile.upsert({
        where: { userId: sp.userId },
        update: {},
        create: {
          ...sp,
          address: 'Sopore, Jammu and Kashmir',
          emergencyContact: 'Parent / Guardian',
          academicStanding: 'Good Standing',
        },
      });
    }

    // 4. Seven Official IGS Demo Courses (explicitly marked isDemo: true & isPublished: true)
    const demoCourses = [
      {
        id: 'crs-igs-bca',
        code: 'IGS-101',
        slug: 'basic-computer-applications',
        title: 'Basic Computer Applications',
        track: 'Computer Foundations',
        category: 'Certificate Program',
        departmentId: 'dept-cs-core',
        instructorId: 'inst-elena',
        durationWeeks: 8,
        tuitionFee: '4500.00',
        description:
          'Hands-on foundation in operating systems, file architecture, internet essentials, digital safety, and everyday workplace computing.',
        prerequisites: 'No prior computing experience required.',
        learningObjectives: [
          'Navigate desktop operating systems and organized file hierarchies confidently.',
          'Use internet communication, cloud drives, and safe browsing practices.',
          'Complete practical lab exercises in keyboarding, formatting, and digital workflows.',
        ],
        modules: [
          { id: 'mod-bca-1', code: 'MOD-1', title: 'Computer Hardware & OS Basics', weight: 30, labHours: 10 },
          { id: 'mod-bca-2', code: 'MOD-2', title: 'Internet, Email & Cloud Productivity', weight: 35, labHours: 12 },
          { id: 'mod-bca-3', code: 'MOD-3', title: 'Digital Hygiene & Practical Lab Capstone', weight: 35, labHours: 12 },
        ],
      },
      {
        id: 'crs-igs-off',
        code: 'IGS-102',
        slug: 'office-automation',
        title: 'Office Automation',
        track: 'Productivity & Administration',
        category: 'Certificate Program',
        departmentId: 'dept-cs-core',
        instructorId: 'inst-elena',
        durationWeeks: 10,
        tuitionFee: '5500.00',
        description:
          'Practical mastery of structured word processing, spreadsheet formulas and pivot summaries, and executive slide presentations for office administration.',
        prerequisites: 'Basic computer literacy recommended.',
        learningObjectives: [
          'Produce formal multi-page reports with styles, tables, and mail merge.',
          'Build automated spreadsheets using lookups, conditional formulas, and charts.',
          'Deliver clean, structured business presentations.',
        ],
        modules: [
          { id: 'mod-off-1', code: 'MOD-1', title: 'Structured Word Processing & Mail Merge', weight: 30, labHours: 12 },
          { id: 'mod-off-2', code: 'MOD-2', title: 'Spreadsheets, Formulas & Pivot Analysis', weight: 45, labHours: 18 },
          { id: 'mod-off-3', code: 'MOD-3', title: 'Executive Presentations & Office Workflows', weight: 25, labHours: 10 },
        ],
      },
      {
        id: 'crs-igs-prog',
        code: 'IGS-201',
        slug: 'programming-fundamentals',
        title: 'Programming Fundamentals',
        track: 'Software Engineering',
        category: 'Core Track',
        departmentId: 'dept-swe-dev',
        instructorId: 'inst-elena',
        durationWeeks: 12,
        tuitionFee: '8500.00',
        description:
          'Algorithmic problem solving, structured control flow, functions, arrays, recursion, and debugging discipline for aspiring software developers.',
        prerequisites: 'Basic Computer Applications or equivalent analytical aptitude.',
        learningObjectives: [
          'Break down problems into clear algorithms and flowcharts.',
          'Write modular programs using loops, conditionals, functions, and data structures.',
          'Debug logic errors systematically using step-through tools and unit checks.',
        ],
        modules: [
          { id: 'mod-prg-1', code: 'MOD-1', title: 'Logic, Control Flow & Problem Decomposition', weight: 30, labHours: 14 },
          { id: 'mod-prg-2', code: 'MOD-2', title: 'Functions, Arrays & Memory Models', weight: 35, labHours: 16 },
          { id: 'mod-prg-3', code: 'MOD-3', title: 'Algorithmic Practice & Console Project', weight: 35, labHours: 18 },
        ],
      },
      {
        id: 'crs-igs-web',
        code: 'IGS-202',
        slug: 'web-development',
        title: 'Web Development',
        track: 'Full-Stack Engineering',
        category: 'Career Bootcamp',
        departmentId: 'dept-swe-dev',
        instructorId: 'inst-elena',
        durationWeeks: 16,
        tuitionFee: '14000.00',
        description:
          'Modern responsive web engineering covering semantic HTML, CSS Grid/Flexbox, TypeScript/JavaScript DOM applications, REST APIs, and full-stack deployment.',
        prerequisites: 'Programming Fundamentals or familiarity with basic coding logic.',
        learningObjectives: [
          'Author accessible, responsive interfaces with semantic HTML and modern CSS.',
          'Build interactive client applications in TypeScript/JavaScript with API integration.',
          'Design and deploy RESTful backend endpoints connected to relational storage.',
        ],
        modules: [
          { id: 'mod-web-1', code: 'MOD-1', title: 'Semantic HTML5 & Responsive Layout Systems', weight: 25, labHours: 16 },
          { id: 'mod-web-2', code: 'MOD-2', title: 'Interactive JavaScript, TypeScript & DOM', weight: 40, labHours: 24 },
          { id: 'mod-web-3', code: 'MOD-3', title: 'REST APIs & Full-Stack Deployment Capstone', weight: 35, labHours: 24 },
        ],
      },
      {
        id: 'crs-igs-py',
        code: 'IGS-203',
        slug: 'python-programming',
        title: 'Python Programming',
        track: 'Software & Automation',
        category: 'Core Track',
        departmentId: 'dept-data-ai',
        instructorId: 'inst-david',
        durationWeeks: 12,
        tuitionFee: '9500.00',
        description:
          'Comprehensive Python programming from clean syntax and object-oriented design to file automation, HTTP APIs, and testing.',
        prerequisites: 'Basic computer usage; Programming Fundamentals helpful.',
        learningObjectives: [
          'Write idiomatic Python with lists, dictionaries, comprehensions, and OOP.',
          'Automate CSV/JSON/PDF workflows and interact with REST web services.',
          'Package and test Python scripts reliably with virtual environments.',
        ],
        modules: [
          { id: 'mod-py-1', code: 'MOD-1', title: 'Python Syntax, Collections & Functions', weight: 30, labHours: 14 },
          { id: 'mod-py-2', code: 'MOD-2', title: 'Object-Oriented Design & File Automation', weight: 35, labHours: 16 },
          { id: 'mod-py-3', code: 'MOD-3', title: 'APIs, Testing & Applied Automation Project', weight: 35, labHours: 18 },
        ],
      },
      {
        id: 'crs-igs-db',
        code: 'IGS-204',
        slug: 'database-management',
        title: 'Database Management',
        track: 'Data Engineering',
        category: 'Core Track',
        departmentId: 'dept-data-ai',
        instructorId: 'inst-david',
        durationWeeks: 10,
        tuitionFee: '9000.00',
        description:
          'Relational database design, entity-relationship modeling, normalization, complex SQL joins/aggregations, indexing, and PostgreSQL administration.',
        prerequisites: 'Programming Fundamentals or Office Automation spreadsheets.',
        learningObjectives: [
          'Model normalized relational schemas up to Third Normal Form (3NF).',
          'Author complex SQL queries using joins, CTEs, subqueries, and window functions.',
          'Optimize query performance using indexes and transactional integrity controls.',
        ],
        modules: [
          { id: 'mod-db-1', code: 'MOD-1', title: 'ER Modeling & Relational Normalization', weight: 30, labHours: 12 },
          { id: 'mod-db-2', code: 'MOD-2', title: 'SQL Queries, Joins & Aggregations', weight: 40, labHours: 18 },
          { id: 'mod-db-3', code: 'MOD-3', title: 'Transactions, Indexing & PostgreSQL Lab', weight: 30, labHours: 14 },
        ],
      },
      {
        id: 'crs-igs-da',
        code: 'IGS-301',
        slug: 'data-analytics',
        title: 'Data Analytics',
        track: 'Data Science & BI',
        category: 'Career Bootcamp',
        departmentId: 'dept-data-ai',
        instructorId: 'inst-david',
        durationWeeks: 14,
        tuitionFee: '13500.00',
        description:
          'End-to-end analytical workflows covering data cleaning, SQL extraction, Python pandas exploration, statistical summaries, and executive dashboarding.',
        prerequisites: 'Office Automation or basic Python/SQL familiarity.',
        learningObjectives: [
          'Clean, transform, and validate messy real-world tabular datasets.',
          'Perform exploratory quantitative analysis with SQL and Python pandas.',
          'Communicate actionable metrics through clear visual charts and KPI reports.',
        ],
        modules: [
          { id: 'mod-da-1', code: 'MOD-1', title: 'Data Wrangling & Exploratory Statistics', weight: 30, labHours: 16 },
          { id: 'mod-da-2', code: 'MOD-2', title: 'SQL & Python Pandas Analytical Pipelines', weight: 40, labHours: 22 },
          { id: 'mod-da-3', code: 'MOD-3', title: 'KPI Dashboarding & Analytical Case Study', weight: 30, labHours: 18 },
        ],
      },
    ];

    for (const c of demoCourses) {
      await tx.course.upsert({
        where: { id: c.id },
        update: {
          slug: c.slug,
          title: c.title,
          track: c.track,
          category: c.category,
          departmentId: c.departmentId,
          instructorId: c.instructorId,
          durationWeeks: c.durationWeeks,
          tuitionFee: c.tuitionFee,
          description: c.description,
          prerequisites: c.prerequisites,
          learningObjectives: c.learningObjectives,
          isPublished: true,
          showTuitionPublicly: true,
          isDemo: true,
          isArchived: false,
        },
        create: {
          id: c.id,
          code: c.code,
          slug: c.slug,
          title: c.title,
          track: c.track,
          category: c.category,
          departmentId: c.departmentId,
          instructorId: c.instructorId,
          durationWeeks: c.durationWeeks,
          tuitionFee: c.tuitionFee,
          description: c.description,
          prerequisites: c.prerequisites,
          learningObjectives: c.learningObjectives,
          gradingConfig: { scaleName: 'Standard IGS Scale', passingGrade: 'D (60%+)' },
          passingScore: 60,
          minAttendanceRate: 75,
          isPublished: true,
          showTuitionPublicly: true,
          isDemo: true,
          isArchived: false,
        },
      });

      for (let idx = 0; idx < c.modules.length; idx += 1) {
        const m = c.modules[idx];
        await tx.courseModule.upsert({
          where: { id: m.id },
          update: {
            code: m.code,
            title: m.title,
            weight: m.weight,
            labHours: m.labHours,
            sortOrder: idx + 1,
          },
          create: {
            id: m.id,
            courseId: c.id,
            code: m.code,
            title: m.title,
            weight: m.weight,
            labHours: m.labHours,
            sortOrder: idx + 1,
          },
        });
      }

      await tx.feeStructure.upsert({
        where: { id: `fs-${c.id}` },
        update: {
          tuitionAmount: c.tuitionFee,
          isActive: true,
        },
        create: {
          id: `fs-${c.id}`,
          courseId: c.id,
          feePlanId: 'plan-standard',
          tuitionAmount: c.tuitionFee,
          registrationFee: '500.00',
          labFee: '0.00',
          isActive: true,
        },
      });
    }

    // 5. Batches / Cohorts
    const cohorts = [
      {
        id: 'bat-web-aut26',
        code: 'IGS202-AUT26-A',
        name: 'Morning Batch · Autumn 2026',
        courseId: 'crs-igs-web',
        termId: 'term-aut-2026',
        instructorId: 'inst-elena',
        classroomId: 'room-sop-lab2',
        capacity: 22,
        startDate: new Date('2026-09-07T00:00:00Z'),
        endDate: new Date('2026-12-20T00:00:00Z'),
        status: 'Active',
      },
      {
        id: 'bat-da-aut26',
        code: 'IGS301-AUT26-A',
        name: 'Afternoon Batch · Autumn 2026',
        courseId: 'crs-igs-da',
        termId: 'term-aut-2026',
        instructorId: 'inst-david',
        classroomId: 'room-sop-201',
        capacity: 24,
        startDate: new Date('2026-09-07T00:00:00Z'),
        endDate: new Date('2026-12-18T00:00:00Z'),
        status: 'Active',
      },
      {
        id: 'bat-bca-aut26',
        code: 'IGS101-AUT26-A',
        name: 'Foundation Batch · Autumn 2026',
        courseId: 'crs-igs-bca',
        termId: 'term-aut-2026',
        instructorId: 'inst-elena',
        classroomId: 'room-sop-lab1',
        capacity: 24,
        startDate: new Date('2026-09-10T00:00:00Z'),
        endDate: new Date('2026-11-15T00:00:00Z'),
        status: 'Active',
      },
      {
        id: 'bat-py-win26',
        code: 'IGS203-WIN26-A',
        name: 'Upcoming Winter Batch',
        courseId: 'crs-igs-py',
        termId: 'term-aut-2026',
        instructorId: 'inst-david',
        classroomId: 'room-sop-lab2',
        capacity: 20,
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2027-02-28T00:00:00Z'),
        status: 'Planned',
      },
    ];

    for (const b of cohorts) {
      await tx.batch.upsert({
        where: { id: b.id },
        update: { status: b.status, capacity: b.capacity },
        create: b,
      });
      await tx.instructorAssignment.upsert({
        where: {
          instructorId_batchId: { instructorId: b.instructorId, batchId: b.id },
        },
        update: { isActive: true },
        create: {
          id: `ia-${b.id}`,
          instructorId: b.instructorId,
          batchId: b.id,
          courseId: b.courseId,
          role: 'Lead',
          isActive: true,
        },
      });
    }

    // 6. Demo Enrollments, Sessions, Attendance, Assessments, Grades, Invoices, Certificates
    await tx.enrollment.upsert({
      where: { id: 'enr-demo-aarav-web' },
      update: {},
      create: {
        id: 'enr-demo-aarav-web',
        studentId: 'stu-aarav',
        courseId: 'crs-igs-web',
        cohortId: 'bat-web-aut26',
        cohort: 'Morning Batch · Autumn 2026',
        status: 'Completed',
        completedModuleIds: ['mod-web-1', 'mod-web-2', 'mod-web-3'],
        tuitionSnapshot: '14000.00',
        batchNameSnapshot: 'Morning Batch · Autumn 2026',
        instructorNameSnapshot: 'Dr. Elena Vance',
      },
    });

    await tx.enrollment.upsert({
      where: { id: 'enr-demo-zoya-da' },
      update: {},
      create: {
        id: 'enr-demo-zoya-da',
        studentId: 'stu-zoya',
        courseId: 'crs-igs-da',
        cohortId: 'bat-da-aut26',
        cohort: 'Afternoon Batch · Autumn 2026',
        status: 'Active',
        completedModuleIds: ['mod-da-1'],
        tuitionSnapshot: '13500.00',
        batchNameSnapshot: 'Afternoon Batch · Autumn 2026',
        instructorNameSnapshot: 'Prof. David Okonkwo',
      },
    });

    await tx.enrollment.upsert({
      where: { id: 'enr-demo-faizan-bca' },
      update: {},
      create: {
        id: 'enr-demo-faizan-bca',
        studentId: 'stu-faizan',
        courseId: 'crs-igs-bca',
        cohortId: 'bat-bca-aut26',
        cohort: 'Foundation Batch · Autumn 2026',
        status: 'Active',
        completedModuleIds: ['mod-bca-1'],
        tuitionSnapshot: '4500.00',
        batchNameSnapshot: 'Foundation Batch · Autumn 2026',
        instructorNameSnapshot: 'Dr. Elena Vance',
      },
    });

    const tomorrowStart = new Date(Date.now() + 18 * 60 * 60 * 1000);
    const tomorrowEnd = new Date(tomorrowStart.getTime() + 2 * 60 * 60 * 1000);
    const pastStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const pastEnd = new Date(pastStart.getTime() + 2 * 60 * 60 * 1000);

    await tx.classSession.upsert({
      where: { id: 'ses-demo-web-1' },
      update: {},
      create: {
        id: 'ses-demo-web-1',
        courseId: 'crs-igs-web',
        cohortId: 'bat-web-aut26',
        classroomId: 'room-sop-lab2',
        cohort: 'Morning Batch · Autumn 2026',
        title: 'REST API Design & TypeScript Capstone Review',
        topic: 'Input validation, PostgreSQL integration, and error responses.',
        room: 'Software Engineering Lab 2',
        instructorId: 'inst-elena',
        instructorName: 'Dr. Elena Vance',
        startIso: pastStart,
        endIso: pastEnd,
        status: 'Completed',
      },
    });

    await tx.classSession.upsert({
      where: { id: 'ses-demo-da-upcoming' },
      update: {},
      create: {
        id: 'ses-demo-da-upcoming',
        courseId: 'crs-igs-da',
        cohortId: 'bat-da-aut26',
        classroomId: 'room-sop-201',
        cohort: 'Afternoon Batch · Autumn 2026',
        title: 'SQL Aggregations & Pandas Grouping Lab',
        topic: 'Window functions, missing value imputation, and KPI tables.',
        room: 'Analytics & Seminar Room 201',
        instructorId: 'inst-david',
        instructorName: 'Prof. David Okonkwo',
        startIso: tomorrowStart,
        endIso: tomorrowEnd,
        status: 'Scheduled',
      },
    });

    await tx.attendance.upsert({
      where: { sessionId_studentId: { sessionId: 'ses-demo-web-1', studentId: 'stu-aarav' } },
      update: {},
      create: {
        id: 'att-demo-1',
        sessionId: 'ses-demo-web-1',
        courseId: 'crs-igs-web',
        enrollmentId: 'enr-demo-aarav-web',
        studentId: 'stu-aarav',
        status: 'Present',
        note: 'Completed capstone API review.',
        updatedByUserId: 'inst-elena',
        updatedBy: 'Dr. Elena Vance',
      },
    });

    const assessments = [
      { id: 'asm-web-1', courseId: 'crs-igs-web', moduleId: 'mod-web-1', title: 'Module 1 Assessment', maxScore: 100, weight: 25 },
      { id: 'asm-web-2', courseId: 'crs-igs-web', moduleId: 'mod-web-2', title: 'Module 2 Assessment', maxScore: 100, weight: 40 },
      { id: 'asm-web-3', courseId: 'crs-igs-web', moduleId: 'mod-web-3', title: 'Module 3 Assessment', maxScore: 100, weight: 35 },
      { id: 'asm-da-1', courseId: 'crs-igs-da', moduleId: 'mod-da-1', title: 'Data Cleaning Lab', maxScore: 100, weight: 30 },
    ];
    for (const a of assessments) {
      await tx.assessment.upsert({
        where: { id: a.id },
        update: {},
        create: {
          ...a,
          assessmentType: 'Module Assessment',
          createdByUserId: 'inst-elena',
        },
      });
    }

    const demoGrades = [
      { id: 'grd-demo-1', studentId: 'stu-aarav', courseId: 'crs-igs-web', moduleId: 'mod-web-1', enrollmentId: 'enr-demo-aarav-web', assessmentId: 'asm-web-1', score: 92, feedback: 'Clean semantic layout and responsive breakpoints.' },
      { id: 'grd-demo-2', studentId: 'stu-aarav', courseId: 'crs-igs-web', moduleId: 'mod-web-2', enrollmentId: 'enr-demo-aarav-web', assessmentId: 'asm-web-2', score: 89, feedback: 'Strong TypeScript state handling.' },
      { id: 'grd-demo-3', studentId: 'stu-aarav', courseId: 'crs-igs-web', moduleId: 'mod-web-3', enrollmentId: 'enr-demo-aarav-web', assessmentId: 'asm-web-3', score: 94, feedback: 'Well-structured REST API capstone.' },
      { id: 'grd-demo-4', studentId: 'stu-zoya', courseId: 'crs-igs-da', moduleId: 'mod-da-1', enrollmentId: 'enr-demo-zoya-da', assessmentId: 'asm-da-1', score: 86, feedback: 'Thorough outlier handling in pandas.' },
    ];
    for (const g of demoGrades) {
      await tx.grade.upsert({
        where: { studentId_assessmentId: { studentId: g.studentId, assessmentId: g.assessmentId } },
        update: {},
        create: {
          ...g,
          maxScore: 100,
          gradedByUserId: 'inst-elena',
          gradedBy: 'Dr. Elena Vance',
        },
      });
    }

    const inv1 = await tx.invoice.upsert({
      where: { invoiceNumber: 'INV-2026-1001' },
      update: {},
      create: {
        id: 'inv-demo-1001',
        invoiceNumber: 'INV-2026-1001',
        studentId: 'stu-aarav',
        enrollmentId: 'enr-demo-aarav-web',
        courseId: 'crs-igs-web',
        feeStructureId: 'fs-crs-igs-web',
        description: 'Web Development — Full Tuition Fee',
        subtotal: '14000.00',
        amountDue: '14000.00',
        amountPaid: '14000.00',
        currency: 'INR',
        status: 'Paid',
        dueDate: new Date('2026-09-20T00:00:00Z'),
        issuedByUserId: 'adm-director',
      },
    });

    await tx.invoice.upsert({
      where: { invoiceNumber: 'INV-2026-1002' },
      update: {},
      create: {
        id: 'inv-demo-1002',
        invoiceNumber: 'INV-2026-1002',
        studentId: 'stu-zoya',
        enrollmentId: 'enr-demo-zoya-da',
        courseId: 'crs-igs-da',
        feeStructureId: 'fs-crs-igs-da',
        description: 'Data Analytics — Tuition Fee',
        subtotal: '13500.00',
        amountDue: '13500.00',
        amountPaid: '7000.00',
        currency: 'INR',
        status: 'Partial',
        dueDate: new Date('2026-10-15T00:00:00Z'),
        issuedByUserId: 'adm-director',
      },
    });

    const pay1 = await tx.payment.upsert({
      where: { receiptNumber: 'RCPT-2026-5001' },
      update: {},
      create: {
        id: 'pay-demo-1',
        receiptNumber: 'RCPT-2026-5001',
        invoiceId: inv1.id,
        studentId: inv1.studentId,
        amount: '14000.00',
        method: 'Bank Transfer',
        referenceCode: 'IGS-BT-9041',
        recordedByUserId: 'adm-director',
        notes: 'Full tuition received at Sopore office.',
      },
    });

    await tx.paymentAllocation.upsert({
      where: { paymentId_invoiceId: { paymentId: pay1.id, invoiceId: inv1.id } },
      update: {},
      create: {
        id: 'pa-demo-1',
        paymentId: pay1.id,
        invoiceId: inv1.id,
        allocatedAmount: '14000.00',
      },
    });

    const certVerifyHash = crypto
      .createHash('sha256')
      .update('IGS-CERT-2026-0001|stu-aarav|crs-igs-web|91.4')
      .digest('hex');

    await tx.certificate.upsert({
      where: { certificateCode: 'IGS-CERT-2026-0001' },
      update: {},
      create: {
        id: 'cert-demo-1',
        certificateCode: 'IGS-CERT-2026-0001',
        verificationHash: certVerifyHash,
        studentId: 'stu-aarav',
        courseId: 'crs-igs-web',
        enrollmentId: 'enr-demo-aarav-web',
        templateId: 'tmpl-default-2026',
        finalScore: '91.40',
        letterGrade: 'A-',
        attendanceRate: 100,
        issuedByUserId: 'adm-director',
        issuedByName: 'Academy Director',
        courseTitleSnapshot: 'Web Development',
        status: 'Issued',
      },
    });

    await tx.notification.upsert({
      where: { id: 'notif-demo-1' },
      update: {},
      create: {
        id: 'notif-demo-1',
        userId: 'stu-aarav',
        kind: 'certificate',
        title: 'Certificate Issued · IGS-202',
        message: 'Your official Web Development certificate (IGS-CERT-2026-0001) is ready for download.',
        relatedCourseId: 'crs-igs-web',
        read: false,
      },
    });
  });

  console.log('Development demo seed completed successfully (7 IGS demo courses + demo accounts).');
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
