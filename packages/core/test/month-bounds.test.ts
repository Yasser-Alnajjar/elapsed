import { describe, expect, it } from "vitest";
import { localMonthKey, monthBounds, previousMonth, startOfLocalDay, timeZoneOffsetMs } from "../src/timezone";

describe("timeZoneOffsetMs", () => {
  it("is zero for UTC and follows DST for a zone that has it", () => {
    expect(timeZoneOffsetMs(new Date("2026-07-01T12:00:00Z"), "UTC")).toBe(0);
    expect(timeZoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-5 * 3_600_000);
    expect(timeZoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-4 * 3_600_000);
    expect(timeZoneOffsetMs(new Date("2026-09-15T12:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3_600_000);
  });

  it("treats an unknown zone as UTC instead of throwing", () => {
    expect(timeZoneOffsetMs(new Date("2026-07-01T12:00:00Z"), "Mars/Olympus")).toBe(0);
  });
});

describe("monthBounds", () => {
  it("is the calendar month in UTC", () => {
    const { start, end } = monthBounds("2026-09", "UTC");
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("follows the organization's wall clock, east and west of UTC", () => {
    expect(monthBounds("2026-09", "Asia/Dubai").start.toISOString()).toBe("2026-08-31T20:00:00.000Z");
    expect(monthBounds("2026-09", "Asia/Dubai").end.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    expect(monthBounds("2026-09", "America/Los_Angeles").start.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  it("is not a fixed number of hours across a DST change", () => {
    // New York left DST on 2026-11-01, so November is 30 days plus an hour.
    const { start, end } = monthBounds("2026-11", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(30 * 24 + 1);
  });

  it("rolls December into the next year and rejects a malformed month", () => {
    expect(monthBounds("2026-12", "UTC").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(() => monthBounds("2026-13", "UTC")).toThrow();
    expect(() => monthBounds("September", "UTC")).toThrow();
  });

  it("a month's first and last instants fall in that month, and the end falls in the next", () => {
    for (const zone of ["UTC", "Asia/Dubai", "America/New_York", "Pacific/Auckland"]) {
      const { start, end } = monthBounds("2026-03", zone);
      expect(localMonthKey(start, zone)).toBe("2026-03");
      expect(localMonthKey(new Date(end.getTime() - 1), zone)).toBe("2026-03");
      expect(localMonthKey(end, zone)).toBe("2026-04");
    }
  });
});

describe("previousMonth", () => {
  it("is the month before the one `now` is in, on the zone's clock", () => {
    expect(previousMonth(new Date("2026-10-02T12:00:00Z"), "UTC").period).toBe("2026-09");
    expect(previousMonth(new Date("2027-01-03T12:00:00Z"), "UTC").period).toBe("2026-12");
  });

  it("changes month at the zone's midnight, not UTC's", () => {
    const instant = new Date("2026-09-30T21:00:00Z"); // already October 1st in Dubai
    expect(previousMonth(instant, "UTC").period).toBe("2026-08");
    expect(previousMonth(instant, "Asia/Dubai").period).toBe("2026-09");
  });
});

describe("startOfLocalDay", () => {
  it("is midnight on the zone's wall clock", () => {
    expect(startOfLocalDay(2026, 9, 1, "UTC").toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(startOfLocalDay(2026, 9, 1, "Asia/Kolkata").toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });
});
