export function escapeCsvCell(val: unknown): string {
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

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
