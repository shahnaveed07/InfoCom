-- Phase 5: Admission & Enrollment Management
ALTER TABLE "admissions"
  ADD COLUMN IF NOT EXISTS "application_number" TEXT,
  ADD COLUMN IF NOT EXISTS "date_of_birth" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "nationality" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "postal_code" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "guardian_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "guardian_relationship" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "guardian_phone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "guardian_email" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "previous_qualification" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "previous_institution" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "graduation_year" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "previous_score" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "allocated_batch_id" TEXT,
  ADD COLUMN IF NOT EXISTS "fee_plan_id" TEXT,
  ADD COLUMN IF NOT EXISTS "applicant_remarks" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "review_remarks" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "portal_activated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "portal_activated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "draft_saved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "admissions_application_number_key"
  ON "admissions"("application_number");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admissions_allocated_batch_id_fkey') THEN
    ALTER TABLE "admissions"
      ADD CONSTRAINT "admissions_allocated_batch_id_fkey"
      FOREIGN KEY ("allocated_batch_id") REFERENCES "cohorts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admissions_fee_plan_id_fkey') THEN
    ALTER TABLE "admissions"
      ADD CONSTRAINT "admissions_fee_plan_id_fkey"
      FOREIGN KEY ("fee_plan_id") REFERENCES "fee_plans"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "admission_status_histories" (
  "id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "previous_status" TEXT,
  "new_status" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "actor_user_id" TEXT,
  "actor_name" TEXT NOT NULL DEFAULT '',
  "actor_role" TEXT NOT NULL DEFAULT 'system',
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admission_status_histories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admission_status_histories_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "admissions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "admission_status_histories_application_id_changed_at_idx"
  ON "admission_status_histories"("application_id", "changed_at");

ALTER TABLE "admission_documents"
  ADD COLUMN IF NOT EXISTS "verification_remarks" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "verified_by_name" TEXT,
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "is_latest" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "documents"
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ALTER COLUMN "uploaded_by_user_id" DROP NOT NULL;

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_owner_user_id_fkey";
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_uploaded_by_user_id_fkey";

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_logs"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "application_id" TEXT;

ALTER TABLE "delivery_logs" DROP CONSTRAINT IF EXISTS "delivery_logs_user_id_fkey";

ALTER TABLE "delivery_logs"
  ADD CONSTRAINT "delivery_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_logs_application_id_fkey') THEN
    ALTER TABLE "delivery_logs"
      ADD CONSTRAINT "delivery_logs_application_id_fkey"
      FOREIGN KEY ("application_id") REFERENCES "admissions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "delivery_logs_application_id_sent_at_idx"
  ON "delivery_logs"("application_id", "sent_at");
