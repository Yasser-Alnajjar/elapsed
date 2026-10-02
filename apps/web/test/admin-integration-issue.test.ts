import { describe, expect, it } from "vitest";
import { describeIntegrationIssue } from "../src/lib/admin-integration-issue";
import type { OperatorIntegrationHealthRow } from "../src/lib/types/operator";

const base: OperatorIntegrationHealthRow = {
  organizationId: "org_1",
  organizationName: "Globex",
  provider: "jira",
  reauthRequired: false,
  permissionDenied: false,
  lastSyncAt: "2026-10-02T07:32:10.000Z",
  lastSyncError: null,
  lastSuccessfulSyncAt: "2026-10-01T23:42:00.000Z",
  consecutiveFailures: 0,
  failingSince: null,
  lastSyncDurationMs: null,
  pollingPausedAt: null,
  stale: false,
  staleSince: null,
};

describe("describeIntegrationIssue", () => {
  it("a deliberate pause is amber and explains the staleness, even when failing and stale as well", () => {
    const issue = describeIntegrationIssue({ ...base, pollingPausedAt: "2026-09-30T14:15:00.000Z", failingSince: "x", stale: true });
    expect(issue.tone).toBe("warning");
    expect(issue.label).toBe("Paused by operator");
    expect(issue.facts[0]).toMatchObject({ label: "Paused since", value: "Sep 30, 2026, 02:15:00 PM UTC" });
  });

  it("a lost authorization wins over a failing streak", () => {
    expect(describeIntegrationIssue({ ...base, reauthRequired: true, failingSince: "x", consecutiveFailures: 4 }).label).toBe("Needs reconnect");
    expect(describeIntegrationIssue({ ...base, permissionDenied: true }).label).toBe("Access lost");
  });

  it("a failing streak is red and carries attempts, duration and the provider's error", () => {
    const issue = describeIntegrationIssue({
      ...base,
      failingSince: "2026-10-02T04:14:12.000Z",
      consecutiveFailures: 36,
      lastSyncDurationMs: 30_000,
      lastSyncError: "Jira responded 503 Service Unavailable",
    });
    expect(issue).toMatchObject({ tone: "danger", label: "Failing", headline: "36 consecutive failed attempts", error: "Jira responded 503 Service Unavailable" });
    expect(issue.facts.map((fact) => fact.value)).toContain("36 · last took 30s");
  });

  it("an error without a streak is 'sync failed'; no error at all is stale", () => {
    expect(describeIntegrationIssue({ ...base, lastSyncError: "boom" }).label).toBe("Sync failed");
    const stale = describeIntegrationIssue({ ...base, stale: true, staleSince: "2026-10-02T01:00:00.000Z" });
    expect(stale).toMatchObject({ tone: "warning", label: "Stale", headline: "No recent successful sync" });
    expect(describeIntegrationIssue({ ...base, stale: true, lastSuccessfulSyncAt: null }).headline).toBe("No successful sync has completed yet");
  });
});
