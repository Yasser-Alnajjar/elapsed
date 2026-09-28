import "server-only";
import { withPerfScope, type CommitmentStatus, type PrismaClient } from "@sla/db";

export interface AlertSummaryRow {
  commitmentId: string;
  caseId: string;
  externalId: string;
  subject: string | null;
  status: "at_risk" | "breached";
  remainingMinutes: number;
}

export interface AlertSummary {
  rows: AlertSummaryRow[];
  totalCount: number;
}

/**
 * Header bell (`AlertsPopover`) snapshot for `(main)/layout.tsx` — persisted
 * `Commitment.status`/`dueAt` only, never `evaluateCommitment` (see
 * performance-plan.md's "Snapshot vs live" ground rule). `remainingMinutes`
 * is derived from `dueAt - asOf`, the same number a live evaluation would
 * report at this instant for an open commitment. `AlertsPopover` renders at
 * most 20 rows (`.slice(0, 20)`), so this loads exactly that many plus a
 * total count for the badge, instead of the whole open at-risk/breached set.
 */
export async function getAlertSummary(
  prisma: PrismaClient,
  organizationId: string,
  asOf: Date = new Date(),
): Promise<AlertSummary> {
  return withPerfScope(
    "alert_summary",
    () => getAlertSummaryInner(prisma, organizationId, asOf),
    { organizationId },
  );
}

async function getAlertSummaryInner(
  prisma: PrismaClient,
  organizationId: string,
  asOf: Date,
): Promise<AlertSummary> {
  const openAlertStatuses: CommitmentStatus[] = ["at_risk", "breached"];
  const where = {
    case: { organizationId },
    closedAt: null,
    status: { in: openAlertStatuses },
  };

  const [rows, totalCount] = await Promise.all([
    prisma.commitment.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 20,
      select: {
        id: true,
        caseId: true,
        status: true,
        dueAt: true,
        case: { select: { externalId: true, subject: true } },
      },
    }),
    prisma.commitment.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      commitmentId: row.id,
      caseId: row.caseId,
      externalId: row.case.externalId,
      subject: row.case.subject,
      status: row.status as "at_risk" | "breached",
      remainingMinutes: Math.round((row.dueAt.getTime() - asOf.getTime()) / 60000),
    })),
    totalCount,
  };
}
