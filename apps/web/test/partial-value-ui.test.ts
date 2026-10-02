/**
 * N5.2: without a tracker the dashboard prints engineering time as "not
 * measured", never as a zero.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtRiskSnapshotTable } from "@modules/dashboard/dashboard/csr/AtRiskSnapshotTable";
import { AttributionLedgerCard } from "@modules/dashboard/dashboard/csr/AttributionLedgerCard";
import type { AtRiskRow, AttributionLedger } from "@/lib/types/dashboard";

const ledger: AttributionLedger = {
  supportLegHours: 12.5,
  engineeringLegHours: 0,
  waitingCustomerLegHours: 3,
  linkingPrecisionPercent: null,
  directMatches: 0,
  unlinkedOrStandalone: 0,
  auditTimestamp: "2026-10-02T00:00:00.000Z",
};

const row: AtRiskRow = {
  commitmentId: "c1",
  caseId: "case1",
  externalId: "101",
  subject: "Cannot log in",
  customerName: "Acme",
  requesterName: null,
  kind: "resolution",
  remainingMinutes: 30,
  status: "at_risk",
  currentLeg: "support",
  minutesInCurrentLeg: 10,
  supportLegMinutes: 90,
  engineeringLegMinutes: 0,
};

describe("engineering time without a tracker", () => {
  it("the attribution ledger shows a dash and a hint, not 0 hrs", () => {
    const html = renderToStaticMarkup(createElement(AttributionLedgerCard, { ledger, engineeringMeasured: false }));
    expect(html).toContain("12.5 hrs"); // support side is measured
    expect(html).toContain("Engineering time appears once a tracker is connected");
    expect(html).toContain("Needs a tracker");
    expect(html.match(/ hrs/g)).toHaveLength(2); // support and waiting only
  });

  it("with a tracker the same zero is a real figure", () => {
    const html = renderToStaticMarkup(createElement(AttributionLedgerCard, { ledger, engineeringMeasured: true }));
    expect(html.match(/ hrs/g)).toHaveLength(3);
    expect(html).not.toContain("Needs a tracker");
  });

  it("the at-risk table shows no engineering minutes without a tracker", () => {
    const without = renderToStaticMarkup(createElement(AtRiskSnapshotTable, { rows: [row], engineeringMeasured: false }));
    expect(without).toContain("Eng —");
    const withTracker = renderToStaticMarkup(createElement(AtRiskSnapshotTable, { rows: [row], engineeringMeasured: true }));
    expect(withTracker).toContain("Eng 0");
    expect(withTracker).not.toContain("Eng —");
  });
});
