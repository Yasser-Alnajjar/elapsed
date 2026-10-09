import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { localDateKey } from "@sla/core";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import {
  complianceReportCsvHeaderLine,
  complianceReportRowsToCsvLines,
  complianceReportRowsToJsonChunk,
  iterateComplianceReportRows,
} from "@/lib/report-data";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const prisma = getPrismaClient();
  const organizationId = session.user.organizationId;
  // The filename's date is the organization's local date (display timezone);
  // the exported timestamps themselves stay ISO 8601 UTC instants.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const date = localDateKey(new Date(), organization?.timezone ?? "UTC");
  const isJson = request.nextUrl.searchParams.get("format") === "json";

  // Streamed in keyset-paginated batches (performance-plan.md Phase 2 item
  // 5) rather than built in memory, so a large org's export doesn't hold
  // every commitment/event/evaluation in the process at once.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (isJson) {
          controller.enqueue(encoder.encode("["));
          let isFirstBatch = true;
          for await (const batch of iterateComplianceReportRows(
            prisma,
            organizationId,
          )) {
            controller.enqueue(
              encoder.encode(
                complianceReportRowsToJsonChunk(batch, isFirstBatch),
              ),
            );
            isFirstBatch = false;
          }
          controller.enqueue(encoder.encode("]"));
        } else {
          controller.enqueue(encoder.encode(complianceReportCsvHeaderLine()));
          for await (const batch of iterateComplianceReportRows(
            prisma,
            organizationId,
          )) {
            controller.enqueue(
              encoder.encode(complianceReportRowsToCsvLines(batch)),
            );
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new NextResponse(
    stream,
    isJson
      ? {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="sla-compliance-${date}.json"`,
          },
        }
      : {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="sla-compliance-${date}.csv"`,
          },
        },
  );
}
