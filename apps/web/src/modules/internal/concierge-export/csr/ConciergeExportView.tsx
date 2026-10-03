"use client";

import { ArrowLeft, FolderArchive } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { CONCIERGE_PROVIDER_COPY } from "@/lib/concierge-providers";
import type { ConciergeExportPageData } from "@/lib/types/concierge-export";
import { ExportCompleteCard } from "./ExportCompleteCard";
import { ExportScopeCard } from "./ExportScopeCard";
import { ExportSidebar } from "./ExportSidebar";
import { useConciergeExport } from "./useConciergeExport";

interface ConciergeExportViewProps {
  data: ConciergeExportPageData;
}

/**
 * Internal operator page: export the Jira or Zendesk half of a Concierge
 * dataset from an integration the signed-in user can already access. Organization and
 * integration come from the session's own rows and are auto-selected when
 * there's only one; ids are never typed.
 */
export function ConciergeExportView({ data }: ConciergeExportViewProps) {
  const copy = CONCIERGE_PROVIDER_COPY[data.provider];
  const {
    selection,
    exporting,
    exportError,
    completed,
    request,
    handleOrganizationChange,
    handleIntegrationChange,
    handleExport,
  } = useConciergeExport(data);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={copy.integrationHref}
          className="inline-flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {copy.label} integration
        </Link>
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Read-only extract
        </span>
      </div>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/10 blur-3xl" />
        <CardContent className="relative flex items-center gap-4 px-6 py-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary">
            <FolderArchive className="size-7" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-xxs uppercase tracking-widest text-primary">
              Concierge data export
            </p>
            <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">
              {copy.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Export {copy.label} data for the Concierge SLA analysis.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <ExportScopeCard
            copy={copy}
            selection={selection}
            exporting={exporting}
            exportError={exportError}
            canExport={request !== null}
            onOrganizationChange={handleOrganizationChange}
            onIntegrationChange={handleIntegrationChange}
            onExport={handleExport}
          />

          {completed && (
            <ExportCompleteCard copy={copy} completed={completed} />
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <ExportSidebar copy={copy} />
        </div>
      </div>
    </div>
  );
}
