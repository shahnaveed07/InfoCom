-- DropForeignKey
ALTER TABLE "module_grades" DROP CONSTRAINT "module_grades_assessment_id_fkey";

-- DropForeignKey
ALTER TABLE "module_grades" DROP CONSTRAINT "module_grades_module_id_fkey";

-- DropIndex
DROP INDEX "module_grades_student_course_mod_idx";

-- AlterTable
ALTER TABLE "module_grades" ALTER COLUMN "module_id" DROP NOT NULL,
ALTER COLUMN "assessment_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "module_grades_student_course_mod_lookup_idx" ON "module_grades"("student_id", "course_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_grades_student_assessment_idx" ON "module_grades"("student_id", "assessment_id");

-- AddForeignKey
ALTER TABLE "module_grades" ADD CONSTRAINT "module_grades_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_grades" ADD CONSTRAINT "module_grades_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
