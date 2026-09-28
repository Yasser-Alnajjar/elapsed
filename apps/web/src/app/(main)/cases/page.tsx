import { CaseList } from "@modules/cases/case-list";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Cases",
};

interface CasesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const resolvedSearchParams = await searchParams;
  return <CaseList searchParams={resolvedSearchParams} />;
}
