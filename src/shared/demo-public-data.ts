import type {
  FeePlanSummary,
  PublicAcademyInfo,
  PublicCourseDetail,
  PublicCourseSummary,
} from './types';

/**
 * Frontend-native synthetic demo fixtures mirrored from prisma/seed-demo.ts.
 * Used strictly for public informational preview when VITE_PUBLIC_DATA_MODE=demo
 * or when AUTO mode detects the IGS backend / PostgreSQL database is unavailable.
 * Never used for authentication, student records, payments, certificates, or admission persistence.
 */
export const IS_SYNTHETIC_DEMO_FIXTURE = true as const;

export const OFFICIAL_IGS_ADDRESS =
  'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

export const DEMO_PUBLIC_ACADEMY: PublicAcademyInfo = {
  name: 'IGS — InfoCom Global Services',
  legalName: 'InfoCom Global Services — Computer Institute',
  slogan: 'Learn Today, Build Tomorrow.',
  address: OFFICIAL_IGS_ADDRESS,
  phone: '',
  email: '',
  website: '',
  logoDataUrl: '',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
};

export const DEMO_PUBLIC_FEE_PLANS: FeePlanSummary[] = [
  {
    id: 'plan-standard',
    code: 'PLAN-STANDARD',
    name: 'Standard Tuition Plan',
    description: 'Two-installment illustrative tuition schedule.',
    installmentCount: 2,
    currency: 'INR',
    isActive: true,
  },
  {
    id: 'plan-full',
    code: 'PLAN-FULL',
    name: 'Full Upfront Tuition',
    description: 'Single illustrative upfront payment option.',
    installmentCount: 1,
    currency: 'INR',
    isActive: true,
  },
];

export const DEMO_PUBLIC_COURSES: PublicCourseDetail[] = [
  {
    id: 'crs-igs-bca',
    code: 'IGS-101',
    slug: 'basic-computer-applications',
    title: 'Basic Computer Applications',
    track: 'Computer Foundations',
    category: 'Certificate Program',
    departmentName: 'Core Computer Applications',
    description:
      'Hands-on foundation in operating systems, file architecture, internet essentials, digital safety, and everyday workplace computing.',
    prerequisites: 'No prior computing experience required.',
    learningObjectives: [
      'Navigate desktop operating systems and organized file hierarchies confidently.',
      'Use internet communication, cloud drives, and safe browsing practices.',
      'Complete practical lab exercises in keyboarding, formatting, and digital workflows.',
    ],
    durationWeeks: 8,
    tuitionFee: '4500.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 34,
    modules: [
      { id: 'mod-bca-1', code: 'MOD-1', title: 'Computer Hardware & OS Basics', weight: 30, labHours: 10, sortOrder: 1 },
      { id: 'mod-bca-2', code: 'MOD-2', title: 'Internet, Email & Cloud Productivity', weight: 35, labHours: 12, sortOrder: 2 },
      { id: 'mod-bca-3', code: 'MOD-3', title: 'Digital Hygiene & Practical Lab Capstone', weight: 35, labHours: 12, sortOrder: 3 },
    ],
    activeCohorts: [
      {
        id: 'bat-bca-aut26',
        code: 'IGS101-AUT26-A',
        name: 'Foundation Batch · Autumn 2026',
        status: 'Active',
        startDate: '2026-09-10T00:00:00.000Z',
        endDate: '2026-11-15T00:00:00.000Z',
        capacity: 24,
      },
    ],
  },
  {
    id: 'crs-igs-off',
    code: 'IGS-102',
    slug: 'office-automation',
    title: 'Office Automation',
    track: 'Productivity & Administration',
    category: 'Certificate Program',
    departmentName: 'Core Computer Applications',
    description:
      'Practical mastery of structured word processing, spreadsheet formulas and pivot summaries, and executive slide presentations for office administration.',
    prerequisites: 'Basic computer literacy recommended.',
    learningObjectives: [
      'Produce formal multi-page reports with styles, tables, and mail merge.',
      'Build automated spreadsheets using lookups, conditional formulas, and charts.',
      'Deliver clean, structured business presentations.',
    ],
    durationWeeks: 10,
    tuitionFee: '5500.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 40,
    modules: [
      { id: 'mod-off-1', code: 'MOD-1', title: 'Structured Word Processing & Mail Merge', weight: 30, labHours: 12, sortOrder: 1 },
      { id: 'mod-off-2', code: 'MOD-2', title: 'Spreadsheets, Formulas & Pivot Analysis', weight: 45, labHours: 18, sortOrder: 2 },
      { id: 'mod-off-3', code: 'MOD-3', title: 'Executive Presentations & Office Workflows', weight: 25, labHours: 10, sortOrder: 3 },
    ],
    activeCohorts: [],
  },
  {
    id: 'crs-igs-prog',
    code: 'IGS-201',
    slug: 'programming-fundamentals',
    title: 'Programming Fundamentals',
    track: 'Software Engineering',
    category: 'Core Track',
    departmentName: 'Software & Web Engineering',
    description:
      'Algorithmic problem solving, structured control flow, functions, arrays, recursion, and debugging discipline for aspiring software developers.',
    prerequisites: 'Basic Computer Applications or equivalent analytical aptitude.',
    learningObjectives: [
      'Break down problems into clear algorithms and flowcharts.',
      'Write modular programs using loops, conditionals, functions, and data structures.',
      'Debug logic errors systematically using step-through tools and unit checks.',
    ],
    durationWeeks: 12,
    tuitionFee: '8500.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 48,
    modules: [
      { id: 'mod-prg-1', code: 'MOD-1', title: 'Logic, Control Flow & Problem Decomposition', weight: 30, labHours: 14, sortOrder: 1 },
      { id: 'mod-prg-2', code: 'MOD-2', title: 'Functions, Arrays & Memory Models', weight: 35, labHours: 16, sortOrder: 2 },
      { id: 'mod-prg-3', code: 'MOD-3', title: 'Algorithmic Practice & Console Project', weight: 35, labHours: 18, sortOrder: 3 },
    ],
    activeCohorts: [],
  },
  {
    id: 'crs-igs-web',
    code: 'IGS-202',
    slug: 'web-development',
    title: 'Web Development',
    track: 'Full-Stack Engineering',
    category: 'Career Bootcamp',
    departmentName: 'Software & Web Engineering',
    description:
      'Modern responsive web engineering covering semantic HTML, CSS Grid/Flexbox, TypeScript/JavaScript DOM applications, REST APIs, and full-stack deployment.',
    prerequisites: 'Programming Fundamentals or familiarity with basic coding logic.',
    learningObjectives: [
      'Author accessible, responsive interfaces with semantic HTML and modern CSS.',
      'Build interactive client applications in TypeScript/JavaScript with API integration.',
      'Design and deploy RESTful backend endpoints connected to relational storage.',
    ],
    durationWeeks: 16,
    tuitionFee: '14000.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 64,
    modules: [
      { id: 'mod-web-1', code: 'MOD-1', title: 'Semantic HTML5 & Responsive Layout Systems', weight: 25, labHours: 16, sortOrder: 1 },
      { id: 'mod-web-2', code: 'MOD-2', title: 'Interactive JavaScript, TypeScript & DOM', weight: 40, labHours: 24, sortOrder: 2 },
      { id: 'mod-web-3', code: 'MOD-3', title: 'REST APIs & Full-Stack Deployment Capstone', weight: 35, labHours: 24, sortOrder: 3 },
    ],
    activeCohorts: [
      {
        id: 'bat-web-aut26',
        code: 'IGS202-AUT26-A',
        name: 'Morning Batch · Autumn 2026',
        status: 'Active',
        startDate: '2026-09-07T00:00:00.000Z',
        endDate: '2026-12-20T00:00:00.000Z',
        capacity: 22,
      },
    ],
  },
  {
    id: 'crs-igs-py',
    code: 'IGS-203',
    slug: 'python-programming',
    title: 'Python Programming',
    track: 'Software & Automation',
    category: 'Core Track',
    departmentName: 'Data Science & Analytics',
    description:
      'Comprehensive Python programming from clean syntax and object-oriented design to file automation, HTTP APIs, and testing.',
    prerequisites: 'Basic computer usage; Programming Fundamentals helpful.',
    learningObjectives: [
      'Write idiomatic Python with lists, dictionaries, comprehensions, and OOP.',
      'Automate CSV/JSON/PDF workflows and interact with REST web services.',
      'Package and test Python scripts reliably with virtual environments.',
    ],
    durationWeeks: 12,
    tuitionFee: '9500.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 48,
    modules: [
      { id: 'mod-py-1', code: 'MOD-1', title: 'Python Syntax, Collections & Functions', weight: 30, labHours: 14, sortOrder: 1 },
      { id: 'mod-py-2', code: 'MOD-2', title: 'Object-Oriented Design & File Automation', weight: 35, labHours: 16, sortOrder: 2 },
      { id: 'mod-py-3', code: 'MOD-3', title: 'APIs, Testing & Applied Automation Project', weight: 35, labHours: 18, sortOrder: 3 },
    ],
    activeCohorts: [
      {
        id: 'bat-py-win26',
        code: 'IGS203-WIN26-A',
        name: 'Upcoming Winter Batch',
        status: 'Planned',
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2027-02-28T00:00:00.000Z',
        capacity: 20,
      },
    ],
  },
  {
    id: 'crs-igs-db',
    code: 'IGS-204',
    slug: 'database-management',
    title: 'Database Management',
    track: 'Data Engineering',
    category: 'Core Track',
    departmentName: 'Data Science & Analytics',
    description:
      'Relational database design, entity-relationship modeling, normalization, complex SQL joins/aggregations, indexing, and PostgreSQL administration.',
    prerequisites: 'Programming Fundamentals or Office Automation spreadsheets.',
    learningObjectives: [
      'Model normalized relational schemas up to Third Normal Form (3NF).',
      'Author complex SQL queries using joins, CTEs, subqueries, and window functions.',
      'Optimize query performance using indexes and transactional integrity controls.',
    ],
    durationWeeks: 10,
    tuitionFee: '9000.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 44,
    modules: [
      { id: 'mod-db-1', code: 'MOD-1', title: 'ER Modeling & Relational Normalization', weight: 30, labHours: 12, sortOrder: 1 },
      { id: 'mod-db-2', code: 'MOD-2', title: 'SQL Queries, Joins & Aggregations', weight: 40, labHours: 18, sortOrder: 2 },
      { id: 'mod-db-3', code: 'MOD-3', title: 'Transactions, Indexing & PostgreSQL Lab', weight: 30, labHours: 14, sortOrder: 3 },
    ],
    activeCohorts: [],
  },
  {
    id: 'crs-igs-da',
    code: 'IGS-301',
    slug: 'data-analytics',
    title: 'Data Analytics',
    track: 'Data Science & BI',
    category: 'Career Bootcamp',
    departmentName: 'Data Science & Analytics',
    description:
      'End-to-end analytical workflows covering data cleaning, SQL extraction, Python pandas exploration, statistical summaries, and executive dashboarding.',
    prerequisites: 'Office Automation or basic Python/SQL familiarity.',
    learningObjectives: [
      'Clean, transform, and validate messy real-world tabular datasets.',
      'Perform exploratory quantitative analysis with SQL and Python pandas.',
      'Communicate actionable metrics through clear visual charts and KPI reports.',
    ],
    durationWeeks: 14,
    tuitionFee: '13500.00',
    showTuitionPublicly: true,
    isDemo: true,
    currency: 'INR',
    moduleCount: 3,
    totalLabHours: 56,
    modules: [
      { id: 'mod-da-1', code: 'MOD-1', title: 'Data Wrangling & Exploratory Statistics', weight: 30, labHours: 16, sortOrder: 1 },
      { id: 'mod-da-2', code: 'MOD-2', title: 'SQL & Python Pandas Analytical Pipelines', weight: 40, labHours: 22, sortOrder: 2 },
      { id: 'mod-da-3', code: 'MOD-3', title: 'KPI Dashboarding & Analytical Case Study', weight: 30, labHours: 18, sortOrder: 3 },
    ],
    activeCohorts: [
      {
        id: 'bat-da-aut26',
        code: 'IGS301-AUT26-A',
        name: 'Afternoon Batch · Autumn 2026',
        status: 'Active',
        startDate: '2026-09-07T00:00:00.000Z',
        endDate: '2026-12-18T00:00:00.000Z',
        capacity: 24,
      },
    ],
  },
];

export function getDemoCourseSummaries(): PublicCourseSummary[] {
  return DEMO_PUBLIC_COURSES.map(
    ({ prerequisites: _p, learningObjectives: _lo, modules: _m, ...summary }) => ({
      ...summary,
      activeCohorts: summary.activeCohorts.map((c) => ({ ...c })),
    })
  );
}

export function findDemoCourseBySlugOrId(slugOrId: string): PublicCourseDetail | null {
  const normalized = slugOrId.trim().toLowerCase();
  if (!normalized) return null;
  const match = DEMO_PUBLIC_COURSES.find(
    (c) => c.slug.toLowerCase() === normalized || c.id.toLowerCase() === normalized
  );
  if (!match) return null;
  return {
    ...match,
    learningObjectives: [...match.learningObjectives],
    modules: match.modules.map((m) => ({ ...m })),
    activeCohorts: match.activeCohorts.map((b) => ({ ...b })),
  };
}

export function getDemoAdmissionCatalog() {
  return {
    academyName: DEMO_PUBLIC_ACADEMY.name,
    currency: DEMO_PUBLIC_ACADEMY.currency,
    courses: DEMO_PUBLIC_COURSES.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      track: c.track,
      category: c.category,
      durationWeeks: c.durationWeeks,
      tuitionFee: c.tuitionFee ?? '0.00',
    })),
    batches: DEMO_PUBLIC_COURSES.flatMap((c) =>
      c.activeCohorts.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        courseId: c.id,
        startDate: b.startDate,
        endDate: b.endDate,
        status: b.status,
      }))
    ),
    feePlans: DEMO_PUBLIC_FEE_PLANS.map((fp) => ({ ...fp })),
  };
}
