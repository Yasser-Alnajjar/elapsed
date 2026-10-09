"use client";

import { Ban, ListChecks, Lock, Pencil, Plug, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { AdminPanel, AuditNotice, Fact, MonoLabel, PageHeader, Tag } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatUtcTimestamp } from "@/lib/admin-format";
import { notify } from "@/lib/notify";
import type { Tone } from "@/lib/status-styles";
import {
  BETA_ACCESS_LABELS,
  RELEASE_STAGE_LABELS,
  type AdminIntegrationAvailabilityRow,
  type AdminIntegrationsData,
  type ReleaseStage,
} from "@/lib/types/admin";
import { AllowlistDialog } from "./AllowlistDialog";
import { AvailabilityDialog } from "./AvailabilityDialog";

const CATEGORY_LABELS: Record<AdminIntegrationAvailabilityRow["category"], string> = {
  ticket_source: "Ticket source",
  work_tracker: "Work tracker",
  code_host: "Code host",
};
const CONNECTION_LABELS: Record<AdminIntegrationAvailabilityRow["connectionType"], string> = {
  oauth: "OAuth",
  api_credentials: "API credentials",
};
const STAGE_TONE: Record<ReleaseStage, Tone> = { stable: "success", beta: "primary", coming_soon: "neutral" };

/**
 * The Integration Control Center (N10, D33): each provider's platform-level
 * availability. Edits go through the audited admin API; after each one the
 * list is re-read from the server so counts and versions stay current.
 */
export function IntegrationsView({ initialData }: { initialData: AdminIntegrationsData }) {
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminIntegrationAvailabilityRow | null>(null);
  const [allowlistFor, setAllowlistFor] = useState<AdminIntegrationAvailabilityRow | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const { ok, body } = await AdminClientActions.listIntegrationAvailability().catch(() => ({
      ok: false,
      status: 0,
      body: { error: "Network error" } as AdminIntegrationsData & { error?: string },
    }));
    setRefreshing(false);
    if (!ok) {
      setLoadError(body.error ?? "The integrations could not be loaded");
      return null;
    }
    setLoadError(null);
    setData(body);
    return body;
  }, []);

  /** After a write: re-read, and keep an open allowlist dialog on the fresh row. */
  const afterChange = useCallback(async () => {
    const fresh = await refresh();
    if (fresh) setAllowlistFor((open) => (open ? (fresh.rows.find((row) => row.provider === open.provider) ?? null) : null));
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        suffix={`${data.rows.length} providers`}
        description="Turn each integration provider on or off for the whole platform, set its release stage, and choose which organizations get a Beta. Enforced by the backend on every connection, sync, webhook and import path. Nothing here deletes customer data."
        aside={
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <AuditNotice label="Platform-wide and audited">
        A change applies to the next request and the next worker run in every process. Disabling keeps every connection, credential and record; customers see
        &quot;Paused by Elapsed&quot;, not &quot;Disconnected&quot;.
      </AuditNotice>

      {loadError && (
        <AdminPanel tone="danger" className="flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
          <span className="text-foreground flex items-center gap-2 text-sm">
            <TriangleAlert className="text-error size-4" aria-hidden />
            Could not load the latest integration settings: {loadError}. What you see may be out of date.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            Try again
          </Button>
        </AdminPanel>
      )}

      {data.rows.length === 0 ? (
        <AdminPanel className="text-muted-foreground p-6 text-sm">No integration providers are registered.</AdminPanel>
      ) : (
        <div className="flex flex-col gap-4">
          {data.rows.map((row) => (
            <ProviderCard key={row.provider} row={row} onEdit={() => setEditing(row)} onAllowlist={() => setAllowlistFor(row)} />
          ))}
        </div>
      )}

      <AvailabilityDialog
        row={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={async (message) => {
          notify.success(message);
          setEditing(null);
          await afterChange();
        }}
        onStale={async (message) => {
          notify.error(message);
          setEditing(null);
          await afterChange();
        }}
      />
      <AllowlistDialog
        row={allowlistFor}
        organizations={data.organizations}
        onOpenChange={(open) => !open && setAllowlistFor(null)}
        onChanged={afterChange}
      />
    </div>
  );
}

function ProviderCard({ row, onEdit, onAllowlist }: { row: AdminIntegrationAvailabilityRow; onEdit: () => void; onAllowlist: () => void }) {
  const allowlistApplies = row.enabled && row.releaseStage === "beta" && row.betaAccess === "allowlist";
  return (
    <AdminPanel tone={row.enabled ? "neutral" : "danger"} className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Plug className="text-primary size-4" aria-hidden />
            <h2 className="text-foreground text-base font-semibold">{row.name}</h2>
            <Tag>{row.provider}</Tag>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag tone={row.enabled ? "success" : "danger"}>{row.enabled ? "Enabled" : "Disabled"}</Tag>
            <Tag tone={STAGE_TONE[row.releaseStage]}>{RELEASE_STAGE_LABELS[row.releaseStage]}</Tag>
            {row.releaseStage === "beta" && <Tag>{BETA_ACCESS_LABELS[row.betaAccess]}</Tag>}
            <Tag>{CATEGORY_LABELS[row.category]}</Tag>
            <Tag>{CONNECTION_LABELS[row.connectionType]}</Tag>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onAllowlist}>
            <ListChecks aria-hidden />
            Allowlist ({row.allowlist.length})
          </Button>
          <Button type="button" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            Edit availability
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Connections" mono>
          {row.connections}
        </Fact>
        <Fact label="Organizations" mono>
          {row.activeOrganizations}
        </Fact>
        <Fact label="Paused by policy" mono tone={row.pausedConnections > 0 ? "warning" : undefined}>
          {row.pausedConnections}
        </Fact>
        <Fact label="Health" mono>
          <span className="text-success">{row.health.healthy} ok</span> · <span className={row.health.failing ? "text-error" : undefined}>{row.health.failing} failing</span> ·{" "}
          <span className={row.health.needsAttention ? "text-warning-text" : undefined}>{row.health.needsAttention} attention</span> · {row.health.stale} stale
        </Fact>
      </dl>

      {(!row.enabled || row.releaseStage === "coming_soon") && row.statusMessage && (
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-semibold">Customer message:</span> {row.statusMessage}
        </p>
      )}
      {allowlistApplies && row.allowlist.length === 0 && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Ban className="size-3.5" aria-hidden />
          Allowlist is empty: no organization can use {row.name} right now.
        </p>
      )}
      {row.rolloutBlock && (
        <p className="border-warning/30 bg-warning/[0.07] text-muted-foreground flex items-start gap-2 rounded border px-3 py-2 text-xs leading-4">
          <Lock className="text-warning-text mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="text-foreground font-semibold">Rollout blocked ({row.rolloutBlock.id}).</span> {row.rolloutBlock.reason} Disabling, Coming soon and removing
            organizations still work.
          </span>
        </p>
      )}

      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <MonoLabel>
          {row.updatedAt ? `Updated ${formatUtcTimestamp(row.updatedAt)}${row.updatedByEmail ? ` by ${row.updatedByEmail}` : " (seeded)"}` : "Default settings, never changed"}
        </MonoLabel>
        <MonoLabel>Version {row.version}</MonoLabel>
      </div>
    </AdminPanel>
  );
}
