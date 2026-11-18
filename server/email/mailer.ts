import { AsyncLocalStorage } from 'node:async_hooks';
import nodemailer from 'nodemailer';

export type EmailProviderMode = 'auto' | 'http' | 'smtp';

export interface EmailSendResult {
  status: 'Delivered' | 'Skipped' | 'Failed';
  messageId: string | null;
  reason: string | null;
}

export interface EmailConfigOverrides {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  EMAIL_HTTP_URL?: string;
  EMAIL_HTTP_TOKEN?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
}

export interface SmtpVerificationResult {
  configured: boolean;
  reachable: boolean;
  status: 'Ready' | 'NotConfigured' | 'Error';
  provider: 'http' | 'smtp' | 'none';
  host: string | null;
  port: number | null;
  secure: boolean;
  from: string | null;
  reason: string | null;
}

export interface TransactionalEmailRequest {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransportAdapter {
  readonly kind: 'http' | 'smtp' | 'none';
  isConfigured: () => boolean;
  send: (params: TransactionalEmailRequest) => Promise<EmailSendResult>;
  verify: () => Promise<SmtpVerificationResult>;
}

type EmailSenderOverride = (params: TransactionalEmailRequest) => Promise<EmailSendResult>;

let senderOverride: EmailSenderOverride | null = null;
const emailConfigStore = new AsyncLocalStorage<EmailConfigOverrides>();

/**
 * Test-only hook to simulate email delivery outcomes without network traffic.
 */
export function setEmailSenderOverride(fn: EmailSenderOverride | null): void {
  senderOverride = fn;
}

/**
 * Binds request/queue-scoped Worker env email settings cleanly via AsyncLocalStorage.
 */
export async function runWithEmailConfig<T>(
  overrides: EmailConfigOverrides | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!overrides) return fn();
  return emailConfigStore.run(overrides, fn);
}

function readEmailVar(key: keyof EmailConfigOverrides): string {
  const scoped = emailConfigStore.getStore();
  const scopedVal = scoped?.[key];
  if (typeof scopedVal === 'string' && scopedVal.trim()) {
    return scopedVal.trim();
  }
  const envVal = process.env[key];
  return typeof envVal === 'string' ? envVal.trim() : '';
}

function getHttpEmailConfig() {
  const from = readEmailVar('EMAIL_FROM') || readEmailVar('SMTP_FROM');
  const resendKey = readEmailVar('RESEND_API_KEY');
  const customUrl = readEmailVar('EMAIL_HTTP_URL');
  const customToken = readEmailVar('EMAIL_HTTP_TOKEN');

  if (customUrl) {
    return {
      configured: Boolean(from && customUrl),
      mode: 'custom-http' as const,
      endpoint: customUrl,
      token: customToken || resendKey,
      from,
    };
  }
  if (resendKey) {
    return {
      configured: Boolean(from && resendKey),
      mode: 'resend' as const,
      endpoint: 'https://api.resend.com/emails',
      token: resendKey,
      from,
    };
  }
  return {
    configured: false,
    mode: 'none' as const,
    endpoint: '',
    token: '',
    from,
  };
}

function getSmtpConfig() {
  const host = readEmailVar('SMTP_HOST');
  const port = Number(readEmailVar('SMTP_PORT') || 587);
  const secure = readEmailVar('SMTP_SECURE') === 'true' || port === 465;
  const user = readEmailVar('SMTP_USER') || undefined;
  const pass = readEmailVar('SMTP_PASS') || undefined;
  const from = readEmailVar('SMTP_FROM') || readEmailVar('EMAIL_FROM');
  return { host, port, secure, user, pass, from };
}

export function isHttpEmailConfigured(): boolean {
  return getHttpEmailConfig().configured;
}

export function isSmtpConfigured(): boolean {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.from);
}

export function isEmailTransportConfigured(): boolean {
  return resolveEmailTransportAdapter().isConfigured();
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

function createHttpTransportAdapter(): EmailTransportAdapter {
  const cfg = getHttpEmailConfig();
  return {
    kind: 'http',
    isConfigured: () => cfg.configured,
    async send(params) {
      if (!cfg.configured) {
        return {
          status: 'Skipped',
          messageId: null,
          reason:
            'HTTP email transport is not configured (EMAIL_FROM and RESEND_API_KEY/EMAIL_HTTP_URL required).',
        };
      }
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (cfg.token) {
          headers.Authorization = `Bearer ${cfg.token}`;
        }
        const res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from: cfg.from,
            to: [params.to],
            subject: params.subject,
            text: params.text,
            ...(params.html ? { html: params.html } : {}),
          }),
        });
        if (!res.ok) {
          const textBody = await res.text().catch(() => '');
          return {
            status: 'Failed',
            messageId: null,
            reason: `HTTP email provider rejected request (${res.status}): ${textBody.slice(0, 200)}`.trim(),
          };
        }
        const data = (await res.json().catch(() => null)) as { id?: unknown; messageId?: unknown } | null;
        const messageId =
          typeof data?.id === 'string'
            ? data.id
            : typeof data?.messageId === 'string'
              ? data.messageId
              : null;
        return {
          status: 'Delivered',
          messageId,
          reason: null,
        };
      } catch (err) {
        return {
          status: 'Failed',
          messageId: null,
          reason: err instanceof Error ? err.message : 'HTTP email delivery failed.',
        };
      }
    },
    async verify() {
      if (!cfg.configured) {
        return {
          configured: false,
          reachable: false,
          status: 'NotConfigured',
          provider: 'http',
          host: cfg.endpoint || null,
          port: 443,
          secure: true,
          from: cfg.from || null,
          reason:
            'HTTP email transport is not configured (EMAIL_FROM + RESEND_API_KEY or EMAIL_HTTP_URL required).',
        };
      }
      return {
        configured: true,
        reachable: true,
        status: 'Ready',
        provider: 'http',
        host: new URL(cfg.endpoint).host,
        port: 443,
        secure: cfg.endpoint.startsWith('https://'),
        from: cfg.from,
        reason: null,
      };
    },
  };
}

function createSmtpTransportAdapter(): EmailTransportAdapter {
  const cfg = getSmtpConfig();
  return {
    kind: 'smtp',
    isConfigured: () => isSmtpConfigured(),
    async send(params) {
      if (!isSmtpConfigured()) {
        return {
          status: 'Skipped',
          messageId: null,
          reason: 'SMTP transport is not configured (SMTP_HOST / SMTP_FROM unset).',
        };
      }
      try {
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
    },
    async verify() {
      if (!isSmtpConfigured()) {
        return {
          configured: false,
          reachable: false,
          status: 'NotConfigured',
          provider: 'smtp',
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
          provider: 'smtp',
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
          provider: 'smtp',
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          from: cfg.from,
          reason: err instanceof Error ? err.message : 'SMTP verification failed.',
        };
      }
    },
  };
}

export function resolveEmailTransportAdapter(): EmailTransportAdapter {
  const rawMode = (readEmailVar('EMAIL_PROVIDER') || 'auto').toLowerCase() as EmailProviderMode;
  if (rawMode === 'http') {
    return createHttpTransportAdapter();
  }
  if (rawMode === 'smtp') {
    return createSmtpTransportAdapter();
  }
  if (isHttpEmailConfigured()) {
    return createHttpTransportAdapter();
  }
  if (isSmtpConfigured()) {
    return createSmtpTransportAdapter();
  }
  return {
    kind: 'none',
    isConfigured: () => false,
    async send() {
      return {
        status: 'Skipped',
        messageId: null,
        reason:
          'No email transport is configured (set HTTP RESEND_API_KEY/EMAIL_HTTP_URL or SMTP_HOST/SMTP_FROM).',
      };
    },
    async verify() {
      return {
        configured: false,
        reachable: false,
        status: 'NotConfigured',
        provider: 'none',
        host: null,
        port: null,
        secure: false,
        from: readEmailVar('EMAIL_FROM') || readEmailVar('SMTP_FROM') || null,
        reason:
          'Email transport is not configured (neither HTTP email API nor SMTP credentials are set).',
      };
    },
  };
}

export async function verifyEmailTransport(): Promise<SmtpVerificationResult> {
  return resolveEmailTransportAdapter().verify();
}

export async function verifySmtpConnection(): Promise<SmtpVerificationResult> {
  return verifyEmailTransport();
}

export async function sendTransactionalEmail(
  params: TransactionalEmailRequest
): Promise<EmailSendResult> {
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

  const adapter = resolveEmailTransportAdapter();
  return adapter.send(params);
}
