/**
 * The admin top-bar clock follows the organization's display timezone
 * (`Organization.timezone`) instead of a hardcoded UTC.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/layout/user-menu", () => ({ UserMenu: () => null }));

import { OrgClock } from "@/components/admin/admin-topbar";
import { OrgTimezoneProvider } from "@/components/shared/org-timezone-provider";
import { resolveDisplayTimeZone } from "@/lib/display-timezone";
import { formatClockTime, formatTimeZoneLabel, formatTimestampWithZone } from "@/lib/format";
import { formatUtcClock } from "@/lib/admin-format";

const INSTANT = new Date("2026-09-17T22:30:05.000Z");

function render(timezone: string): string {
  return renderToStaticMarkup(createElement(OrgTimezoneProvider, { timezone, children: createElement(OrgClock) }));
}

describe("formatClockTime", () => {
  it("renders the same instant in the requested timezone", () => {
    expect(formatClockTime(INSTANT, "UTC")).toBe("10:30:05 pm");
    expect(formatClockTime(INSTANT, "Africa/Cairo")).toBe("1:30:05 am");
    expect(formatClockTime(INSTANT, "Asia/Kolkata")).toBe("4:00:05 am");
    expect(formatClockTime(INSTANT, "America/New_York")).toBe("6:30:05 pm");
  });

  it("leaves the UTC-only admin formatter unchanged", () => {
    expect(formatUtcClock(INSTANT)).toBe("10:30:05 pm");
  });
});

describe("OrgClock", () => {
  it("labels the clock with the configured timezone and describes it in the tooltip", () => {
    const html = render("Africa/Cairo");
    expect(html).toContain("Africa/Cairo --:--:--");
    expect(html).toContain("Current time in Africa/Cairo");
    expect(html).not.toContain("Every timestamp in this console is UTC");
    expect(html).toContain("Timestamps in the console&#x27;s tables are UTC");
  });

  it("follows a changed organization timezone without a reload", () => {
    expect(render("Asia/Kolkata")).toContain("Asia/Kolkata --:--:--");
    expect(render("America/New_York")).toContain("America/New_York --:--:--");
  });

  it("falls back to UTC for a missing or invalid timezone", () => {
    for (const bad of ["", "Not/AZone"]) {
      const html = render(bad);
      expect(html).toContain("UTC --:--:--");
      expect(html).toContain("Current time in UTC");
    }
  });

  it("keeps the existing styling and responsive visibility", () => {
    expect(render("UTC")).toContain("hidden items-center gap-1.5 rounded border");
    expect(render("UTC")).toContain("sm:flex");
  });
});

describe("display timezone helpers", () => {
  it("resolves invalid values to UTC and keeps valid ones", () => {
    expect(resolveDisplayTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveDisplayTimeZone("garbage")).toBe("UTC");
    expect(resolveDisplayTimeZone(null)).toBe("UTC");
    expect(resolveDisplayTimeZone(undefined)).toBe("UTC");
  });

  it("renders a snapshot timestamp in the org timezone and names the zone", () => {
    expect(formatTimestampWithZone("2026-09-17T22:30:05.000Z", "Africa/Cairo")).toBe("Sep 18, 2026, 01:30:05 AM Africa/Cairo");
    expect(formatTimestampWithZone("2026-09-17T22:30:05.000Z", "UTC")).toBe("Sep 17, 2026, 10:30:05 PM UTC");
    expect(formatTimestampWithZone(null, "UTC")).toBe("Never");
  });

  it("labels a timezone by its IANA id", () => {
    expect(formatTimeZoneLabel("Africa/Cairo")).toBe("Africa/Cairo");
  });
});
