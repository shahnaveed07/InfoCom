import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { IGS_LOGO_JPEG_BASE64 } from './igs-logo-bytes.ts';

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function safeWinAnsiText(input: string): string {
  return String(input || '')
    .replace(/\u20B9/g, 'INR ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    // Replace characters outside Latin-1/WinAnsi safe printable set except em-dash/middle-dot
    .replace(/[^\x20-\xFF\u2014\u00B7]/g, ' ');
}

function drawCenteredText(params: {
  page: PDFPage;
  text: string;
  font: PDFFont;
  size: number;
  topY: number;
  pageWidth: number;
  pageHeight: number;
  color: ReturnType<typeof rgb>;
  maxWidth?: number;
}) {
  let clean = safeWinAnsiText(params.text);
  const maxWidth = params.maxWidth ?? params.pageWidth - 112;
  let width = params.font.widthOfTextAtSize(clean, params.size);
  if (width > maxWidth && clean.length > 8) {
    while (clean.length > 6 && params.font.widthOfTextAtSize(`${clean}...`, params.size) > maxWidth) {
      clean = clean.slice(0, -1);
    }
    clean = `${clean.trimEnd()}...`;
    width = params.font.widthOfTextAtSize(clean, params.size);
  }
  const x = Math.max(56, (params.pageWidth - width) / 2);
  const y = params.pageHeight - params.topY - params.size * 0.78;
  params.page.drawText(clean, {
    x,
    y,
    size: params.size,
    font: params.font,
    color: params.color,
  });
}

function drawQrVector(params: {
  page: PDFPage;
  value: string;
  left: number;
  bottomY: number;
  size: number;
}) {
  const qr = QRCode.create(params.value, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const quiet = 2;
  const totalModules = count + quiet * 2;
  const cellSize = params.size / totalModules;

  // White background box
  params.page.drawRectangle({
    x: params.left,
    y: params.bottomY,
    width: params.size,
    height: params.size,
    color: rgb(1, 1, 1),
  });

  const dark = rgb(15 / 255, 23 / 255, 42 / 255); // #0F172A
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) {
        const x = params.left + (col + quiet) * cellSize;
        const y = params.bottomY + (totalModules - 1 - (row + quiet)) * cellSize;
        params.page.drawRectangle({
          x,
          y,
          width: cellSize + 0.15,
          height: cellSize + 0.15,
          color: dark,
        });
      }
    }
  }
}

export interface CertificatePdfInput {
  certificateCode: string;
  verificationHash: string;
  verifyUrl: string;
  academyName: string;
  academySubtitle: string;
  academyAddress: string;
  titleFormat: string;
  studentName: string;
  studentCode?: string | null;
  courseCode?: string | null;
  courseTitle: string;
  finalScore: string;
  letterGrade: string;
  attendanceRate: number;
  status: string;
  revokedReason?: string | null;
  signatoryName: string;
  signatoryTitle: string;
  issuedAtIso: string;
  customLogoDataUrl?: string | null;
}

export async function generateCertificatePdfBytes(
  input: CertificatePdfInput
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(safeWinAnsiText(`${input.certificateCode} — ${input.academyName}`));
  pdfDoc.setAuthor(safeWinAnsiText(input.academyName));

  // A4 Landscape in points
  const width = 841.89;
  const height = 595.28;
  const page = pdfDoc.addPage([width, height]);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const navy = rgb(30 / 255, 58 / 255, 138 / 255); // #1E3A8A
  const slate900 = rgb(15 / 255, 23 / 255, 42 / 255); // #0F172A
  const slate700 = rgb(51 / 255, 65 / 255, 85 / 255); // #334155
  const slate600 = rgb(71 / 255, 85 / 255, 105 / 255); // #475569
  const slate500 = rgb(100 / 255, 116 / 255, 139 / 255); // #64748B
  const slate400 = rgb(148 / 255, 163 / 255, 184 / 255); // #94A3B8
  const teal = rgb(15 / 255, 118 / 255, 110 / 255); // #0F766E
  const crimson = rgb(185 / 255, 28 / 255, 28 / 255); // #B91C1C

  // Crisp double border
  page.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderColor: navy,
    borderWidth: 2,
  });
  page.drawRectangle({
    x: 32,
    y: 32,
    width: width - 64,
    height: height - 64,
    borderColor: slate400,
    borderWidth: 0.75,
  });

  // Embed official IGS logo bytes (static embedded JPEG or academy custom data URL)
  try {
    let embeddedLogo: Awaited<ReturnType<typeof pdfDoc.embedJpg>> | null = null;
    if (input.customLogoDataUrl?.startsWith('data:image/png;base64,')) {
      embeddedLogo = await pdfDoc.embedPng(
        decodeBase64ToBytes(input.customLogoDataUrl.slice('data:image/png;base64,'.length))
      );
    } else if (
      input.customLogoDataUrl?.startsWith('data:image/jpeg;base64,') ||
      input.customLogoDataUrl?.startsWith('data:image/jpg;base64,')
    ) {
      const b64 = input.customLogoDataUrl.split(',')[1] || '';
      if (b64) embeddedLogo = await pdfDoc.embedJpg(decodeBase64ToBytes(b64));
    } else {
      embeddedLogo = await pdfDoc.embedJpg(decodeBase64ToBytes(IGS_LOGO_JPEG_BASE64));
    }

    if (embeddedLogo) {
      const dims = embeddedLogo.scaleToFit(120, 62);
      page.drawImage(embeddedLogo, {
        x: 54,
        y: height - 46 - dims.height,
        width: dims.width,
        height: dims.height,
      });
    }
  } catch {
    // Non-fatal fallback if custom uploaded logo bytes cannot be parsed
  }

  // Header
  drawCenteredText({
    page,
    text: input.academyName.toUpperCase(),
    font: fontBold,
    size: 18,
    topY: 54,
    pageWidth: width,
    pageHeight: height,
    color: slate900,
  });
  drawCenteredText({
    page,
    text: `${input.academySubtitle} · Learn Today, Build Tomorrow.`,
    font: fontRegular,
    size: 10,
    topY: 78,
    pageWidth: width,
    pageHeight: height,
    color: slate600,
  });
  drawCenteredText({
    page,
    text: input.academyAddress,
    font: fontRegular,
    size: 8.5,
    topY: 94,
    pageWidth: width,
    pageHeight: height,
    color: slate500,
  });

  // Title
  drawCenteredText({
    page,
    text: (input.titleFormat || 'VERIFIED CERTIFICATE OF COMPLETION').toUpperCase(),
    font: fontBold,
    size: 24,
    topY: 134,
    pageWidth: width,
    pageHeight: height,
    color: navy,
  });

  drawCenteredText({
    page,
    text: 'This is to formally certify that',
    font: fontRegular,
    size: 11,
    topY: 178,
    pageWidth: width,
    pageHeight: height,
    color: slate600,
  });

  drawCenteredText({
    page,
    text: input.studentName || 'Student',
    font: fontBold,
    size: 26,
    topY: 204,
    pageWidth: width,
    pageHeight: height,
    color: slate900,
  });

  if (input.studentCode) {
    drawCenteredText({
      page,
      text: `Student ID: ${input.studentCode}`,
      font: fontRegular,
      size: 10,
      topY: 238,
      pageWidth: width,
      pageHeight: height,
      color: slate500,
    });
  }

  drawCenteredText({
    page,
    text: 'has successfully satisfied all curriculum, assessment, and attendance requirements for',
    font: fontRegular,
    size: 11,
    topY: 266,
    pageWidth: width,
    pageHeight: height,
    color: slate600,
  });

  const courseDisplay = `${input.courseCode ? `${input.courseCode} — ` : ''}${input.courseTitle}`;
  drawCenteredText({
    page,
    text: courseDisplay,
    font: fontBold,
    size: 18,
    topY: 292,
    pageWidth: width,
    pageHeight: height,
    color: slate900,
  });

  const metricsText = `Final Score: ${input.finalScore}%   ·   Grade: ${input.letterGrade}   ·   Attendance: ${input.attendanceRate}%   ·   Status: ${input.status}`;
  drawCenteredText({
    page,
    text: metricsText,
    font: fontBold,
    size: 10.5,
    topY: 330,
    pageWidth: width,
    pageHeight: height,
    color: input.status === 'Revoked' ? crimson : teal,
  });

  if (input.status === 'Revoked') {
    drawCenteredText({
      page,
      text: `REVOKED CERTIFICATE${input.revokedReason ? ` — ${input.revokedReason}` : ''}`,
      font: fontBold,
      size: 14,
      topY: 352,
      pageWidth: width,
      pageHeight: height,
      color: crimson,
    });
  }

  // Footer signature + metadata + QR code
  const footerTop = height - 155;
  const sigLineY = height - (footerTop + 46);
  page.drawLine({
    start: { x: 64, y: sigLineY },
    end: { x: 280, y: sigLineY },
    thickness: 0.75,
    color: slate400,
  });

  page.drawText(safeWinAnsiText(input.signatoryName), {
    x: 64,
    y: height - (footerTop + 52) - 9,
    size: 10.5,
    font: fontBold,
    color: slate900,
  });
  page.drawText(safeWinAnsiText(input.signatoryTitle), {
    x: 64,
    y: height - (footerTop + 68) - 8,
    size: 9,
    font: fontRegular,
    color: slate600,
  });

  page.drawText(safeWinAnsiText(`Certificate Code: ${input.certificateCode}`), {
    x: 310,
    y: height - (footerTop + 34) - 8,
    size: 9,
    font: fontRegular,
    color: slate700,
  });
  page.drawText(safeWinAnsiText(`Issued Date: ${input.issuedAtIso.slice(0, 10)}`), {
    x: 310,
    y: height - (footerTop + 50) - 8,
    size: 9,
    font: fontRegular,
    color: slate700,
  });
  page.drawText(safeWinAnsiText(`SHA-256 Digest: ${input.verificationHash.slice(0, 24)}...`), {
    x: 310,
    y: height - (footerTop + 66) - 8,
    size: 9,
    font: fontRegular,
    color: slate700,
  });

  const qrSize = 92;
  const qrX = width - 156;
  const qrBottomY = height - (footerTop - 6) - qrSize;
  drawQrVector({
    page,
    value: input.verifyUrl,
    left: qrX,
    bottomY: qrBottomY,
    size: qrSize,
  });

  const scanLabel = 'Scan to verify';
  const scanWidth = fontRegular.widthOfTextAtSize(scanLabel, 7.5);
  page.drawText(scanLabel, {
    x: qrX + (qrSize - scanWidth) / 2,
    y: qrBottomY - 12,
    size: 7.5,
    font: fontRegular,
    color: slate500,
  });

  return pdfDoc.save();
}
