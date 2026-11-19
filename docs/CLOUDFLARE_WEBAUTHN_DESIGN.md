# IGS — InfoCom Global Services: First-Party WebAuthn / Passkey Technical Design (Cloudflare Workers Free)

**Status:** **PROPOSED TECHNICAL DESIGN — AWAITING INSTITUTIONAL APPROVAL (NOT YET IMPLEMENTED)**  
**Current Deployment Gate:** **`BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION`**  
**Target Runtime:** Cloudflare Workers Free (10 ms CPU per HTTP invocation) + Cloudflare D1 + Web Crypto API (`crypto.subtle`) — zero paid auth SaaS, zero external IdPs, zero weakened password hashing.

---

## 1. Problem Statement & Security Non-Negotiables

Password-based authentication using OWASP-compliant memory-hard KDFs exceeds the **10 ms CPU limit** enforced on hosted **Cloudflare Workers Free** isolates:

| Mechanism | Cost Parameters | Measured Local CPU | Hosted Workers Free 10 ms Ceiling |
| --- | --- | --- | --- |
| `scrypt` (`server/worker-auth.ts`) | `N=16384, r=8, p=1` (64-byte key) | **61.54 ms** hash / **61.60 ms** verify | **Exceeds (~6.1x over limit)** |
| `Argon2id` WASM (`hash-wasm`) | `m=19456, t=2, p=1` | **103.83 ms** hash / **91.80 ms** verify | **Exceeds (~9.2–10.4x) + Wasm codegen blocked** |
| **WebAuthn ECDSA P-256 (`ES256`)** | Hardware/OS asymmetric key + `crypto.subtle.verify` | **~0.5–2.0 ms** (expected; **must be hosted-benchmarked**) | **Designed to fit well under 10 ms** |

**Non-Negotiables Preserved:**
- Never reduce `scrypt` below `N=16384, r=8, p=1`.
- Never substitute SHA-256 or PBKDF2-low-iteration digests for passwords.
- Never expose raw onboarding/recovery tokens in logs or database job payloads.
- Do **not** alter the current login UI or disable password auth in code until this design (or the Workers Paid $5/month option) is explicitly approved.

---

## 2. Architecture Overview

First-party WebAuthn/Passkeys authenticate users via asymmetric cryptography bound to the relying party origin (`https://<worker>.workers.dev` initially, or a future custom domain):

- **Client (Browser):** Uses standard `navigator.credentials.create()` (registration) and `navigator.credentials.get()` (sign-in) with platform authenticators (Windows Hello, Android biometric passkeys, Apple Touch ID / Face ID) or roaming FIDO2 security keys.
- **Worker (`server/worker-routes/webauthn.ts` — proposed):**
  - Issues cryptographically random 32-byte challenges via `crypto.getRandomValues()` and stores **only** the SHA-256 challenge hash / record in Cloudflare D1 with a strict 5-minute TTL.
  - Verifies clientDataJSON, authenticatorData, RP ID hash, Origin, flags (`UP`, `UV`), signature counter, and cryptographic signature using native V8 **Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.verify`)** with zero WASM and minimal CPU overhead.
  - Issues the **existing** opaque `HttpOnly; SameSite=Lax; Secure` session cookie backed by `auth_sessions` in D1 (`server/worker-auth.ts`), leaving all RBAC, IDOR, CSRF, and workspace logic unchanged.

---

## 3. Proposed Cloudflare D1 Schema (`migrations/0003_webauthn_passkeys.sql`)

```sql
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,                         -- internal UUID (wac-...)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,          -- base64url encoded raw credential ID
  public_key_spki TEXT NOT NULL,               -- base64 encoded SPKI public key (ES256 P-256 / RS256)
  cose_alg INTEGER NOT NULL,                   -- -7 (ES256, preferred) or -257 (RS256)
  sign_count INTEGER NOT NULL DEFAULT 0,       -- monotonic signature counter (clone detection)
  transports TEXT NOT NULL DEFAULT '[]',       -- JSON array e.g. ["internal","hybrid"]
  device_label TEXT NOT NULL DEFAULT 'Passkey',
  aaguid TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0,  -- BE flag
  backup_state INTEGER NOT NULL DEFAULT 0,     -- BS flag
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_creds_user_active
  ON webauthn_credentials(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,                         -- wch-...
  challenge_hash TEXT NOT NULL UNIQUE,         -- SHA-256 hex of base64url challenge
  ceremony_type TEXT NOT NULL,                 -- 'registration' | 'authentication' | 'bootstrap' | 'recovery'
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  enrollment_token_id TEXT REFERENCES password_reset_tokens(id) ON DELETE CASCADE,
  rp_id TEXT NOT NULL,
  expected_origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,                    -- created_at + 5 minutes
  consumed_at TEXT,                            -- NULL while active; atomically stamped on first use
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_exp
  ON webauthn_challenges(expires_at, consumed_at);
```

---

## 4. Registration & Authentication Ceremonies

### 4.1 Passkey Registration Ceremony (Authenticated User or Approved Enrollment Token)
1. **Begin (`POST /api/auth/webauthn/register/options`)**:
   - Authorized via either:
     - Active authenticated session (adding a backup passkey), OR
     - Valid, unexpired, unused, unrevoked single-use enrollment token (`password_reset_tokens` / `enrollment_tokens`, hashed via SHA-256).
   - Generates 32-byte random `challenge` (base64url).
   - Inserts `webauthn_challenges` row with `ceremony_type`, `user_id`, `rp_id`, `expected_origin`, `expires_at = now + 5m`.
   - Returns `PublicKeyCredentialCreationOptions`:
     - `rp: { id: rpId, name: 'IGS — InfoCom Global Services' }`
     - `user: { id: base64url(user.id), name: user.email, displayName: user.name }`
     - `pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }]`
     - `authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }`
     - `excludeCredentials`: all non-revoked credentials currently belonging to `user.id`
     - `attestation: 'none'` (privacy-preserving, lowest parsing CPU).
2. **Finish (`POST /api/auth/webauthn/register/verify`)**:
   - Parses `clientDataJSON` -> verifies `type === 'webauthn.create'`, exact `origin === expected_origin`, and `challenge` matches an unconsumed, unexpired `webauthn_challenges` record.
   - **Atomic Replay Guard:** Executes conditional update:
     ```sql
     UPDATE webauthn_challenges
     SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
     ```
     and aborts (`400`) if `meta.changes !== 1`.
   - Parses CBOR `attestationObject.authData`:
     - Verifies `SHA-256(rpId) === authData.rpIdHash` (constant-time comparison).
     - Verifies flags: `UP` (User Present, bit 0) **and** `UV` (User Verified, bit 2) are set.
     - Extracts `credentialId`, `signCount`, `BE`/`BS` flags, and COSE public key (`kty=2, crv=1, alg=-7` for ECDSA P-256, or `kty=3, alg=-257` for RSA).
     - Encodes the public key into standard SPKI DER (pure TypeScript helper, ~30 lines, zero WASM) and validates import via `crypto.subtle.importKey('spki', ...)` before storing in `webauthn_credentials`.
   - If using an enrollment/bootstrap/recovery token, marks that token `used_at = now` atomically inside the same `db.batch()`, clears `must_change_password`, logs `WEBAUTHN_CREDENTIAL_REGISTERED` in `audit_logs`, and creates a fresh `auth_sessions` cookie.

### 4.2 Passkey Authentication Ceremony (Sign-In)
1. **Begin (`POST /api/auth/webauthn/login/options`)**:
   - Accepts optional `{ email }` (for non-discoverable security keys) or empty body (discoverable/resident passkey autofill).
   - Rate-limited via Cloudflare `AUTH_RATE_LIMITER`.
   - If `email` is provided and matches an active user, returns `allowCredentials` containing only their active credential IDs (never leaking account existence on unknown emails — return generic challenge options if unknown to prevent enumeration).
   - Persists single-use 5-minute challenge in `webauthn_challenges`.
2. **Finish (`POST /api/auth/webauthn/login/verify`)**:
   - Atomically consumes the challenge (`consumed_at = now WHERE consumed_at IS NULL AND expires_at > now`).
   - Verifies `clientDataJSON.type === 'webauthn.get'` and exact `clientDataJSON.origin === expected_origin`.
   - Looks up `webauthn_credentials` by `credential_id` joined to `users` (`revoked_at IS NULL` and `users.status = 'active'`).
   - Verifies `authData.rpIdHash === SHA-256(rpId)` and `UP` + `UV` flags.
   - Verifies signature via Web Crypto:
     - `signedData = concat(authenticatorData, SHA-256(clientDataJSONBytes))`
     - Converts ASN.1 DER ECDSA signature to raw `r || s` (64 bytes) for Web Crypto `ECDSA / P-256 / SHA-256`.
     - Calls `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, rawSig, signedData)`.
   - **Clone Detection:** If stored `sign_count > 0` or incoming `signCount > 0`, verifies `incomingSignCount > storedSignCount`. On regression (`incoming <= stored` when non-zero), rejects login (`403`), logs `WEBAUTHN_CLONE_SUSPECTED`, and flags credential for admin review.
   - Updates `sign_count` and `last_used_at`, issues opaque `auth_sessions` cookie, and logs `AUTH_LOGIN_WEBAUTHN_SUCCESS`.

---

## 5. Origin, RP ID & Custom Domain Considerations

- **Strict Validation:** `expected_origin` MUST exactly match the configured canonical `APP_URL` (e.g., `https://igs-infocom-ams-worker.<subdomain>.workers.dev`). `rp_id` MUST equal `new URL(APP_URL).hostname`.
- **Important `workers.dev` Migration Caveat:** WebAuthn credentials are cryptographically bound to `rpId`. Passkeys registered on `<worker>.workers.dev` **cannot** be reused later on a custom domain (e.g., `portal.infocomglobal.edu`).
  - **Mitigation:** When a custom domain is eventually adopted, run a planned dual-origin transition window where admins issue fresh single-use passkey enrollment links on the new domain (or allow Related Origin Requests if supported by browsers, while preferring clean re-enrollment on the permanent domain).

---

## 6. Lifecycle Operations: Bootstrap, Migration, Revocation & Recovery (Zero Email Required)

### 6.1 Bootstrapping the First Production Administrator
1. Operator applies D1 migrations (`0001`, `0002`, and future `0003_webauthn_passkeys.sql`).
2. Operator runs a local CLI script (`scripts/d1-bootstrap-passkey-admin.ts` — proposed) that inserts the inaugural `admin` user row (with `password_hash = NULL`) and a single-use **15-minute** hashed bootstrap enrollment token into remote D1 via `wrangler d1 execute --remote`, printing the one-time setup URL to the operator's terminal only (never stored in logs or `background_jobs`).
3. Admin opens the URL in their browser on the live HTTPS origin and completes the WebAuthn registration ceremony, which marks the bootstrap token consumed immediately and establishes their session.

### 6.2 Supervised Migration of Existing Users (Including Legacy `$argon2*` Accounts)
- **Zero User Records Discarded:** All rows in `users` (including accounts imported from PostgreSQL with `$argon2id` or `scrypt` hashes) remain intact with identical `id`, `email`, `role`, `student_code`, `staff_code`, enrollments, invoices, and certificates.
- **Migration Flow:**
  1. Administrators open **Users & Access** or **Students** in the portal and generate a single-use 72-hour passkey enrollment link for each user (or batch-supervised in lab/campus sessions).
  2. Users open their link, register their device passkey (or campus FIDO2 key), and immediately gain sub-10ms Workers Free sign-in.
  3. Existing `password_hash` values are not needed for WebAuthn login and can be cleared or retained strictly for legacy local Node deployments without weakening security.

### 6.3 Credential Revocation, Replacement & Multi-Device Support
- **Self-Service:** Authenticated users can register at least 2 passkeys (e.g., laptop + phone) and revoke lost credentials (`POST /api/auth/webauthn/credentials/:id/revoke`), provided they retain at least one active passkey or request admin recovery.
- **Admin Controls:** Administrators can view registered passkey metadata (label, created date, last used date — never private keys), revoke compromised credentials (`POST /api/users/:id/webauthn/:credId/revoke` -> also revokes all `auth_sessions` for that user), and issue or explicitly revoke single-use recovery enrollment links (`POST /api/users/:id/revoke-reset-tokens`).

### 6.4 Account Recovery Without Outbound Email
- Because `EMAIL_PROVIDER="disabled"` on Cloudflare Free:
  1. Lost-device user verifies identity in person or via institutional phone/office protocol with an IGS Administrator.
  2. Administrator revokes the lost passkey(s) + active sessions and generates a fresh single-use 72-hour recovery enrollment URL.
  3. Administrator can explicitly revoke the unused link at any time (`POST /api/users/:id/revoke-reset-tokens`) if misdirected.
  4. All issuance, revocation, and redemption events are recorded in `audit_logs` with zero raw tokens.

---

## 7. Rate Limiting, Audit Logging & Cron Cleanup

- **Rate Limiting:** All `/api/auth/webauthn/*` endpoints run behind Cloudflare's distributed `AUTH_RATE_LIMITER` (`10 req / 60s` per IP+bucket).
- **Audit Events:** `WEBAUTHN_REG_STARTED`, `WEBAUTHN_CREDENTIAL_REGISTERED`, `AUTH_LOGIN_WEBAUTHN_SUCCESS`, `AUTH_LOGIN_WEBAUTHN_FAILED`, `WEBAUTHN_CLONE_SUSPECTED`, `WEBAUTHN_CREDENTIAL_REVOKED`, `WEBAUTHN_RECOVERY_ISSUED`, `WEBAUTHN_RECOVERY_REVOKED`.
- **Cron Purge:** Existing 15-minute Cron trigger (`server/jobs/d1-worker.ts`) purges expired/consumed rows from `webauthn_challenges` (`DELETE FROM webauthn_challenges WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`).

---

## 8. Mandatory Hosted Cloudflare Free Benchmarking Requirement

> **CRITICAL WARNING:** Local `wrangler dev` / `unstable_dev` (`workerd` / Miniflare) **does NOT enforce** Cloudflare Workers Free's 10 ms hosted CPU termination limit. Passing locally does **not** prove hosted Workers Free CPU compliance.

Before removing the `BLOCKED — CLOUDFLARE FREE AUTHENTICATION LIMITATION` gate after implementation, operators **must**:
1. Deploy a staging Worker on an actual **Cloudflare Workers Free** account.
2. Execute at least 50 registration verifications and 100 authentication verifications (`ES256` and `RS256`) against live D1 + `AUTH_RATE_LIMITER`.
3. Inspect Cloudflare Worker Analytics / `wrangler tail` CPU time metrics (`cpuTimeMs` p50, p95, p99) and confirm **0 Error 1102 CPU limit exceptions** with p99 CPU comfortably below `10 ms` (target `< 5 ms`).

---

## 9. Decision & Approval Boundary

No code changes replacing password authentication have been made yet. Stakeholders must explicitly approve one of two compliant paths:

1. **Option A — Upgrade Workers to Paid ($5/month):** Keeps existing password authentication (`scrypt N=16384, r=8, p=1`) unchanged under a 30-second default CPU limit; zero UX change for students/staff on shared campus lab computers.
2. **Option B — Approve First-Party WebAuthn/Passkeys on Workers Free:** Authorizes implementing `migrations/0003_webauthn_passkeys.sql`, `server/worker-routes/webauthn.ts`, passkey UI in `AuthView.tsx` / account security settings, and hosted Workers Free CPU benchmarking. Note: campus shared-PC labs without platform authenticators will require either synced smartphone passkeys (QR hybrid transport) or USB FIDO2 keys.
