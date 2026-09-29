/** Quotes a field per RFC 4180 only when it contains a comma, quote, or line break. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function formatRow(row: (string | number | null)[]): string {
  return row.map((cell) => escapeField(String(cell ?? ""))).join(",");
}

/** A single CRLF-terminated CSV header line. */
export function buildCsvHeaderLine(header: string[]): string {
  return formatRow(header) + "\r\n";
}

/** CRLF-terminated CSV body lines, no header — for appending to a streamed response batch by batch. */
export function buildCsvRowLines(rows: (string | number | null)[][]): string {
  if (rows.length === 0) return "";
  return rows.map(formatRow).join("\r\n") + "\r\n";
}

/** Builds a CRLF-terminated CSV string, header row first. */
export function buildCsv(header: string[], rows: (string | number | null)[][]): string {
  return buildCsvHeaderLine(header) + buildCsvRowLines(rows);
}
