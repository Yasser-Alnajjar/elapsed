/**
 * The download formats of Settings → Data, in the order they are offered. The
 * single list the dialog, the route and the activity trail read, so a format is
 * added in one place (here, plus its serializer in `serialize.ts` or a report
 * builder). Client-safe: no server imports.
 *
 * `complete` formats contain every stored record and are backups; the PDF is a
 * summary report and says so wherever it is shown.
 */
export const EXPORT_FORMATS = [
  {
    id: "ndjson",
    label: "JSON Lines (compressed)",
    short: "JSON Lines",
    extension: "ndjson.gz",
    contentType: "application/gzip",
    complete: true,
    description:
      "Every stored record, one JSON object per line, gzip-compressed. Lossless and streamed, so it suits archiving and very large integrations.",
  },
  {
    id: "json",
    label: "JSON",
    short: "JSON",
    extension: "json",
    contentType: "application/json",
    complete: true,
    description: "Every stored record in one JSON document, grouped by type. Easy to read, query and script against.",
  },
  {
    id: "csv",
    label: "CSV (spreadsheet)",
    short: "CSV",
    extension: "zip",
    contentType: "application/zip",
    complete: true,
    description:
      "A zip with one CSV per record type, for Excel or Google Sheets. Text starting with = + - or @ gets a leading apostrophe so a spreadsheet never runs it as a formula.",
  },
  {
    id: "pdf",
    label: "PDF report",
    short: "PDF",
    extension: "pdf",
    contentType: "application/pdf",
    complete: false,
    description:
      "A readable summary to share: record counts, the period covered, SLA status totals, the 25 most recent cases and recent activity. Not a backup — it does not contain the records.",
  },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportFormatId = ExportFormat["id"];

export const DEFAULT_EXPORT_FORMAT: ExportFormatId = "ndjson";

export function isExportFormat(value: unknown): value is ExportFormatId {
  return EXPORT_FORMATS.some((format) => format.id === value);
}

/** What to call a recorded operation: a PDF download is a report, any other is a backup. */
export function describeOperation(kind: string, format: string | null): "Backup" | "Report" | "Cleanup" {
  if (kind === "cleanup") return "Cleanup";
  return format === "pdf" ? "Report" : "Backup";
}

export function exportFormat(id: ExportFormatId): ExportFormat {
  return EXPORT_FORMATS.find((format) => format.id === id)!;
}
