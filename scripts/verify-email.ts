import 'dotenv/config';
import { verifySmtpConnection } from '../server/email/mailer.ts';

async function main() {
  const strict = process.argv.includes('--strict');
  const result = await verifySmtpConnection();
  console.log(JSON.stringify(result, null, 2));

  if (!result.configured) {
    if (strict) {
      console.error('SMTP transport is not configured (--strict mode enabled).');
      process.exitCode = 1;
      return;
    }
    console.log(
      'SMTP is not configured; transactional email jobs safely fall back to DeliveryLog status "Skipped".'
    );
    return;
  }

  if (!result.reachable) {
    console.error(`SMTP verification failed: ${result.reason ?? 'Unknown transport error'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`SMTP transport verified (${result.host}:${result.port} as ${result.from}).`);
}

void main();
