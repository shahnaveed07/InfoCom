-- Phase B: Remove legacy Firebase UID column and apply INR & IGS defaults
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_firebase_uid_key";
DROP INDEX IF EXISTS "users_firebase_uid_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "firebase_uid";

ALTER TABLE "academies" ALTER COLUMN "currency" SET DEFAULT 'INR';
ALTER TABLE "fee_plans" ALTER COLUMN "currency" SET DEFAULT 'INR';
ALTER TABLE "fee_invoices" ALTER COLUMN "currency" SET DEFAULT 'INR';
ALTER TABLE "certificate_templates" ALTER COLUMN "signatory_name" SET DEFAULT 'Academy Director';
