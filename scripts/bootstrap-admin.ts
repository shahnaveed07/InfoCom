import 'dotenv/config';
import crypto from 'node:crypto';
import { hashPassword } from '../server/auth.ts';
import { disconnectPrisma, prisma } from '../server/db/prisma.ts';

function parseCliArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 2) {
      result[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i += 1;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const email = String(args.email ?? process.env.ADMIN_BOOTSTRAP_EMAIL ?? '')
    .trim()
    .toLowerCase();
  const name = String(args.name ?? process.env.ADMIN_BOOTSTRAP_NAME ?? 'Academy Administrator').trim();
  const password = String(args.password ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '');
  const allowAdditional = args['allow-additional'] === true || args['allow-additional'] === 'true';

  if (!email || !email.includes('@')) {
    console.error('Usage: npm run admin:bootstrap -- --email <admin-email> --password <strong-password> [--name "Full Name"] [--allow-additional]');
    process.exitCode = 1;
    return;
  }

  if (password.length < 12) {
    console.error('Bootstrap rejected: initial admin password must be at least 12 characters long.');
    process.exitCode = 1;
    return;
  }

  const existingAdmins = await prisma.user.count({
    where: { role: 'admin', status: 'active' },
  });

  if (existingAdmins > 0 && !allowAdditional) {
    const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
    const suppliedSecret = String(args.secret ?? '');
    if (!bootstrapSecret || !suppliedSecret || bootstrapSecret !== suppliedSecret) {
      console.error(
        'Bootstrap blocked: an active admin already exists. Use an existing admin account to create additional admins, or provide --allow-additional with valid ADMIN_BOOTSTRAP_SECRET.'
      );
      process.exitCode = 1;
      return;
    }
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.error(`Bootstrap aborted: user with email ${email} already exists.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const adminId = `adm-${crypto.randomUUID().slice(0, 8)}`;
  const staffCode = `INF-ADM-${Math.floor(100 + Math.random() * 899)}`;

  await prisma.$transaction(async (tx) => {
    const adminRole = await tx.role.upsert({
      where: { code: 'admin' },
      update: {},
      create: {
        id: 'role-admin',
        code: 'admin',
        name: 'Academy Administrator',
        description: 'Full institutional, admissions, financial, and audit governance access.',
        isSystem: true,
      },
    });

    await tx.user.create({
      data: {
        id: adminId,
        name,
        email,
        role: 'admin',
        status: 'active',
        staffCode,
        department: 'Academy Administration',
        passwordHash,
        passwordUpdatedAt: new Date(),
      },
    });

    await tx.userRole.create({
      data: {
        id: `ur-${adminId}-admin`,
        userId: adminId,
        roleId: adminRole.id,
      },
    });

    await tx.auditLog.create({
      data: {
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        actorUserId: adminId,
        actorEmail: email,
        actorRole: 'admin',
        action: 'ADMIN_BOOTSTRAPPED',
        entityType: 'user',
        entityId: adminId,
        summary: `Initial administrator account provisioned via protected bootstrap CLI (${email}).`,
        metadata: { staffCode },
      },
    });
  });

  console.log(`Administrator account created: ${email} (id=${adminId}, staffCode=${staffCode}).`);
}

main()
  .catch((err) => {
    console.error('Admin bootstrap failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
