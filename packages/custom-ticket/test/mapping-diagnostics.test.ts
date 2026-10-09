/**
 * Field-level mapping diagnostics (N9): a failed ticket names the field, the
 * mapping and the reason, reports every independent failure together, and never
 * carries a source value.
 */
import { describe, expect, it } from "vitest";
import { atMapping } from "../src/diagnostics";
import { deriveBatch, type RawRow } from "../src/derive";
import { MappingError } from "../src/errors";
import { parseConfig, type CustomConfig } from "../src/schema";
import { RAW_PREFIX } from "../src/shared";
import { evaluateText } from "../src/transforms";

const base = {
  schemaVersion: 1,
  displayName: "Test Desk",
  connection: { baseUrl: "https://api.helpdesk.example.com" },
  auth: { type: "bearer" },
  tickets: { request: { method: "GET", path: "/v2/tickets" }, itemsPath: "$.data[*]", pagination: { type: "none" } },
  mapping: { id: "$.id", createdAt: "$.created_at", status: "$.state", title: "$.subject" },
  valueMaps: { status: { open: "open", solved: "resolved" } },
  unknownStatus: "fail",
  importWindowDays: 90,
  slaMode: "full",
  creationActor: { type: "assume_customer" },
};

function configWith(patch: (c: Record<string, any>) => void): CustomConfig {
  const draft = structuredClone(base) as Record<string, any>;
  patch(draft);
  const parsed = parseConfig(draft);
  if (!parsed.ok) throw new Error(`test config invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}

const row = (payload: unknown, n = 1): RawRow => ({ id: `r${n}`, providerEventId: `${RAW_PREFIX.ticket}T-${n}:hash`, payload, fetchedAt: new Date("2026-10-01T00:00:00Z") });
const ticket = (overrides: Record<string, unknown> = {}) => ({ id: "T-1", created_at: "2026-09-01T10:00:00Z", state: "open", subject: "Printer on fire", ...overrides });

describe("template errors", () => {
  const expr = { transform: "template", template: "{id}-{org}", values: { id: "$.id" } } as const;

  it("names the template, the missing variable and the variables that exist", () => {
    let error: unknown;
    try {
      atMapping("mapping.id", () => evaluateText(expr, { id: "T-1" }, { timezone: null }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MappingError);
    const problem = (error as MappingError).problems[0]!;
    expect(problem).toMatchObject({ mapping: "mapping.id", target: "externalId", code: "transform_failed", reason: "undefined_variable", template: "{id}-{org}", variable: "org", available: ["id"] });
    expect(problem.message).toBe('Field "externalId" (mapping.id) failed: template "{id}-{org}" references undefined variable "org". Available variables: id.');
  });

  it("keeps the original error as the cause", () => {
    try {
      atMapping("mapping.id", () => evaluateText(expr, { id: "T-1" }, { timezone: null }));
      expect.unreachable();
    } catch (e) {
      const cause = (e as MappingError).cause as MappingError;
      expect(cause).toBeInstanceOf(MappingError);
      expect(cause.drafts[0]?.variable).toBe("org");
    }
  });
});

describe("text length errors", () => {
  it("reports the actual and maximum length without the value", () => {
    const long = "SECRET-".repeat(1300); // 9100 characters
    try {
      atMapping("mapping.title", () => evaluateText("$.subject", { subject: long }, { timezone: null }));
      expect.unreachable();
    } catch (e) {
      const problem = (e as MappingError).problems[0]!;
      expect(problem).toMatchObject({ target: "subject", reason: "too_long", length: 9100, max: 8192, source: "$.subject" });
      expect(problem.message).toBe('Field "subject" (mapping.title) failed: value length is 9100 characters; maximum allowed is 8192.');
      expect(JSON.stringify(problem)).not.toContain("SECRET");
    }
  });
});

describe("deriveBatch failures", () => {
  it("says a source field is missing, and which one", () => {
    const { created_at: _omit, ...withoutCreated } = ticket();
    const out = deriveBatch(configWith(() => {}), [row(withoutCreated)]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({ id: "T-1", code: "missing_required" });
    expect(out.failures[0]!.details[0]).toMatchObject({ mapping: "mapping.createdAt", target: "openedAt", reason: "missing", source: "$.created_at" });
    expect(out.failures[0]!.details[0]!.message).toBe('Field "openedAt" (mapping.createdAt) failed: source field "$.created_at" is missing from the response (nothing at that path).');
  });

  it("tells a null field from a missing one", () => {
    const out = deriveBatch(configWith(() => {}), [row(ticket({ created_at: null }))]);
    expect(out.failures[0]!.details[0]).toMatchObject({ reason: "null" });
    expect(out.failures[0]!.details[0]!.message).toContain('"$.created_at" is null');
  });

  it("names an unsupported type without showing the value", () => {
    const out = deriveBatch(configWith(() => {}), [row(ticket({ state: { secret: "hunter2" } }))]);
    const detail = out.failures[0]!.details[0]!;
    expect(out.failures[0]!.code).toBe("invalid_type");
    expect(detail).toMatchObject({ mapping: "mapping.status", reason: "unsupported_type", actualType: "object" });
    expect(detail.message).toBe('Field "status" (mapping.status) failed: source field "$.state" is an object; expected text.');
    expect(JSON.stringify(out.failures)).not.toContain("hunter2");
  });

  it("reports every failing field of one ticket, not only the first", () => {
    const config = configWith((c) => {
      c.mapping.title = { transform: "template", template: "{id}-{org}", values: { id: "$.id" } };
    });
    const { created_at: _omit, ...rest } = ticket();
    const out = deriveBatch(config, [row(rest)]);
    const mappings = out.failures[0]!.details.map((d) => d.mapping).sort();
    expect(mappings).toEqual(["mapping.createdAt", "mapping.title"]);
    expect(out.failures[0]!.details.find((d) => d.mapping === "mapping.title")!.message).toContain('references undefined variable "org"');
  });

  it("explains an unknown status without echoing it", () => {
    const out = deriveBatch(configWith(() => {}), [row(ticket({ state: "exploded-9000" }))]);
    expect(out.failures[0]).toMatchObject({ code: "unknown_status" });
    expect(out.failures[0]!.details[0]!.message).toContain("valueMaps.status");
    expect(JSON.stringify(out.failures)).not.toContain("exploded-9000");
  });

  it("derives a healthy ticket with no failures", () => {
    const out = deriveBatch(configWith(() => {}), [row(ticket())]);
    expect(out.failures).toEqual([]);
    expect(out.cases).toHaveLength(1);
  });
});
