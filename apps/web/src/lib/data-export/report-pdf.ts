import type { IntegrationReportData } from "@sla/db";
import { INTEGRATION_PROVIDER_LABELS } from "../types/integrations";
import { DATA_COUNT_LINES } from "../types/data";
import { describeOperation, exportFormat, isExportFormat } from "./formats";
import { measureText, PAGE_HEIGHT, PAGE_WIDTH, PdfDocument, wrapText, type PdfFont, type Rgb } from "./pdf";

/**
 * Lays out the integration data report: what an integration has stored, what
 * period it covers, the SLA state of its commitments, its most recent cases and
 * recent backup/cleanup activity. A summary to read or share, not a backup —
 * it says so on the page. Dates are UTC and written out in full so the file
 * reads the same wherever it is opened.
 */

const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - 56;
const INK: Rgb = [0.11, 0.13, 0.17];
const MUTED: Rgb = [0.4, 0.44, 0.5];
const ACCENT: Rgb = [0.1, 0.29, 0.62];
const BAND: Rgb = [0.09, 0.14, 0.24];
const ZEBRA: Rgb = [0.955, 0.965, 0.98];

const STATUS_LABEL: Record<IntegrationReportData["status"], string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  reauth_required: "Needs reconnect",
  permission_denied: "Access restricted",
};

const COMMITMENT_STATUS_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  breached: "Breached",
  met: "Met",
  paused: "Paused",
  cancelled: "Cancelled",
};

const OPERATION_STATUS_LABEL: Record<string, string> = { started: "In progress", completed: "Completed", failed: "Failed" };

const formatInt = (value: number) => value.toLocaleString("en-US");
const formatDate = (date: Date | null) => (date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Column {
  title: string;
  width: number;
  align?: "end";
}

class Layout {
  readonly pdf: PdfDocument;
  y = 0;

  constructor(pdf: PdfDocument) {
    this.pdf = pdf;
  }

  page(): void {
    this.pdf.addPage();
    this.y = MARGIN;
  }

  ensure(height: number): void {
    if (this.y + height > BOTTOM) this.page();
  }

  title(text: string, subtitle: string): void {
    this.pdf.rect(0, 0, PAGE_WIDTH, 92, BAND);
    this.pdf.text(MARGIN, 44, text, { font: "bold", size: 20, color: [1, 1, 1] });
    this.pdf.text(MARGIN, 66, subtitle, { size: 11, color: [0.78, 0.84, 0.95] });
    this.y = 92 + 28;
  }

  heading(text: string): void {
    this.ensure(40);
    this.y += 8;
    this.pdf.text(MARGIN, this.y, text, { font: "bold", size: 12, color: ACCENT });
    this.pdf.line(MARGIN, this.y + 6, PAGE_WIDTH - MARGIN, this.y + 6, { color: [0.82, 0.85, 0.9] });
    this.y += 22;
  }

  paragraph(text: string, options: { font?: PdfFont; size?: number; color?: Rgb } = {}): void {
    const { size = 9.5 } = options;
    for (const line of wrapText(text, options.font ?? "regular", size, CONTENT_WIDTH)) {
      this.ensure(size + 5);
      this.pdf.text(MARGIN, this.y, line, { ...options, size, color: options.color ?? INK });
      this.y += size + 4;
    }
    this.y += 4;
  }

  /** Label/value pairs in two columns. */
  facts(pairs: [string, string][]): void {
    const half = CONTENT_WIDTH / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      this.ensure(32);
      pairs.slice(i, i + 2).forEach(([label, value], column) => {
        const x = MARGIN + column * half;
        this.pdf.text(x, this.y, label.toUpperCase(), { font: "bold", size: 7, color: MUTED });
        const [first = ""] = wrapText(value, "regular", 10, half - 16);
        this.pdf.text(x, this.y + 13, first, { size: 10, color: INK });
      });
      this.y += 32;
    }
  }

  table(columns: Column[], rows: string[][], options: { boldLast?: boolean } = {}): void {
    const size = 8.5;
    const rowHeight = 16;
    const gap = 8;
    const draw = (cells: string[], header: boolean, shade: boolean, bold: boolean) => {
      this.ensure(rowHeight + (header ? 0 : 2));
      if (shade) this.pdf.rect(MARGIN, this.y - 11, CONTENT_WIDTH, rowHeight, ZEBRA);
      let x = MARGIN + 4;
      columns.forEach((column, i) => {
        const room = Math.max(1, Math.floor((column.width - gap) / (0.6 * size)));
        const raw = cells[i] ?? "";
        const text = raw.length > room ? `${raw.slice(0, Math.max(1, room - 1))}…` : raw;
        const textWidth = measureText(text, "mono", size);
        const left = column.align === "end" ? x + column.width - gap - textWidth : x;
        if (header) this.pdf.text(left, this.y, text.toUpperCase(), { font: "bold", size: 7, color: MUTED });
        else this.pdf.text(left, this.y, text, { font: bold ? "bold" : "mono", size: bold ? 9 : size, color: INK });
        x += column.width;
      });
      this.y += rowHeight;
    };

    const header = columns.map((c) => c.title);
    draw(header, true, false, false);
    this.pdf.line(MARGIN, this.y - 11, PAGE_WIDTH - MARGIN, this.y - 11, { color: [0.85, 0.87, 0.9] });
    rows.forEach((row, index) => {
      // A table that runs onto a new page repeats its header.
      if (this.y + rowHeight > BOTTOM) {
        this.page();
        draw(header, true, false, false);
        this.pdf.line(MARGIN, this.y - 11, PAGE_WIDTH - MARGIN, this.y - 11, { color: [0.85, 0.87, 0.9] });
      }
      draw(row, false, index % 2 === 1, !!options.boldLast && index === rows.length - 1);
    });
    this.y += 6;
  }
}

/** The report as PDF bytes. */
export function buildIntegrationReportPdf(data: IntegrationReportData): Uint8Array {
  const label = INTEGRATION_PROVIDER_LABELS[data.provider];
  const pdf = new PdfDocument({
    title: `${label} data report`,
    author: data.generatedBy,
    createdAt: data.generatedAt,
  });
  const layout = new Layout(pdf);
  layout.page();
  layout.title("Integration data report", `${label}  ·  ${STATUS_LABEL[data.status]}  ·  ${data.organizationName}`);

  layout.facts([
    ["Organization", data.organizationName],
    ["Integration", label],
    ["Status", STATUS_LABEL[data.status]],
    ["Records stored", formatInt(data.total)],
    ["Connected", formatDate(data.connectedAt)],
    ["Disconnected", formatDate(data.disconnectedAt)],
    ["Last sync", formatDate(data.lastSyncAt)],
    ["Last successful sync", formatDate(data.lastSuccessfulSyncAt)],
    ["Generated", formatDate(data.generatedAt)],
    ["Generated by", data.generatedBy],
  ]);
  if (data.lastSyncError) layout.paragraph(`Last sync error: ${data.lastSyncError.slice(0, 240)}`, { color: [0.7, 0.2, 0.2] });

  layout.heading("Stored data");
  layout.table(
    [
      { title: "Record type", width: CONTENT_WIDTH - 110 },
      { title: "Records", width: 110, align: "end" },
    ],
    [
      ...DATA_COUNT_LINES.map(({ key, label: line }) => [line, formatInt(data.counts[key])]),
      ["Total", formatInt(data.total)],
    ],
    { boldLast: true },
  );

  layout.heading("Period covered");
  layout.table(
    [
      { title: "", width: 190 },
      { title: "Earliest", width: 150 },
      { title: "Latest", width: CONTENT_WIDTH - 340 },
    ],
    [
      ["Raw records fetched", formatDate(data.span.firstRawEventAt), formatDate(data.span.lastRawEventAt)],
      ["Cases opened", formatDate(data.span.firstCaseOpenedAt), formatDate(data.span.lastCaseOpenedAt)],
    ],
  );

  layout.heading("Cases");
  if (data.cases.total === 0) {
    layout.paragraph(`${label} owns no cases. Its stored records are events and links on other integrations' cases.`, { color: MUTED });
  } else {
    layout.table(
      [
        { title: "Total", width: 110, align: "end" },
        { title: "Open", width: 110, align: "end" },
        { title: "Closed", width: 110, align: "end" },
        { title: "Deleted at source", width: CONTENT_WIDTH - 330, align: "end" },
      ],
      [[formatInt(data.cases.total), formatInt(data.cases.open), formatInt(data.cases.closed), formatInt(data.cases.deleted)]],
    );
  }

  layout.heading("SLA commitments by status");
  const statuses = Object.entries(data.commitmentsByStatus).sort(([a], [b]) => a.localeCompare(b));
  if (statuses.length === 0) {
    layout.paragraph("No commitments are stored for this integration.", { color: MUTED });
  } else {
    layout.table(
      [
        { title: "Status", width: CONTENT_WIDTH - 110 },
        { title: "Commitments", width: 110, align: "end" },
      ],
      statuses.map(([status, count]) => [COMMITMENT_STATUS_LABEL[status] ?? titleCase(status), formatInt(count)]),
    );
  }

  if (data.recentCases.length > 0) {
    layout.heading(`Most recent cases (${data.recentCases.length})`);
    layout.table(
      [
        { title: "Case", width: 90 },
        { title: "Opened", width: 130 },
        { title: "Closed", width: 130 },
        { title: "Priority", width: 60 },
        { title: "State", width: CONTENT_WIDTH - 410 },
      ],
      data.recentCases.map((row) => [
        row.externalId,
        formatDate(row.openedAt),
        formatDate(row.closedAt),
        row.priority ?? "—",
        row.deleted ? "Deleted" : row.closedAt ? "Closed" : "Open",
      ]),
    );
  }

  layout.heading("Recent activity on this data");
  if (data.recentOperations.length === 0) {
    layout.paragraph("No backups, reports or cleanups were recorded before this report.", { color: MUTED });
  } else {
    layout.table(
      [
        { title: "When", width: 130 },
        { title: "Operation", width: 80 },
        { title: "Format", width: 80 },
        { title: "By", width: CONTENT_WIDTH - 360 },
        { title: "Status", width: 70 },
      ],
      data.recentOperations.map((operation) => [
        formatDate(operation.startedAt),
        describeOperation(operation.kind, operation.format),
        operation.format && isExportFormat(operation.format) ? exportFormat(operation.format).short : "—",
        operation.actorEmail,
        OPERATION_STATUS_LABEL[operation.status] ?? operation.status,
      ]),
    );
  }

  layout.heading("About this report");
  layout.paragraph(
    "This is a summary of what is stored for this integration at the time it was generated. It does not contain the records themselves and is not a backup. For the complete data choose JSON Lines, JSON or CSV in Settings > Data. Provider credentials are never part of any export.",
    { color: MUTED },
  );

  const total = pdf.pageCount;
  for (let index = 0; index < total; index++) {
    pdf.onPage(index, () => {
      pdf.line(MARGIN, PAGE_HEIGHT - 40, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 40, { color: [0.85, 0.87, 0.9] });
      pdf.text(MARGIN, PAGE_HEIGHT - 26, `${label} data report  ·  generated ${formatDate(data.generatedAt)}`, { size: 8, color: MUTED });
      const pageText = `Page ${index + 1} of ${total}`;
      pdf.text(PAGE_WIDTH - MARGIN - measureText(pageText, "regular", 8), PAGE_HEIGHT - 26, pageText, { size: 8, color: MUTED });
    });
  }
  return pdf.toBytes();
}
