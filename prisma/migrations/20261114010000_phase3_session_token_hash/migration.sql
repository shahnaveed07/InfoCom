-- Phase 3: Enforce unique SHA-256 token hash on opaque server-side auth sessions
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
