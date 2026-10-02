"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileArchive,
  GitBranch,
  GitPullRequest,
  History,
  Info,
  KeyRound,
  LifeBuoy,
  Link2,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  Webhook as WebhookIcon,
  Workflow,
  ArrowRightLeft,
  Server,
} from "lucide-react";
import type { ReactNode } from "react";
import { PermissionDeniedBanner } from "@/components/shared/permission-denied-banner";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { CONCIERGE_PROVIDER_COPY } from "@/lib/concierge-providers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  INTEGRATION_PROVIDER_LABELS,
  type IntegrationDetailData,
} from "@/lib/types/integrations";
import { cn, Utils } from "@/lib/utils";
import { ZendeskBackfillButton } from "../../integrations/csr/ZendeskCard";
import { JiraBackfillButton } from "../../integrations/csr/JiraCard";
import { LinearBackfillButton } from "../../integrations/csr/LinearCard";
import { IntercomBackfillButton } from "../../integrations/csr/IntercomCard";
import { GithubBackfillButton } from "../../integrations/csr/GithubCard";
import { DisconnectButton } from "../../integrations/csr/DisconnectButton";
import type { ConciergeSourceProvider } from "@/lib/types/concierge-export";
import { WebhookInfo } from "../../integrations/csr/WebhookInfo";
import Link from "next/link";

const PROVIDER_ICONS: Record<IntegrationDetailData["provider"], ReactNode> = {
  zendesk: <Ticket className="size-4" />,
  jira: <GitBranch className="size-4" />,
  linear: <Workflow className="size-4" />,
  intercom: <LifeBuoy className="size-4" />,
  github: <GitPullRequest className="size-4" />,
};

const iconWrapper =
  "flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary";

const descriptionClass = "text-sm text-on-surface-variant";

const labelClass =
  "font-mono text-xxs font-semibold uppercase tracking-wider text-outline";

const panelClass = "bg-surface-container flex flex-col gap-2 rounded-lg p-4";

function StatusPill({
  tone,
  children,
  pulse,
}: {
  tone: "success" | "warning";
  children: ReactNode;
  pulse?: boolean;
}) {
  const text = tone === "success" ? "text-tertiary" : "text-error";
  const dot = tone === "success" ? "bg-tertiary" : "bg-error";
  return (
    <span
      className={cn(
        "bg-surface-container-low inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xxs font-semibold uppercase tracking-wide shadow-sm",
        text,
      )}
    >
      <span
        className={cn("size-2 rounded-full", dot, pulse && "animate-pulse")}
      />
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "warning";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <span
        className={cn(
          "truncate font-mono text-sm font-semibold",
          tone === "success"
            ? "text-tertiary"
            : tone === "warning"
              ? "text-error"
              : "text-on-surface",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="bg-surface-container-low overflow-hidden rounded-xl border-0 shadow-sm">
      <CardHeader className="p-6 pb-0">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className={iconWrapper}>{icon}</span>
            <div>
              <CardTitle className="text-on-surface text-xl font-semibold tracking-tight">
                {title}
              </CardTitle>
              <p className="mt-1 text-xs text-on-surface-variant">
                {description}
              </p>
            </div>
          </div>
          {badge}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-6 pt-4">
        {children}
      </CardContent>
    </Card>
  );
}

function SectionBadge({
  tone = "success",
  icon,
  children,
}: {
  tone?: "success" | "warning" | "primary";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "bg-surface-container inline-flex items-center gap-1.5 self-start rounded px-3 py-1 font-mono text-xxs font-semibold uppercase sm:self-auto",
        tone === "success" && "text-tertiary",
        tone === "warning" && "text-error",
        tone === "primary" && "text-primary",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

interface IntegrationDetailViewProps {
  data: IntegrationDetailData;
}

export function IntegrationDetailView({ data }: IntegrationDetailViewProps) {
  const {
    provider,
    integrationId,
    connectedAt,
    reauthRequired,
    permissionDenied,
    lastSyncAt,
    lastSyncError,
    lastSuccessfulSyncAt,
    consecutiveFailures,
    failingSince,
    lastSyncDurationMs,
    backfillCompletedAt,
    webhookSecret,
    webhooks: hasWebhook,
    subdomain,
    repo,
  } = data;

  const label = INTEGRATION_PROVIDER_LABELS[provider];
  const unhealthy = reauthRequired || permissionDenied || !!lastSyncError;

  /** Where an admin manages this provider's OAuth app / developer account — shown always, not just while unconfigured, so it's easy to find again later. */
  const PROVIDER_APP_URLS: Record<IntegrationDetailData["provider"], string> = {
    zendesk: `https://${subdomain}.zendesk.com`,
    jira: `https://${subdomain}.atlassian.net/jira`,
    linear: "https://linear.app",
    intercom: "https://intercom.com",
    github: repo ? `https://github.com/${repo}` : "https://github.com",
  };

  const target =
    provider === "zendesk" && subdomain
      ? `${subdomain}.zendesk.com`
      : provider === "github" && repo
        ? repo
        : `${label} workspace`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="w-full flex flex-wrap items-center justify-between gap-4 bg-surface-container-low px-6 py-2 rounded-xl">
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-primary transition-colors hover:text-primary-fixed"
        >
          <ArrowLeft className="size-4" />
          Back to Integrations
        </Link>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className={labelClass}>Ingress ID:</span>
          <span className="bg-surface-container text-on-surface max-w-56 truncate rounded px-2 py-0.5 font-mono text-xs">
            {integrationId}
          </span>
        </div>
      </div>

      <Reveal>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className={iconWrapper}>{PROVIDER_ICONS[provider]}</span>
              <h1 className="font-display text-on-surface text-3xl font-semibold tracking-tight">
                {label}
              </h1>
            </div>
            <p className={descriptionClass}>
              Connected {Utils.formatDateTimeV2(connectedAt)} via read-only
              access
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              tone={reauthRequired || permissionDenied ? "warning" : "success"}
              pulse={!reauthRequired && !permissionDenied}
            >
              {reauthRequired
                ? "Needs reconnect"
                : permissionDenied
                  ? "Access restricted"
                  : "Connected"}
            </StatusPill>
            <span className="bg-surface-container text-on-surface-variant inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xxs font-semibold uppercase tracking-wider shadow-sm">
              <ShieldCheck className="size-3.5" />
              Read-only ingestion
            </span>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.03}>
        <Card className="bg-surface-container-low flex flex-col gap-4 rounded-xl border-0 p-6 shadow-md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className={labelClass}>
                {provider === "github" ? "Repository" : "Target"}
              </span>
              <span className="text-on-surface flex items-center gap-2 font-mono text-sm">
                <Server className="size-4 shrink-0 text-primary" />
                <span className="truncate">{target}</span>
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={labelClass}>Connection established</span>
              <span className="text-on-surface flex items-center gap-2 font-mono text-sm">
                <Clock className="size-4 shrink-0 text-on-surface-variant" />
                {Utils.formatDateTimeV2(connectedAt)}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={labelClass}>Ingestion mode</span>
              <span className="flex items-center gap-2 font-mono text-sm text-tertiary">
                <ShieldCheck className="size-4 shrink-0" />
                Strict read-only
                <span className="text-xs text-on-surface-variant">
                  (zero write tokens)
                </span>
              </span>
            </div>
          </div>

          <div className="bg-surface-container grid grid-cols-2 gap-4 rounded-lg p-4 lg:grid-cols-4">
            <Stat
              label="Last sync"
              value={lastSyncAt ? Utils.formatDateTimeV2(lastSyncAt) : "Never"}
            />
            <Stat
              label="Last sync result"
              value={!lastSyncAt ? "—" : lastSyncError ? "Failed" : "Succeeded"}
              tone={
                !lastSyncAt ? undefined : lastSyncError ? "warning" : "success"
              }
            />
            <Stat label="Last successful sync" value={lastSuccessfulSyncAt ? Utils.formatDateTimeV2(lastSuccessfulSyncAt) : "Never"} />
            <Stat label="Failing since" value={failingSince ? Utils.formatDateTimeV2(failingSince) : "—"} tone={failingSince ? "warning" : undefined} />
            <Stat label="Consecutive failures" value={String(consecutiveFailures)} tone={consecutiveFailures ? "warning" : undefined} />
            <Stat label="Latest sync duration" value={lastSyncDurationMs === null ? "—" : `${lastSyncDurationMs} ms`} />
            <Stat
              label="90-day backfill"
              value={backfillCompletedAt ? "Completed" : "Not run"}
              tone={backfillCompletedAt ? "success" : undefined}
            />
            <Stat
              label="Webhook"
              value={
                !hasWebhook
                  ? "Polling only"
                  : webhookSecret
                    ? "Configured"
                    : "Unavailable"
              }
              tone={hasWebhook && webhookSecret ? "success" : undefined}
            />
          </div>
        </Card>
      </Reveal>
      <Reveal delay={0.05}>
        <SectionCard
          icon={<History className="size-4" />}
          title="Historical backfill & calibration"
          description="Import the last 90 days of data"
          badge={
            <SectionBadge
              tone={backfillCompletedAt ? "success" : "primary"}
              icon={
                backfillCompletedAt ? (
                  <CheckCircle2 className="size-3.5" />
                ) : undefined
              }
            >
              {backfillCompletedAt ? "Completed" : "Pending"}
            </SectionBadge>
          }
        >
          {backfillCompletedAt && (
            <div className={panelClass}>
              <span className={labelClass}>Baseline ingestion cycle</span>
              <span className="text-on-surface font-mono text-sm font-semibold">
                Finished {Utils.formatDateTimeV2(backfillCompletedAt)}
              </span>
            </div>
          )}

          <div className="bg-surface-container flex flex-col gap-4 rounded-lg p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-3xl items-start gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-xs text-on-surface-variant">
                <strong className="text-on-surface font-medium">
                  Backfill data is immutable.
                </strong>{" "}
                Re-running evaluates any unlinked records without modifying the
                established baseline.
              </p>
            </div>

            <div className="min-w-0 shrink-0">
              {provider === "zendesk" && (
                <ZendeskBackfillButton
                  subdomain={subdomain ?? ""}
                  initialReauthRequired={reauthRequired}
                />
              )}

              {provider === "jira" && (
                <JiraBackfillButton initialReauthRequired={reauthRequired} />
              )}

              {provider === "linear" && (
                <LinearBackfillButton initialReauthRequired={reauthRequired} />
              )}

              {provider === "intercom" && (
                <IntercomBackfillButton
                  initialReauthRequired={reauthRequired}
                />
              )}

              {provider === "github" && (
                <GithubBackfillButton
                  repo={repo ?? ""}
                  initialReauthRequired={reauthRequired}
                />
              )}
            </div>
          </div>
        </SectionCard>
      </Reveal>
      <Reveal delay={0.1}>
        <SectionCard
          icon={<ArrowRightLeft className="size-4" />}
          title="Sync health & connection state"
          description="Continuous polling and token lifecycle verification"
          badge={
            <SectionBadge tone={unhealthy ? "warning" : "success"}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  unhealthy ? "bg-error" : "bg-tertiary",
                )}
              />
              {unhealthy ? "Needs attention" : "Healthy"}
            </SectionBadge>
          }
        >
          {permissionDenied && !reauthRequired && (
            <PermissionDeniedBanner provider={label} />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={panelClass}>
              <span className={labelClass}>Last ingress cycle</span>
              <span className="text-primary font-mono text-sm font-semibold">
                {lastSyncAt
                  ? Utils.formatDateTimeV2(lastSyncAt)
                  : "No sync attempt yet"}
              </span>
              <p className={descriptionClass}>
                {backfillCompletedAt
                  ? `90-day backfill complete as of ${Utils.formatDateTimeV2(
                      backfillCompletedAt,
                    )}.`
                  : "No backfill run yet."}
              </p>
            </div>

            <div className={panelClass}>
              <span className={labelClass}>Diagnostic log</span>
              <div className="bg-surface-container-highest flex items-start gap-3 rounded p-3">
                {lastSyncError ? (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tertiary" />
                )}
                <span className="wrap-break-word font-mono text-xs text-on-surface">
                  {lastSyncError
                    ? lastSyncError
                    : lastSyncAt
                      ? "Last sync succeeded. No errors recorded."
                      : "Waiting for the first sync."}
                </span>
              </div>
            </div>
          </div>

          <div className={panelClass}>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              <span className="text-on-surface font-mono text-sm font-medium">
                {provider === "github" ? "Access" : "OAuth 2.0"} authorization
              </span>
            </div>
            <div className="flex items-start gap-2 rounded bg-surface-container-highest p-3">
              <ShieldCheck
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  reauthRequired || permissionDenied
                    ? "text-error"
                    : "text-tertiary",
                )}
              />
              <span className={descriptionClass}>
                {reauthRequired
                  ? "Authorization expired or was revoked — reconnect to resume syncing."
                  : permissionDenied
                    ? "The token works, but the connecting user lost access on the provider side."
                    : "Authorization healthy. No re-authentication needed."}
              </span>
            </div>
          </div>
        </SectionCard>
      </Reveal>

      {hasWebhook && (
        <Reveal delay={0.15}>
          <SectionCard
            icon={<FileArchive className="size-4" />}
            title="Concierge export"
            description={`${label} data for the Concierge SLA analysis`}
          >
            <div className="bg-surface-container flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
              <p className={descriptionClass}>
                {provider === "jira"
                  ? "Download issues and their status history from Jira's changelog as CSVs."
                  : "Download tickets and their status changes from Zendesk's ticket audits as CSVs."}
              </p>
              <Button
                variant="surface"
                size="sm"
                className="text-nowrap"
                asChild
              >
                <Link href={CONCIERGE_PROVIDER_COPY[provider as ConciergeSourceProvider].exportHref}>
                  Open export
                  <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </SectionCard>
        </Reveal>
      )}

      {hasWebhook && (
        <Reveal delay={0.2}>
          <SectionCard
            icon={<WebhookIcon className="size-4" />}
            title="Real-time webhooks & ingress gateway"
            description="Close the gap between polls"
            badge={
              <SectionBadge tone={webhookSecret ? "success" : "warning"}>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    webhookSecret ? "animate-pulse bg-tertiary" : "bg-error",
                  )}
                />
                {webhookSecret ? "Active listening" : "Unavailable"}
              </SectionBadge>
            }
          >
            <WebhookInfo
              provider={provider}
              integrationId={integrationId}
              webhookSecret={webhookSecret}
            />
          </SectionCard>
        </Reveal>
      )}

      <Reveal delay={0.25}>
        <SectionCard
          icon={<Link2 className="size-4" />}
          title="Provider app & governance"
          description={`${label} integration settings and mutation safety covenant`}
          badge={
            <SectionBadge
              tone="primary"
              icon={<ShieldCheck className="size-3.5" />}
            >
              External registered
            </SectionBadge>
          }
        >
          <div className="bg-surface-container flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-1">
              <span className={labelClass}>{label} console</span>
              <span className="text-on-surface font-mono text-sm font-medium">
                Manage the OAuth app and access in {label}
              </span>
            </div>
            <Button variant="surface" size="sm" className="self-start" asChild>
              <a
                href={PROVIDER_APP_URLS[provider]}
                target="_blank"
                rel="noreferrer"
              >
                Open {label}
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>

          <div className="bg-surface-container flex items-start gap-3 rounded-lg p-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-tertiary/10 text-tertiary">
              <ShieldCheck className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xxs font-semibold uppercase text-tertiary">
                Zero write-back guarantee
              </span>
              <p className="text-xs leading-relaxed text-on-surface-variant">
                Elapsed does not request or store write credentials. Everything
                in your {label} instance remains strictly immutable — events are
                ingested passively via read-only access.
              </p>
            </div>
          </div>

          <div className="bg-error-container/10 flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xxs font-semibold uppercase text-error">
                Integration severing control
              </span>
              <p className="text-xs text-on-surface-variant">
                Disconnecting halts all ingestion from {label}. Existing cases
                and history remain unchanged.
              </p>
            </div>
            <DisconnectButton provider={provider} providerLabel={label} />
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
