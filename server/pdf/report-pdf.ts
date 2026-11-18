import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safeWinAnsiText } from './certificate-pdf.ts';

function truncateCellText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  const clean = safeWinAnsiText(text).slice(0, 64);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 3 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

export async function generateTablePdfBytes(params: {
  academyName: string;
  academyAddress: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(safeWinAnsiText(params.title));
  pdfDoc.setAuthor(safeWinAnsiText(params.academyName));

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 40;
  const usableWidth = pageWidth - margin * 2;
  const colCount = Math.max(1, params.headers.length);
  const colWidth = usableWidth / colCount;

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const slate900 = rgb(15 / 255, 23 / 255, 42 / 255);
  const slate800 = rgb(30 / 255, 41 / 255, 59 / 255);
  const slate600 = rgb(71 / 255, 85 / 255, 105 / 255);
  const slate500 = rgb(100 / 255, 116 / 255, 139 / 255);
  const navy = rgb(30 / 255, 58 / 255, 138 / 255);
  const white = rgb(1, 1, 1);
  const zebra = rgb(248 / 255, 250 / 255, 252 / 255);

  let page: PDFPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let topY = margin;

  page.drawText(safeWinAnsiText(params.academyName), {
    x: margin,
    y: pageHeight - topY - 12,
    size: 15,
    font: fontBold,
    color: slate900,
  });
  topY += 20;

  page.drawText(safeWinAnsiText(params.academyAddress), {
    x: margin,
    y: pageHeight - topY - 8,
    size: 9,
    font: fontRegular,
    color: slate600,
  });
  topY += 22;

  page.drawText(safeWinAnsiText(params.title), {
    x: margin,
    y: pageHeight - topY - 10,
    size: 13,
    font: fontBold,
    color: navy,
  });
  topY += 17;

  const generatedLabel = `${params.subtitle} · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  page.drawText(safeWinAnsiText(generatedLabel), {
    x: margin,
    y: pageHeight - topY - 8,
    size: 9,
    font: fontRegular,
    color: slate500,
  });
  topY += 24;

  const drawRow = (cells: Array<string | number>, isHeader: boolean, currentTop: number, rowIdx: number) => {
    if (isHeader) {
      page.drawRectangle({
        x: margin,
        y: pageHeight - currentTop - 16,
        width: usableWidth,
        height: 20,
        color: slate900,
      });
    } else if (rowIdx % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: pageHeight - currentTop - 15,
        width: usableWidth,
        height: 18,
        color: zebra,
      });
    }

    const font = isHeader ? fontBold : fontRegular;
    const size = isHeader ? 8.5 : 8;
    const color = isHeader ? white : slate800;

    cells.forEach((cell, idx) => {
      const txt = truncateCellText(String(cell ?? ''), font, size, colWidth - 8);
      page.drawText(txt, {
        x: margin + 4 + idx * colWidth,
        y: pageHeight - currentTop - 10,
        size,
        font,
        color,
      });
    });
  };

  drawRow(params.headers, true, topY, 0);
  topY += 22;

  for (let i = 0; i < params.rows.length; i += 1) {
    if (topY > pageHeight - 60) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      topY = 44;
      drawRow(params.headers, true, topY, 0);
      topY += 22;
    }
    drawRow(params.rows[i], false, topY, i);
    topY += 18;
  }

  if (params.rows.length === 0) {
    page.drawText('No matching records for this report.', {
      x: margin,
      y: pageHeight - topY - 14,
      size: 10,
      font: fontRegular,
      color: slate500,
    });
  }

  return pdfDoc.save();
}
