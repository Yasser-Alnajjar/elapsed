import { CaseDetail } from "@modules/cases/case-detail";

export const dynamic = "force-dynamic";

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
