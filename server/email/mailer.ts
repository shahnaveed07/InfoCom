import nodemailer from 'nodemailer';

export interface EmailSendResult {
  status: 'Delivered' | 'Skipped' | 'Failed';
  messageId: string | null;
  reason: string | null;
}

export interface SmtpVerificationResult {
  configured: boolean;
  reachable: boolean;
  status: 'Ready' | 'NotConfigured' | 'Error';
  host: string | null;
  port: number | null;
  secure: boolean;
  from: string | null;
  reason: string | null;
}

type EmailSenderOverride = (params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => Promise<EmailSendResult>;

let senderOverride: EmailSenderOverride | null = null;

/**
 * Test-only hook to simulate SMTP delivery outcomes without network traffic.
 */
export function setEmailSenderOverride(fn: EmailSenderOverride | null): void {
  senderOverride = fn;
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_FROM?.trim()
  );
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim() || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || '';
  return { host, port, secure, user, pass, from };
}

function buildSmtpTransporter() {
  const cfg = getSmtpConfig();
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });
}

export async function verifySmtpConnection(): Promise<SmtpVerificationResult> {
  const cfg = getSmtpConfig();
  if (!isSmtpConfigured()) {
    return {
      configured: false,
      reachable: false,
      status: 'NotConfigured',
      host: cfg.host || null,
      port: Number.isFinite(cfg.port) ? cfg.port : null,
      secure: cfg.secure,
      from: cfg.from || null,
      reason: 'SMTP transport is not configured (SMTP_HOST / SMTP_FROM unset).',
    };
  }

  try {
    const transporter = buildSmtpTransporter();
    await transporter.verify();
    return {
      configured: true,
      reachable: true,
      status: 'Ready',
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      from: cfg.from,
      reason: null,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      status: 'Error',
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      from: cfg.from,
      reason: err instanceof Error ? err.message : 'SMTP verification failed.',
    };
  }
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

  if (senderOverride) {
    return senderOverride(params);
  }

  if (!isSmtpConfigured()) {
    return {
      status: 'Skipped',
      messageId: null,
      reason: 'SMTP transport is not configured (SMTP_HOST / SMTP_FROM unset).',
    };
  }

  try {
    const cfg = getSmtpConfig();
    const transporter = buildSmtpTransporter();

    const info = await transporter.sendMail({
      from: cfg.from,
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
