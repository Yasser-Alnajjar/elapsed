import { afterEach, describe, expect, it, vi } from "vitest";
import type { Expr } from "../src/schema";
import { evaluateDate, evaluateText } from "../src/transforms";

const env = { timezone: "America/New_York" };
const doc = {
  id: 42,
  name: "  Ada <b>Lovelace</b>  ",
  state: "waiting",
  created: 1_788_000_000,
  local: "2026-03-08 03:30:00",
  nothing: null,
};

const exprs: Record<string, Expr> = {
  template: { transform: "template", template: "{a}-{b}", values: { a: "$.id", b: { transform: "lowercase", of: "$.state" } } },
  coalesce: { transform: "coalesce", of: ["$.missing", "$.nothing", "$.name"] },
  clean: { transform: "trim", of: { transform: "stripHtml", of: "$.name" } },
  valueMap: { transform: "valueMap", of: "$.state", map: { waiting: "pending_customer" }, fallback: "open" },
  epoch: { transform: "epochToIso", of: "$.created", unit: "seconds" },
  local: { transform: "parseDate", of: "$.local", format: "local" },
};

afterEach(() => vi.useRealTimers());

describe("transforms are deterministic (plan 09 §13 row 2)", () => {
  it("returns identical output on repeated evaluation and for a differently ordered document", () => {
    const shuffled = Object.fromEntries(Object.entries(doc).reverse());
    for (const [name, expr] of Object.entries(exprs)) {
      const first = evaluateText(expr, doc, env);
      expect(first, name).not.toBeNull();
      expect(evaluateText(expr, doc, env), name).toBe(first);
      expect(evaluateText(expr, shuffled, env), name).toBe(first);
    }
  });

  it("does not depend on the clock or the process time zone", () => {
    const run = () => Object.fromEntries(Object.entries(exprs).map(([name, expr]) => [name, evaluateText(expr, doc, env)]));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const before = run();
    vi.setSystemTime(new Date("2031-07-09T23:59:59Z"));
    expect(run()).toEqual(before);
    const savedTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      expect(run()).toEqual(before);
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });

  it("evaluates dates the same way every time", () => {
    const expr: Expr = { transform: "parseDate", of: "$.created", format: "epoch_seconds" };
    const a = evaluateDate(expr, doc, env);
    expect(a?.toISOString()).toBe(new Date(1_788_000_000 * 1000).toISOString());
    expect(evaluateDate(expr, doc, env)?.getTime()).toBe(a?.getTime());
  });

  it("does not modify its input", () => {
    const frozen = structuredClone(doc);
    for (const expr of Object.values(exprs)) evaluateText(expr, doc, env);
    expect(doc).toEqual(frozen);
  });
});
