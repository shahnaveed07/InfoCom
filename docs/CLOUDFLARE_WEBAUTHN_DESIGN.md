# IGS — InfoCom Global Services: First-Party WebAuthn / Passkey Architecture (Cloudflare Workers Free)

**Implementation Status:** **`COMPLETED` (Implemented & Verified Locally in `workerd` + Chromium CDP)**  
**Hosted Cloudflare Free 10 ms CPU Validation:** **`PENDING` (Must Be Executed on Live Staging `workers.dev` Before Production Cutover)**  
**Target Runtime:** Cloudflare Workers Free (10 ms CPU per HTTP invocation) + Cloudflare D1 + Web Crypto API (`crypto.subtle`) — zero paid auth SaaS, zero external IdPs, zero weakened password hashing.

---

## 1. Why First-Party WebAuthn Replaces Password Hashing on Workers Free

OWASP-compliant memory-hard password KDFs exceed the **10 ms CPU limit** enforced on hosted **Cloudflare Workers Free** isolates:

| Mechanism | Cost Parameters | Measured Local Timing | Workers Free 10 ms Compatibility |
| --- | --- | --- | --- |
| `scrypt` (legacy password KDF) | `N=16384, r=8, p=1` (64-byte key) | ~61.5 ms hash / ~61.6 ms verify | **Incompatible (~6x over limit)** — removed from Worker bundle |
| `Argon2id` WASM (`hash-wasm`) | `m=19456, t=2, p=1` | ~91–104 ms + WASM codegen restrictions | **Incompatible (~9–10x over limit)** — excluded from Worker bundle |
| **First-Party WebAuthn (`ES256` / `RS256`)** | Hardware/OS asymmetric key + native V8 `crypto.subtle` | **Sub-millisecond crypto verification locally** (hosted staging p99 CPU validation: `PENDING`) | **Designed & built for Workers Free (`AUTH_MODE=webauthn`)** |

**Security Non-Negotiables Enforced:**
- Password KDFs (`scrypt`, `argon2`, `hash-wasm`, `hashPasswordWorker`, `verifyPasswordWorker`) are **completely removed** from the Cloudflare Worker bundle (`dist-worker/worker.js` verified by `server/worker.test.ts` and CI).
- All legacy password routes on Cloudflare Workers (`POST /api/auth/login`, `/change-password`, `/forgot-password`, `/reset-password`) return HTTP `403` with `code: 'PASSWORD_AUTH_UNAVAILABLE_ON_WORKERS_FREE'` and `authMode: 'webauthn'`.
- Existing user rows and legacy `users.password_hash` values are preserved untouched so zero records are lost and legacy local Node.js + PostgreSQL (`server/routes/auth.routes.ts`) continues running full Argon2id/scrypt password auth unchanged.

---

## 2. Implemented Runtime Architecture

- **Pure Web Crypto Core (`server/webauthn/core.ts`):**
  - Zero third-party WebAuthn dependencies and zero WASM modules.
  - Strict RFC 8949 CBOR decoder (`decodeCbor`) with depth/length bounds.
  - Full `authenticatorData` parser extracting `rpIdHash`, flags (`UP`, `UV`, `BE`, `BS`, `AT`), `signCount`, `aaguid`, `credentialId`, and COSE public key.
  - Pure TypeScript COSE -> ASN.1 DER SPKI encoder supporting `ES256 (-7)` (ECDSA P-256) and `RS256 (-257)` (RSASSA-PKCS1-v1_5 SHA-256), plus ASN.1 DER ECDSA -> IEEE P1363 raw signature conversion for `crypto.subtle.verify`.
  - Strict `clientDataJSON` verification (`type`, constant-time `challenge`, exact `origin`, `crossOrigin !== true`), constant-time `rpIdHash` verification, mandatory `UP` + `UV` checks, and W3C synced-passkey-safe counter evaluation (`0 -> 0` accepted; non-zero regression rejected as `CLONE_SUSPECTED`).
- **Worker API Routes (`server/worker-routes/webauthn.ts`):**
  - `GET /api/auth/config` — Public runtime auth mode discovery (`authMode`, `passwordAuthEnabled`, `passkeySupported`, `rpId`, `rpName`).
  - `POST /api/auth/webauthn/register/options` & `POST /api/auth/webauthn/register/verify` — Single-use admin enrollment link OR authenticated multi-passkey registration; enforces `excludeCredentials`, cross-user guard (`CROSS_USER_ENROLLMENT_FORBIDDEN`), atomic challenge consumption, atomic enrollment token consumption, and session issuance.
  - `POST /api/auth/webauthn/login/options` & `POST /api/auth/webauthn/login/verify` — Discoverable or email-hinted sign-in, rate-limited by `AUTH_RATE_LIMITER`, atomic single-use challenge consumption, clone regression detection (`WEBAUTHN_CLONE_SUSPECTED`), and opaque `HttpOnly; SameSite=Lax; Secure` `auth_sessions` cookie issuance.
  - `POST /api/auth/webauthn/reauth/options` & `POST /api/auth/webauthn/reauth/verify` — Step-up passkey verification issuing a 2-minute single-use `reauthProof` required before self-revocation.
  - `GET /api/auth/webauthn/credentials`, `PATCH /api/auth/webauthn/credentials/:id`, `POST /api/auth/webauthn/credentials/:id/revoke` — Self-service passkey listing, renaming, and step-up-protected revocation.
  - `GET /api/users/:id/webauthn` & `POST /api/users/:id/webauthn/:credId/revoke` — Admin metadata inspection (never private keys) and revocation that also immediately invalidates all active `auth_sessions` for that user.

---

## 3. Cloudflare D1 Additive Schema (`migrations/0003_webauthn_passkeys.sql`)

Adds 2 tables alongside the 45 core tables (**47 total relational tables**):
1. `webauthn_credentials`: `id`, `user_id`, `credential_id` (UNIQUE), `public_key_spki`, `cose_algorithm`, `sign_count`, `transports`, `device_label`, `aaguid`, `backup_eligible`, `backup_state`, `created_at`, `last_used_at`, `revoked_at`, `revoked_by_user_id`.
2. `webauthn_challenges`: `id`, `user_id`, `ceremony` (`'register' | 'login' | 'reauth'`), `challenge_hash`, `expected_rp_id`, `expected_origin`, `enrollment_token_hash`, `expires_at`, `consumed_at`, `created_at`.

All expired/consumed `webauthn_challenges` rows are purged automatically by the 15-minute Cloudflare Cron sweep (`server/jobs/d1-worker.ts`).

---

## 4. Lifecycle Operations (Zero Outbound Email Required)

### 4.1 First-Admin Passkey Bootstrap CLI (`scripts/d1-bootstrap-passkey-admin.ts`)
```bash
npm run cf:admin:bootstrap -- \
  --remote \
  --database igs-infocom-db \
  --email director@infocomglobal.edu \
  --name "IGS Director" \
  --app-url https://igs-infocom-ams-worker.<your-subdomain>.workers.dev
```
- Refuses to overwrite existing administrators (exits non-zero unless `--allow-existing-enrollment` is explicitly passed for supervised recovery).
- Inserts the admin with `password_hash = NULL`, persists **only** the SHA-256 hash of a 32-byte single-use token (default 15-minute TTL), and prints the one-time `/login?enrollToken=...` URL to stdout only.

### 4.2 Migrating Existing Users & Account Recovery
- Existing users imported from PostgreSQL retain their `id`, `email`, `role`, `student_code`, `staff_code`, enrollments, invoices, certificates, and untouched `password_hash`.
- Admins issue 72-hour single-use `/?enrollToken=...` links from **User Accounts** or **Students**, can explicitly revoke unused links at any time (`POST /api/users/:id/revoke-reset-tokens`), and can inspect/revoke user passkeys (immediately revoking all active sessions).
- Raw enrollment tokens are never written to `audit_logs` or `background_jobs` under `EMAIL_PROVIDER="disabled"`.

---

## 5. Origin, RP ID & Future Custom Domain Transition

- `expectedOrigin` and `rpId` are derived from `APP_URL` / `WEBAUTHN_RP_ID` (on local `wrangler dev`, loopback `localhost` is supported automatically).
- Because WebAuthn credentials are cryptographically bound to `rpId`, passkeys registered on `*.workers.dev` cannot be reused if the institute later moves to a custom domain. During any future domain cutover, admins should issue fresh single-use passkey enrollment links on the permanent domain.

---

## 6. Mandatory Hosted Cloudflare Free Verification (`PENDING`)

> **Important:** Local `workerd` (`npm run test:cloudflare`) and Chromium CDP E2E (`npm run test:e2e:worker`) verify cryptographic correctness, security negative cases, and end-to-end UX, **but local Miniflare does not enforce Cloudflare Workers Free's 10 ms hosted CPU cap**.

Before production cutover on Cloudflare Workers Free, run `npm run cf:verify:cpu -- --url https://igs-infocom-ams-worker.<your-subdomain>.workers.dev` and inspect `wrangler tail` + Cloudflare Workers Analytics CPU time (p99 < 10 ms, zero Error 1102 exceptions) during live registration, sign-in, and PDF downloads.
