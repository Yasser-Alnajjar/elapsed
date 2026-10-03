import { describe, expect, it } from "vitest";
import { pageCountOf, pageOf, pageRange, pageWindow } from "../src/lib/pagination";

describe("pagination helpers", () => {
  it("counts pages, never fewer than one", () => {
    expect(pageCountOf(21)).toBe(3);
    expect(pageCountOf(0)).toBe(1);
    expect(pageCountOf(50, 25)).toBe(2);
  });

  it("slices a 1-based page", () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(rows, 1)).toEqual(rows.slice(0, 10));
    expect(pageOf(rows, 3)).toEqual([20, 21, 22]);
    expect(pageOf(rows, 0)).toEqual(rows.slice(0, 10));
  });

  it("reports the inclusive row range a page covers", () => {
    expect(pageRange(1, 10, 23)).toEqual({ from: 1, to: 10 });
    expect(pageRange(3, 10, 23)).toEqual({ from: 21, to: 23 });
    expect(pageRange(1, 10, 0)).toEqual({ from: 0, to: 0 });
  });

  it("pages with a compact window", () => {
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, null, 12]);
    expect(pageWindow(7, 12)).toEqual([1, null, 6, 7, 8, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 10, 11, 12]);
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });
});
