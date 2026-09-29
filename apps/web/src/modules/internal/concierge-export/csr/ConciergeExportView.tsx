"use client";

import {
  AlertCircle,
  Archive,
  ArrowLeft,
  BadgeCheck,
  Calendar,
  Download,
  FileText,
  FolderArchive,
  History,
  Loader2,
  Lock,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  exportRequest,
  initialSelection,
  integrationsFailed,
  integrationsLoaded,
  selectIntegration,
  selectOrganization,
  type ConciergeExportSelection,
} from "@/lib/concierge-selection";
import { CONCIERGE_PROVIDER_COPY } from "@/lib/concierge-providers";
import { DEFAULT_EXPORT_SINCE_DAYS } from "@/lib/types/concierge-export";
import type { ConciergeExportPageData, ConciergeExportSummary } from "@/lib/types/concierge-export";
import { SelectionField } from "./SelectionField";

interface ConciergeExportViewProps {
  data: ConciergeExportPageData;
}

interface CompletedExport {
  summary: ConciergeExportSummary;
  url: string;
}

/**
 * Internal operator page: export the Jira or Zendesk half of a Concierge
 * dataset from an integration the signed-in user can already access. Organization and
 * integration come from the session's own rows and are auto-selected when
 * there's only one; ids are never typed.
 */
export function ConciergeExportView({ data }: ConciergeExportViewProps) {
  const { provider } = data;
  const copy = CONCIERGE_PROVIDER_COPY[provider];
  const [selection, setSelection] = useState<ConciergeExportSelection>(() => initialSelection(data));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedExport | null>(null);
  const latestUrl = useRef<string | null>(null);

  useEffect(() => () => revoke(latestUrl), []);

  function clearResult() {
    revoke(latestUrl);
    setCompleted(null);
    setExportError(null);
  }

  async function handleOrganizationChange(organizationId: string) {
    const next = selectOrganization(selection, organizationId);
    if (next === selection) return;
    clearResult();
    setSelection(next);

    const result = await Actions.Concierge.listIntegrations(provider, organizationId);
    // Applied to the latest state: a reply for an organization that's no longer selected is dropped.
    setSelection((current) =>
      result.ok && result.integrations
        ? integrationsLoaded(current, organizationId, result.integrations)
        : integrationsFailed(current, organizationId, result.error ?? `Failed to load ${copy.label} integrations`),
    );
  }

  function handleIntegrationChange(integrationId: string) {
    clearResult();
    setSelection((current) => selectIntegration(current, integrationId));
  }

  async function handleExport() {
    const request = exportRequest(selection);
    if (!request) return;

    clearResult();
    setExporting(true);
    const result = await Actions.Concierge.exportData(provider, request);
    setExporting(false);

    if (!result.ok) {
      setExportError(result.error);
      return;
    }
    const url = URL.createObjectURL(result.zip);
    latestUrl.current = url;
    setCompleted({ summary: result.summary, url });
  }

  const request = exportRequest(selection);
  const { organizations, integrations } = selection;
  const selectedIntegration = integrations?.find((integration) => integration.id === selection.integrationId);
  const unavailable =
    integrations?.length === 1 && !integrations[0]!.exportable ? integrations[0]! : null;

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
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Read-only extract</span>
      </div>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/10 blur-3xl" />
        <CardContent className="relative flex items-center gap-4 px-6 py-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary">
            <FolderArchive className="size-7" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Concierge data export</p>
            <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Export {copy.label} data for the Concierge SLA analysis.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 border-b px-6 py-4">
              <CardTitle className="text-sm font-semibold">Export scope</CardTitle>
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Fixed
              </span>
            </CardHeader>

            <CardContent className="space-y-5 px-6 py-5">
              <p className="text-sm text-muted-foreground">{copy.sourceDescription}</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LockedField icon={Calendar} label="Date range" value={`Last ${DEFAULT_EXPORT_SINCE_DAYS} days`} hint={`${copy.scopeRecords} in this window`} />
                <LockedField icon={History} label="History source" value={copy.historySource} hint="Status transitions only" />
              </div>

              <div className="space-y-5 border-t pt-5">
                {organizations.length === 0 ? (
                  <Alert variant="warning">
                    <AlertCircle />
                    <AlertDescription>You don&apos;t have access to any organization, so there is nothing to export.</AlertDescription>
                  </Alert>
                ) : (
                  <SelectionField
                    id="concierge-organization"
                    label="Organization"
                    placeholder="Select organization"
                    value={selection.organizationId}
                    options={organizations.map((organization) => ({ value: organization.id, label: organization.name }))}
                    disabled={exporting}
                    onChange={handleOrganizationChange}
                  />
                )}

                {selection.organizationId && (
                  <IntegrationSection
                    label={copy.label}
                    selection={selection}
                    exporting={exporting}
                    unavailableReason={unavailable?.unavailableReason ?? selectedIntegration?.unavailableReason ?? null}
                    onChange={handleIntegrationChange}
                  />
                )}

                {exportError && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>{exportError}</AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t pt-5">
                <Button type="button" onClick={handleExport} disabled={!request || exporting}>
                  {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
                  {exporting ? "Exporting…" : copy.exportButton}
                </Button>
                <span className="text-xs text-muted-foreground">Generates a ZIP bundle of CSV files and export metadata.</span>
              </div>
            </CardContent>
          </Card>

          {completed && (
            <Card className="relative overflow-hidden border-success/30">
              <div className="absolute inset-x-0 top-0 h-1 bg-success" />
              <CardContent className="space-y-5 px-6 py-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-success/10 text-success">
                      <BadgeCheck className="size-6" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">Export complete</h3>
                        <span className="rounded bg-success/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-success">
                          Ready
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{completed.summary.fileName}</p>
                    </div>
                  </div>
                  <Button asChild size="sm">
                    <a href={completed.url} download={completed.summary.fileName}>
                      <Download />
                      Download ZIP
                    </a>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat value={completed.summary.recordCount} label={copy.recordNoun} />
                  <Stat value={completed.summary.historyCount} label={copy.historyNoun} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card>
            <CardHeader className="flex-row items-center gap-2 border-b px-6 py-4">
              <FileText className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Archive contents</CardTitle>
            </CardHeader>
            <CardContent className="px-6 py-5">
              <ul className="space-y-1 rounded-lg bg-muted/30 p-4 font-mono text-xs">
                {copy.archiveFiles.map((file) => (
                  <li key={file.name} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground">{file.name}</span>
                    <span className="text-end text-[11px] text-muted-foreground">{file.description}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-start gap-3 px-6 py-5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-primary">
                <Shield className="size-4" />
              </span>
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-primary">Read-only</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The export only reads from {copy.label}. Nothing in your workspace is created, updated or deleted.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LockedField({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="flex items-center gap-0.5">
          <Lock className="size-3" />
          Locked
        </span>
      </div>
      <div className="flex cursor-not-allowed select-none items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm opacity-80">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{value}</span>
      </div>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <span className="font-mono text-2xl font-bold">{value}</span>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface IntegrationSectionProps {
  label: string;
  selection: ConciergeExportSelection;
  exporting: boolean;
  unavailableReason: string | null;
  onChange: (integrationId: string) => void;
}

function IntegrationSection({ label, selection, exporting, unavailableReason, onChange }: IntegrationSectionProps) {
  if (selection.loadingIntegrations) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading {label} integrations…
      </p>
    );
  }
  if (selection.integrationsError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>{selection.integrationsError}</AlertDescription>
      </Alert>
    );
  }
  if (!selection.integrations) return null;
  if (selection.integrations.length === 0) {
    return (
      <Alert>
        <AlertCircle />
        <AlertDescription>No {label} integration is configured for this organization.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <SelectionField
        id="concierge-integration"
        label={`${label} Integration`}
        placeholder={`Select ${label} integration`}
        value={selection.integrationId ?? (selection.integrations.length === 1 ? selection.integrations[0]!.id : null)}
        options={selection.integrations.map((integration) => ({
          value: integration.id,
          label: integration.exportable ? integration.name : `${integration.name} — ${integration.unavailableReason}`,
          disabled: !integration.exportable,
        }))}
        disabled={exporting}
        onChange={onChange}
      />
      {unavailableReason && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertDescription>
            This {label} integration can&apos;t be exported ({unavailableReason}). Reconnect it from Integrations settings.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function revoke(ref: { current: string | null }) {
  if (ref.current) URL.revokeObjectURL(ref.current);
  ref.current = null;
}
