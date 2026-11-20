-- IGS — InfoCom Global Services
-- Additive Migration 0003: First-Party WebAuthn / Passkey Authentication for Cloudflare Workers Free
-- Preserves all existing 45 tables and users.password_hash intact (zero destructive changes).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_spki TEXT NOT NULL,
  cose_algorithm INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_label TEXT NOT NULL DEFAULT 'Passkey',
  aaguid TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  backup_state INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id
  ON webauthn_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_active_user
  ON webauthn_credentials(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('register', 'login', 'reauth')),
  challenge_hash TEXT NOT NULL UNIQUE,
  expected_rp_id TEXT NOT NULL,
  expected_origin TEXT NOT NULL,
  enrollment_token_hash TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at
  ON webauthn_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_ceremony
  ON webauthn_challenges(user_id, ceremony, created_at);
