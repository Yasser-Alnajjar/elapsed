/**
 * D32: the Syncs section shows the last check and the last data update apart,
 * says plainly when nothing changed, and leaves the history table empty rather
 * than listing no-change syncs or showing zero counts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrgTimezoneProvider } from "../src/components/shared/org-timezone-provider";
import type { CustomStatus } from "../src/lib/custom-provider/status";
import { RunHistory, SyncFreshness } from "../src/modules/settings/custom-provider/csr/RunHistory";

const status = (overrides: Partial<CustomStatus> = {}): CustomStatus => ({
  connected: true,
  state: "up_to_date",
  attention: null,
  stale: false,
  staleSince: null,
  lastSuccessfulSyncAt: "2026-10-09T12:30:00.000Z",
  lastDataChangedAt: "2026-10-09T10:00:00.000Z",
  activeVersion: 1,
  slaSupport: null,
  versions: [],
  runs: [],
  failedTickets: [],
  failedTicketCount: 0,
  override: null,
  ...overrides,
});

const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(OrgTimezoneProvider, { timezone: "UTC", children: node }));

describe("SyncFreshness", () => {
  it("shows both timestamps and that nothing changed since the last update", () => {
    const out = html(createElement(SyncFreshness, { status: status() }));
    expect(out).toContain("Last checked:");
    expect(out).toContain("October 9, 2026 at 12:30 PM");
    expect(out).toContain("Last data update:");
    expect(out).toContain("October 9, 2026 at 10:00 AM");
    expect(out).toContain("No data changes detected since the last update.");
  });

  it("does not claim 'no changes since' when the last check is the one that changed data", () => {
    const out = html(createElement(SyncFreshness, { status: status({ lastDataChangedAt: "2026-10-09T12:30:00.000Z" }) }));
    expect(out).not.toContain("No data changes detected");
  });

  it("says so when no change has been recorded or nothing was checked yet", () => {
    expect(html(createElement(SyncFreshness, { status: status({ lastDataChangedAt: null }) }))).toContain("No data changes recorded yet.");
    const never = html(createElement(SyncFreshness, { status: status({ lastSuccessfulSyncAt: null, lastDataChangedAt: null }) }));
    expect(never).toContain("Not checked yet");
    expect(never).not.toContain("No data changes");
  });

  it("uses no physical left/right classes, so it mirrors under RTL", () => {
    expect(html(createElement(SyncFreshness, { status: status() }))).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});

describe("RunHistory", () => {
  it("leaves the table empty, with a neutral row, when there are no recorded changes or failures", () => {
    const out = html(createElement(RunHistory, { status: status() }));
    expect(out).toContain("No data changes or failures recorded.");
    expect(out).not.toContain("No sync has run yet");
    expect(out).not.toContain("could not be processed");
  });

  it("lists a stored run with an empty reason as a dash, not a blank", () => {
    const run = { id: "r1", startedAt: "2026-10-09T10:00:00.000Z", finishedAt: "2026-10-09T10:00:05.000Z", outcome: "ok" as const, reasonCode: null, secondaryReason: null, recordsFetched: 4, failureCount: 0, progress: null };
    const out = html(createElement(RunHistory, { status: status({ runs: [run] }) }));
    expect(out).toContain("—");
    expect(out).not.toContain("No data changes or failures recorded.");
  });
});
