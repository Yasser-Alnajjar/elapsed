"use client";

import type { AdminIntegrationDetailRow } from "@/lib/types/admin";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import { ControlButton } from "./ControlButton";

/**
 * The platform admin's per-integration controls (N4.5): pause or resume
 * polling, and request one full re-normalization. Each is confirmed, scoped to
 * this integration, and audited server-side. The controls never edit a
 * tenant's data.
 */
export function IntegrationControls({
  integration,
  tenantName,
}: {
  integration: AdminIntegrationDetailRow;
  tenantName: string;
}) {
  const label = INTEGRATION_PROVIDER_LABELS[integration.provider];

  if (integration.status === "disconnected") {
    return (
      <p className="text-foreground-subtle font-mono text-xs">
        Disconnected: nothing to poll or re-normalize.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {integration.pollingPausedAt ? (
        <ControlButton
          integration={integration}
          tenantName={tenantName}
          provider={label}
          action="resume_polling"
        />
      ) : (
        <ControlButton
          integration={integration}
          tenantName={tenantName}
          provider={label}
          action="pause_polling"
        />
      )}
      <ControlButton
        integration={integration}
        tenantName={tenantName}
        provider={label}
        action="request_renormalize"
        disabled={integration.renormalizeRequestedAt !== null}
        disabledLabel="Re-normalization requested"
      />
    </div>
  );
}
