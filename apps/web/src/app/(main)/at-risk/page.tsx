import { AtRisk } from "@modules/dashboard/at-risk";

export const dynamic = "force-dynamic";

interface AtRiskPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AtRiskPage({ searchParams }: AtRiskPageProps) {
  const resolvedSearchParams = await searchParams;
  return <AtRisk searchParams={resolvedSearchParams} />;
}
