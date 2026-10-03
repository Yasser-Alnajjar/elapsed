"use client";

import {
  AlertCircle,
  Archive,
  Calendar,
  History,
  Loader2,
  Lock,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConciergeExportSelection } from "@/lib/concierge-selection";
import type { ConciergeProviderCopy } from "@/lib/concierge-providers";
import { DEFAULT_EXPORT_SINCE_DAYS } from "@/lib/types/concierge-export";
import { IntegrationSection } from "./IntegrationSection";
import { SelectionField } from "./SelectionField";

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
      <div className="flex items-center justify-between font-mono text-xxs uppercase tracking-wider text-muted-foreground">
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
      <span className="text-xxs text-muted-foreground">{hint}</span>
    </div>
  );
}

/** The fixed export window, the organization / integration pickers, and the export button. */
export function ExportScopeCard({
  copy,
  selection,
  exporting,
  exportError,
  canExport,
  onOrganizationChange,
  onIntegrationChange,
  onExport,
}: {
  copy: ConciergeProviderCopy;
  selection: ConciergeExportSelection;
  exporting: boolean;
  exportError: string | null;
  canExport: boolean;
  onOrganizationChange: (organizationId: string) => void;
  onIntegrationChange: (integrationId: string) => void;
  onExport: () => void;
}) {
  const { organizations, integrations } = selection;
  const selectedIntegration = integrations?.find(
    (integration) => integration.id === selection.integrationId,
  );
  const unavailable =
    integrations?.length === 1 && !integrations[0]!.exportable
      ? integrations[0]!
      : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 border-b px-6 py-4">
        <CardTitle className="text-sm font-semibold">Export scope</CardTitle>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Fixed
        </span>
      </CardHeader>

      <CardContent className="space-y-5 px-6 py-5">
        <p className="text-sm text-muted-foreground">
          {copy.sourceDescription}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LockedField
            icon={Calendar}
            label="Date range"
            value={`Last ${DEFAULT_EXPORT_SINCE_DAYS} days`}
            hint={`${copy.scopeRecords} in this window`}
          />
          <LockedField
            icon={History}
            label="History source"
            value={copy.historySource}
            hint="Status transitions only"
          />
        </div>

        <div className="space-y-5 border-t pt-5">
          {organizations.length === 0 ? (
            <Alert variant="warning">
              <AlertCircle />
              <AlertDescription>
                You don&apos;t have access to any organization, so there is
                nothing to export.
              </AlertDescription>
            </Alert>
          ) : (
            <SelectionField
              id="concierge-organization"
              label="Organization"
              placeholder="Select organization"
              value={selection.organizationId}
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
              disabled={exporting}
              onChange={onOrganizationChange}
            />
          )}

          {selection.organizationId && (
            <IntegrationSection
              label={copy.label}
              selection={selection}
              exporting={exporting}
              unavailableReason={
                unavailable?.unavailableReason ??
                selectedIntegration?.unavailableReason ??
                null
              }
              onChange={onIntegrationChange}
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
          <Button
            type="button"
            onClick={onExport}
            disabled={!canExport || exporting}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Archive />}
            {exporting ? "Exporting…" : copy.exportButton}
          </Button>
          <span className="text-xs text-muted-foreground">
            Generates a ZIP bundle of CSV files and export metadata.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
