-- Background Worker Hardening: lease expiration, worker ownership, deduplication, and telemetry
ALTER TABLE "background_jobs"
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT,
  ADD COLUMN IF NOT EXISTS "worker_id" TEXT,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_dedupe_key_key"
  ON "background_jobs"("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "background_jobs_status_lease_expires_at_idx"
  ON "background_jobs"("status", "lease_expires_at");
