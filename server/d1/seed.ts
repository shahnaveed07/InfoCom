import { sha256Hex, hashPasswordWorker } from '../worker-auth.ts';
import { d1Batch, d1First, d1Stmt, type D1DatabaseLike } from './client.ts';

export async function seedD1ProductionFoundation(db: D1DatabaseLike): Promise<void> {
  const statements = [
    d1Stmt(
      `INSERT INTO roles (id, code, name, description, is_system) VALUES
       ('role-admin', 'admin', 'Academy Administrator', 'Full institutional, admissions, financial, and audit governance access.', 1),
       ('role-instructor', 'instructor', 'Faculty Instructor', 'Academic delivery, curriculum tracking, grading, attendance, and schedules.', 1),
       ('role-student', 'student', 'Enrolled Student', 'Personal dashboard, grades, attendance alerts, schedules, and documents.', 1)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO academies (id, code, name, legal_name, email, phone, website, address, logo_data_url, timezone, currency)
       VALUES ('acad-infocom', 'INFOCOM-MAIN', 'IGS — InfoCom Global Services', 'InfoCom Global Services — Computer Institute', '', '', '',
               'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.', '', 'Asia/Kolkata', 'INR')
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, legal_name = excluded.legal_name, address = excluded.address, timezone = excluded.timezone, currency = excluded.currency`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO academy_settings (id, academy_id, key, value, value_type) VALUES
       ('set-academy-student-id-prefix', 'acad-infocom', 'academy.student_id_prefix', 'IGS', 'string'),
       ('set-academy-invoice-prefix', 'acad-infocom', 'academy.invoice_prefix', 'INV-2026', 'string'),
       ('set-academy-invoice-next-seq', 'acad-infocom', 'academy.invoice_next_seq', '1001', 'number'),
       ('set-academy-fee-due-days', 'acad-infocom', 'academy.fee_due_days', '14', 'number'),
       ('set-academy-late-fee-pct', 'acad-infocom', 'academy.late_fee_pct', '5', 'number'),
       ('set-grading-passing-score', 'acad-infocom', 'grading.passing_score', '60', 'number'),
       ('set-grading-distinction-score', 'acad-infocom', 'grading.distinction_score', '90', 'number'),
       ('set-attendance-min-rate-pct', 'acad-infocom', 'attendance.min_rate_pct', '75', 'number'),
       ('set-attendance-late-weight-pct', 'acad-infocom', 'attendance.late_weight_pct', '75', 'number'),
       ('set-certificate-code-prefix', 'acad-infocom', 'certificate.code_prefix', 'IGS-CERT-2026', 'string'),
       ('set-certificate-min-completion-pct', 'acad-infocom', 'certificate.min_completion_pct', '100', 'number'),
       ('set-certificate-min-weighted-score', 'acad-infocom', 'certificate.min_weighted_score', '60', 'number'),
       ('set-certificate-min-attendance-pct', 'acad-infocom', 'certificate.min_attendance_pct', '75', 'number'),
       ('set-session-reminder-window-hours', 'acad-infocom', 'session.reminder_window_hours', '24', 'number'),
       ('set-admission-portal-activation-policy', 'acad-infocom', 'admission.portal_activation_policy', 'on_approval', 'string')
       ON CONFLICT(academy_id, key) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO departments (id, academy_id, code, name, status)
       VALUES ('dept-admin', 'acad-infocom', 'ADMIN', 'Academy Administration', 'active')
       ON CONFLICT(code) DO UPDATE SET name = excluded.name`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO certificate_templates (id, code, name, title_format, signatory_name, signatory_title, min_completion_pct, min_score, min_attendance_pct, is_active)
       VALUES ('tmpl-default-2026', 'CERT-DEFAULT-2026', 'IGS — InfoCom Global Services Completion Template',
               'Verified Certificate of Completion', 'Academy Director', 'IGS — InfoCom Global Services', 100, 60, 75, 1)
       ON CONFLICT(code) DO UPDATE SET is_active = 1, name = excluded.name`,
      [],
      db
    ),
  ];

  await d1Batch(statements, db);
}

export async function seedD1DemoDataset(
  db: D1DatabaseLike,
  passwords: {
    adminPassword: string;
    instructorPassword: string;
    studentPassword: string;
  },
  options?: { bypassEnvGuardForTest?: boolean }
): Promise<void> {
  if (!options?.bypassEnvGuardForTest) {
    const nodeEnv = (typeof process !== 'undefined' ? process.env.NODE_ENV : '') || '';
    const allowDemo = (typeof process !== 'undefined' ? process.env.ALLOW_DEMO_SEED : '') || '';
    if (nodeEnv !== 'development' || allowDemo !== 'true') {
      throw new Error(
        'Refusing to run D1 demo seed outside NODE_ENV=development with ALLOW_DEMO_SEED=true.'
      );
    }
  }

  await seedD1ProductionFoundation(db);

  const [adminPwHash, instructorPwHash, studentPwHash] = await Promise.all([
    hashPasswordWorker(passwords.adminPassword),
    hashPasswordWorker(passwords.instructorPassword),
    hashPasswordWorker(passwords.studentPassword),
  ]);

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
        'Relational database design, entity-relationship modeling, normalization, complex SQL joins/aggregations, indexing, and administration.',
      prerequisites: 'Programming Fundamentals or Office Automation spreadsheets.',
      learningObjectives: [
        'Model normalized relational schemas up to Third Normal Form (3NF).',
        'Author complex SQL queries using joins, CTEs, subqueries, and window functions.',
        'Optimize query performance using indexes and transactional integrity controls.',
      ],
      modules: [
        { id: 'mod-db-1', code: 'MOD-1', title: 'ER Modeling & Relational Normalization', weight: 30, labHours: 12 },
        { id: 'mod-db-2', code: 'MOD-2', title: 'SQL Queries, Joins & Aggregations', weight: 40, labHours: 18 },
        { id: 'mod-db-3', code: 'MOD-3', title: 'Transactions, Indexing & SQL Admin Lab', weight: 30, labHours: 14 },
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

  const stmts = [
    d1Stmt(
      `INSERT INTO departments (id, academy_id, code, name, status) VALUES
       ('dept-cs-core', 'acad-infocom', 'CS-CORE', 'Core Computer Applications', 'active'),
       ('dept-swe-dev', 'acad-infocom', 'SWE-DEV', 'Software & Web Engineering', 'active'),
       ('dept-data-ai', 'acad-infocom', 'DATA-AI', 'Data Science & Analytics', 'active')
       ON CONFLICT(code) DO UPDATE SET name = excluded.name`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO academic_years (id, academy_id, code, name, start_date, end_date, is_current, status)
       VALUES ('ay-2026', 'acad-infocom', 'AY-2026', 'Academic Year 2026', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z', 1, 'Active')
       ON CONFLICT(code) DO UPDATE SET is_current = 1, status = 'Active'`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO academic_terms (id, academic_year_id, code, name, start_date, end_date, is_current, status)
       VALUES ('term-aut-2026', 'ay-2026', 'AUT-2026', 'Autumn 2026', '2026-09-01T00:00:00.000Z', '2026-12-20T23:59:59.000Z', 1, 'Active')
       ON CONFLICT(code) DO UPDATE SET is_current = 1, status = 'Active'`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO classrooms (id, academy_id, code, name, building, capacity, equipment, is_active) VALUES
       ('room-sop-lab1', 'acad-infocom', 'LAB-101', 'Sopore Computer Lab 1', 'Main Campus · Downtown Sopore', 24, 'Desktop workstations, Linux/Windows dual boot, projector', 1),
       ('room-sop-lab2', 'acad-infocom', 'LAB-102', 'Software Engineering Lab 2', 'Main Campus · Downtown Sopore', 22, 'Development workstations, local Git server, fiber LAN', 1),
       ('room-sop-201', 'acad-infocom', 'ROOM-201', 'Analytics & Seminar Room 201', 'Main Campus · Downtown Sopore', 28, 'Interactive display, Python/SQL lab terminals', 1)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, capacity = excluded.capacity`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO fee_plans (id, code, name, description, installment_count, currency, is_active) VALUES
       ('plan-standard', 'PLAN-STANDARD', 'Standard Tuition Plan', 'Two-installment tuition schedule.', 2, 'INR', 1),
       ('plan-full', 'PLAN-FULL', 'Full Upfront Tuition', 'Single upfront payment on enrollment.', 1, 'INR', 1)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, is_active = 1`,
      [],
      db
    ),
  ];

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
    stmts.push(
      d1Stmt(
        `INSERT INTO users (id, name, email, role, status, staff_code, student_code, department, password_hash, must_change_password)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 0)
         ON CONFLICT(email) DO NOTHING`,
        [acct.id, acct.name, acct.email, acct.role, acct.staffCode, acct.studentCode, acct.department, acct.passwordHash],
        db
      ),
      d1Stmt(
        `INSERT INTO user_roles (id, user_id, role_id)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, role_id) DO NOTHING`,
        [`ur-${acct.id}-role-${acct.role}`, acct.id, `role-${acct.role}`],
        db
      )
    );
  }

  stmts.push(
    d1Stmt(
      `INSERT INTO instructor_profiles (id, user_id, staff_code, department_id, specialization, qualification, bio, permissions_configured, permissions, hire_date, status)
       VALUES
       ('ip-inst-elena', 'inst-elena', 'IGS-INS-001', 'dept-swe-dev', 'Web Engineering & Software Foundations', 'M.Tech Computer Science', 'Leads practical full-stack web engineering and structured programming cohorts.', 1, ?, '2025-01-15T00:00:00.000Z', 'active'),
       ('ip-inst-david', 'inst-david', 'IGS-INS-002', 'dept-data-ai', 'Python, SQL Databases & Applied Analytics', 'M.Sc Data Systems', 'Leads relational database systems, Python automation, and business analytics labs.', 1, ?, '2025-02-01T00:00:00.000Z', 'active')
       ON CONFLICT(user_id) DO NOTHING`,
      [
        JSON.stringify([
          'enrollments:manage',
          'progress:manage',
          'grades:manage',
          'sessions:manage',
          'attendance:manage',
          'documents:upload',
          'certificates:issue',
        ]),
        JSON.stringify([
          'progress:manage',
          'grades:manage',
          'sessions:manage',
          'attendance:manage',
          'documents:upload',
        ]),
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO student_profiles (id, user_id, student_code, department_id, address, emergency_contact, academic_standing) VALUES
       ('sp-stu-aarav', 'stu-aarav', 'IGS-2026-0001', 'dept-swe-dev', 'Sopore, Jammu and Kashmir', 'Parent / Guardian', 'Good Standing'),
       ('sp-stu-zoya', 'stu-zoya', 'IGS-2026-0002', 'dept-data-ai', 'Sopore, Jammu and Kashmir', 'Parent / Guardian', 'Good Standing'),
       ('sp-stu-faizan', 'stu-faizan', 'IGS-2026-0003', 'dept-cs-core', 'Sopore, Jammu and Kashmir', 'Parent / Guardian', 'Good Standing')
       ON CONFLICT(user_id) DO NOTHING`,
      [],
      db
    )
  );

  for (const c of demoCourses) {
    stmts.push(
      d1Stmt(
        `INSERT INTO courses (
          id, code, slug, title, track, category, department_id, instructor_id,
          duration_weeks, tuition_fee, description, prerequisites, learning_objectives,
          grading_config, passing_score, min_attendance_rate,
          is_published, show_tuition_publicly, is_demo, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60, 75, 1, 1, 1, 0)
        ON CONFLICT(id) DO UPDATE SET
          slug = excluded.slug, title = excluded.title, track = excluded.track,
          category = excluded.category, tuition_fee = excluded.tuition_fee,
          is_published = 1, show_tuition_publicly = 1, is_demo = 1, is_archived = 0`,
        [
          c.id,
          c.code,
          c.slug,
          c.title,
          c.track,
          c.category,
          c.departmentId,
          c.instructorId,
          c.durationWeeks,
          c.tuitionFee,
          c.description,
          c.prerequisites,
          JSON.stringify(c.learningObjectives),
          JSON.stringify({ scaleName: 'Standard IGS Scale', passingGrade: 'D (60%+)' }),
        ],
        db
      )
    );

    for (let idx = 0; idx < c.modules.length; idx += 1) {
      const m = c.modules[idx];
      stmts.push(
        d1Stmt(
          `INSERT INTO course_modules (id, course_id, code, title, weight, lab_hours, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, weight = excluded.weight, lab_hours = excluded.lab_hours, sort_order = excluded.sort_order`,
          [m.id, c.id, m.code, m.title, m.weight, m.labHours, idx + 1],
          db
        )
      );
    }

    stmts.push(
      d1Stmt(
        `INSERT INTO fee_structures (id, course_id, fee_plan_id, tuition_amount, registration_fee, lab_fee, is_active)
         VALUES (?, ?, 'plan-standard', ?, '500.00', '0.00', 1)
         ON CONFLICT(id) DO UPDATE SET tuition_amount = excluded.tuition_amount, is_active = 1`,
        [`fs-${c.id}`, c.id, c.tuitionFee],
        db
      )
    );
  }

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
      startDate: '2026-09-07T00:00:00.000Z',
      endDate: '2026-12-20T00:00:00.000Z',
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
      startDate: '2026-09-07T00:00:00.000Z',
      endDate: '2026-12-18T00:00:00.000Z',
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
      startDate: '2026-09-10T00:00:00.000Z',
      endDate: '2026-11-15T00:00:00.000Z',
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
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2027-02-28T00:00:00.000Z',
      status: 'Planned',
    },
  ];

  for (const b of cohorts) {
    stmts.push(
      d1Stmt(
        `INSERT INTO cohorts (id, code, name, course_id, term_id, instructor_id, classroom_id, capacity, start_date, end_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, capacity = excluded.capacity`,
        [b.id, b.code, b.name, b.courseId, b.termId, b.instructorId, b.classroomId, b.capacity, b.startDate, b.endDate, b.status],
        db
      ),
      d1Stmt(
        `INSERT INTO instructor_assignments (id, instructor_id, batch_id, course_id, role, is_active)
         VALUES (?, ?, ?, ?, 'Lead', 1)
         ON CONFLICT(instructor_id, batch_id) DO UPDATE SET is_active = 1`,
        [`ia-${b.id}`, b.instructorId, b.id, b.courseId],
        db
      )
    );
  }

  const tomorrowStart = new Date(Date.now() + 18 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 2 * 60 * 60 * 1000);
  const pastStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const pastEnd = new Date(pastStart.getTime() + 2 * 60 * 60 * 1000);
  const certVerifyHash = await sha256Hex('IGS-CERT-2026-0001|stu-aarav|crs-igs-web|91.4');

  stmts.push(
    d1Stmt(
      `INSERT INTO enrollments (id, student_id, course_id, cohort_id, cohort, status, completed_module_ids, tuition_snapshot, batch_name_snapshot, instructor_name_snapshot)
       VALUES
       ('enr-demo-aarav-web', 'stu-aarav', 'crs-igs-web', 'bat-web-aut26', 'Morning Batch · Autumn 2026', 'Completed', ?, '14000.00', 'Morning Batch · Autumn 2026', 'Dr. Elena Vance'),
       ('enr-demo-zoya-da', 'stu-zoya', 'crs-igs-da', 'bat-da-aut26', 'Afternoon Batch · Autumn 2026', 'Active', ?, '13500.00', 'Afternoon Batch · Autumn 2026', 'Prof. David Okonkwo'),
       ('enr-demo-faizan-bca', 'stu-faizan', 'crs-igs-bca', 'bat-bca-aut26', 'Foundation Batch · Autumn 2026', 'Active', ?, '4500.00', 'Foundation Batch · Autumn 2026', 'Dr. Elena Vance')
       ON CONFLICT(id) DO NOTHING`,
      [
        JSON.stringify(['mod-web-1', 'mod-web-2', 'mod-web-3']),
        JSON.stringify(['mod-da-1']),
        JSON.stringify(['mod-bca-1']),
      ],
      db
    ),
    d1Stmt(
      `INSERT INTO class_sessions (id, course_id, cohort_id, classroom_id, cohort, title, topic, room, instructor_id, instructor_name, start_at, end_at, status)
       VALUES
       ('ses-demo-web-1', 'crs-igs-web', 'bat-web-aut26', 'room-sop-lab2', 'Morning Batch · Autumn 2026', 'REST API Design & TypeScript Capstone Review', 'Input validation, D1 SQLite integration, and error responses.', 'Software Engineering Lab 2', 'inst-elena', 'Dr. Elena Vance', ?, ?, 'Completed'),
       ('ses-demo-da-upcoming', 'crs-igs-da', 'bat-da-aut26', 'room-sop-201', 'Afternoon Batch · Autumn 2026', 'SQL Aggregations & Pandas Grouping Lab', 'Window functions, missing value imputation, and KPI tables.', 'Analytics & Seminar Room 201', 'inst-david', 'Prof. David Okonkwo', ?, ?, 'Scheduled')
       ON CONFLICT(id) DO NOTHING`,
      [pastStart.toISOString(), pastEnd.toISOString(), tomorrowStart.toISOString(), tomorrowEnd.toISOString()],
      db
    ),
    d1Stmt(
      `INSERT INTO attendance_records (id, session_id, course_id, enrollment_id, student_id, status, note, updated_by_user_id, updated_by)
       VALUES ('att-demo-1', 'ses-demo-web-1', 'crs-igs-web', 'enr-demo-aarav-web', 'stu-aarav', 'Present', 'Completed capstone API review.', 'inst-elena', 'Dr. Elena Vance')
       ON CONFLICT(session_id, student_id) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO assessments (id, course_id, module_id, title, assessment_type, max_score, weight, created_by_user_id) VALUES
       ('asm-web-1', 'crs-igs-web', 'mod-web-1', 'Module 1 Assessment', 'Module Assessment', 100, 25, 'inst-elena'),
       ('asm-web-2', 'crs-igs-web', 'mod-web-2', 'Module 2 Assessment', 'Module Assessment', 100, 40, 'inst-elena'),
       ('asm-web-3', 'crs-igs-web', 'mod-web-3', 'Module 3 Assessment', 'Module Assessment', 100, 35, 'inst-elena'),
       ('asm-da-1', 'crs-igs-da', 'mod-da-1', 'Data Cleaning Lab', 'Module Assessment', 100, 30, 'inst-elena')
       ON CONFLICT(id) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO module_grades (id, student_id, course_id, module_id, enrollment_id, assessment_id, score, max_score, feedback, graded_by_user_id, graded_by) VALUES
       ('grd-demo-1', 'stu-aarav', 'crs-igs-web', 'mod-web-1', 'enr-demo-aarav-web', 'asm-web-1', 92, 100, 'Clean semantic layout and responsive breakpoints.', 'inst-elena', 'Dr. Elena Vance'),
       ('grd-demo-2', 'stu-aarav', 'crs-igs-web', 'mod-web-2', 'enr-demo-aarav-web', 'asm-web-2', 89, 100, 'Strong TypeScript state handling.', 'inst-elena', 'Dr. Elena Vance'),
       ('grd-demo-3', 'stu-aarav', 'crs-igs-web', 'mod-web-3', 'enr-demo-aarav-web', 'asm-web-3', 94, 100, 'Well-structured REST API capstone.', 'inst-elena', 'Dr. Elena Vance'),
       ('grd-demo-4', 'stu-zoya', 'crs-igs-da', 'mod-da-1', 'enr-demo-zoya-da', 'asm-da-1', 86, 100, 'Thorough outlier handling in pandas.', 'inst-elena', 'Dr. Elena Vance')
       ON CONFLICT(student_id, assessment_id) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO fee_invoices (id, invoice_number, student_id, enrollment_id, course_id, fee_structure_id, description, subtotal, amount_due, amount_paid, currency, status, due_date, issued_by_user_id) VALUES
       ('inv-demo-1001', 'INV-2026-1001', 'stu-aarav', 'enr-demo-aarav-web', 'crs-igs-web', 'fs-crs-igs-web', 'Web Development — Full Tuition Fee', '14000.00', '14000.00', '14000.00', 'INR', 'Paid', '2026-09-20T00:00:00.000Z', 'adm-director'),
       ('inv-demo-1002', 'INV-2026-1002', 'stu-zoya', 'enr-demo-zoya-da', 'crs-igs-da', 'fs-crs-igs-da', 'Data Analytics — Tuition Fee', '13500.00', '13500.00', '7000.00', 'INR', 'Partial', '2026-10-15T00:00:00.000Z', 'adm-director')
       ON CONFLICT(invoice_number) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO payments (id, receipt_number, invoice_id, student_id, amount, method, reference_code, recorded_by_user_id, notes)
       VALUES ('pay-demo-1', 'RCPT-2026-5001', 'inv-demo-1001', 'stu-aarav', '14000.00', 'Bank Transfer', 'IGS-BT-9041', 'adm-director', 'Full tuition received at Sopore office.')
       ON CONFLICT(receipt_number) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount)
       VALUES ('pa-demo-1', 'pay-demo-1', 'inv-demo-1001', '14000.00')
       ON CONFLICT(payment_id, invoice_id) DO NOTHING`,
      [],
      db
    ),
    d1Stmt(
      `INSERT INTO certificates (id, certificate_code, verification_hash, student_id, course_id, enrollment_id, template_id, final_score, letter_grade, attendance_rate, issued_by_user_id, issued_by_name, course_title_snapshot, status)
       VALUES ('cert-demo-1', 'IGS-CERT-2026-0001', ?, 'stu-aarav', 'crs-igs-web', 'enr-demo-aarav-web', 'tmpl-default-2026', '91.40', 'A-', 100, 'adm-director', 'Academy Director', 'Web Development', 'Issued')
       ON CONFLICT(certificate_code) DO NOTHING`,
      [certVerifyHash],
      db
    ),
    d1Stmt(
      `INSERT INTO notifications (id, user_id, kind, title, message, related_course_id, read)
       VALUES ('notif-demo-1', 'stu-aarav', 'certificate', 'Certificate Issued · IGS-202', 'Your official Web Development certificate (IGS-CERT-2026-0001) is ready for download.', 'crs-igs-web', 0)
       ON CONFLICT(id) DO NOTHING`,
      [],
      db
    )
  );

  // Sync invoice_next_seq only if still at default 1001
  const seqSetting = await d1First<{ value: string }>(
    "SELECT value FROM academy_settings WHERE academy_id = 'acad-infocom' AND key = 'academy.invoice_next_seq'",
    [],
    db
  );
  if (seqSetting?.value === '1001') {
    stmts.push(
      d1Stmt(
        "UPDATE academy_settings SET value = '1003' WHERE academy_id = 'acad-infocom' AND key = 'academy.invoice_next_seq' AND value = '1001'",
        [],
        db
      )
    );
  }

  await d1Batch(stmts, db);
}
