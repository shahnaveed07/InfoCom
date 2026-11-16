import { Router } from 'express';
import PDFDocument from 'pdfkit';
import {
  calculateAttendanceStats,
  calculateCourseCompletion,
  calculateLetterGrade,
  calculateWeightedAverage,
  toCents,
  fromCents,
} from '../../src/shared/academic.ts';
import type { AttendanceStatus } from '../../src/shared/types.ts';
import { prisma } from '../db/prisma.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

function escapeCsvCell(val: unknown): string {
  let str = val === null || val === undefined ? '' : String(val);
  // Neutralize Excel/Sheets formula injection on exported CSV cells
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function generateTablePdf(params: {
  academyName: string;
  academyAddress: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
      info: {
        Title: params.title,
        Author: params.academyName,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#0F172A')
      .text(params.academyName, { align: 'left' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#475569')
      .text(params.academyAddress);

    doc.moveDown(0.75);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#1E3A8A')
      .text(params.title);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#64748B')
      .text(`${params.subtitle} · Generated ${new Date().toLocaleString('en-IN')}`);

    doc.moveDown(0.75);

    const usableWidth = doc.page.width - 80;
    const colCount = Math.max(1, params.headers.length);
    const colWidth = usableWidth / colCount;

    const drawRow = (cells: Array<string | number>, isHeader: boolean, yPos: number) => {
      if (isHeader) {
        doc.rect(40, yPos - 4, usableWidth, 20).fill('#0F172A');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
      } else {
        doc.fillColor('#1E293B').font('Helvetica').fontSize(8);
      }
      cells.forEach((cell, idx) => {
        const text = String(cell ?? '').slice(0, 48);
        doc.text(text, 44 + idx * colWidth, yPos, {
          width: colWidth - 8,
          height: 14,
          ellipsis: true,
        });
      });
    };

    let y = doc.y;
    drawRow(params.headers, true, y);
    y += 22;

    for (let i = 0; i < params.rows.length; i += 1) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 44;
        drawRow(params.headers, true, y);
        y += 22;
      }
      if (i % 2 === 1) {
        doc.rect(40, y - 3, usableWidth, 18).fill('#F8FAFC');
      }
      drawRow(params.rows[i], false, y);
      y += 18;
    }

    if (params.rows.length === 0) {
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(10).fillColor('#64748B').text('No matching records for this report.');
    }

    doc.end();
  });
}

reportsRouter.get('/:kind', async (req: AuthenticatedRequest, res) => {
  try {
    const actor = req.authUser!;
    const kind = String(req.params.kind || '').trim().toLowerCase();
    const format = String(req.query.format || 'json').trim().toLowerCase();

    if (!['csv', 'pdf', 'json'].includes(format)) {
      res.status(400).json({ error: 'Unsupported report format. Use csv, pdf, or json.' });
      return;
    }

    const academy = await prisma.academy.findFirst({ orderBy: { createdAt: 'asc' } });
    const academyName = academy?.name || 'IGS — InfoCom Global Services';
    const academyAddress =
      academy?.address ||
      'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.';

    let title = '';
    let subtitle = '';
    let headers: string[] = [];
    let rows: Array<Array<string | number>> = [];

    if (kind === 'academic-progress') {
      title = 'Academic Progress Report';
      subtitle = `Scoped for ${actor.name} (${actor.role.toUpperCase()})`;

      const courseFilter =
        actor.role === 'instructor'
          ? {
              OR: [
                { instructorId: actor.id },
                { batches: { some: { instructorId: actor.id } } },
                { instructorAssignments: { some: { instructorId: actor.id, isActive: true } } },
              ],
            }
          : undefined;

      const enrollments = await prisma.enrollment.findMany({
        where: {
          ...(actor.role === 'student' ? { studentId: actor.id } : {}),
          ...(courseFilter ? { course: courseFilter } : {}),
        },
        include: {
          student: { select: { id: true, name: true, email: true, studentCode: true } },
          course: { include: { modules: true } },
        },
        orderBy: { enrolledAt: 'desc' },
      });

      const [grades, attendance] = await Promise.all([
        prisma.grade.findMany({
          where: {
            ...(actor.role === 'student' ? { studentId: actor.id } : {}),
          },
          include: { assessment: true },
        }),
        prisma.attendance.findMany({
          where: {
            ...(actor.role === 'student' ? { studentId: actor.id } : {}),
          },
        }),
      ]);

      headers = [
        'Student ID',
        'Student Name',
        'Course',
        'Batch',
        'Status',
        'Completion %',
        'Weighted Score %',
        'Letter Grade',
        'Attendance %',
      ];

      rows = enrollments.map((e) => {
        const completed = Array.isArray(e.completedModuleIds)
          ? (e.completedModuleIds as string[])
          : [];
        const completionPct = calculateCourseCompletion(completed, e.course.modules.length);
        const enrGrades = grades
          .filter((g) => g.studentId === e.studentId && g.courseId === e.courseId)
          .map((g) => ({
            score: Math.round((g.score / Math.max(1, g.maxScore)) * 1000) / 10,
            weight: g.assessment.weight,
          }));
        const weighted = calculateWeightedAverage(enrGrades);
        const letter = calculateLetterGrade(weighted);
        const enrAtt = attendance
          .filter((a) => a.studentId === e.studentId && a.courseId === e.courseId)
          .map((a) => ({
            id: a.id,
            sessionId: a.sessionId,
            courseId: a.courseId,
            studentId: a.studentId,
            status: a.status as AttendanceStatus,
            note: a.note,
            updatedAt: a.updatedAt.toISOString(),
            updatedBy: a.updatedBy,
          }));
        const attRate = calculateAttendanceStats(enrAtt).rate;

        return [
          e.student.studentCode || e.studentId,
          e.student.name,
          `${e.course.code} ${e.course.title}`,
          e.cohort,
          e.status,
          completionPct,
          weighted !== null ? weighted : 'N/A',
          letter,
          attRate,
        ];
      });
    } else if (kind === 'attendance-summary') {
      if (actor.role === 'student') {
        res.status(403).json({ error: 'Attendance summary export is restricted to faculty and administrators.' });
        return;
      }
      title = 'Attendance Summary Report';
      subtitle = `Course & Batch Attendance Metrics (${actor.role.toUpperCase()})`;

      const courses = await prisma.course.findMany({
        where:
          actor.role === 'instructor'
            ? {
                OR: [
                  { instructorId: actor.id },
                  { batches: { some: { instructorId: actor.id } } },
                  { instructorAssignments: { some: { instructorId: actor.id, isActive: true } } },
                ],
              }
            : {},
        include: {
          sessions: true,
          attendanceRecords: true,
        },
        orderBy: { code: 'asc' },
      });

      headers = [
        'Course Code',
        'Course Title',
        'Sessions Count',
        'Marked Records',
        'Present',
        'Late',
        'Absent',
        'Excused',
        'Attendance Rate %',
      ];

      rows = courses.map((c) => {
        const stats = calculateAttendanceStats(
          c.attendanceRecords.map((a) => ({
            id: a.id,
            sessionId: a.sessionId,
            courseId: a.courseId,
            studentId: a.studentId,
            status: a.status as AttendanceStatus,
            note: a.note,
            updatedAt: a.updatedAt.toISOString(),
            updatedBy: a.updatedBy,
          }))
        );
        return [
          c.code,
          c.title,
          c.sessions.length,
          stats.total,
          stats.present,
          stats.late,
          stats.absent,
          stats.excused,
          stats.rate,
        ];
      });
    } else if (kind === 'financial-collections') {
      if (actor.role !== 'admin') {
        res.status(403).json({ error: 'Financial collections reports are restricted to administrators.' });
        return;
      }
      title = 'Financial Collections & Fee Ledger Report';
      subtitle = `Currency: ${academy?.currency || 'INR'}`;

      const invoices = await prisma.invoice.findMany({
        where: { isArchived: false },
        include: {
          student: { select: { name: true, studentCode: true } },
          course: { select: { code: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      headers = [
        'Invoice #',
        'Student ID',
        'Student Name',
        'Course',
        'Status',
        'Amount Due',
        'Amount Paid',
        'Balance',
        'Due Date',
      ];

      rows = invoices.map((inv) => {
        const dueCents = toCents(inv.amountDue.toFixed(2));
        const paidCents = toCents(inv.amountPaid.toFixed(2));
        const balance = inv.status === 'Voided' ? '0.00' : fromCents(Math.max(0, dueCents - paidCents));
        return [
          inv.invoiceNumber,
          inv.student.studentCode || inv.studentId,
          inv.student.name,
          `${inv.course.code} ${inv.course.title}`,
          inv.status,
          inv.amountDue.toFixed(2),
          inv.amountPaid.toFixed(2),
          balance,
          inv.dueDate.toISOString().slice(0, 10),
        ];
      });
    } else if (kind === 'admissions-funnel') {
      if (actor.role !== 'admin') {
        res.status(403).json({ error: 'Admissions funnel reports are restricted to administrators.' });
        return;
      }
      title = 'Admissions Funnel Report';
      subtitle = 'Application Pipeline & Conversion Status';

      const apps = await prisma.admissionApplication.findMany({
        include: {
          targetCourse: { select: { code: true, title: true } },
        },
        orderBy: { submittedAt: 'desc' },
      });

      headers = [
        'Application #',
        'Applicant Name',
        'Email',
        'Phone',
        'Target Course',
        'Preferred Batch',
        'Status',
        'Submitted Date',
      ];

      rows = apps.map((a) => [
        a.applicationNumber || a.id,
        a.applicantName,
        a.applicantEmail,
        a.phone,
        `${a.targetCourse.code} ${a.targetCourse.title}`,
        a.preferredCohort,
        a.status,
        a.submittedAt.toISOString().slice(0, 10),
      ]);
    } else {
      res.status(404).json({ error: `Unknown report type: ${kind}` });
      return;
    }

    const safeFileBase = `igs-${kind}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const csv = toCsv(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileBase}.csv"`);
      res.send(csv);
      return;
    }

    if (format === 'pdf') {
      const pdfBuffer = await generateTablePdf({
        academyName,
        academyAddress,
        title,
        subtitle,
        headers,
        rows,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileBase}.pdf"`);
      res.send(pdfBuffer);
      return;
    }

    res.json({ title, subtitle, headers, rows });
  } catch (err) {
    console.error('Report generation failed:', err);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});
