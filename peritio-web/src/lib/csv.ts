function needsSpreadsheetFormulaProtection(value: string): boolean {
  return /^\s*[=+\-@]/.test(value) || /^\s*[\t\r]/.test(value);
}

export function formatCsvCell(value: string): string {
  const safeValue = needsSpreadsheetFormulaProtection(value) ? `'${value}` : value;
  const escaped = safeValue.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function buildCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(formatCsvCell).join(",")).join("\r\n");
}
