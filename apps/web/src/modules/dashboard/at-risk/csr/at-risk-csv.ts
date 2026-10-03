import { buildCsv } from "@sla/core";
import type { AtRiskRowData } from "@/lib/types/at-risk";

/** The rows on the current page, after the leg filter; one row per commitment. */
export function atRiskRowsToCsv(rows: AtRiskRowData[]): string {
  return buildCsv(
    [
      "commitmentId",
      "caseId",
      "externalId",
      "subject",
      "customerName",
      "requesterName",
      "kind",
      "remainingMinutes",
      "status",
      "currentLeg",
      "minutesInCurrentLeg",
      "priority",
      "tier",
      "targetMinutes",
      "elapsedSeconds",
      "supportLegMinutes",
      "engineeringLegMinutes",
      "waitingCustomerLegMinutes",
      "supportAssigneeName",
      "linkedIssue",
    ],
    rows.map((row) => [
      row.commitmentId,
      row.caseId,
      row.externalId,
      row.subject,
      row.customerName,
      row.requesterName,
      row.kind,
      row.remainingMinutes,
      row.status,
      row.currentLeg,
      row.minutesInCurrentLeg,
      row.priority,
      row.tier,
      row.targetMinutes,
      row.elapsedSeconds,
      row.supportLegMinutes,
      row.engineeringLegMinutes,
      row.waitingCustomerLegMinutes,
      row.supportAssigneeName,
      row.linkedIssue?.externalId ?? null,
    ]),
  );
}
