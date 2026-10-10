import { describe, expect, it } from "vitest";
import { SafeHttpError } from "../src/errors";
import { parseJsonLimited } from "../src/json";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof SafeHttpError ? error.code : "other";
  }
  return "no_error";
}

describe("parseJsonLimited", () => {
  it("parses a document at exactly the depth limit and refuses one level deeper", () => {
    const nested = (n: number) => `${"[".repeat(n)}${"]".repeat(n)}`;
    expect(parseJsonLimited(nested(20), 20)).toBeTruthy();
    expect(code(() => parseJsonLimited(nested(21), 20))).toBe("bad_response");
  });

  it("refuses a hostile deeply nested document before building it", () => {
    expect(code(() => parseJsonLimited("[".repeat(200_000), 20))).toBe("bad_response");
  });

  it("does not count brackets inside strings or escaped quotes", () => {
    expect(parseJsonLimited('{"a":"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["}', 2)).toEqual({ a: "[".repeat(30) });
    expect(parseJsonLimited('{"a":"\\"[[[[[[[[[[[[[[[[[[[[[["}', 2)).toBeTruthy();
  });

  it("reports malformed JSON as bad_response with no parser message", () => {
    for (const text of ["", "{", "{'a':1}", "undefined", "<html>"]) {
      expect(code(() => parseJsonLimited(text, 20))).toBe("bad_response");
    }
  });

  it("keeps __proto__ as plain data (no prototype pollution through the parser)", () => {
    const parsed = parseJsonLimited('{"__proto__":{"polluted":true}}', 20) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed)).toContain("__proto__");
  });
});
