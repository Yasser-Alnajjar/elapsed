/**
 * The pure parts of the data download formats, with no database: the streaming
 * ZIP writer, the JSON / JSON Lines / CSV serializers over a fake record stream
 * (including that a cancelled download closes the stream), and the dependency-
 * free PDF writer and report layout.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportManifest, ExportRecord, IntegrationReportData } from "@sla/db";
import { describe, expect, it } from "vitest";
import { exportFormat, isExportFormat, EXPORT_FORMATS } from "../src/lib/data-export/formats";
import { PdfDocument, measureText, wrapText } from "../src/lib/data-export/pdf";
import { buildIntegrationReportPdf } from "../src/lib/data-export/report-pdf";
import { jsonDocument, serializeExport } from "../src/lib/data-export/serialize";
import { zipStream, ZipTooLargeError } from "../src/lib/data-export/zip-stream";
import { crc32, readStoredZip } from "../src/lib/zip";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const MANIFEST = { formatVersion: 1, provider: "zendesk", scope: {} } as unknown as ExportManifest;

async function collect(stream: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * A record stream that notes whether the serializer closed it early. Hand-rolled
 * rather than an async generator: closing a generator that never started runs no
 * code, and a cancelled download can arrive before the first record is read.
 */
function fakeExport(records: ExportRecord[]) {
  const state = { closedEarly: false, finished: false };
  let index = 0;
  const stream: AsyncGenerator<ExportRecord, void, void> = {
    next: async () => {
      if (index >= records.length) {
        state.finished = true;
        return { done: true, value: undefined };
      }
      return { done: false, value: records[index++]! };
    },
    return: async () => {
      if (!state.finished) state.closedEarly = true;
      return { done: true, value: undefined };
    },
    throw: async (error) => {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: async () => {},
  };
  return { state, exported: { manifest: MANIFEST, records: stream } };
}

describe("export format registry", () => {
  it("offers JSON Lines, JSON, CSV and PDF, and only PDF is not a complete copy", () => {
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual(["ndjson", "json", "csv", "pdf"]);
    expect(EXPORT_FORMATS.filter((f) => !f.complete).map((f) => f.id)).toEqual(["pdf"]);
    expect(isExportFormat("csv")).toBe(true);
    expect(isExportFormat("xlsx")).toBe(false);
    expect(isExportFormat(null)).toBe(false);
    expect(exportFormat("pdf").extension).toBe("pdf");
  });
});

describe("zipStream", () => {
  async function* entries(...items: { name: string; chunks: (string | Uint8Array)[] }[]) {
    for (const item of items) yield item;
  }

  it("writes entries whose sizes are unknown up front, readable back with correct CRCs", async () => {
    const big = Buffer.alloc(300_000, "abcdefghij");
    const zip = await collect(
      zipStream(
        entries(
          { name: "a.txt", chunks: ["hello ", "world"] },
          { name: "empty.csv", chunks: [] },
          { name: "dir/ünïcode.bin", chunks: [big.subarray(0, 100_000), big.subarray(100_000)] },
        ),
      ),
    );
    const files = readStoredZip(zip);

    expect([...files.keys()]).toEqual(["a.txt", "empty.csv", "dir/ünïcode.bin"]);
    expect(decode(files.get("a.txt")!)).toBe("hello world");
    expect(files.get("empty.csv")!.length).toBe(0);
    expect(createHash("sha256").update(files.get("dir/ünïcode.bin")!).digest("hex")).toBe(createHash("sha256").update(big).digest("hex"));
    expect(crc32(new TextEncoder().encode("hello world"))).toBe(0x0d4a1185);
  });

  it("is a valid archive for a real unzip tool", async () => {
    const zip = await collect(zipStream(entries({ name: "a.txt", chunks: ["hello world"] }, { name: "b.csv", chunks: ["x,y\r\n1,2\r\n"] })));
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    writeFileSync(join(dir, "t.zip"), zip);
    let output = "";
    try {
      output = execFileSync("unzip", ["-t", join(dir, "t.zip")], { encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // no unzip on this machine
      throw error;
    }
    expect(output).toContain("No errors detected");
  });

  it("refuses to write an archive past its size limit rather than write a corrupt one", async () => {
    await expect(collect(zipStream(entries({ name: "big", chunks: ["x".repeat(600), "y".repeat(600)] }), { maxBytes: 1000 }))).rejects.toBeInstanceOf(
      ZipTooLargeError,
    );
  });
});

describe("jsonDocument", () => {
  it("emits every collection, empty ones as [], as valid JSON", async () => {
    const { exported } = fakeExport([
      { type: "integration", data: { id: "i" } },
      { type: "case", data: { id: "c1" } },
      { type: "case", data: { id: "c2" } },
      { type: "raw_event", data: { id: "r1", payload: { n: 1 } } },
    ]);
    const doc = JSON.parse(decode(await collect(jsonDocument(exported))));

    expect(Object.keys(doc)).toEqual([
      "manifest", "integration", "customers", "customerIdentities", "cases", "caseLinks", "normalizedEvents", "commitments",
      "evaluations", "notifications", "notificationFailures", "commitmentPolicyChanges", "legSpans", "rawEvents",
    ]);
    expect(doc.cases).toEqual([{ id: "c1" }, { id: "c2" }]);
    expect(doc.customers).toEqual([]);
    expect(doc.rawEvents).toEqual([{ id: "r1", payload: { n: 1 } }]);
  });

  it("is valid JSON even with no records at all", async () => {
    const doc = JSON.parse(decode(await collect(jsonDocument(fakeExport([]).exported))));
    expect(doc.integration).toBeNull();
    expect(doc.rawEvents).toEqual([]);
  });
});

describe("serializeExport", () => {
  const records: ExportRecord[] = [
    { type: "integration", data: { id: "i", provider: "zendesk" } },
    { type: "case", data: { id: "c1", subject: 'He said "hi", twice', closedAt: null, tags: ["a", "b"], openedAt: new Date("2026-01-02T03:04:05Z"), n: 3, flag: true } },
    { type: "case", data: { id: "c2", subject: "+SUM(1)", closedAt: null, tags: [], openedAt: new Date("2026-02-02T00:00:00Z"), n: 4, flag: false } },
    { type: "raw_event", data: { id: "r1", payload: { k: "v" } } },
  ];

  it("CSV: header from the first row, ISO dates, JSON text for nested values, quoting and formula guard", async () => {
    const { exported } = fakeExport(records);
    const files = readStoredZip(await collect(serializeExport("csv", exported)));
    expect(decode(files.get("cases.csv")!)).toBe(
      'id,subject,closedAt,tags,openedAt,n,flag\r\n' +
        'c1,"He said ""hi"", twice",,"[""a"",""b""]",2026-01-02T03:04:05.000Z,3,true\r\n' +
        "c2,'+SUM(1),,[],2026-02-02T00:00:00.000Z,4,false\r\n",
    );
    expect(decode(files.get("raw_events.csv")!)).toBe('id,payload\r\nr1,"{""k"":""v""}"\r\n');
    expect(files.has("customers.csv")).toBe(false);
    expect(files.has("manifest.json")).toBe(true);
  });

  it("CSV streams in batches: thousands of rows round-trip", async () => {
    const many: ExportRecord[] = Array.from({ length: 1234 }, (_, i) => ({ type: "raw_event" as const, data: { id: `r${i}`, n: i } }));
    const files = readStoredZip(await collect(serializeExport("csv", fakeExport(many).exported)));
    const lines = decode(files.get("raw_events.csv")!).trim().split("\r\n");
    expect(lines).toHaveLength(1235);
    expect(lines[1234]).toBe("r1233,1233");
  });

  it("JSON Lines: gzip, a manifest line, then one record per line", async () => {
    const lines = decode(gunzipSync(await collect(serializeExport("ndjson", fakeExport(records).exported)))).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["manifest", "integration", "case", "case", "raw_event"]);
  });

  it.each(["ndjson", "json", "csv"] as const)("%s: cancelling the download closes the record stream so it can be recorded as interrupted", async (format) => {
    const many: ExportRecord[] = Array.from({ length: 5000 }, (_, i) => ({ type: "raw_event" as const, data: { id: `r${i}` } }));
    const { state, exported } = fakeExport(many);
    const reader = serializeExport(format, exported).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.finished).toBe(false);
    expect(state.closedEarly).toBe(true);
  });
});

describe("PdfDocument", () => {
  it("writes a structurally valid PDF: correct xref offsets, page count, escaped and WinAnsi text", () => {
    const pdf = new PdfDocument({ title: "T (x)", author: "me", createdAt: new Date("2026-10-06T10:00:00Z") });
    pdf.addPage();
    pdf.text(50, 50, "Hello (world) \\ — “quoted” ünï 日本", { font: "bold", size: 14 });
    pdf.line(10, 10, 100, 10);
    pdf.rect(0, 0, 50, 20, [0.5, 0.5, 0.5]);
    pdf.addPage();
    pdf.text(50, 50, "Page two", { font: "mono" });
    const bytes = Buffer.from(pdf.toBytes());
    const text = bytes.toString("latin1");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("(Hello \\(world\\) \\\\ \x97 \x93quoted\x94 ünï ??)".replace("ünï", "\xfcn\xef"));

    // Every xref entry points at its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = text.slice(xrefAt).split("\n").slice(3).filter((l) => /^\d{10} 00000 n/.test(l));
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`);
    });
  });

  it("measures Courier exactly and wraps text to a width", () => {
    expect(measureText("abcd", "mono", 10)).toBe(24);
    const lines = wrapText("the quick brown fox jumps over the lazy dog", "regular", 10, 80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measureText(l, "regular", 10) <= 80 || !l.includes(" "))).toBe(true);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });
});

describe("buildIntegrationReportPdf", () => {
  const base = (): IntegrationReportData => ({
    generatedAt: new Date("2026-10-06T10:15:00Z"),
    generatedBy: "owner@tenant.test",
    organizationName: "Acme Corp",
    provider: "zendesk",
    integrationId: "int-1",
    status: "disconnected",
    connectedAt: new Date("2026-09-01T08:00:00Z"),
    disconnectedAt: new Date("2026-10-01T09:30:00Z"),
    lastSyncAt: new Date("2026-10-01T09:00:00Z"),
    lastSuccessfulSyncAt: new Date("2026-10-01T09:00:00Z"),
    lastSyncError: null,
    counts: { rawEvents: 1200, cases: 340, normalizedEvents: 5100, commitments: 680, evaluations: 2040, caseLinks: 120, customerIdentities: 45, other: 17 },
    total: 9542,
    span: { firstRawEventAt: new Date("2026-07-01T00:00:00Z"), lastRawEventAt: new Date("2026-10-01T09:00:00Z"), firstCaseOpenedAt: new Date("2026-07-02T00:00:00Z"), lastCaseOpenedAt: new Date("2026-10-01T08:00:00Z") },
    cases: { total: 340, open: 12, closed: 320, deleted: 8 },
    commitmentsByStatus: { on_track: 600, breached: 30, met: 50 },
    recentCases: Array.from({ length: 25 }, (_, i) => ({ externalId: `ZD-${1000 + i}`, openedAt: new Date("2026-10-01T08:00:00Z"), closedAt: i % 2 ? new Date("2026-10-01T10:00:00Z") : null, deleted: i === 3, priority: i % 3 ? "high" : null })),
    recentOperations: Array.from({ length: 10 }, (_, i) => ({ kind: "backup", status: "completed", actorEmail: "owner@tenant.test", startedAt: new Date("2026-10-02T10:00:00Z"), format: i % 2 ? "pdf" : "csv" })),
  });

  function render(data: IntegrationReportData): { bytes: Uint8Array; text: string } {
    const bytes = buildIntegrationReportPdf(data);
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    const file = join(dir, "r.pdf");
    writeFileSync(file, bytes);
    let text = "";
    try {
      text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      text = Buffer.from(bytes).toString("latin1"); // no poppler here: fall back to the raw operators
    }
    return { bytes, text };
  }

  it("lays out every section with the real numbers and names", () => {
    const { text } = render(base());
    for (const expected of [
      "Integration data report", "Zendesk", "Acme Corp", "Disconnected", "9,542", "Stored data", "5,100", "Period covered",
      "Cases", "DELETED AT SOURCE", "SLA commitments by status", "Breached", "Most recent cases (25)", "ZD-1024",
      "Recent activity on this data", "PDF", "CSV", "About this report", "not a backup",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("flows long tables across pages with numbered footers and a repeated header", () => {
    const { text } = render(base());
    const pages = text.split("\f").filter((p) => p.trim());
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} of ${pages.length}`));
    expect(pages.slice(1).join("\n")).toMatch(/CASE\s+OPENED/i); // header repeated after a page break
  });

  it("handles an integration with no cases, no commitments and nothing recorded", () => {
    const empty = {
      ...base(),
      status: "connected" as const,
      disconnectedAt: null,
      counts: { rawEvents: 30, cases: 0, normalizedEvents: 0, commitments: 0, evaluations: 0, caseLinks: 0, customerIdentities: 0, other: 0 },
      total: 30,
      cases: { total: 0, open: 0, closed: 0, deleted: 0 },
      commitmentsByStatus: {},
      recentCases: [],
      recentOperations: [],
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      provider: "jira" as const,
    };
    const { text } = render(empty);
    expect(text).toContain("Jira owns no cases");
    expect(text).toContain("No commitments are stored");
    expect(text).toContain("No backups, reports or cleanups were recorded");
    expect(text).not.toContain("Most recent cases");
  });

  it("never fails on text the standard fonts cannot draw", () => {
    const data = { ...base(), organizationName: "Ünïcödé 日本語 Corp (Ltd) \\", lastSyncError: "Timeout — “slow” upstream ☃" };
    const { text } = render(data);
    expect(text).toContain("Corp (Ltd)");
  });
});
