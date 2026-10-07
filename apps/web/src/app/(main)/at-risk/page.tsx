import { AtRisk } from "@modules/dashboard/at-risk";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

interface AtRiskPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = noIndexMetadata("At risk");

export default async function AtRiskPage({ searchParams }: AtRiskPageProps) {
  const resolvedSearchParams = await searchParams;
  return <AtRisk searchParams={resolvedSearchParams} />;
}
