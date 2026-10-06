import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient, startIntegrationExport, startIntegrationReport } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { DEFAULT_EXPORT_FORMAT, exportFormat, isExportFormat } from "@/lib/data-export/formats";
import { buildIntegrationReportPdf } from "@/lib/data-export/report-pdf";
import { serializeExport } from "@/lib/data-export/serialize";
import { isIntegrationProvider } from "@/lib/types/integrations";

export const dynamic = "force-dynamic";

/**
 * Downloads one integration's stored data in a chosen `format` (a form field;
 * default JSON Lines): a separate, read-only action that modifies and deletes
 * nothing, works for a connected or a disconnected integration, and is never
 * triggered by (nor does it trigger) a cleanup.
 *
 *  - `ndjson`, `json`, `csv`: complete data — a backup. Exactly what
 *    `cleanupIntegrationData` would delete, read through one record stream
 *    (`startIntegrationExport`) and serialized as it is read.
 *  - `pdf`: a summary report (`startIntegrationReport`), not the records.
 *
 * Each is recorded in the data-operation audit trail with its format.
 *
 * A POST, not a GET: it is expensive and audited, and a cross-site top-level
 * GET carries the session cookie under `SameSite=Lax` where a POST is stopped
 * by the proxy's origin check. The UI submits a plain form to it, so the
 * browser streams the response straight to disk. Owner-only: it exports raw
 * provider records.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const { provider } = await params;
  if (!isIntegrationProvider(provider)) {
    return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const requested = form?.get("format") ?? DEFAULT_EXPORT_FORMAT;
  if (!isExportFormat(requested)) {
    return NextResponse.json({ error: "Unknown export format" }, { status: 400 });
  }
  const format = exportFormat(requested);

  const prisma = getPrismaClient();
  const organizationId = session.user.organizationId;
  const actor = { userId: session.user.id, email: session.user.email };
  const fileName = (stamp: string) => `elapsed-${provider}-${format.id === "pdf" ? "report" : "backup"}-${stamp}.${format.extension}`;
  const headers = (stamp: string): Record<string, string> => ({
    "Content-Type": format.contentType,
    "Content-Disposition": `attachment; filename="${fileName(stamp)}"`,
    "Cache-Control": "no-store",
  });

  if (format.id === "pdf") {
    const report = await startIntegrationReport(prisma, organizationId, provider, actor);
    if (report.status === "not_found") {
      return NextResponse.json({ error: "This integration has no data to report on" }, { status: 404 });
    }
    try {
      const pdf = buildIntegrationReportPdf(report.data);
      await report.complete();
      const stamp = report.data.generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      return new Response(pdf as BodyInit, { headers: { ...headers(stamp), "Content-Length": String(pdf.length) } });
    } catch (error) {
      await report.fail(error);
      throw error;
    }
  }

  const exported = await startIntegrationExport(prisma, organizationId, provider, actor, format.id);
  if (exported.status === "not_found") {
    return NextResponse.json({ error: "This integration has no data to back up" }, { status: 404 });
  }
  return new Response(serializeExport(format.id, exported), { headers: headers(exported.stamp) });
}
