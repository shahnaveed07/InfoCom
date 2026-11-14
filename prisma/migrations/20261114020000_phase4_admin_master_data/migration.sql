-- Phase 4: Administrative Master Data, Instructor Permissions & Academy Configuration
ALTER TABLE "academies"
  ADD COLUMN IF NOT EXISTS "website" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "logo_data_url" TEXT NOT NULL DEFAULT '';

ALTER TABLE "academies"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';

ALTER TABLE "instructor_profiles"
  ADD COLUMN IF NOT EXISTS "permissions_configured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'Technical Bootcamp',
  ADD COLUMN IF NOT EXISTS "prerequisites" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "learning_objectives" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "grading_config" JSONB NOT NULL DEFAULT '{}'::jsonb;
