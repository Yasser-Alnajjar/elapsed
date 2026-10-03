import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { buildCsv } from "@sla/core";
import { getCaseListData, parseCaseListParams } from "@/lib/case-list-data";
import {
  formatCommitmentKind,
  formatCommitmentStatus,
  formatMinutes,
} from "@/lib/format";
import type { CaseListRow } from "@/lib/types/cases";

const CSV_HEADER = [
  "Customer",
  "Ticket",
  "Subject",
  "Priority",
  "Tier",
  "SLA status",
  "Commitment",
  "Target",
  "Remaining/Elapsed",
  "Assignee",
  "Linked issue",
  "Opened at",
  "Closed at",
];

function toRow(row: CaseListRow): (string | number | null)[] {
  const snapshot = row.liveCommitment ?? row.settledCommitment;
  return [
    row.customerName ?? "Unknown account",
    row.externalId,
    row.subject,
    row.priority,
    row.tier,
    row.worstCommitmentStatus ? formatCommitmentStatus(row.worstCommitmentStatus) : "",
    snapshot ? formatCommitmentKind(snapshot.kind) : "",
    snapshot ? formatMinutes(snapshot.targetMinutes) : "",
    row.liveCommitment
      ? formatMinutes(row.liveCommitment.remainingMinutes)
      : row.settledCommitment?.elapsedSeconds != null
        ? formatMinutes(row.settledCommitment.elapsedSeconds / 60)
        : "",
    row.assigneeName,
    row.primaryLink
      ? `${row.primaryLink.system.toUpperCase()}-${row.primaryLink.externalId}`
      : "",
    row.openedAt,
    row.closedAt,
  ];
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseCaseListParams(searchParams);

  const prisma = getPrismaClient();
  const data = await getCaseListData(prisma, session.user.organizationId, {
    ...params,
    pageSize: undefined,
  });

  const csv = buildCsv(CSV_HEADER, data.cases.map(toRow));
  const filename = `sla-cases-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
