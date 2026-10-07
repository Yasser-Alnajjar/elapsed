import { CaseDetail } from "@modules/cases/case-detail";
import { Actions } from "@/actions";
import { formatCaseTitle } from "@/lib/format";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

/**
 * The tab is titled with the case ("ZD-8921 · Login fails after SSO"). Falls
 * back to a generic title for a case that isn't found, or if the lookup fails:
 * the page itself still does its own `notFound()` and error handling, a
 * missing title must never be what breaks it.
 */
export async function generateMetadata({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  try {
    const found = await Actions.Cases.getTitle(caseId);
    return noIndexMetadata(found ? formatCaseTitle(found.system, found.externalId, found.subject) : "Case details");
  } catch {
    return noIndexMetadata("Case details");
  }
}

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ commitmentId?: string | string[]; ref?: string | string[]; n?: string | string[] }>;
}) {
  const { caseId } = await params;
  const { commitmentId, ref, n } = await searchParams;
  return (
    <CaseDetail
      caseId={caseId}
      commitmentId={typeof commitmentId === "string" ? commitmentId : undefined}
      alertNotificationId={ref === "alert" && typeof n === "string" ? n : undefined}
    />
  );
}
