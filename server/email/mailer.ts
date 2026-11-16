import nodemailer from 'nodemailer';

export interface EmailSendResult {
  status: 'Delivered' | 'Skipped' | 'Failed';
  messageId: string | null;
  reason: string | null;
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_FROM?.trim()
  );
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<EmailSendResult> {
  if (!params.to || !params.to.includes('@')) {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'Recipient email address is invalid or missing.',
    };
  }

  if (!isSmtpConfigured()) {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'SMTP transport is not configured (SMTP_HOST / SMTP_FROM unset).',
    };
  }

  try {
    const host = process.env.SMTP_HOST!.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    const from = process.env.SMTP_FROM!.trim();

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    });

    return {
      status: 'Delivered',
      messageId: info.messageId || null,
      reason: null,
    };
  } catch (err) {
    return {
      status: 'Failed',
      messageId: null,
      reason: err instanceof Error ? err.message : 'SMTP delivery failed.',
    };
  }
}
