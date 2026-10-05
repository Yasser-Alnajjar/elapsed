import { describe, expect, it } from "vitest";
import { computeDeadline, workingMinutesBetween } from "../src/calendar";
import type { BusinessCalendarVersion } from "../src/types";

const businessHours: BusinessCalendarVersion = {
  id: "cal-v1",
  version: 1,
  timezone: "UTC",
  weekly: [1, 2, 3, 4, 5].map((day) => ({
    day: day as 1 | 2 | 3 | 4 | 5,
    openMinute: 9 * 60,
    closeMinute: 17 * 60,
  })),
  holidays: ["2026-09-09"], // Wednesday
  alwaysOpen: false,
};

const alwaysOpen: BusinessCalendarVersion = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

describe("computeDeadline", () => {
  it("carries remaining minutes across a weekend boundary", () => {
    // Friday 16:00 + 120 target minutes: 60 available before close, 60 more consumed Monday from open.
    const deadline = computeDeadline(
      "2026-09-11T16:00:00.000Z",
      120,
      businessHours,
    );
    expect(deadline.toISOString()).toBe("2026-09-14T10:00:00.000Z");
  });

  it("skips a holiday entirely", () => {
    // Tuesday 16:00 + 120 target minutes: 60 available before close, Wednesday is a holiday, 60 more Thursday from open.
    const deadline = computeDeadline(
      "2026-09-08T16:00:00.000Z",
      120,
      businessHours,
    );
    expect(deadline.toISOString()).toBe("2026-09-10T10:00:00.000Z");
  });

  it("treats alwaysOpen as a single 24/7 code path", () => {
    const deadline = computeDeadline(
      "2026-09-11T16:00:00.000Z",
      120,
      alwaysOpen,
    );
    expect(deadline.toISOString()).toBe("2026-09-11T18:00:00.000Z");
  });

  it("resolves within the same working window when enough time remains", () => {
    const deadline = computeDeadline(
      "2026-09-07T09:00:00.000Z",
      60,
      businessHours,
    );
    expect(deadline.toISOString()).toBe("2026-09-07T10:00:00.000Z");
  });
});

describe("workingMinutesBetween", () => {
  it("sums only working minutes, excluding a holiday and the weekend", () => {
    // Tue 16:00 -> Thu 10:00, holiday Wed skipped, weekend not in range.
    const minutes = workingMinutesBetween(
      new Date("2026-09-08T16:00:00.000Z"),
      new Date("2026-09-10T10:00:00.000Z"),
      businessHours,
    );
    expect(minutes).toBe(120);
  });

  it("returns raw elapsed minutes for an alwaysOpen calendar", () => {
    const minutes = workingMinutesBetween(
      new Date("2026-09-11T16:00:00.000Z"),
      new Date("2026-09-11T18:00:00.000Z"),
      alwaysOpen,
    );
    expect(minutes).toBe(120);
  });

  it("returns 0 when end is not after start", () => {
    const minutes = workingMinutesBetween(
      new Date("2026-09-07T09:00:00.000Z"),
      new Date("2026-09-07T09:00:00.000Z"),
      businessHours,
    );
    expect(minutes).toBe(0);
  });
});

// America/New_York, 2026: spring-forward Sun 2026-03-08 02:00 EST -> 03:00 EDT
// (UTC-5 -> UTC-4); fall-back Sun 2026-11-01 02:00 EDT -> 01:00 EST.
function newYork(
  days: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
  openMinute: number,
  closeMinute: number,
  holidays: string[] = [],
): BusinessCalendarVersion {
  return {
    id: "cal-ny",
    version: 1,
    timezone: "America/New_York",
    weekly: days.map((day) => ({ day, openMinute, closeMinute })),
    holidays,
    alwaysOpen: false,
  };
}

const weekdaysNewYork = newYork([1, 2, 3, 4, 5], 9 * 60, 17 * 60);
const everyDayNewYork = newYork([0, 1, 2, 3, 4, 5, 6], 9 * 60, 17 * 60);

// Pins the current weekday / alwaysOpen semantics the calendar editor relies
// on: `weekly` is an allow-list of open windows, so a weekday with no entry
// is closed all day, and `alwaysOpen` bypasses `weekly` entirely.
describe("weekly semantics", () => {
  const mondayOnly: BusinessCalendarVersion = {
    ...businessHours,
    weekly: [{ day: 1, openMinute: 9 * 60, closeMinute: 17 * 60 }],
    holidays: [],
  };

  it("treats a weekday missing from weekly as closed all day", () => {
    // Mon 2026-09-07 16:00 + 120: 60 on Monday, Tue-Sun have no entry, 60 more the next Monday.
    expect(computeDeadline("2026-09-07T16:00:00.000Z", 120, mondayOnly).toISOString()).toBe(
      "2026-09-14T10:00:00.000Z",
    );
    expect(
      workingMinutesBetween(new Date("2026-09-08T00:00:00.000Z"), new Date("2026-09-14T00:00:00.000Z"), mondayOnly),
    ).toBe(0);
  });

  it("with an empty weekly and alwaysOpen false, accrues no working time and cannot produce a deadline", () => {
    const noOpenDays: BusinessCalendarVersion = { ...businessHours, weekly: [], holidays: [] };
    expect(
      workingMinutesBetween(new Date("2026-09-07T00:00:00.000Z"), new Date("2026-09-21T00:00:00.000Z"), noOpenDays),
    ).toBe(0);
    expect(() => computeDeadline("2026-09-07T09:00:00.000Z", 60, noOpenDays)).toThrow(/search horizon/);
  });

  it("ignores weekly entirely when alwaysOpen is true", () => {
    const alwaysOpenWithHours: BusinessCalendarVersion = { ...businessHours, alwaysOpen: true };
    // Saturday 10:00 is outside every weekly window, yet the clock runs.
    expect(computeDeadline("2026-09-12T10:00:00.000Z", 60, alwaysOpenWithHours).toISOString()).toBe(
      "2026-09-12T11:00:00.000Z",
    );
  });
});

// 4e: closeMinute: 1440 is the canonical way to represent a full 24-hour
// working day (00:00 -> midnight, exclusive) — these pin that it preserves
// exact wall-clock semantics (no lost/gained minute) through both UTC and a
// DST transition, where a "24-hour" local day is not always 24 real hours.
describe("full-day windows (4e)", () => {
  it("a full day (closeMinute: 1440) in UTC accrues exactly 24 hours", () => {
    const fullDayMonday = newYork([1], 0, 1440);
    const minutes = workingMinutesBetween(
      new Date("2026-09-14T00:00:00.000Z"),
      new Date("2026-09-15T00:00:00.000Z"),
      { ...fullDayMonday, timezone: "UTC" },
    );
    expect(minutes).toBe(24 * 60);
  });

  it("loses no minute versus a 00:00-23:59 window plus one — closeMinute 1440 covers the last minute of the day", () => {
    const almostFullDay = newYork([1], 0, 1439); // the old, lossy way to mean "all day"
    const fullDay = newYork([1], 0, 1440);
    const start = new Date("2026-09-14T04:00:00.000Z"); // Mon 00:00 EDT
    const end = new Date("2026-09-15T04:00:00.000Z"); // Tue 00:00 EDT
    expect(workingMinutesBetween(start, end, fullDay)).toBe(
      workingMinutesBetween(start, end, almostFullDay) + 1,
    );
  });

  it("a full-day window on the spring-forward day accrues only 23 actual hours, not 24", () => {
    const fullDaySunday = newYork([0], 0, 1440);
    const minutes = workingMinutesBetween(
      new Date("2026-03-08T05:00:00.000Z"), // Sun 2026-03-08 00:00 EST
      new Date("2026-03-09T04:00:00.000Z"), // Mon 2026-03-09 00:00 EDT
      fullDaySunday,
    );
    expect(minutes).toBe(23 * 60);
  });

  it("a full-day window on the fall-back day accrues 25 actual hours, not 24", () => {
    const fullDaySunday = newYork([0], 0, 1440);
    const minutes = workingMinutesBetween(
      new Date("2026-11-01T04:00:00.000Z"), // Sun 2026-11-01 00:00 EDT
      new Date("2026-11-02T05:00:00.000Z"), // Mon 2026-11-02 00:00 EST
      fullDaySunday,
    );
    expect(minutes).toBe(25 * 60);
  });

  it("computeDeadline for a full-day window lands exactly at the next wall-clock day boundary across spring-forward", () => {
    const fullDaySunday = newYork([0], 0, 1440);
    const deadline = computeDeadline("2026-03-08T05:00:00.000Z", 23 * 60, fullDaySunday);
    expect(deadline.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("never treats a full-day window as zero-length", () => {
    const fullDayMonday = newYork([1], 0, 1440);
    expect(() => computeDeadline("2026-09-14T13:00:00.000Z", 1, fullDayMonday)).not.toThrow();
  });
});

describe("computeDeadline in a non-UTC timezone", () => {
  it("resolves local business hours to the zone's UTC offset", () => {
    // Mon 2026-09-14 09:00 EDT is 13:00Z; +60 minutes.
    const deadline = computeDeadline(
      "2026-09-14T13:00:00.000Z",
      60,
      weekdaysNewYork,
    );
    expect(deadline.toISOString()).toBe("2026-09-14T14:00:00.000Z");
  });

  it("carries across the spring-forward weekend using the new offset", () => {
    // Fri 2026-03-06 16:00 EST (21:00Z): 60 minutes Friday, 60 more from
    // Mon 09:00 EDT (13:00Z).
    const deadline = computeDeadline(
      "2026-03-06T21:00:00.000Z",
      120,
      weekdaysNewYork,
    );
    expect(deadline.toISOString()).toBe("2026-03-09T14:00:00.000Z");
  });

  it("carries across the fall-back weekend using the new offset", () => {
    // Fri 2026-10-30 16:00 EDT (20:00Z): 60 minutes Friday, 60 more from
    // Mon 09:00 EST (14:00Z).
    const deadline = computeDeadline(
      "2026-10-30T20:00:00.000Z",
      120,
      weekdaysNewYork,
    );
    expect(deadline.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("opens at local 09:00 on the spring-forward day itself", () => {
    // Sun 2026-03-08 00:00 EST (05:00Z). 09:00 EDT is 13:00Z, not 14:00Z.
    const deadline = computeDeadline(
      "2026-03-08T05:00:00.000Z",
      30,
      everyDayNewYork,
    );
    expect(deadline.toISOString()).toBe("2026-03-08T13:30:00.000Z");
  });

  it("opens at local 09:00 on the fall-back day itself", () => {
    // Sun 2026-11-01 00:00 EDT (04:00Z). 09:00 EST is 14:00Z, not 13:00Z.
    const deadline = computeDeadline(
      "2026-11-01T04:00:00.000Z",
      30,
      everyDayNewYork,
    );
    expect(deadline.toISOString()).toBe("2026-11-01T14:30:00.000Z");
  });

  it("gives a window spanning the skipped hour one fewer real hour", () => {
    // Sun 2026-03-08 00:00-06:00 local is only 5 real hours (02:00-03:00
    // never happens): 05:00Z -> 10:00Z.
    const calendar = newYork([0], 0, 6 * 60);
    const deadline = computeDeadline("2026-03-08T05:00:00.000Z", 300, calendar);
    expect(deadline.toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("gives a window spanning the repeated hour one more real hour", () => {
    // Sun 2026-11-01 00:00-06:00 local is 7 real hours (01:00-02:00 happens
    // twice): 04:00Z -> 11:00Z.
    const calendar = newYork([0], 0, 6 * 60);
    const deadline = computeDeadline("2026-11-01T04:00:00.000Z", 420, calendar);
    expect(deadline.toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });

  it("applies a holiday to the local date, not the UTC date", () => {
    // Fri 2026-12-25 is a holiday. Thu 2026-12-24 16:00 EST (21:00Z): 60
    // minutes Thursday, then Mon 2026-12-28 09:00 EST (14:00Z) + 60. At
    // 21:00Z Thursday it is already Friday nowhere west of UTC+3.
    const calendar = newYork([1, 2, 3, 4, 5], 9 * 60, 17 * 60, ["2026-12-25"]);
    const deadline = computeDeadline("2026-12-24T21:00:00.000Z", 120, calendar);
    expect(deadline.toISOString()).toBe("2026-12-28T15:00:00.000Z");
  });

  it("handles a window that closes at local midnight on a transition day", () => {
    // Sun 2026-11-01 20:00-24:00 EST is 01:00Z-05:00Z Monday.
    const calendar = newYork([0], 20 * 60, 24 * 60);
    const deadline = computeDeadline("2026-11-01T12:00:00.000Z", 240, calendar);
    expect(deadline.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("handles a zone whose DST transition skips midnight", () => {
    // America/Santiago, Sun 2026-09-06: 00:00 -04 jumps to 01:00 -03, so
    // local midnight does not exist. The day's 09:00 -03 is 12:00Z.
    const calendar: BusinessCalendarVersion = {
      id: "cal-scl",
      version: 1,
      timezone: "America/Santiago",
      weekly: [{ day: 0, openMinute: 9 * 60, closeMinute: 17 * 60 }],
      holidays: [],
      alwaysOpen: false,
    };
    const deadline = computeDeadline("2026-09-05T12:00:00.000Z", 60, calendar);
    expect(deadline.toISOString()).toBe("2026-09-06T13:00:00.000Z");
  });

  it("stays consistent with workingMinutesBetween across a transition", () => {
    const start = new Date("2026-10-29T15:00:00.000Z");
    for (const target of [1, 59, 480, 481, 1000, 2400]) {
      const deadline = computeDeadline(start, target, everyDayNewYork);
      expect(workingMinutesBetween(start, deadline, everyDayNewYork)).toBe(
        target,
      );
    }
  });
});

describe("workingMinutesBetween in a non-UTC timezone", () => {
  it("counts a full week spanning spring-forward as 40 hours", () => {
    const minutes = workingMinutesBetween(
      new Date("2026-03-06T05:00:00.000Z"), // Fri 00:00 EST
      new Date("2026-03-13T05:00:00.000Z"), // Fri 00:00 EST
      weekdaysNewYork,
    );
    expect(minutes).toBe(40 * 60);
  });

  it("counts a full week spanning fall-back as 40 hours", () => {
    const minutes = workingMinutesBetween(
      new Date("2026-10-30T04:00:00.000Z"), // Fri 00:00 EDT
      new Date("2026-11-06T05:00:00.000Z"), // Fri 00:00 EST
      weekdaysNewYork,
    );
    expect(minutes).toBe(40 * 60);
  });

  it("counts the transition day's local hours at its real length", () => {
    const allDaySunday = newYork([0], 0, 24 * 60);
    expect(
      workingMinutesBetween(
        new Date("2026-03-07T12:00:00.000Z"),
        new Date("2026-03-09T12:00:00.000Z"),
        allDaySunday,
      ),
    ).toBe(23 * 60);
    expect(
      workingMinutesBetween(
        new Date("2026-10-31T12:00:00.000Z"),
        new Date("2026-11-02T12:00:00.000Z"),
        allDaySunday,
      ),
    ).toBe(25 * 60);
  });
});

describe("Sun-Thu 09:00-18:00 vs 24/7 calendars in Africa/Cairo (new-commitment regression)", () => {
  const cairoBusinessHours: BusinessCalendarVersion = {
    id: "cairo-v2",
    version: 2,
    timezone: "Africa/Cairo",
    weekly: [0, 1, 2, 3, 4].map((day) => ({
      day: day as 0 | 1 | 2 | 3 | 4,
      openMinute: 9 * 60,
      closeMinute: 18 * 60,
    })),
    holidays: [],
    alwaysOpen: false,
  };
  // The calendar editor saves "24/7" as seven full-day windows with alwaysOpen false.
  const cairoFullWeekWindows: BusinessCalendarVersion = {
    id: "cairo-v4",
    version: 4,
    timezone: "Africa/Cairo",
    weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day: day as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      openMinute: 0,
      closeMinute: 1440,
    })),
    holidays: [],
    alwaysOpen: false,
  };
  const cairoAlwaysOpen: BusinessCalendarVersion = {
    ...cairoFullWeekWindows,
    id: "cairo-always-open",
    weekly: [],
    alwaysOpen: true,
  };

  // Monday 2026-10-05 17:58 Cairo (UTC+3) = 14:58Z, two minutes before close.
  const nearClose = "2026-10-05T14:58:00.000Z";

  it("a 1h target created near closing time crosses to the next working day (wall-clock runway ~16h)", () => {
    const deadline = computeDeadline(nearClose, 60, cairoBusinessHours);
    // 2 minutes left today, 58 more from 09:00 Cairo on Tuesday -> 09:58 Cairo = 06:58Z.
    expect(deadline.toISOString()).toBe("2026-10-06T06:58:00.000Z");
    const runwayHours = (deadline.getTime() - new Date(nearClose).getTime()) / 3_600_000;
    expect(runwayHours).toBeCloseTo(16, 0);
  });

  it("a 40m target created near closing time crosses to the next working day", () => {
    expect(computeDeadline(nearClose, 40, cairoBusinessHours).toISOString()).toBe("2026-10-06T06:38:00.000Z");
  });

  it("skips the Friday/Saturday closed days when the target crosses Thursday's close", () => {
    // Thursday 2026-10-08 17:58 Cairo = 14:58Z -> Sunday 2026-10-11 09:58 Cairo = 06:58Z.
    expect(computeDeadline("2026-10-08T14:58:00.000Z", 60, cairoBusinessHours).toISOString()).toBe(
      "2026-10-11T06:58:00.000Z",
    );
  });

  it.each([
    ["seven full-day windows", cairoFullWeekWindows],
    ["alwaysOpen", cairoAlwaysOpen],
  ])("a 1h target on a 24/7 calendar (%s) lands exactly 1 real hour later", (_label, calendar) => {
    const deadline = computeDeadline(nearClose, 60, calendar);
    expect(deadline.getTime() - new Date(nearClose).getTime()).toBe(60 * 60_000);
  });

  it("first-response and resolution targets share the same calendar semantics", () => {
    for (const calendar of [cairoFullWeekWindows, cairoAlwaysOpen]) {
      const firstResponse = computeDeadline(nearClose, 40, calendar);
      const resolution = computeDeadline(nearClose, 60, calendar);
      expect(firstResponse.getTime() - new Date(nearClose).getTime()).toBe(40 * 60_000);
      expect(resolution.getTime() - new Date(nearClose).getTime()).toBe(60 * 60_000);
    }
    const firstResponse = computeDeadline(nearClose, 40, cairoBusinessHours);
    const resolution = computeDeadline(nearClose, 60, cairoBusinessHours);
    expect(resolution.getTime() - firstResponse.getTime()).toBe(20 * 60_000);
  });

  it("business time equals wall-clock time on a 24/7 calendar, but not on a closed-hours calendar", () => {
    const end = new Date("2026-10-06T06:58:00.000Z");
    expect(workingMinutesBetween(new Date(nearClose), end, cairoFullWeekWindows)).toBe(16 * 60);
    expect(workingMinutesBetween(new Date(nearClose), end, cairoBusinessHours)).toBe(60);
  });
});
