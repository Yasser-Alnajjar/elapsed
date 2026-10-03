"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ConciergeExportSelection } from "@/lib/concierge-selection";
import { SelectionField } from "./SelectionField";

interface IntegrationSectionProps {
  label: string;
  selection: ConciergeExportSelection;
  exporting: boolean;
  unavailableReason: string | null;
  onChange: (integrationId: string) => void;
}

/** The integration picker for the selected organization, with its loading, error, empty and not-exportable states. */
export function IntegrationSection({
  label,
  selection,
  exporting,
  unavailableReason,
  onChange,
}: IntegrationSectionProps) {
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
        <AlertDescription>
          No {label} integration is configured for this organization.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <SelectionField
        id="concierge-integration"
        label={`${label} Integration`}
        placeholder={`Select ${label} integration`}
        value={
          selection.integrationId ??
          (selection.integrations.length === 1
            ? selection.integrations[0]!.id
            : null)
        }
        options={selection.integrations.map((integration) => ({
          value: integration.id,
          label: integration.exportable
            ? integration.name
            : `${integration.name} — ${integration.unavailableReason}`,
          disabled: !integration.exportable,
        }))}
        disabled={exporting}
        onChange={onChange}
      />
      {unavailableReason && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertDescription>
            This {label} integration can&apos;t be exported ({unavailableReason}
            ). Reconnect it from Integrations settings.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
