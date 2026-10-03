import type { AtRiskRowData } from "@/lib/types/at-risk";

const shareOf = (part: number, whole: number) =>
  whole > 0 ? Math.min((part / whole) * 100, 100) : 0;

/** How much of the target is spent, and how the elapsed time splits across legs (percentages capped at 100). */
export function timeAllocation(row: AtRiskRowData) {
  const elapsedMinutes = row.elapsedSeconds / 60;

  return {
    elapsedMinutes,
    elapsedPercent: shareOf(elapsedMinutes, row.targetMinutes),
    supportPercent: shareOf(row.supportLegMinutes, elapsedMinutes),
    engineeringPercent: shareOf(row.engineeringLegMinutes, elapsedMinutes),
    waitingCustomerPercent: shareOf(
      row.waitingCustomerLegMinutes,
      elapsedMinutes,
    ),
  };
}
