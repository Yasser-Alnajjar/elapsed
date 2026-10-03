"use client";

import { useEffect, useRef, useState } from "react";
import { Actions } from "@/actions/client";
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
import type {
  ConciergeExportPageData,
  ConciergeExportSummary,
} from "@/lib/types/concierge-export";

export interface CompletedExport {
  summary: ConciergeExportSummary;
  url: string;
}

function revoke(ref: { current: string | null }) {
  if (ref.current) URL.revokeObjectURL(ref.current);
  ref.current = null;
}

/**
 * The export page's state machine: organization → integration selection
 * (loading an organization's integrations on demand), the export request,
 * and the downloadable ZIP's object URL, revoked whenever it is replaced
 * or the page unmounts.
 */
export function useConciergeExport(data: ConciergeExportPageData) {
  const { provider } = data;
  const copy = CONCIERGE_PROVIDER_COPY[provider];
  const [selection, setSelection] = useState<ConciergeExportSelection>(() =>
    initialSelection(data),
  );
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

    const result = await Actions.Concierge.listIntegrations(
      provider,
      organizationId,
    );
    // Applied to the latest state: a reply for an organization that's no longer selected is dropped.
    setSelection((current) =>
      result.ok && result.integrations
        ? integrationsLoaded(current, organizationId, result.integrations)
        : integrationsFailed(
            current,
            organizationId,
            result.error ?? `Failed to load ${copy.label} integrations`,
          ),
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

  return {
    selection,
    exporting,
    exportError,
    completed,
    request: exportRequest(selection),
    handleOrganizationChange,
    handleIntegrationChange,
    handleExport,
  };
}
