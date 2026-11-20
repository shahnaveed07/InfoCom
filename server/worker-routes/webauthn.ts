import { z } from 'zod';
import { recordAuditLogD1 } from '../d1/ams-service.ts';
import { d1All, d1First, d1Run, nowIso, randomId } from '../d1/client.ts';
import {
  createAuthSessionRecordD1,
  revokeAllUserSessionsD1,
  toPublicUserD1,
  type DbUserRow,
} from '../d1/repository.ts';
import {
  COSE_ALG_ES256,
  COSE_ALG_RS256,
  WebAuthnVerificationError,
  bytesToBase64Url,
  generateChallengeBase64Url,
  resolveWebAuthnRpConfig,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '../webauthn/core.ts';
import {
  SESSION_TTL_MS,
  WEBAUTHN_CHALLENGE_TTL_MS,
  buildSessionCookie,
  generateOpaqueToken,
  resolveWorkerAuthMode,
  sha256Hex,
} from '../worker-auth.ts';
import {
  isCrossSiteCookiesEnabledWorker,
  type WorkerRequestContext,
  type WorkerRouteEntry,
} from '../worker-router.ts';

interface D1WebAuthnCredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key_spki: string;
  cose_algorithm: number;
  sign_count: number;
  transports: string;
  device_label: string;
  aaguid: string | null;
  backup_eligible: number;
  backup_state: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
}

interface D1WebAuthnChallengeRow {
  id: string;
  user_id: string | null;
  ceremony: 'register' | 'login' | 'reauth';
  challenge_hash: string;
  expected_rp_id: string;
  expected_origin: string;
  enrollment_token_hash: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

interface D1EnrollmentTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
}

const registerOptionsSchema = z.object({
  enrollmentToken: z.string().trim().min(16).max(256).optional(),
  deviceLabel: z.string().trim().min(1).max(80).optional(),
});

const registerVerifySchema = z.object({
  challengeId: z.string().trim().min(1).max(128),
  credentialId: z.string().trim().min(1).max(1024),
  clientDataJSON: z.string().trim().min(1).max(8192),
  attestationObject: z.string().trim().min(1).max(16384),
  transports: z.array(z.string().trim().max(32)).max(8).optional(),
  deviceLabel: z.string().trim().min(1).max(80).optional(),
  enrollmentToken: z.string().trim().min(16).max(256).optional(),
});

const loginOptionsSchema = z.object({
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
});

const loginVerifySchema = z.object({
  challengeId: z.string().trim().min(1).max(128),
  credentialId: z.string().trim().min(1).max(1024),
  clientDataJSON: z.string().trim().min(1).max(8192),
  authenticatorData: z.string().trim().min(1).max(8192),
  signature: z.string().trim().min(1).max(4096),
});

const renameCredentialSchema = z.object({
  deviceLabel: z.string().trim().min(1, 'Device label is required.').max(80),
});

const revokeCredentialSchema = z.object({
  reauthProof: z.string().trim().min(16).max(256).optional(),
  reason: z.string().trim().max(240).optional(),
});

function parseTransportsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

function serializeCredentialMetadata(row: D1WebAuthnCredentialRow) {
  return {
    id: row.id,
    credentialId: row.credential_id,
    deviceLabel: row.device_label,
    coseAlgorithm: row.cose_algorithm,
    transports: parseTransportsJson(row.transports),
    aaguid: row.aaguid,
    backupEligible: Boolean(row.backup_eligible),
    backupState: Boolean(row.backup_state),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function extractClientDataChallenge(clientDataJsonB64: string): string | null {
  try {
    const normalized = clientDataJsonB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (normalized.length % 4)) % 4;
    const binary = atob(normalized + '='.repeat(pad));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

async function findUserByIdRow(c: WorkerRequestContext, id: string): Promise<DbUserRow | null> {
  return d1First<DbUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id], c.db);
}

async function findUserByEmailRow(c: WorkerRequestContext, email: string): Promise<DbUserRow | null> {
  return d1First<DbUserRow>(
    'SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1',
    [email.trim().toLowerCase()],
    c.db
  );
}

async function consumeChallengeAtomically(
  c: WorkerRequestContext,
  challengeId: string,
  ceremony: 'register' | 'login' | 'reauth',
  candidateChallenge: string
): Promise<
  | { ok: true; row: D1WebAuthnChallengeRow }
  | { ok: false; status: number; code: string; error: string }
> {
  const now = nowIso();
  const candidateHash = await sha256Hex(candidateChallenge);
  const existing = await d1First<D1WebAuthnChallengeRow>(
    'SELECT * FROM webauthn_challenges WHERE id = ? AND ceremony = ? LIMIT 1',
    [challengeId, ceremony],
    c.db
  );

  if (!existing) {
    return {
      ok: false,
      status: 400,
      code: 'CHALLENGE_NOT_FOUND',
      error: 'Authentication challenge is invalid or expired. Please try again.',
    };
  }
  if (existing.consumed_at) {
    return {
      ok: false,
      status: 400,
      code: 'CHALLENGE_REPLAYED',
      error: 'This authentication challenge has already been used. Please start again.',
    };
  }
  if (existing.expires_at <= now) {
    return {
      ok: false,
      status: 400,
      code: 'CHALLENGE_EXPIRED',
      error: 'Your passkey prompt timed out. Please try again.',
    };
  }
  if (existing.challenge_hash !== candidateHash) {
    return {
      ok: false,
      status: 400,
      code: 'CHALLENGE_MISMATCH',
      error: 'Passkey challenge verification failed.',
    };
  }

  const updateRes = await d1Run(
    `UPDATE webauthn_challenges
     SET consumed_at = ?
     WHERE id = ? AND ceremony = ? AND challenge_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [now, challengeId, ceremony, candidateHash, now],
    c.db
  );
  if ((updateRes.meta?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'CHALLENGE_REPLAYED',
      error: 'This authentication challenge is no longer valid. Please start again.',
    };
  }

  return { ok: true, row: existing };
}

async function resolveEnrollmentTokenUser(
  c: WorkerRequestContext,
  rawToken: string
): Promise<
  | { ok: true; tokenRow: D1EnrollmentTokenRow; user: DbUserRow }
  | { ok: false; status: number; code: string; error: string }
> {
  const tokenHash = await sha256Hex(rawToken.trim());
  const tokenRow = await d1First<D1EnrollmentTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM password_reset_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash],
    c.db
  );
  if (!tokenRow) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ENROLLMENT_TOKEN',
      error: 'Enrollment link is invalid or has been revoked.',
    };
  }
  if (tokenRow.used_at) {
    return {
      ok: false,
      status: 400,
      code: 'ENROLLMENT_TOKEN_USED',
      error: 'This single-use enrollment link has already been used or revoked.',
    };
  }
  if (tokenRow.expires_at <= nowIso()) {
    return {
      ok: false,
      status: 400,
      code: 'ENROLLMENT_TOKEN_EXPIRED',
      error: 'This enrollment link has expired. Ask an IGS Administrator to issue a new one.',
    };
  }
  const user = await findUserByIdRow(c, tokenRow.user_id);
  if (!user) {
    return {
      ok: false,
      status: 404,
      code: 'ACCOUNT_NOT_FOUND',
      error: 'Associated account was not found.',
    };
  }
  if (user.status !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      error: `This account is currently ${user.status} and cannot enroll a passkey.`,
    };
  }
  return { ok: true, tokenRow, user };
}

export const workerWebAuthnRoutes: WorkerRouteEntry[] = [
  // GET /api/auth/config — Public auth mode discovery for SPA
  {
    method: 'GET',
    pattern: '/api/auth/config',
    auth: 'none',
    handler: async (c) => {
      const rp = resolveWebAuthnRpConfig(c.request, c.env);
      return c.json(
        200,
        {
          authMode: resolveWorkerAuthMode(c.env),
          passwordAuthEnabled: false,
          passkeySupported: true,
          rpId: rp.rpId,
          rpName: rp.rpName,
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // POST /api/auth/webauthn/register/options
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/register/options',
    auth: 'optional',
    handler: async (c) => {
      const rawBody = await c.readJson(64 * 1024);
      const parsed = registerOptionsSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid registration options request.',
        });
      }
      const input = parsed.data;

      let targetUser: DbUserRow | null = null;
      let enrollmentTokenHash: string | null = null;

      if (input.enrollmentToken) {
        const resolved = await resolveEnrollmentTokenUser(c, input.enrollmentToken);
        if (!resolved.ok) {
          return c.json(resolved.status, { error: resolved.error, code: resolved.code });
        }
        // Cross-user guard: refuse enrolling a different account while already signed in
        if (c.authUser && c.authUser.id !== resolved.user.id) {
          return c.json(403, {
            error:
              'This enrollment link belongs to a different account. Sign out before enrolling another user.',
            code: 'CROSS_USER_ENROLLMENT_FORBIDDEN',
          });
        }
        targetUser = resolved.user;
        enrollmentTokenHash = resolved.tokenRow.token_hash;
      } else {
        if (!c.authUser) {
          return c.json(401, { error: 'Authentication or a valid enrollment link is required.' });
        }
        const row = await findUserByIdRow(c, c.authUser.id);
        if (!row || row.status !== 'active') {
          return c.json(403, {
            error: 'Inactive accounts cannot register passkeys.',
            code: 'ACCOUNT_INACTIVE',
          });
        }
        targetUser = row;
      }

      const rp = resolveWebAuthnRpConfig(c.request, c.env);
      const challenge = generateChallengeBase64Url(32);
      const challengeHash = await sha256Hex(challenge);
      const challengeId = randomId('wch', 10);
      const now = nowIso();
      const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString();

      await d1Run(
        `INSERT INTO webauthn_challenges (
          id, user_id, ceremony, challenge_hash, expected_rp_id, expected_origin,
          enrollment_token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, 'register', ?, ?, ?, ?, ?, NULL, ?)`,
        [
          challengeId,
          targetUser.id,
          challengeHash,
          rp.rpId,
          rp.expectedOrigin,
          enrollmentTokenHash,
          expiresAt,
          now,
        ],
        c.db
      );

      const existingCreds = await d1All<{ credential_id: string; transports: string }>(
        `SELECT credential_id, transports FROM webauthn_credentials
         WHERE user_id = ? AND revoked_at IS NULL`,
        [targetUser.id],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser ?? toPublicUserD1(targetUser),
          action: 'WEBAUTHN_REG_STARTED',
          entityType: 'user',
          entityId: targetUser.id,
          ipAddress: c.ipAddress,
          summary: `Started passkey registration ceremony for ${targetUser.email}`,
          metadata: { viaEnrollmentToken: Boolean(enrollmentTokenHash), rpId: rp.rpId },
        },
        c.db
      );

      const userHandleBytes = new TextEncoder().encode(targetUser.id);
      return c.json(
        200,
        {
          challengeId,
          expiresAt,
          targetUser: {
            name: targetUser.name,
            email: targetUser.email,
            role: targetUser.role,
          },
          options: {
            challenge,
            rp: {
              id: rp.rpId,
              name: rp.rpName,
            },
            user: {
              id: bytesToBase64Url(userHandleBytes),
              name: targetUser.email,
              displayName: targetUser.name,
            },
            pubKeyCredParams: [
              { type: 'public-key', alg: COSE_ALG_ES256 },
              { type: 'public-key', alg: COSE_ALG_RS256 },
            ],
            timeout: 120000,
            attestation: 'none',
            excludeCredentials: existingCreds.map((cred) => ({
              type: 'public-key',
              id: cred.credential_id,
              transports: parseTransportsJson(cred.transports),
            })),
            authenticatorSelection: {
              residentKey: 'preferred',
              requireResidentKey: false,
              userVerification: 'required',
            },
          },
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // POST /api/auth/webauthn/register/verify
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/register/verify',
    auth: 'optional',
    handler: async (c) => {
      const rawBody = await c.readJson(64 * 1024);
      const parsed = registerVerifySchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid registration response.',
        });
      }
      const input = parsed.data;

      const candidateChallenge = extractClientDataChallenge(input.clientDataJSON);
      if (!candidateChallenge) {
        return c.json(400, { error: 'Malformed clientDataJSON payload.', code: 'INVALID_CLIENT_DATA' });
      }

      const consumed = await consumeChallengeAtomically(
        c,
        input.challengeId,
        'register',
        candidateChallenge
      );
      if (!consumed.ok) {
        return c.json(consumed.status, { error: consumed.error, code: consumed.code });
      }

      const challengeRow = consumed.row;
      if (!challengeRow.user_id) {
        return c.json(400, { error: 'Challenge has no associated user.', code: 'INVALID_CHALLENGE' });
      }

      if (challengeRow.enrollment_token_hash) {
        if (c.authUser && c.authUser.id !== challengeRow.user_id) {
          return c.json(403, {
            error: 'Cross-user passkey registration is forbidden.',
            code: 'CROSS_USER_ENROLLMENT_FORBIDDEN',
          });
        }
        if (input.enrollmentToken) {
          const providedHash = await sha256Hex(input.enrollmentToken.trim());
          if (providedHash !== challengeRow.enrollment_token_hash) {
            return c.json(403, {
              error: 'Enrollment token does not match the registration challenge.',
              code: 'ENROLLMENT_TOKEN_MISMATCH',
            });
          }
        }
      } else {
        if (!c.authUser) {
          return c.json(401, { error: 'Authentication required.' });
        }
        if (c.authUser.id !== challengeRow.user_id) {
          return c.json(403, {
            error: 'Cross-user passkey registration is forbidden.',
            code: 'CROSS_USER_ENROLLMENT_FORBIDDEN',
          });
        }
      }

      const user = await findUserByIdRow(c, challengeRow.user_id);
      if (!user || user.status !== 'active') {
        return c.json(403, {
          error: 'Account is not active and cannot register a passkey.',
          code: 'ACCOUNT_INACTIVE',
        });
      }

      let verified;
      try {
        verified = await verifyRegistrationResponse({
          credentialId: input.credentialId,
          clientDataJSON: input.clientDataJSON,
          attestationObject: input.attestationObject,
          transports: input.transports,
          expectedChallenge: candidateChallenge,
          expectedOrigin: challengeRow.expected_origin,
          expectedRpId: challengeRow.expected_rp_id,
          requireUserVerification: true,
        });
      } catch (err) {
        const code = err instanceof WebAuthnVerificationError ? err.code : 'WEBAUTHN_VERIFY_FAILED';
        const msg = err instanceof Error ? err.message : 'Passkey registration verification failed.';
        await recordAuditLogD1(
          {
            actor: toPublicUserD1(user),
            action: 'WEBAUTHN_REG_FAILED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Passkey registration failed for ${user.email}: ${code}`,
            metadata: { code },
          },
          c.db
        );
        return c.json(400, { error: msg, code });
      }

      const duplicate = await d1First<{ id: string }>(
        'SELECT id FROM webauthn_credentials WHERE credential_id = ? LIMIT 1',
        [verified.credentialId],
        c.db
      );
      if (duplicate) {
        return c.json(409, {
          error: 'This passkey is already registered. Use a different authenticator or sign in.',
          code: 'CREDENTIAL_ALREADY_REGISTERED',
        });
      }

      const now = nowIso();

      if (challengeRow.enrollment_token_hash) {
        const tokenConsume = await d1Run(
          `UPDATE password_reset_tokens
           SET used_at = ?
           WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?`,
          [now, challengeRow.enrollment_token_hash, user.id, now],
          c.db
        );
        if ((tokenConsume.meta?.changes ?? 0) !== 1) {
          return c.json(400, {
            error: 'Enrollment link was already used, revoked, or expired.',
            code: 'ENROLLMENT_TOKEN_USED',
          });
        }
      }

      const credRecordId = randomId('wcred', 10);
      const label = (input.deviceLabel || 'Passkey').trim().slice(0, 80);

      await d1Run(
        `INSERT INTO webauthn_credentials (
          id, user_id, credential_id, public_key_spki, cose_algorithm, sign_count,
          transports, device_label, aaguid, backup_eligible, backup_state,
          created_at, last_used_at, revoked_at, revoked_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        [
          credRecordId,
          user.id,
          verified.credentialId,
          verified.publicKeySpki,
          verified.coseAlgorithm,
          verified.signCount,
          JSON.stringify(verified.transports),
          label,
          verified.aaguid,
          verified.backupEligible ? 1 : 0,
          verified.backupState ? 1 : 0,
          now,
        ],
        c.db
      );

      if (user.must_change_password) {
        await d1Run(
          'UPDATE users SET must_change_password = 0, updated_at = ? WHERE id = ?',
          [now, user.id],
          c.db
        );
        user.must_change_password = 0;
      }

      await recordAuditLogD1(
        {
          actor: toPublicUserD1(user),
          action: 'WEBAUTHN_CREDENTIAL_REGISTERED',
          entityType: 'webauthn_credential',
          entityId: credRecordId,
          ipAddress: c.ipAddress,
          summary: `Registered passkey "${label}" for ${user.email}`,
          metadata: {
            coseAlgorithm: verified.coseAlgorithm,
            transports: verified.transports,
            viaEnrollmentToken: Boolean(challengeRow.enrollment_token_hash),
          },
        },
        c.db
      );

      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (!c.authUser && challengeRow.enrollment_token_hash) {
        const rawSessionToken = generateOpaqueToken(32);
        const tokenHash = await sha256Hex(rawSessionToken);
        await createAuthSessionRecordD1(
          {
            id: randomId('ses', 12),
            tokenHash,
            userId: user.id,
            roleCode: user.role,
            ipAddress: c.ipAddress,
            userAgent: c.request.headers.get('user-agent') || '',
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          },
          c.db
        );
        headers['Set-Cookie'] = buildSessionCookie(
          rawSessionToken,
          c.request,
          isCrossSiteCookiesEnabledWorker(c.env)
        );
      }

      return c.json(
        201,
        {
          ok: true,
          user: toPublicUserD1(user),
          authMode: resolveWorkerAuthMode(c.env),
          credential: {
            id: credRecordId,
            credentialId: verified.credentialId,
            deviceLabel: label,
            coseAlgorithm: verified.coseAlgorithm,
            transports: verified.transports,
            aaguid: verified.aaguid,
            backupEligible: verified.backupEligible,
            backupState: verified.backupState,
            createdAt: now,
            lastUsedAt: null,
            revokedAt: null,
          },
        },
        headers
      );
    },
  },

  // POST /api/auth/webauthn/login/options
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/login/options',
    auth: 'none',
    handler: async (c) => {
      const rawBody = await c.readJson(32 * 1024);
      const parsed = loginOptionsSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid login options request.',
        });
      }
      const email = parsed.data.email?.trim().toLowerCase() || '';

      const rp = resolveWebAuthnRpConfig(c.request, c.env);
      const challenge = generateChallengeBase64Url(32);
      const challengeHash = await sha256Hex(challenge);
      const challengeId = randomId('wch', 10);
      const now = nowIso();
      const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString();

      let allowCredentials: Array<{ type: 'public-key'; id: string; transports?: string[] }> = [];
      let matchedUserId: string | null = null;

      if (email) {
        const user = await findUserByEmailRow(c, email);
        if (user && user.status === 'active') {
          matchedUserId = user.id;
          const creds = await d1All<{ credential_id: string; transports: string }>(
            `SELECT credential_id, transports FROM webauthn_credentials
             WHERE user_id = ? AND revoked_at IS NULL`,
            [user.id],
            c.db
          );
          allowCredentials = creds.map((cred) => {
            const transports = parseTransportsJson(cred.transports);
            return transports.length > 0
              ? { type: 'public-key', id: cred.credential_id, transports }
              : { type: 'public-key', id: cred.credential_id };
          });
        }
      }

      await d1Run(
        `INSERT INTO webauthn_challenges (
          id, user_id, ceremony, challenge_hash, expected_rp_id, expected_origin,
          enrollment_token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, 'login', ?, ?, ?, NULL, ?, NULL, ?)`,
        [challengeId, matchedUserId, challengeHash, rp.rpId, rp.expectedOrigin, expiresAt, now],
        c.db
      );

      return c.json(
        200,
        {
          challengeId,
          expiresAt,
          options: {
            challenge,
            rpId: rp.rpId,
            timeout: 120000,
            userVerification: 'required',
            ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
          },
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // POST /api/auth/webauthn/login/verify
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/login/verify',
    auth: 'none',
    handler: async (c) => {
      const rawBody = await c.readJson(64 * 1024);
      const parsed = loginVerifySchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid passkey login payload.',
        });
      }
      const input = parsed.data;

      const candidateChallenge = extractClientDataChallenge(input.clientDataJSON);
      if (!candidateChallenge) {
        return c.json(400, { error: 'Malformed clientDataJSON payload.', code: 'INVALID_CLIENT_DATA' });
      }

      const consumed = await consumeChallengeAtomically(
        c,
        input.challengeId,
        'login',
        candidateChallenge
      );
      if (!consumed.ok) {
        return c.json(consumed.status, { error: consumed.error, code: consumed.code });
      }
      const challengeRow = consumed.row;

      const cred = await d1First<D1WebAuthnCredentialRow>(
        'SELECT * FROM webauthn_credentials WHERE credential_id = ? LIMIT 1',
        [input.credentialId],
        c.db
      );
      if (!cred) {
        await recordAuditLogD1(
          {
            actor: null,
            action: 'AUTH_LOGIN_WEBAUTHN_FAILED',
            entityType: 'webauthn_credential',
            entityId: 'unknown',
            ipAddress: c.ipAddress,
            summary: 'Passkey login failed: unrecognized credential ID',
            metadata: { reason: 'CREDENTIAL_NOT_FOUND' },
          },
          c.db
        );
        return c.json(401, {
          error: 'Passkey was not recognized or has been revoked.',
          code: 'INVALID_CREDENTIAL',
        });
      }

      const user = await findUserByIdRow(c, cred.user_id);
      if (!user) {
        return c.json(401, { error: 'Passkey account no longer exists.', code: 'INVALID_CREDENTIAL' });
      }

      if (cred.revoked_at) {
        await recordAuditLogD1(
          {
            actor: toPublicUserD1(user),
            action: 'AUTH_LOGIN_WEBAUTHN_FAILED',
            entityType: 'webauthn_credential',
            entityId: cred.id,
            ipAddress: c.ipAddress,
            summary: `Blocked login using revoked passkey "${cred.device_label}" for ${user.email}`,
            metadata: { reason: 'CREDENTIAL_REVOKED' },
          },
          c.db
        );
        return c.json(401, {
          error: 'This passkey has been revoked.',
          code: 'CREDENTIAL_REVOKED',
        });
      }

      if (user.status !== 'active') {
        await recordAuditLogD1(
          {
            actor: toPublicUserD1(user),
            action: 'AUTH_LOGIN_WEBAUTHN_FAILED',
            entityType: 'user',
            entityId: user.id,
            ipAddress: c.ipAddress,
            summary: `Blocked passkey login for ${user.status} account ${user.email}`,
            metadata: { status: user.status },
          },
          c.db
        );
        return c.json(403, {
          error: `This account is ${user.status}. Please contact an IGS Administrator.`,
          code: 'ACCOUNT_INACTIVE',
        });
      }

      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          clientDataJSON: input.clientDataJSON,
          authenticatorData: input.authenticatorData,
          signature: input.signature,
          expectedChallenge: candidateChallenge,
          expectedOrigin: challengeRow.expected_origin,
          expectedRpId: challengeRow.expected_rp_id,
          storedPublicKeySpki: cred.public_key_spki,
          storedCoseAlgorithm: cred.cose_algorithm,
          storedSignCount: cred.sign_count,
          requireUserVerification: true,
        });
      } catch (err) {
        const isClone = err instanceof WebAuthnVerificationError && err.cloneSuspected;
        const code = err instanceof WebAuthnVerificationError ? err.code : 'WEBAUTHN_VERIFY_FAILED';
        const msg = err instanceof Error ? err.message : 'Passkey authentication failed.';
        await recordAuditLogD1(
          {
            actor: toPublicUserD1(user),
            action: isClone ? 'WEBAUTHN_CLONE_SUSPECTED' : 'AUTH_LOGIN_WEBAUTHN_FAILED',
            entityType: 'webauthn_credential',
            entityId: cred.id,
            ipAddress: c.ipAddress,
            summary: isClone
              ? `Suspected cloned authenticator counter regression on "${cred.device_label}" for ${user.email}`
              : `Passkey login failed for ${user.email}: ${code}`,
            metadata: { code, storedSignCount: cred.sign_count },
          },
          c.db
        );
        return c.json(isClone ? 403 : 401, { error: msg, code });
      }

      const now = nowIso();
      await d1Run(
        `UPDATE webauthn_credentials
         SET sign_count = ?, backup_eligible = ?, backup_state = ?, last_used_at = ?
         WHERE id = ?`,
        [
          verified.newSignCount,
          verified.backupEligible ? 1 : 0,
          verified.backupState ? 1 : 0,
          now,
          cred.id,
        ],
        c.db
      );

      const rawSessionToken = generateOpaqueToken(32);
      const tokenHash = await sha256Hex(rawSessionToken);
      await createAuthSessionRecordD1(
        {
          id: randomId('ses', 12),
          tokenHash,
          userId: user.id,
          roleCode: user.role,
          ipAddress: c.ipAddress,
          userAgent: c.request.headers.get('user-agent') || '',
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
        c.db
      );

      await recordAuditLogD1(
        {
          actor: toPublicUserD1(user),
          action: 'AUTH_LOGIN_WEBAUTHN_SUCCESS',
          entityType: 'webauthn_credential',
          entityId: cred.id,
          ipAddress: c.ipAddress,
          summary: `${user.email} signed in with passkey "${cred.device_label}"`,
          metadata: { credentialId: cred.id, signCount: verified.newSignCount },
        },
        c.db
      );

      return c.json(
        200,
        {
          user: toPublicUserD1(user),
          authMode: resolveWorkerAuthMode(c.env),
        },
        {
          'Set-Cookie': buildSessionCookie(
            rawSessionToken,
            c.request,
            isCrossSiteCookiesEnabledWorker(c.env)
          ),
          'Cache-Control': 'no-store',
        }
      );
    },
  },

  // POST /api/auth/webauthn/reauth/options — Step-up verification before passkey revocation
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/reauth/options',
    auth: 'required',
    handler: async (c) => {
      const rp = resolveWebAuthnRpConfig(c.request, c.env);
      const creds = await d1All<{ credential_id: string; transports: string }>(
        `SELECT credential_id, transports FROM webauthn_credentials
         WHERE user_id = ? AND revoked_at IS NULL`,
        [c.authUser!.id],
        c.db
      );
      if (creds.length === 0) {
        return c.json(400, {
          error: 'No active passkeys are registered on your account.',
          code: 'NO_ACTIVE_PASSKEYS',
        });
      }

      const challenge = generateChallengeBase64Url(32);
      const challengeHash = await sha256Hex(challenge);
      const challengeId = randomId('wch', 10);
      const now = nowIso();
      const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString();

      await d1Run(
        `INSERT INTO webauthn_challenges (
          id, user_id, ceremony, challenge_hash, expected_rp_id, expected_origin,
          enrollment_token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, 'reauth', ?, ?, ?, NULL, ?, NULL, ?)`,
        [challengeId, c.authUser!.id, challengeHash, rp.rpId, rp.expectedOrigin, expiresAt, now],
        c.db
      );

      return c.json(
        200,
        {
          challengeId,
          expiresAt,
          options: {
            challenge,
            rpId: rp.rpId,
            timeout: 120000,
            userVerification: 'required',
            allowCredentials: creds.map((cred) => {
              const transports = parseTransportsJson(cred.transports);
              return transports.length > 0
                ? { type: 'public-key', id: cred.credential_id, transports }
                : { type: 'public-key', id: cred.credential_id };
            }),
          },
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // POST /api/auth/webauthn/reauth/verify — Issues a 2-minute single-use reauth proof token
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/reauth/verify',
    auth: 'required',
    handler: async (c) => {
      const rawBody = await c.readJson(64 * 1024);
      const parsed = loginVerifySchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid reauthentication payload.',
        });
      }
      const input = parsed.data;

      const candidateChallenge = extractClientDataChallenge(input.clientDataJSON);
      if (!candidateChallenge) {
        return c.json(400, { error: 'Malformed clientDataJSON payload.', code: 'INVALID_CLIENT_DATA' });
      }

      const consumed = await consumeChallengeAtomically(
        c,
        input.challengeId,
        'reauth',
        candidateChallenge
      );
      if (!consumed.ok) {
        return c.json(consumed.status, { error: consumed.error, code: consumed.code });
      }
      if (consumed.row.user_id !== c.authUser!.id) {
        return c.json(403, { error: 'Reauthentication challenge does not belong to you.', code: 'FORBIDDEN' });
      }

      const cred = await d1First<D1WebAuthnCredentialRow>(
        `SELECT * FROM webauthn_credentials
         WHERE credential_id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1`,
        [input.credentialId, c.authUser!.id],
        c.db
      );
      if (!cred) {
        return c.json(403, {
          error: 'Selected passkey is not active on your account.',
          code: 'INVALID_CREDENTIAL',
        });
      }

      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          clientDataJSON: input.clientDataJSON,
          authenticatorData: input.authenticatorData,
          signature: input.signature,
          expectedChallenge: candidateChallenge,
          expectedOrigin: consumed.row.expected_origin,
          expectedRpId: consumed.row.expected_rp_id,
          storedPublicKeySpki: cred.public_key_spki,
          storedCoseAlgorithm: cred.cose_algorithm,
          storedSignCount: cred.sign_count,
          requireUserVerification: true,
        });
      } catch (err) {
        const code = err instanceof WebAuthnVerificationError ? err.code : 'WEBAUTHN_VERIFY_FAILED';
        const msg = err instanceof Error ? err.message : 'Passkey reauthentication failed.';
        return c.json(401, { error: msg, code });
      }

      const now = nowIso();
      await d1Run(
        'UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?',
        [verified.newSignCount, now, cred.id],
        c.db
      );

      const reauthProof = generateOpaqueToken(24);
      const proofHash = await sha256Hex(reauthProof);
      const proofExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      await d1Run(
        `INSERT INTO webauthn_challenges (
          id, user_id, ceremony, challenge_hash, expected_rp_id, expected_origin,
          enrollment_token_hash, expires_at, consumed_at, created_at
        ) VALUES (?, ?, 'reauth', ?, ?, ?, 'reauth-proof', ?, NULL, ?)`,
        [
          randomId('wpr', 10),
          c.authUser!.id,
          proofHash,
          consumed.row.expected_rp_id,
          consumed.row.expected_origin,
          proofExpiresAt,
          now,
        ],
        c.db
      );

      return c.json(
        200,
        { ok: true, reauthProof, expiresAt: proofExpiresAt },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // GET /api/auth/webauthn/credentials — List own passkeys
  {
    method: 'GET',
    pattern: '/api/auth/webauthn/credentials',
    auth: 'required',
    handler: async (c) => {
      const rows = await d1All<D1WebAuthnCredentialRow>(
        `SELECT * FROM webauthn_credentials
         WHERE user_id = ?
         ORDER BY revoked_at IS NOT NULL ASC, created_at DESC`,
        [c.authUser!.id],
        c.db
      );

      return c.json(
        200,
        {
          credentials: rows.map(serializeCredentialMetadata),
          activeCount: rows.filter((r) => !r.revoked_at).length,
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // PATCH /api/auth/webauthn/credentials/:id — Rename own passkey
  {
    method: 'PATCH',
    pattern: '/api/auth/webauthn/credentials/:id',
    auth: 'required',
    handler: async (c) => {
      const rawBody = await c.readJson(16 * 1024);
      const parsed = renameCredentialSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid device label.',
        });
      }

      const cred = await d1First<D1WebAuthnCredentialRow>(
        'SELECT * FROM webauthn_credentials WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!cred) {
        return c.json(404, { error: 'Passkey not found.', code: 'NOT_FOUND' });
      }
      if (cred.user_id !== c.authUser!.id) {
        return c.json(403, { error: 'You can only rename your own passkeys.', code: 'FORBIDDEN' });
      }
      if (cred.revoked_at) {
        return c.json(400, { error: 'Cannot rename a revoked passkey.', code: 'CREDENTIAL_REVOKED' });
      }

      const newLabel = parsed.data.deviceLabel.trim();
      await d1Run(
        'UPDATE webauthn_credentials SET device_label = ? WHERE id = ? AND user_id = ?',
        [newLabel, cred.id, c.authUser!.id],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'WEBAUTHN_CREDENTIAL_RENAMED',
          entityType: 'webauthn_credential',
          entityId: cred.id,
          ipAddress: c.ipAddress,
          summary: `Renamed passkey from "${cred.device_label}" to "${newLabel}"`,
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        credential: serializeCredentialMetadata({ ...cred, device_label: newLabel }),
      });
    },
  },

  // POST /api/auth/webauthn/credentials/:id/revoke — Revoke own passkey (requires step-up reauth)
  {
    method: 'POST',
    pattern: '/api/auth/webauthn/credentials/:id/revoke',
    auth: 'required',
    handler: async (c) => {
      const rawBody = await c.readJson(16 * 1024);
      const parsed = revokeCredentialSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(400, {
          error: parsed.error.issues[0]?.message ?? 'Invalid revocation request.',
        });
      }

      const cred = await d1First<D1WebAuthnCredentialRow>(
        'SELECT * FROM webauthn_credentials WHERE id = ? LIMIT 1',
        [c.params.id],
        c.db
      );
      if (!cred) {
        return c.json(404, { error: 'Passkey not found.', code: 'NOT_FOUND' });
      }
      if (cred.user_id !== c.authUser!.id) {
        return c.json(403, { error: 'You cannot revoke another user’s passkey.', code: 'FORBIDDEN' });
      }
      if (cred.revoked_at) {
        return c.json(400, { error: 'This passkey is already revoked.', code: 'ALREADY_REVOKED' });
      }

      if (!parsed.data.reauthProof) {
        return c.json(403, {
          error: 'Passkey reauthentication is required before revoking a registered passkey.',
          code: 'REAUTH_REQUIRED',
        });
      }

      const now = nowIso();
      const proofHash = await sha256Hex(parsed.data.reauthProof);
      const consumeProof = await d1Run(
        `UPDATE webauthn_challenges
         SET consumed_at = ?
         WHERE user_id = ? AND ceremony = 'reauth' AND enrollment_token_hash = 'reauth-proof'
           AND challenge_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        [now, c.authUser!.id, proofHash, now],
        c.db
      );
      if ((consumeProof.meta?.changes ?? 0) !== 1) {
        return c.json(403, {
          error: 'Reauthentication proof is invalid or expired. Verify your passkey again.',
          code: 'REAUTH_REQUIRED',
        });
      }

      await d1Run(
        `UPDATE webauthn_credentials
         SET revoked_at = ?, revoked_by_user_id = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [now, c.authUser!.id, cred.id, c.authUser!.id],
        c.db
      );

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'WEBAUTHN_CREDENTIAL_REVOKED',
          entityType: 'webauthn_credential',
          entityId: cred.id,
          ipAddress: c.ipAddress,
          summary: `${c.authUser!.email} revoked own passkey "${cred.device_label}"`,
          metadata: { reason: parsed.data.reason || 'Self-revoked by user' },
        },
        c.db
      );

      const remaining = await d1All<{ id: string }>(
        'SELECT id FROM webauthn_credentials WHERE user_id = ? AND revoked_at IS NULL',
        [c.authUser!.id],
        c.db
      );

      return c.json(200, {
        ok: true,
        revokedId: cred.id,
        remainingActiveCount: remaining.length,
      });
    },
  },

  // GET /api/users/:id/webauthn — Admin inspects a user's passkeys (metadata only)
  {
    method: 'GET',
    pattern: '/api/users/:id/webauthn',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await findUserByIdRow(c, c.params.id);
      if (!target) {
        return c.json(404, { error: 'User not found.', code: 'NOT_FOUND' });
      }

      const rows = await d1All<D1WebAuthnCredentialRow>(
        `SELECT * FROM webauthn_credentials
         WHERE user_id = ?
         ORDER BY revoked_at IS NOT NULL ASC, created_at DESC`,
        [target.id],
        c.db
      );

      return c.json(
        200,
        {
          userId: target.id,
          userEmail: target.email,
          credentials: rows.map(serializeCredentialMetadata),
          activeCount: rows.filter((r) => !r.revoked_at).length,
        },
        { 'Cache-Control': 'no-store' }
      );
    },
  },

  // POST /api/users/:id/webauthn/:credId/revoke — Admin revokes user passkey + all user sessions
  {
    method: 'POST',
    pattern: '/api/users/:id/webauthn/:credId/revoke',
    auth: 'required',
    roles: ['admin'],
    handler: async (c) => {
      const target = await findUserByIdRow(c, c.params.id);
      if (!target) {
        return c.json(404, { error: 'User not found.', code: 'NOT_FOUND' });
      }

      const cred = await d1First<D1WebAuthnCredentialRow>(
        'SELECT * FROM webauthn_credentials WHERE id = ? AND user_id = ? LIMIT 1',
        [c.params.credId, target.id],
        c.db
      );
      if (!cred) {
        return c.json(404, { error: 'Passkey not found for this user.', code: 'NOT_FOUND' });
      }
      if (cred.revoked_at) {
        return c.json(400, { error: 'Passkey is already revoked.', code: 'ALREADY_REVOKED' });
      }

      const now = nowIso();
      await d1Run(
        `UPDATE webauthn_credentials
         SET revoked_at = ?, revoked_by_user_id = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [now, c.authUser!.id, cred.id, target.id],
        c.db
      );

      await revokeAllUserSessionsD1(target.id, 'webauthn_credential_revoked', c.db);

      await recordAuditLogD1(
        {
          actor: c.authUser!,
          action: 'WEBAUTHN_CREDENTIAL_REVOKED',
          entityType: 'webauthn_credential',
          entityId: cred.id,
          ipAddress: c.ipAddress,
          summary: `Admin revoked passkey "${cred.device_label}" and active sessions for ${target.email}`,
          metadata: { targetUserId: target.id, revokedByAdmin: true },
        },
        c.db
      );

      return c.json(200, {
        ok: true,
        revokedId: cred.id,
        sessionsRevoked: true,
      });
    },
  },
];
