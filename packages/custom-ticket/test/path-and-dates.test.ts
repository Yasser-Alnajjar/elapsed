/** Mapping rows of plan 09 §13: the path subset and date parsing (timezones, DST). */
import { describe, expect, it } from "vitest";
import { parseDateValue } from "../src/dates";
import { MappingError } from "../src/errors";
import { evaluatePath, firstMatch, isValidPath, MAX_PATH_LENGTH, MAX_PATH_SEGMENTS, parsePath } from "../src/path";

function mappingCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof MappingError) return String((error as { code?: unknown }).code ?? error.message);
    throw error;
  }
  return "no_error";
}

describe("JSONPath subset: valid, invalid, wildcard", () => {
  it.each(["$", "$.a", "$.a.b", "$['a b']", '$["a"]', "$.a[0]", "$.a[*]", "$.data[*].id", "$.a-b_c.D9", "$[*][*]"])("accepts %s", (path) => {
    expect(isValidPath(path)).toBe(true);
  });

  it.each([
    "",
    "a",
    ".a",
    "$.",
    "$..a", // recursive descent
    "$.a[?(@.b)]", // filter
    "$.a[0:2]", // slice
    "$.a[-1]", // negative index
    "$.a[01]", // leading zero
    "$.a[1.5]",
    "$.a[1234567890]", // more than 9 digits
    "$.a[(1+1)]", // expression
    "$.a.length()", // function
    "$.a b",
    "$.a[",
    "$['a",
    "$['a']x",
    "$['']",
    "$['a\\'b']", // escape
    "$[\"a'b\"]", // nested quote
    "$['a\nb']", // control character
  ])("rejects %j", (path) => {
    expect(isValidPath(path)).toBe(false);
  });

  it("enforces the length and segment limits", () => {
    expect(isValidPath("$" + ".a".repeat(MAX_PATH_SEGMENTS))).toBe(true);
    expect(isValidPath("$" + ".a".repeat(MAX_PATH_SEGMENTS + 1))).toBe(false);
    expect(isValidPath("$." + "a".repeat(MAX_PATH_LENGTH))).toBe(false);
    expect(parsePath(123 as unknown as string)).toBeNull();
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects the prototype-pollution key %s in every spelling", (key) => {
    expect(isValidPath(`$.${key}`)).toBe(false);
    expect(isValidPath(`$['${key}']`)).toBe(false);
    expect(isValidPath(`$["${key}"]`)).toBe(false);
    expect(isValidPath(`$.a.${key}.b`)).toBe(false);
  });

  it("evaluates keys, indexes and wildcards over arrays and objects, in document order", () => {
    const doc = { data: [{ id: 1, tags: ["a", "b"] }, { id: 2, tags: [] }, { id: 3 }], map: { x: 10, y: 20 } };
    expect(evaluatePath("$.data[*].id", doc)).toEqual([1, 2, 3]);
    expect(evaluatePath("$.data[0].tags[1]", doc)).toEqual(["b"]);
    expect(evaluatePath("$.data[*].tags[*]", doc)).toEqual(["a", "b"]);
    expect(evaluatePath("$.map[*]", doc)).toEqual([10, 20]);
    expect(evaluatePath("$['map']['y']", doc)).toEqual([20]);
    expect(firstMatch("$.data[2].id", doc)).toBe(3);
  });

  it("a missing key or an out-of-range index matches nothing, and never throws", () => {
    const doc = { a: [1], b: null, c: "text" };
    for (const path of ["$.zzz", "$.a[5]", "$.b.x", "$.c.length", "$.c[0]", "$.a.x"]) expect(evaluatePath(path, doc)).toEqual([]);
    expect(firstMatch("$.zzz", doc)).toBeUndefined();
    expect(evaluatePath("$.a", null)).toEqual([]);
  });

  it("reads own properties only: the prototype chain is unreachable even if a key is named like a built-in", () => {
    const doc = JSON.parse('{"__proto__":{"polluted":"yes"},"toString":"mine"}');
    expect(evaluatePath("$.toString", doc)).toEqual(["mine"]);
    expect(evaluatePath("$.hasOwnProperty", {})).toEqual([]);
    expect(evaluatePath("$.valueOf", {})).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("an invalid path passed to the evaluator is an invalid_path mapping error", () => {
    expect(mappingCode(() => evaluatePath("$..a", {}))).toBe("invalid_path");
  });
});

describe("date parsing (§4.6): timezone required, DST gap and overlap rejected", () => {
  const iso = (value: unknown, timezone: string | null = null) => parseDateValue(value, { format: "iso8601", timezone });

  it("uses an explicit offset or Z as given, ignoring the configured zone", () => {
    expect(iso("2026-10-10T12:00:00Z", "Asia/Tokyo").toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(iso("2026-10-10T12:00:00+02:00").toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(iso("2026-10-10T12:00:00-0530").toISOString()).toBe("2026-10-10T17:30:00.000Z");
    expect(iso("2026-10-10T12:00:00.123456Z").getUTCMilliseconds()).toBe(123);
  });

  it("a naive wall-clock date REQUIRES a timezone: UTC and any default are never assumed", () => {
    expect(mappingCode(() => iso("2026-10-10T12:00:00"))).toBe("timezone_required");
    expect(mappingCode(() => iso("2026-10-10"))).toBe("timezone_required");
    expect(iso("2026-10-10T12:00:00", "Europe/Berlin").toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(iso("2026-01-10T12:00:00", "Europe/Berlin").toISOString()).toBe("2026-01-10T11:00:00.000Z");
  });

  it("rejects a time inside a DST gap (it does not exist)", () => {
    // Europe/Berlin: 2026-03-29 02:00 -> 03:00
    expect(mappingCode(() => iso("2026-03-29T02:30:00", "Europe/Berlin"))).toBe("nonexistent_local_time");
    // America/New_York: 2026-03-08 02:00 -> 03:00
    expect(mappingCode(() => iso("2026-03-08T02:15:00", "America/New_York"))).toBe("nonexistent_local_time");
  });

  it("rejects a time inside a DST overlap (it names two instants)", () => {
    // Europe/Berlin: 2026-10-25 03:00 -> 02:00
    expect(mappingCode(() => iso("2026-10-25T02:30:00", "Europe/Berlin"))).toBe("ambiguous_local_time");
    // America/New_York: 2026-11-01 02:00 -> 01:00
    expect(mappingCode(() => iso("2026-11-01T01:30:00", "America/New_York"))).toBe("ambiguous_local_time");
  });

  it("accepts the instants either side of a transition", () => {
    expect(iso("2026-03-29T01:59:59", "Europe/Berlin").toISOString()).toBe("2026-03-29T00:59:59.000Z");
    expect(iso("2026-03-29T03:00:00", "Europe/Berlin").toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(iso("2026-10-25T01:59:59", "Europe/Berlin").toISOString()).toBe("2026-10-24T23:59:59.000Z");
    expect(iso("2026-10-25T03:00:00", "Europe/Berlin").toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });

  it("rejects an unknown timezone, impossible calendar dates and malformed strings", () => {
    expect(mappingCode(() => iso("2026-10-10T12:00:00", "Mars/Olympus"))).toBe("invalid_timezone");
    for (const bad of ["2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-10T24:00:00Z", "2026-10-10T12:60:00Z", "yesterday", "", "10/10/2026", "2026-10-10T12:00:00+25:00"]) {
      expect(mappingCode(() => iso(bad, "UTC")), bad).toBe("invalid_date");
    }
  });

  it("refuses a number under iso8601 (seconds and milliseconds cannot be told apart) and non-strings", () => {
    expect(mappingCode(() => iso(1_760_000_000))).toBe("date_format_required");
    expect(mappingCode(() => iso({}))).toBe("invalid_type");
    expect(mappingCode(() => iso(null))).toBe("invalid_type");
  });

  it("epoch formats take numbers or integer strings only, within 1970..2200", () => {
    const secs = (v: unknown) => parseDateValue(v, { format: "epoch_seconds", timezone: null });
    const ms = (v: unknown) => parseDateValue(v, { format: "epoch_millis", timezone: null });
    expect(secs(1_760_000_000).toISOString()).toBe("2025-10-09T08:53:20.000Z");
    expect(ms("1760000000000").toISOString()).toBe("2025-10-09T08:53:20.000Z");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "abc", "1e9", "", null, {}]) expect(mappingCode(() => secs(bad)), String(bad)).toBe("invalid_date");
    expect(mappingCode(() => secs(-1))).toBe("invalid_date"); // before 1970
    expect(mappingCode(() => secs(99_999_999_999_999))).toBe("invalid_date"); // beyond 2200
  });

  it("the 'local' format is always wall-clock, requires a zone, and refuses an offset", () => {
    const local = (v: unknown, tz: string | null) => parseDateValue(v, { format: "local", timezone: tz });
    expect(local("2026-10-10 12:00:00", "UTC").toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(mappingCode(() => local("2026-10-10 12:00:00", null))).toBe("timezone_required");
    expect(mappingCode(() => local("2026-10-10T12:00:00Z", "UTC"))).toBe("invalid_date");
  });

  it("is deterministic: the same input and zone always give the same instant", () => {
    const first = iso("2026-06-15T08:30:00", "Asia/Kolkata").getTime();
    for (let i = 0; i < 20; i += 1) expect(iso("2026-06-15T08:30:00", "Asia/Kolkata").getTime()).toBe(first);
  });
});
