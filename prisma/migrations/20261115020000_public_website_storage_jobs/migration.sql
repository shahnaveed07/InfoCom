-- AlterTable
ALTER TABLE "courses" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "show_tuition_publicly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "slug" TEXT;

-- Backfill unique deterministic slugs for any pre-existing course rows
UPDATE "courses"
SET "slug" = LOWER(REGEXP_REPLACE(TRIM(COALESCE("code", '') || '-' || COALESCE("title", 'course')), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTRING("id", 1, 6)
WHERE "slug" IS NULL;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "storage_key" TEXT,
ALTER COLUMN "content_base64" DROP NOT NULL,
ALTER COLUMN "content_base64" SET DEFAULT '';

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "background_jobs_status_run_after_idx" ON "background_jobs"("status", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_is_published_is_archived_idx" ON "courses"("is_published", "is_archived");
