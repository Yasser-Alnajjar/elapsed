import { createGzip } from "node:zlib";
import { Readable, pipeline } from "node:stream";
import { buildCsvHeaderLine, buildCsvRowLines } from "@sla/core";
import { EXPORT_RECORD_TYPES, ndjsonLines, type ExportManifest, type ExportRecord, type ExportRecordType } from "@sla/db";
import { zipStream, type ZipStreamEntry } from "./zip-stream";

/**
 * Serializers for the complete-data formats. Each consumes the one neutral
 * record stream `startIntegrationExport` produces, writes as it reads (nothing
 * is built in memory), and — because closing the output closes the stream —
 * lets an abandoned download end the export and be recorded as interrupted.
 */

export interface RecordExport {
  manifest: ExportManifest;
  records: AsyncGenerator<ExportRecord, void, void>;
}

/** JSON key of each collection in the JSON document; `integration` is a single object. */
const COLLECTION: Record<Exclude<ExportRecordType, "integration">, string> = {
  customer: "customers",
  customer_identity: "customerIdentities",
  case: "cases",
  case_link: "caseLinks",
  normalized_event: "normalizedEvents",
  commitment: "commitments",
  evaluation: "evaluations",
  notification: "notifications",
  notification_failure: "notificationFailures",
  commitment_policy_change: "commitmentPolicyChanges",
  leg_span: "legSpans",
  raw_event: "rawEvents",
};

/** File name of each record type in the CSV archive. */
const CSV_FILE: Record<ExportRecordType, string> = {
  integration: "integration.csv",
  customer: "customers.csv",
  customer_identity: "customer_identities.csv",
  case: "cases.csv",
  case_link: "case_links.csv",
  normalized_event: "normalized_events.csv",
  commitment: "commitments.csv",
  evaluation: "evaluations.csv",
  notification: "notifications.csv",
  notification_failure: "notification_failures.csv",
  commitment_policy_change: "commitment_policy_changes.csv",
  leg_span: "leg_spans.csv",
  raw_event: "raw_events.csv",
};

/** Bytes to a web stream. A non-object-mode `Readable` turns string chunks into bytes and destroys the source generator when the client cancels. */
function toWebStream(source: AsyncIterable<string | Uint8Array>): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(source, { objectMode: false })) as unknown as ReadableStream<Uint8Array>;
}

/** `{ "manifest": …, "integration": {…}, "customers": […], … }` — every collection present, empty ones as `[]`, written piece by piece. */
export async function* jsonDocument(exported: RecordExport): AsyncGenerator<string, void, void> {
  yield `{"manifest":${JSON.stringify(exported.manifest)}`;

  let current = -1; // index into EXPORT_RECORD_TYPES of the open collection
  let first = true;
  let integrationWritten = false;

  const open = (index: number) =>
    EXPORT_RECORD_TYPES[index] === "integration" ? `,"integration":` : `,"${COLLECTION[EXPORT_RECORD_TYPES[index] as keyof typeof COLLECTION]}":[`;
  const close = (index: number) =>
    EXPORT_RECORD_TYPES[index] === "integration" ? (integrationWritten ? "" : "null") : "]";

  for await (const record of exported.records) {
    const index = EXPORT_RECORD_TYPES.indexOf(record.type);
    while (current < index) {
      if (current >= 0) yield close(current);
      current += 1;
      yield open(current);
      first = true;
    }
    if (record.type === "integration") {
      integrationWritten = true;
      yield JSON.stringify(record.data);
    } else {
      yield (first ? "" : ",") + JSON.stringify(record.data);
      first = false;
    }
  }
  while (current < EXPORT_RECORD_TYPES.length - 1) {
    if (current >= 0) yield close(current);
    current += 1;
    yield open(current);
  }
  if (current >= 0) yield close(current);
  yield "}";
}

type Cell = string | number | null;

function cellOf(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const CSV_BATCH_ROWS = 200;

const README = `Elapsed data export (CSV)

One CSV file per record type, plus manifest.json describing the export. Only
record types that have records are included. Every column is a stored field;
dates are ISO 8601 (UTC), nested values (JSON payloads, tags) are JSON text.
Text that starts with = + - or @ is prefixed with an apostrophe so a
spreadsheet does not run it as a formula. Spreadsheet apps may truncate very
long cells (raw provider payloads); the JSON Lines or JSON export keeps them
whole. Provider credentials and the webhook secret are never included.
`;

async function* csvEntries(exported: RecordExport): AsyncGenerator<ZipStreamEntry, void, void> {
  const iterator = exported.records[Symbol.asyncIterator]();
  try {
    yield { name: "manifest.json", chunks: [JSON.stringify(exported.manifest, null, 2)] };
    yield { name: "README.txt", chunks: [README] };

    let pending = await iterator.next();
    while (!pending.done) {
      const type = pending.value.type;
      const columns = Object.keys(pending.value.data);

      yield {
        name: CSV_FILE[type],
        chunks: (async function* () {
          yield buildCsvHeaderLine(columns);
          let batch: Cell[][] = [];
          while (!pending.done && pending.value.type === type) {
            batch.push(columns.map((column) => cellOf(pending.value!.data[column])));
            pending = await iterator.next();
            if (batch.length >= CSV_BATCH_ROWS) {
              yield buildCsvRowLines(batch);
              batch = [];
            }
          }
          if (batch.length > 0) yield buildCsvRowLines(batch);
        })(),
      };
    }
  } finally {
    // Close the record stream if the archive was abandoned part-way.
    await iterator.return?.();
  }
}

/** A complete-data format's response body. */
export function serializeExport(format: "ndjson" | "json" | "csv", exported: RecordExport): ReadableStream<Uint8Array> {
  switch (format) {
    case "ndjson": {
      // `pipeline` tears the chain down if the client goes away, which ends the generator early.
      const gzip = createGzip();
      pipeline(Readable.from(ndjsonLines(exported)), gzip, () => {});
      return Readable.toWeb(gzip) as unknown as ReadableStream<Uint8Array>;
    }
    case "json":
      return toWebStream(jsonDocument(exported));
    case "csv":
      return toWebStream(zipStream(csvEntries(exported)));
  }
}
