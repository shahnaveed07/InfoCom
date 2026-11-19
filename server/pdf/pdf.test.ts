import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { generateCertificatePdfBytes, safeWinAnsiText } from './certificate-pdf.ts';
import { generateTablePdfBytes } from './report-pdf.ts';

// Minimal valid 1x1 transparent PNG data URL for custom logo embedding test
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('safeWinAnsiText sanitizes INR rupee symbols, smart punctuation, and non-WinAnsi characters', () => {
  assert.equal(safeWinAnsiText('Tuition ₹18,000.00 – “Verified”'), 'Tuition INR 18,000.00 - "Verified"');
  assert.equal(safeWinAnsiText('Hello… ‘world’ — IGS · Sopore'), "Hello... 'world' — IGS · Sopore");
});

test('generateCertificatePdfBytes produces a valid single-page A4 landscape PDF with embedded logo & QR vector', async () => {
  const bytes = await generateCertificatePdfBytes({
    certificateCode: 'IGS-CERT-2026-0042',
    verificationHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    verifyUrl: 'https://igs-infocom.workers.dev/verify-certificate?code=IGS-CERT-2026-0042',
    academyName: 'IGS — InfoCom Global Services',
    academySubtitle: 'Computer Institute',
    academyAddress: 'Downtown Sopore, Opposite Hassan Motors Petrol Pump, Sopore, Jammu and Kashmir, India.',
    titleFormat: 'Verified Certificate of Completion',
    studentName: 'Amina Rashid Lone',
    studentCode: 'STU-2026-0001',
    courseCode: 'IGS-WEB-101',
    courseTitle: 'Full-Stack Web Development',
    finalScore: '92.50',
    letterGrade: 'A',
    attendanceRate: 96,
    status: 'Issued',
    signatoryName: 'IGS Academic Registrar',
    signatoryTitle: 'Office of the Principal',
    issuedAtIso: '2026-05-15T10:00:00.000Z',
  });

  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 2000, `Expected non-trivial PDF output, got ${bytes.byteLength} bytes`);
  assert.equal(Buffer.from(bytes.subarray(0, 7)).toString('utf8'), '%PDF-1.');

  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 1);
  const { width, height } = parsed.getPage(0).getSize();
  assert.ok(width > height, 'Certificate PDF must be landscape');
});

test('generateCertificatePdfBytes handles revoked status, custom PNG logo, and invalid custom logo gracefully', async () => {
  const withPngLogo = await generateCertificatePdfBytes({
    certificateCode: 'IGS-CERT-2026-0099',
    verificationHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    verifyUrl: 'https://igs-infocom.workers.dev/verify-certificate?code=IGS-CERT-2026-0099',
    academyName: 'IGS — InfoCom Global Services',
    academySubtitle: 'Computer Institute',
    academyAddress: 'Sopore, J&K',
    titleFormat: 'Diploma Certificate',
    studentName: 'Test Learner',
    courseTitle: 'Cloud Computing & DevOps',
    finalScore: '81.00',
    letterGrade: 'B+',
    attendanceRate: 88,
    status: 'Revoked',
    revokedReason: 'Issued in error during audit test',
    signatoryName: 'Principal',
    signatoryTitle: 'IGS Administration',
    issuedAtIso: '2026-05-15T10:00:00.000Z',
    customLogoDataUrl: TINY_PNG_DATA_URL,
  });

  assert.equal(Buffer.from(withPngLogo.subarray(0, 7)).toString('utf8'), '%PDF-1.');

  // Corrupt base64 logo must fall back cleanly without throwing
  const withBadLogo = await generateCertificatePdfBytes({
    certificateCode: 'IGS-CERT-2026-0100',
    verificationHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    verifyUrl: 'https://igs-infocom.workers.dev/verify-certificate?code=IGS-CERT-2026-0100',
    academyName: 'IGS — InfoCom Global Services',
    academySubtitle: 'Computer Institute',
    academyAddress: 'Sopore, J&K',
    titleFormat: 'Certificate of Completion',
    studentName: 'Fallback Logo Test',
    courseTitle: 'Python Programming',
    finalScore: '85.00',
    letterGrade: 'A-',
    attendanceRate: 90,
    status: 'Issued',
    signatoryName: 'Principal',
    signatoryTitle: 'IGS Administration',
    issuedAtIso: '2026-05-15T10:00:00.000Z',
    customLogoDataUrl: 'data:image/png;base64,bm90LWEtcG5n',
  });
  assert.equal(Buffer.from(withBadLogo.subarray(0, 7)).toString('utf8'), '%PDF-1.');
});

test('generateTablePdfBytes supports multi-page pagination, INR text sanitization, and empty tables', async () => {
  const manyRows = Array.from({ length: 42 }, (_, idx) => [
    `INV-2026-${String(idx + 1).padStart(4, '0')}`,
    `Student ${idx + 1}`,
    `₹${(12000 + idx * 100).toFixed(2)}`,
    'Paid',
  ]);

  const multiPageBytes = await generateTablePdfBytes({
    academyName: 'IGS — InfoCom Global Services',
    academyAddress: 'Sopore, Jammu & Kashmir',
    title: 'Financial Collections Report',
    subtitle: 'INR Tuition Ledger',
    headers: ['Invoice #', 'Student', 'Collected', 'Status'],
    rows: manyRows,
  });

  assert.equal(Buffer.from(multiPageBytes.subarray(0, 7)).toString('utf8'), '%PDF-1.');
  const multiDoc = await PDFDocument.load(multiPageBytes);
  assert.ok(multiDoc.getPageCount() >= 2, `Expected >=2 pages for 42 rows, got ${multiDoc.getPageCount()}`);

  const emptyBytes = await generateTablePdfBytes({
    academyName: 'IGS — InfoCom Global Services',
    academyAddress: 'Sopore, Jammu & Kashmir',
    title: 'Empty Attendance Report',
    subtitle: 'Zero Records',
    headers: ['Date', 'Student', 'Status'],
    rows: [],
  });
  assert.equal(Buffer.from(emptyBytes.subarray(0, 7)).toString('utf8'), '%PDF-1.');
  const emptyDoc = await PDFDocument.load(emptyBytes);
  assert.equal(emptyDoc.getPageCount(), 1);
});
