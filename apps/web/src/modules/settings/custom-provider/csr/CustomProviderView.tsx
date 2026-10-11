"use client";

import {
  History,
  Plug,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Actions } from "@/actions/client";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { ReleaseStageBadge } from "@/components/shared/release-stage";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATE_COPY } from "@/lib/custom-provider/state-copy";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { formatLongDateTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import type {
  CustomProviderPageData,
  DraftView,
} from "@/lib/types/custom-provider";
import { ConfigWizard } from "./ConfigWizard";
import { DeleteConfigurationDialog } from "./DeleteConfigurationDialog";
import { DisconnectDialog } from "./DisconnectDialog";
import { LimitationsNotice } from "./LimitationsNotice";
import { OverridePanel } from "./OverridePanel";
import { ReconnectPanel } from "./ReconnectPanel";
import { FailedTickets, RunHistory, SyncFreshness } from "./RunHistory";
import { SyncStateBanner } from "./SyncStateBanner";
import { VersionList } from "./VersionList";

const card =
  "bg-surface-container-low flex flex-col gap-4 rounded-xl p-5 shadow-soft";
const cardTitle =
  "text-on-surface flex items-center gap-2 text-base font-semibold";
const caption =
  "text-on-surface-variant font-mono text-[10px] font-semibold uppercase tracking-wider";

const TONE_DOT = {
  neutral: "bg-primary",
  success: "bg-success",
  error: "bg-error",
} as const;

/**
 * Custom REST (N9): the guided connection for a helpdesk Elapsed has no
 * adapter for. Read-only against your system; credentials encrypted and never
 * shown again. Members can read the state; only the owner can change anything.
 */
export function CustomProviderView({ data }: { data: CustomProviderPageData }) {
  const [editing, setEditing] = useState(false);
  const [seed, setSeed] = useState<DraftView | null>(null);
  const { status } = data;

  if (!data.enabled && !status.connected) {
    return (
      <div className="flex flex-col gap-4">
        <Header data={data} />
        <Alert>
          {data.unavailableMessage ?? "Custom REST is not enabled for your organization."}
          {data.betaRestricted ? " Contact support to request access." : ""}
        </Alert>
      </div>
    );
  }

  const showConfig = data.isOwner && data.enabled;
  const draft = seed ?? data.draft;
  // Disconnecting keeps the configuration; only "Delete configuration" removes it.
  const kept = !status.connected && status.versions.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Header data={data} />
      <SyncStateBanner status={status} />
      {status.connected && <LimitationsNotice slaSupport={status.slaSupport} />}
      <OverridePanel status={status} isOwner={data.isOwner} />

      {status.connected && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
            <FailedTickets status={status} />
            <section className={card} aria-labelledby="cp-runs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="cp-runs" className={cardTitle}>
                  <RefreshCw className="text-primary size-5" />
                  Syncs
                </h2>
              </div>
              <SyncFreshness status={status} />
              <RunHistory status={status} />
            </section>
          </div>
          <section
            className={`${card} min-w-0 xl:col-span-4 h-fit`}
            aria-labelledby="cp-versions"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="cp-versions" className={cardTitle}>
                <History className="text-primary size-5" />
                Configuration versions
              </h2>
              <span className="bg-surface-raised text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-[10px]">
                Max 20
              </span>
            </div>
            <VersionList status={status} isOwner={data.isOwner} />
            <p className="bg-surface-raised text-on-surface-variant flex items-start gap-2 rounded-lg p-3 text-xs">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              Versions are immutable. Rolling back shows what it would change
              before anything is applied.
            </p>
          </section>
        </div>
      )}

      {showConfig && kept && (
        <section className={card} aria-labelledby="cp-kept">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex max-w-2xl flex-col gap-1">
              <h2 id="cp-kept" className={cardTitle}>
                <History className="text-primary size-5" />
                Disconnected: your configuration is kept
              </h2>
              <p className="text-on-surface-variant text-sm">
                Syncing is stopped, the credentials were cleared and your
                data is hidden, not deleted. Enter the credentials again to
                reconnect on the last active version below: nothing is
                activated and no version is created. Deleting the
                configuration removes only the configuration and versions,
                never your cases, events or SLAs.
              </p>
            </div>
            <DeleteConfigurationDialog />
          </div>
          <VersionList status={status} isOwner={false} />
          {status.reconnect ? (
            <ReconnectPanel
              version={status.reconnect.version}
              secretFields={status.reconnect.secretFields}
            />
          ) : (
            <Alert>
              The last active configuration could not be read, so it cannot be
              reconnected. Delete the configuration and set it up again; your
              stored data is kept.
            </Alert>
          )}
        </section>
      )}

      {showConfig && !kept && (
        <section className={`${card} gap-6 p-6`} aria-labelledby="cp-config">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="cp-config"
                  className="text-on-surface text-2xl font-semibold tracking-tight"
                >
                  {status.connected
                    ? "Change the configuration"
                    : "Connect your helpdesk"}
                </h2>
                {draft && (editing || !status.connected) && (
                  <Badge variant="primary">Draft</Badge>
                )}
              </div>
              <p className="text-on-surface-variant max-w-3xl text-sm">
                Describe where your API is, which fields hold the ticket data
                and how replies are told apart. Nothing changes for your
                organization until you activate.
              </p>
            </div>
            {status.connected && !editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={async () => {
                  const result = await Actions.CustomProvider.editFromActive();
                  if (result.ok && result.body.draft) {
                    setSeed(result.body.draft);
                    setEditing(true);
                  } else {
                    notify.error(
                      "The configuration could not be opened for editing.",
                    );
                  }
                }}
              >
                Edit (creates a new version)
              </Button>
            )}
          </div>
          {(!status.connected || editing) && (
            <ConfigWizard
              key={seed?.expiresAt ?? "new"}
              initial={draft}
              secretsSet={draft?.secretsSet ?? []}
              userId={data.userId}
            />
          )}
        </section>
      )}

      {showConfig && status.connected && (
        <section
          className="bg-error-container flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="cp-disconnect"
        >
          <div className="flex max-w-2xl flex-col gap-1">
            <h2
              id="cp-disconnect"
              className="text-error flex items-center gap-2 text-base font-semibold"
            >
              <TriangleAlert className="size-5" />
              Disconnect Custom REST
            </h2>
            <p className="text-error-foreground text-sm">
              Syncing stops. Your existing data and configuration versions are
              kept.
            </p>
          </div>
          <DisconnectDialog />
        </section>
      )}
    </div>
  );
}

/** Breadcrumb, identity card with the live sync state, and the role strip. */
function Header({ data }: { data: CustomProviderPageData }) {
  const { status } = data;
  const timeZone = useOrgTimezone();
  const copy =
    status.connected && status.state ? STATE_COPY[status.state] : null;
  const checked = status.lastSuccessfulSyncAt
    ? formatLongDateTime(new Date(status.lastSuccessfulSyncAt), timeZone)
    : "Not checked yet";

  return (
    <header className="flex flex-col gap-4">
      <nav
        aria-label="Breadcrumb"
        className="text-on-surface-variant flex items-center gap-1.5 font-mono text-xs"
      >
        <span>Settings</span>
        <span className="opacity-50">/</span>
        <Link href="/settings/integrations" className="hover:text-on-surface">
          Integrations
        </Link>
        <span className="opacity-50">/</span>
        <span className="text-primary font-semibold">Custom REST</span>
      </nav>

      <div className="bg-surface flex flex-col gap-4 rounded-xl p-6 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="bg-surface-raised text-primary flex size-12 shrink-0 items-center justify-center rounded-lg">
              <Plug className="size-6" />
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-on-surface text-2xl font-semibold tracking-tight">
                  Custom REST
                </h1>
                <ReleaseStageBadge stage={data.releaseStage} />
                {copy && (
                  <span className="bg-surface-raised text-on-surface flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium">
                    <span
                      className={`size-1.5 rounded-full ${TONE_DOT[copy.tone]}`}
                    />
                    {copy.title}
                  </span>
                )}
              </div>
              <p className="text-on-surface-variant max-w-2xl text-sm">
                Connect a helpdesk through its read-only JSON API. Elapsed only
                reads; nothing is ever written back.
              </p>
            </div>
          </div>

          {status.connected && (
            <dl className="bg-surface-container-lowest flex flex-wrap gap-1.5 self-start rounded-lg p-1.5 lg:self-auto">
              <Metric
                label="Active version"
                value={
                  status.activeVersion !== null
                    ? `v${status.activeVersion}`
                    : "—"
                }
                accent
              />
              <Metric label="Last checked" value={checked} />
            </dl>
          )}
        </div>

        <div className="bg-surface-raised text-on-surface-variant flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-xs">
          <span className="flex items-center gap-2">
            <UserCog className="text-primary size-4" />
            <span className="text-on-surface font-medium">
              {data.isOwner ? "Role: Organization owner" : "Role: Member"}
            </span>
            <span className="opacity-50">·</span>
            <span>
              {data.isOwner
                ? "You can change the configuration, roll back and enter credentials."
                : "You can read the state; only the organization owner can change anything."}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface-raised flex flex-col rounded px-4 py-1.5">
      <dt className={caption}>{label}</dt>
      <dd
        className={`font-mono text-sm font-semibold ${accent ? "text-primary" : "text-on-surface"}`}
      >
        {value}
      </dd>
    </div>
  );
}
