"use client";

import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Network,
  Radio,
  ShieldCheck,
  Webhook,
  Hourglass,
  Coins,
  ListVideo,
  Terminal,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Lock,
  ShieldAlert,
  LifeBuoy,
  MessageSquare,
  Ticket,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { PermissionDeniedMessage } from "@/components/shared/permission-denied-banner";
import { Reveal } from "@/components/shared/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  ConfigurableIntegrationProvider,
  IntegrationConnectionView,
  IntegrationsPageData,
} from "@/lib/types/integrations";
import { ZendeskConnectForm } from "./ZendeskCard";
import { JiraConnectButton } from "./JiraCard";
import { LinearConnectButton } from "./LinearCard";
import { IntercomConnectButton } from "./IntercomCard";
import { GithubConnectForm } from "./GithubCard";
import {
  SlackConnectButton,
  SlackChannelPicker,
  SlackChannelChangeButton,
} from "./SlackCard";
import { DisconnectButton } from "./DisconnectButton";
import { IntegrationConfigGate } from "./IntegrationConfigGate";
import Link from "next/link";
import { log } from "node:console";

interface IntegrationsViewProps {
  data: IntegrationsPageData;
}

const descriptionClass = "text-sm text-on-surface-variant";
const statusToneClasses = {
  success: { dot: "bg-success", text: "text-success" },
  warning: { dot: "bg-warning", text: "text-warning" },
  muted: { dot: "bg-muted-foreground/60", text: "text-on-surface-variant" },
} as const;

function StatusIndicator({
  tone,
  label,
  icon,
}: {
  tone: keyof typeof statusToneClasses;
  label: string;
  /** Replaces the status dot — e.g. the warning icon on a hover-explained status. */
  icon?: React.ReactNode;
}) {
  const { dot, text } = statusToneClasses[tone];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded px-2 py-1",
        tone === "success" ? "bg-success/10" : "bg-surface-container",
      )}
    >
      {icon ?? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dot,
            tone === "success" && "animate-pulse",
          )}
        />
      )}
      <span className={cn("font-mono text-xxs font-semibold", text)}>
        {label}
      </span>
    </span>
  );
}

/** "Access restricted" status — hovering (or tapping) it explains the warning in a popover. */
function PermissionDeniedStatus({ providerLabel }: { providerLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="cursor-help rounded"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <StatusIndicator
          tone="warning"
          label="Access restricted"
          icon={<ShieldAlert className="text-warning size-3" />}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="text-warning-text w-80 text-xs "
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <PermissionDeniedMessage provider={providerLabel} />
      </PopoverContent>
    </Popover>
  );
}

function ConnectedStatus({
  view,
  providerLabel,
}: {
  view: IntegrationConnectionView;
  providerLabel: string;
}) {
  if (view.reauthRequired) {
    return <StatusIndicator tone="warning" label="Needs reconnect" />;
  }
  if (view.permissionDenied) {
    return <PermissionDeniedStatus providerLabel={providerLabel} />;
  }
  return <StatusIndicator tone="success" label="Connected" />;
}

function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo" });
}

/**
 * Shared card shell for provider integrations — a flat single surface (no
 * header divider) so the four cards read as lightweight tiles rather than
 * boxed panels.
 */
function IntegrationCard({
  delay,
  icon,
  connected,
  title,
  subtitle,
  tag,
  badge,
  status,
  children,
}: {
  delay: number;
  icon: React.ReactNode;
  connected: boolean;
  title: string;
  subtitle: string;
  /** Uppercase category chip next to the title (TICKETS / ENGINEERING / DISPATCH). */
  tag: string;
  /** Optional label next to the title — e.g. `<Badge variant="beta">Beta</Badge>` for Intercom/GitHub (roadmap task 2.10). */
  badge?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Reveal delay={delay}>
      <Card className="bg-surface-container-low relative flex h-full flex-col gap-4 overflow-hidden rounded-xl border-0 p-6 shadow-sm">
        {/* {connected && (
          <div className="bg-tertiary absolute bottom-0 inset-s-0 top-0 w-1" />
        )} */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "bg-surface-container-highest flex size-10 shrink-0 items-center justify-center rounded",
                connected ? "text-primary" : "text-outline",
              )}
            >
              {icon}
            </span>

            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-on-surface truncate text-lg font-medium">
                  {title}
                </CardTitle>
                <span className="bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-xxs">
                  {tag}
                </span>
                {badge}
              </div>
              <p className="text-on-surface-variant truncate text-xs">
                {subtitle}
              </p>
            </div>
          </div>

          {status}
        </div>

        <div className="flex flex-1 flex-col">{children}</div>
      </Card>
    </Reveal>
  );
}

interface PulseStat {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "warning" | "primary" | "default";
}

const pulseToneClass = {
  success: "text-success",
  warning: "text-warning",
  primary: "text-primary",
  default: "text-on-surface",
} as const;

/** Design "pulse" panel: title row with a health label, then three mono stats. */
function PulsePanel({
  title,
  health,
  healthTone,
  healthIcon,
  stats,
}: {
  title: string;
  health: string;
  healthTone: "success" | "warning";
  healthIcon: React.ReactNode;
  stats: PulseStat[];
}) {
  return (
    <div className="bg-surface-container border-outline-variant/20 flex flex-col gap-2 rounded-lg border p-4">
      <div className="text-outline border-outline-variant/20 flex items-center justify-between border-b pb-1.5 font-mono text-xxs">
        <span className="uppercase tracking-wider">{title}</span>
        <span
          className={cn(
            "flex items-center gap-1 font-semibold",
            healthTone === "success" ? "text-success" : "text-warning",
          )}
        >
          {healthIcon} {health}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col">
            <span className="text-outline truncate font-mono text-xxs uppercase">
              {stat.label}
            </span>
            <span
              className={cn(
                "mt-0.5 truncate font-mono text-sm font-bold",
                pulseToneClass[stat.tone ?? "default"],
              )}
            >
              {stat.value}
            </span>
            <span className="text-on-surface-variant truncate font-mono text-xxs">
              {stat.hint}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-on-surface-variant flex flex-wrap items-center gap-1.5 text-xs">
      {children}
    </div>
  );
}

const metaChip =
  "text-primary bg-surface-container-lowest border-outline-variant/30 rounded border px-1.5 py-0.5 font-mono text-xxs";
const metaDot = <span className="text-outline">·</span>;

/**
 * A connected integration's card: meta line, optional pulse panel, and a
 * footer with Disconnect, an optional extra action and Manage. Backfill,
 * webhooks and sync health live on `/settings/integrations/[provider]`.
 */
function ConnectedCardBody({
  provider,
  providerLabel,
  connectedAt,
  disconnectHint,
  meta,
  pulse,
  extra,
}: {
  provider: "zendesk" | "jira" | "linear" | "intercom" | "github";
  providerLabel: string;
  connectedAt: Date;
  disconnectHint?: string;
  meta?: React.ReactNode;
  pulse?: React.ComponentProps<typeof PulsePanel>;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <MetaLine>
        <span className="font-mono text-xxs">
          {new Date(connectedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        {meta}
      </MetaLine>
      {pulse ? (
        <PulsePanel {...pulse} />
      ) : (
        <p className={descriptionClass}>
          Connected {formatDateTime(connectedAt)}.
          {disconnectHint && ` ${disconnectHint}`}
        </p>
      )}

      <div className="border-outline-variant/20 mt-auto flex items-center justify-between border-t pt-2">
        <DisconnectButton provider={provider} providerLabel={providerLabel} />
        <div className="flex items-center gap-1.5">
          {extra}
          <Button variant="surface" className="text-nowrap" size="sm" asChild>
            <Link href={`/settings/integrations/${provider}`}>
              Manage
              <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One integration card's static shell (icon/tone/badge) plus its fully-rendered status and body — the pieces that vary per provider. */
interface IntegrationCardConfig {
  provider: ConfigurableIntegrationProvider;
  label: string;
  subtitle: string;
  tag: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  connected: boolean;
  status: React.ReactNode;
  body: React.ReactNode;
}

export const IntegrationsView = ({ data }: IntegrationsViewProps) => {
  const {
    zendesk,
    zendeskConfig,
    jira,
    jiraConfig,
    linear,
    linearConfig,
    intercom,
    intercomConfig,
    github,
    githubConfig,
    slack,
    slackConfig,
  } = data;

  const integrations: IntegrationCardConfig[] = [
    {
      provider: "zendesk",
      label: "Zendesk",
      subtitle: "Primary helpdesk event stream",
      tag: "TICKETS",
      icon: <Ticket className="size-4" />,
      connected: zendesk.connected,
      status:
        zendeskConfig.configured &&
        (zendesk.connected ? (
          <ConnectedStatus view={zendesk} providerLabel="Zendesk" />
        ) : (
          zendesk.disconnectedAt && (
            <StatusIndicator tone="muted" label="Disconnected" />
          )
        )),
      body: (
        <IntegrationConfigGate
          provider="zendesk"
          providerLabel="Zendesk"
          config={zendeskConfig}
          descriptionClass={descriptionClass}
          helpUrl="https://support.zendesk.com/hc/en-us/articles/4408845965210-Using-OAuth-authentication-with-your-application"
          helpLabel="Get your Zendesk OAuth app credentials"
        >
          {zendesk.connected ? (
            <ConnectedCardBody
              provider="zendesk"
              providerLabel="Zendesk"
              connectedAt={zendesk.connectedAt!}
              meta={
                <>
                  {metaDot}
                  <span className={metaChip}>
                    {zendesk.subdomain ?? "dataship"}.zendesk.com
                  </span>
                  {metaDot}
                  <span className="font-mono text-xxs uppercase">
                    OAuth v2.0
                  </span>
                </>
              }
              pulse={{
                title: "Ingress runway pulse",
                health: "HEALTHY",
                healthTone: "success",
                healthIcon: <Bolt className="size-3.5" />,
                stats: [
                  {
                    label: "Last webhook",
                    value: "4s ago",
                    hint: "0x7f4c9a81",
                  },
                  {
                    label: "Sync lag",
                    value: "120ms",
                    hint: "p99 < 210ms",
                    tone: "success",
                  },
                  {
                    label: "Daily events",
                    value: "14,280",
                    hint: "+12.4% avg",
                    tone: "primary",
                  },
                ],
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                Read-only access — no tickets, comments, or fields are ever
                written back to Zendesk.
                {zendesk.disconnectedAt &&
                  ` Disconnected ${formatDateTime(zendesk.disconnectedAt)}.`}
              </p>

              <div className="mt-auto pt-6">
                <ZendeskConnectForm />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
    {
      provider: "jira",
      label: "Jira",
      subtitle: "Issue lifecycle & handoff",
      tag: "ENGINEERING",
      icon: <GitBranch className="size-4" />,
      connected: jira.connected,
      status:
        jiraConfig.configured &&
        (jira.connected ? (
          <ConnectedStatus view={jira} providerLabel="Jira" />
        ) : (
          jira.disconnectedAt && (
            <StatusIndicator tone="muted" label="Disconnected" />
          )
        )),
      body: (
        <IntegrationConfigGate
          provider="jira"
          providerLabel="Jira"
          config={jiraConfig}
          descriptionClass={descriptionClass}
          helpUrl="https://developer.atlassian.com/console/myapps/"
          helpLabel="Get your Jira OAuth app credentials"
        >
          {jira.connected ? (
            <ConnectedCardBody
              provider="jira"
              providerLabel="Jira"
              connectedAt={jira.connectedAt!}
              meta={
                <>
                  {metaDot}
                  <span className={metaChip}>
                    {jira.subdomain ?? "dataship"}.atlassian.net
                  </span>

                  {metaDot}
                  <span className="text-on-surface font-mono text-xxs">
                    12 projects
                  </span>
                </>
              }
              pulse={{
                title: "Transit reconciliation",
                health: "14 LIMBO DETECTED",
                healthTone: "warning",
                healthIcon: <TriangleAlert className="size-3.5" />,
                stats: [
                  { label: "Last poll", value: "28s ago", hint: "Changelog" },
                  {
                    label: "Limbo issues",
                    value: "14 active",
                    hint: "Unassigned",
                    tone: "warning",
                  },
                  {
                    label: "Webhook status",
                    value: "Healthy",
                    hint: "RFC-822",
                    tone: "success",
                  },
                ],
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                Read-only access — no issues, comments, or fields are ever
                written back to Jira.
                {jira.disconnectedAt &&
                  ` Disconnected ${formatDateTime(jira.disconnectedAt)}.`}
              </p>

              <div className="mt-auto pt-6">
                <JiraConnectButton />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
    {
      provider: "linear",
      label: "Linear",
      subtitle: "Alternative engineering-leg source",
      tag: "ENGINEERING",
      icon: <Workflow className="size-4" />,
      connected: linear.connected,
      status:
        linearConfig.configured &&
        (linear.connected ? (
          <ConnectedStatus view={linear} providerLabel="Linear" />
        ) : (
          linear.disconnectedAt && (
            <StatusIndicator tone="muted" label="Disconnected" />
          )
        )),
      body: (
        <IntegrationConfigGate
          provider="linear"
          providerLabel="Linear"
          config={linearConfig}
          descriptionClass={descriptionClass}
          helpUrl="https://linear.app/settings/api"
          helpLabel="Get your Linear OAuth app credentials"
        >
          {linear.connected ? (
            <ConnectedCardBody
              provider="linear"
              providerLabel="Linear"
              connectedAt={linear.connectedAt!}
              meta={
                <>
                  {metaDot}
                  <span className={metaChip}>
                    linear.app/{linear.subdomain ?? "dataship"}
                  </span>
                  {metaDot}
                  <span className="font-mono text-xxs uppercase">
                    OAuth v2.0
                  </span>
                </>
              }
              pulse={{
                title: "Engineering leg pulse",
                health: "HEALTHY",
                healthTone: "success",
                healthIcon: <Bolt className="size-3.5" />,
                stats: [
                  {
                    label: "Last webhook",
                    value: "9s ago",
                    hint: "Issue update",
                  },
                  {
                    label: "Sync lag",
                    value: "180ms",
                    hint: "p99 < 320ms",
                    tone: "success",
                  },
                  {
                    label: "Daily events",
                    value: "3,640",
                    hint: "+6.1% avg",
                    tone: "primary",
                  },
                ],
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                Read-only access — no issues, comments, or fields are ever
                written back to Linear. An alternative engineering-leg source
                alongside Jira, not a replacement.
                {linear.disconnectedAt &&
                  ` Disconnected ${formatDateTime(linear.disconnectedAt)}.`}
              </p>

              <div className="mt-auto pt-6">
                <LinearConnectButton />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
    {
      provider: "intercom",
      label: "Intercom",
      subtitle: "Alternative helpdesk event stream",
      tag: "TICKETS",
      icon: <LifeBuoy className="size-4" />,
      badge: <Badge variant="beta">Beta</Badge>,
      connected: intercom.connected,
      status:
        intercomConfig.configured &&
        (intercom.connected ? (
          <ConnectedStatus view={intercom} providerLabel="Intercom" />
        ) : (
          intercom.disconnectedAt && (
            <StatusIndicator tone="muted" label="Disconnected" />
          )
        )),
      body: (
        <IntegrationConfigGate
          provider="intercom"
          providerLabel="Intercom"
          config={intercomConfig}
          descriptionClass={descriptionClass}
          helpUrl="https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth?utm_source=chatgpt.com"
          helpLabel="Get your Intercom OAuth app credentials"
        >
          {intercom.connected ? (
            <ConnectedCardBody
              provider="intercom"
              providerLabel="Intercom"
              connectedAt={intercom.connectedAt!}
              meta={
                <>
                  {metaDot}
                  <span className={metaChip}>
                    {intercom.subdomain
                      ? `app.intercom.com/a/apps/${intercom.subdomain}`
                      : "app.intercom.com"}
                  </span>
                  {metaDot}
                  <span className="font-mono text-xxs uppercase">
                    OAuth v2.0
                  </span>
                </>
              }
              pulse={{
                title: "Ingress runway pulse",
                health: "HEALTHY",
                healthTone: "success",
                healthIcon: <Bolt className="size-3.5" />,
                stats: [
                  {
                    label: "Last webhook",
                    value: "6s ago",
                    hint: "Conversation",
                  },
                  {
                    label: "Sync lag",
                    value: "140ms",
                    hint: "p99 < 260ms",
                    tone: "success",
                  },
                  {
                    label: "Daily events",
                    value: "5,120",
                    hint: "+8.7% avg",
                    tone: "primary",
                  },
                ],
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                Read-only access — no conversations, contacts, or fields are
                ever written back to Intercom. An alternative ticket source
                alongside Zendesk, not a replacement.
                {intercom.disconnectedAt &&
                  ` Disconnected ${formatDateTime(intercom.disconnectedAt)}.`}
              </p>

              <div className="mt-auto pt-6">
                <IntercomConnectButton />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
    {
      provider: "github",
      label: "GitHub",
      subtitle: "Pull request lifecycle",
      tag: "ENGINEERING",
      icon: <GitPullRequest className="size-4" />,
      badge: <Badge variant="beta">Beta</Badge>,
      connected: github.connected,
      status:
        githubConfig.configured &&
        (github.connected ? (
          <ConnectedStatus view={github} providerLabel="GitHub" />
        ) : (
          github.disconnectedAt && (
            <StatusIndicator tone="muted" label="Disconnected" />
          )
        )),
      body: (
        <IntegrationConfigGate
          provider="github"
          providerLabel="GitHub"
          config={githubConfig}
          descriptionClass={descriptionClass}
          helpUrl="/docs/integrations/github#create-github-app"
          helpLabel="Create your read-only GitHub App"
        >
          {github.connected ? (
            <ConnectedCardBody
              provider="github"
              providerLabel="GitHub"
              connectedAt={github.connectedAt!}
              meta={
                <>
                  {metaDot}
                  <span className={metaChip}>
                    {github.subdomain
                      ? `github.com/${github.subdomain}`
                      : "github.com"}
                  </span>
                  {metaDot}
                  <span className="font-mono text-xxs uppercase">
                    GitHub App
                  </span>
                </>
              }
              pulse={{
                title: "Pull request pulse",
                health: "HEALTHY",
                healthTone: "success",
                healthIcon: <Bolt className="size-3.5" />,
                stats: [
                  {
                    label: "Last webhook",
                    value: "12s ago",
                    hint: "Pull request",
                  },
                  {
                    label: "Sync lag",
                    value: "160ms",
                    hint: "p99 < 290ms",
                    tone: "success",
                  },
                  {
                    label: "Daily events",
                    value: "2,310",
                    hint: "+4.3% avg",
                    tone: "primary",
                  },
                ],
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                Read-only access — no pull requests, reviews, or code are ever
                written back to GitHub. An engineering-leg source alongside
                Jira/Linear, correlated through whichever issue a pull request
                already references.
                {github.disconnectedAt &&
                  ` Disconnected ${formatDateTime(github.disconnectedAt)}.`}
              </p>

              <div className="mt-auto pt-6">
                <GithubConnectForm />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
    {
      provider: "slack",
      label: "Slack",
      subtitle: "Real-time at-risk & breach alerts",
      tag: "DISPATCH",
      icon: <MessageSquare className="size-4" />,
      connected: slack.connected,
      status: slackConfig.configured && slack.connected && (
        <StatusIndicator tone="success" label="Connected" />
      ),
      body: (
        <IntegrationConfigGate
          provider="slack"
          providerLabel="Slack"
          config={slackConfig}
          descriptionClass={descriptionClass}
          helpUrl="https://api.slack.com/apps"
          helpLabel="Get your Slack app credentials"
        >
          {slack.connected ? (
            <div className="flex flex-1 flex-col gap-4">
              <MetaLine>
                <span className="text-on-surface-variant">Workspace:</span>
                <span className="bg-surface-container border-outline-variant/30 text-on-surface rounded border px-1.5 py-0.5 font-mono text-xxs font-medium">
                  {slack.teamName}
                </span>
                <span className="text-outline font-mono text-xxs">
                  ({formatDateTime(slack.installedAt!)})
                </span>
              </MetaLine>

              <div className="bg-surface-container border-outline-variant/20 flex flex-col gap-2 rounded-lg border p-4">
                <div className="text-outline border-outline-variant/20 flex items-center justify-between border-b pb-1.5 font-mono text-xxs">
                  <span className="uppercase tracking-wider">
                    Dispatch destinations
                  </span>
                  <span className="text-success font-semibold">
                    {slack.channelId ? "1 BOUND" : "0 BOUND"}
                  </span>
                </div>
                {slack.channelId && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="bg-surface-container-lowest text-outline border-outline-variant/30 flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xxs">
                      <span className="text-outline">#</span>
                      {slack.channelName}
                      <span className="bg-success ms-1 size-1.5 rounded-full" />
                    </span>
                  </div>
                )}
                <p className="text-on-surface-variant line-clamp-2 text-xs">
                  Critical SLA runway warnings under 4h are routed with
                  high-priority countdown thread cards.
                </p>
              </div>

              <div className="border-outline-variant/20 mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <DisconnectButton provider="slack" providerLabel="Slack" />
                {slack.channelId ? (
                  <SlackChannelChangeButton />
                ) : (
                  <SlackChannelPicker />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <p className={descriptionClass}>
                The only alert channel in v1. Posts when a commitment crosses a
                warning threshold or breaches.
              </p>

              <div className="mt-auto pt-6">
                <SlackConnectButton />
              </div>
            </div>
          )}
        </IntegrationConfigGate>
      ),
    },
  ];
  const all = [zendesk, jira, linear, intercom, github, slack];
  const connectedCount = all.filter((v) => v.connected).length;

  const metrics = [
    {
      label: "Streaming ingress",
      value: `${connectedCount} Connectors`,
      hint: "100% deterministic SLA fidelity",
      hintTone: "text-success",
      icon: <Radio className="text-success size-4" />,
      tone: "text-on-surface",
    },
    {
      label: "24h event ingestion",
      value: "41,894 evts",
      hint: "Mean transit lag: 142ms",
      hintTone: "text-on-surface-variant",
      icon: <Coins className="text-primary size-4" />,
      tone: "text-on-surface",
    },
    {
      label: "Unattributed limbo",
      value: "14 Issues",
      hint: "Jira handoff gap > 30m",
      hintTone: "text-on-surface-variant",
      icon: <Hourglass className="text-warning size-4" />,
      tone: "text-warning",
    },
    {
      label: "Encrypted at rest",
      value: "AES-256-GCM",
      hint: "Rotated automatically 6h ago",
      hintTone: "text-on-surface-variant",
      icon: <ShieldCheck className="text-secondary size-4" />,
      tone: "text-on-surface",
    },
  ];

  const principles = [
    {
      title: "Wall-Clock Immutability",
      body: "Elapsed records absolute timestamps at the exact instant an external webhook is received. Timelines do not rely on malleable third-party update fields.",
    },
    {
      title: "Non-Attributive Leg Tracking",
      body: 'Time elapsed is calculated per operational leg ("Engineering Leg", "Support Leg") rather than individual agent names, prioritizing root bottlenecks over friction.',
    },
    {
      title: "Zero Payload Persistence",
      body: "Ticket comment text, customer email strings, and attachment blobs are stripped immediately at the edge. Only cryptographic event hashes are indexed.",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb / guardrail meta bar */}
      <div className="bg-surface-container-low flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-1.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="text-primary size-4" />
          <span className="text-outline font-mono text-xxs uppercase">
            INGESTION_CONTROLLER // PIPELINE_TOPOLOGY
          </span>
          <span className="text-outline font-mono text-xs">/</span>
          <span className="text-primary truncate font-mono text-xs">
            v2-deterministic-clock
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="bg-surface-container flex items-center gap-1.5 rounded px-1.5 py-0.5">
            <span className="bg-success size-1.5 animate-pulse rounded-full" />
            <span className="text-success font-mono text-xxs">
              INGRESS RUNWAYS SYNCHRONIZED
            </span>
          </div>
          <span className="text-outline hidden font-mono text-xs sm:inline">
            POLL_INTERVAL: 1000ms
          </span>
        </div>
      </div>

      {/* Header panel */}
      <section className="bg-surface-container-low border-outline-variant/20 flex flex-col gap-4 rounded-xl border p-6 shadow-md">
        <div className="border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-outline font-mono text-xxs font-semibold uppercase tracking-widest">
              Data ingestion pipelines
            </span>
            <span className="bg-surface-container border-outline-variant/30 text-secondary rounded border px-2 py-0.5 font-mono text-xxs">
              MUTATION LOCK: ACTIVE
            </span>
          </div>
        </div>
        <div className="max-w-4xl space-y-1">
          <h2 className="text-on-surface font-display text-xl font-semibold tracking-tight">
            Ticket &amp; Issue Integrations — Available Providers (
            {connectedCount} Active)
          </h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Bi-directional read-only streams synchronizing helpdesk ticket
            events and engineering issues into continuous customer wall-clock
            timelines.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="bg-primary/70 size-2 rounded-full" />
            <span className="text-on-surface-variant text-xs">
              Role Context:{" "}
              <strong className="text-on-surface font-medium">
                Organization Owner
              </strong>{" "}
              (Full pipeline configuration &amp; ingestion scope privileges)
            </span>
          </div>
        </div>
      </section>

      {/* Metrics strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="bg-surface-container-low flex flex-col gap-1 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-outline font-mono text-xxs uppercase">
                {metric.label}
              </span>
              {metric.icon}
            </div>
            <span
              className={cn(
                "truncate font-mono text-lg font-bold tracking-tight",
                metric.tone,
              )}
            >
              {metric.value}
            </span>
            <span className={cn("truncate text-xs", metric.hintTone)}>
              {metric.hint}
            </span>
          </div>
        ))}
      </div>

      {/* Integration cards */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 md:grid-cols-2">
        {integrations.map((integration, index) => (
          <IntegrationCard
            key={integration.provider}
            delay={index * 0.05}
            icon={integration.icon}
            connected={integration.connected}
            title={integration.label}
            subtitle={integration.subtitle}
            tag={integration.tag}
            badge={integration.badge}
            status={integration.status}
          >
            {integration.body}
          </IntegrationCard>
        ))}
      </div>

      {/* Security principles */}
      <section className="bg-surface-container-low flex flex-col gap-4 rounded-xl p-6 shadow-md">
        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="bg-surface-container text-primary flex size-8 items-center justify-center rounded">
              <ShieldCheck className="size-4" />
            </span>
            <div className="flex flex-col">
              <h3 className="text-on-surface font-display text-lg font-semibold">
                Deterministic Timeline Security Principles
              </h3>
              <span className="text-outline font-mono text-xxs uppercase">
                Cryptographic read integrity without message content ingestion
              </span>
            </div>
          </div>
          <span className="text-success bg-success/10 rounded px-2 py-1 font-mono text-xxs">
            SOC-2 TYPE II AUDITED
          </span>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-4 pt-2 md:grid-cols-3">
          {principles.map((principle, index) => (
            <div
              key={principle.title}
              className="bg-surface-container border-outline-variant/20 flex h-full flex-col gap-1 rounded-lg border p-4"
            >
              <span className="text-on-surface font-mono text-sm font-bold">
                <span className="text-primary">0{index + 1}.</span>{" "}
                {principle.title}
              </span>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                {principle.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom helper note */}
      <div className="bg-surface-container-low border-outline-variant/20 flex flex-col items-center justify-between gap-4 rounded-xl border px-6 py-4 shadow-sm sm:flex-row">
        <span className="text-on-surface-variant flex items-center gap-2 text-sm">
          <Webhook className="text-primary size-5 shrink-0" />
          <span>
            Looking for custom internal webhooks? Visit the{" "}
            <strong className="text-on-surface font-medium">
              Alert Studio
            </strong>{" "}
            in Notifications to build customized webhook schemas and telemetry
            consumers.
          </span>
        </span>
        <Button variant="surface" size="sm" className="text-secondary" asChild>
          <Link href="/settings/notifications">
            Go to Alert Studio
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
