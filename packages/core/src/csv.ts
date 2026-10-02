/** Quotes a field per RFC 4180 only when it contains a comma, quote, or line break. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Spreadsheet formula injection (OWASP "CSV injection"): a text cell that
 * starts with `=`, `+`, `-` or `@` (or a tab/CR, which some spreadsheets strip
 * before evaluating) is treated as a formula when the file is opened. Case
 * subjects, customer names and tags come from customers' end users, so they are
 * attacker-controlled. A leading `'` makes the spreadsheet show the text as-is.
 * Only real strings are touched, and two fully-anchored shapes that cannot
 * be a formula are left alone: a plain signed number (`-15`, `+2.5`) and the
 * app's own overdue duration text from `formatMinutes` (`-1h 5m`, `-30s`),
 * which the case export writes into "Remaining/Elapsed".
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const OVERDUE_DURATION = /^-\d+[dhms]( \d+[dhms])*$/;

export function neutralizeFormula(value: string): string {
  if (!FORMULA_PREFIX.test(value)) return value;
  if (PLAIN_NUMBER.test(value) || OVERDUE_DURATION.test(value)) return value;
  return `'${value}`;
}

function formatCell(cell: string | number | null): string {
  return escapeField(typeof cell === "string" ? neutralizeFormula(cell) : String(cell ?? ""));
}

function formatRow(row: (string | number | null)[]): string {
  return row.map(formatCell).join(",");
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
