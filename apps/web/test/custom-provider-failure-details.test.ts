/**
 * How a failed custom-provider ticket is explained in the UI: the field, the
 * mapping and the reason from the structured details, and the plain-language
 * fallback for a run recorded without them.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/org-timezone-provider", () => ({ useOrgTimezone: () => "UTC" }));

const html = (element: React.ReactElement) => renderToStaticMarkup(element).replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

const details = [
  {
    mapping: "mapping.title",
    target: "subject",
    reason: "undefined_variable",
    message: 'Field "subject" (mapping.title) failed: template "{id}-{org}" references undefined variable "org". Available variables: id.',
  },
  { mapping: "mapping.createdAt", target: "openedAt", reason: "missing", message: 'Field "openedAt" (mapping.createdAt) failed: source field "$.created_at" is missing from the response (nothing at that path).' },
];

describe("FailureReasons", () => {
  it("lists each failing field with its mapping and reason", async () => {
    const { FailureReasons } = await import("../src/modules/settings/custom-provider/csr/FailureReasons");
    const out = html(createElement(FailureReasons, { code: "transform_failed", details }));
    expect(out).toContain('Field "subject" (mapping.title) failed: template "{id}-{org}" references undefined variable "org". Available variables: id.');
    expect(out).toContain('Field "openedAt" (mapping.createdAt) failed: source field "$.created_at" is missing');
    expect(out).toContain("[mapping.title: undefined_variable]");
    expect(out).toContain("[mapping.createdAt: missing]");
    expect(out).not.toContain("A mapped value could not be built");
  });

  it("falls back to the plain-language text for a failure recorded without details", async () => {
    const { FailureReasons } = await import("../src/modules/settings/custom-provider/csr/FailureReasons");
    expect(html(createElement(FailureReasons, { code: "unknown_status" }))).toContain("not in your status mapping");
    expect(html(createElement(FailureReasons, { code: "something_new" }))).toContain("something_new");
  });
});

describe("RunHistory", () => {
  it("shows the detailed reason for each failed ticket", async () => {
    const { RunHistory } = await import("../src/modules/settings/custom-provider/csr/RunHistory");
    const status = {
      runs: [{ id: "run1", startedAt: "2026-10-01T00:00:00.000Z", outcome: "partial", reasonCode: null, secondaryReason: null, recordsFetched: 2, failureCount: 1 }],
      failedTicketCount: 1,
      failedTickets: [{ recordId: "TCK-1001", code: "transform_failed", details }],
    } as unknown as import("../src/lib/custom-provider/status").CustomStatus;
    const out = html(createElement(RunHistory, { status }));
    expect(out).toContain("TCK-1001");
    expect(out).toContain('references undefined variable "org"');
    expect(out).toContain("[mapping.createdAt: missing]");
  });
});
