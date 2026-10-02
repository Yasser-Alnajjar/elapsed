"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlarmClockCheck,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  Headset,
  Hourglass,
  ListChecks,
  Lock,
  LockKeyhole,
  Megaphone,
  Network,
  Sparkles,
  Ticket,
  TrendingUp,
  UserPlus,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Actions } from "@/actions/client";
import { formatMinutes } from "@/lib/format";
import { deriveOnboardingProgress, providerStatus } from "@/lib/onboarding-progress";
import type { ActivationPageData } from "@/lib/types/onboarding";
import type { FindingsData } from "@/lib/types/findings";

import { AtRiskSnapshotTable } from "@modules/dashboard/dashboard/csr/AtRiskSnapshotTable";
import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

const DESCRIPTION_CLASS = "font-body-sm text-body-sm text-on-surface-variant";

/** Engine-state status chip — ported from the onboarding flow's own header aside. */
function EngineStateChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-container-low p-3 shadow-sm">
      <div className="flex flex-col text-end">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
          {label}
        </span>
        <span className="font-mono-metric-md text-mono-metric-md text-tertiary">
          {value}
        </span>
      </div>
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
        <Network className="size-5 shrink-0" />
      </div>
    </div>
  );
}

interface CompletedStep {
  number: string;
  label: string;
  detail: string;
  /** A step that was optional and skipped, shown as open instead of done. Defaults to done. */
  pending?: boolean;
}

/** The 4-step completion strip. Steps 1, 2 and 4 are always done by the time this screen renders (`getActivationData` redirects back to `/onboarding` otherwise); step 3, the work tracker, is optional and shows as open without one (N5.2). */
function CompletionStrip({ steps }: { steps: CompletedStep[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.number}
            className={`flex items-start gap-3 rounded-lg p-3.5 ${
              isLast
                ? "bg-tertiary/10 shadow-[0_0_15px_color-mix(in_srgb,var(--success)_12%,transparent)]"
                : "bg-surface-container-low"
            }`}
          >
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                step.pending
                  ? "bg-surface-container-high text-on-surface-variant"
                  : isLast
                    ? "bg-tertiary text-on-tertiary"
                    : "bg-tertiary/20 text-tertiary"
              }`}
            >
              {step.pending ? (
                <span className="size-1.5 rounded-full bg-current" />
              ) : (
                <Check className="size-3.5 shrink-0" />
              )}
            </div>
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm font-medium text-on-surface-variant">
                {step.number}
              </span>
              <div className="font-headline-sm truncate text-[13px] font-semibold text-on-surface">
                {step.label}
              </div>
              <div className="font-code-audit text-code-audit mt-0.5 text-on-surface-variant/80">
                {step.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The mockup's "Setup Progress" wizard bar: an ambient-glow card wrapping the
 * step grid, with a "Step 4 of 4" pill and a live-tracking pulse badge — the
 * same "live telemetry" idiom `OnboardingHeader` already uses elsewhere.
 */
function SetupProgressBar({ steps }: { steps: CompletedStep[] }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 size-80 rounded-full bg-tertiary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BadgeCheck className="size-[22px] shrink-0" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
                  Setup progress
                </span>
                <span className="font-label-caps text-label-caps rounded bg-tertiary/10 px-2 py-0.5 uppercase text-tertiary">
                  Step 4 of 4
                </span>
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Zero-config onboarding &amp; verification complete
              </h2>
            </div>
          </div>

          <div className="inline-flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-1.5 shadow-inner">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-tertiary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-tertiary" />
            </span>
            <span className="font-code-audit text-code-audit font-semibold uppercase tracking-wider text-tertiary">
              Live tracking active
            </span>
          </div>
        </div>

        <CompletionStrip steps={steps} />
      </div>
    </div>
  );
}

interface HealthCardProps {
  icon: LucideIcon;
  label: string;
  status: string;
  statusTone: "good" | "warn";
  value: string;
  valueUnit?: string;
  description: string;
  footer: { label: string; value: string }[];
}

/** One tile of the pre-flight health matrix — real per-channel status, no invented precision. */
function HealthCard({
  icon: Icon,
  label,
  status,
  statusTone,
  value,
  valueUnit,
  description,
  footer,
}: HealthCardProps) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Icon className="size-[18px] text-primary shrink-0" />
            <span className="font-label-caps text-label-caps uppercase tracking-wider">
              {label}
            </span>
          </div>
          <span
            className={`font-label-caps text-label-caps rounded px-2 py-0.5 uppercase ${
              statusTone === "good"
                ? "bg-tertiary/10 text-tertiary"
                : "bg-primary/10 text-primary"
            }`}
          >
            {status}
          </span>
        </div>
        <div className="space-y-1">
          <div className="font-mono-metric-lg text-mono-metric-lg text-on-surface">
            {value}{" "}
            {valueUnit && (
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                {valueUnit}
              </span>
            )}
          </div>
          <p className={DESCRIPTION_CLASS}>{description}</p>
        </div>
      </div>
      <div className="-mx-5 -mb-5 space-y-1.5 rounded-b-xl bg-surface-container-lowest/60 p-4">
        {footer.map((row) => (
          <div
            key={row.label}
            className="font-code-audit text-code-audit flex justify-between"
          >
            <span className="text-on-surface-variant">{row.label}</span>
            <span className="text-on-surface">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown wherever engineering time would be, until a tracker is connected: a neutral "not yet", never a zero presented as a fact (N5.2). */
function NoTrackerNotice({ description }: { description: string }) {
  return (
    <EmptyState
      icon={Workflow}
      title="Engineering time appears once a tracker is connected"
      description={description}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/integrations">Connect a work tracker</Link>
        </Button>
      }
    />
  );
}

/** What the 90-day backfill actually found — folded in from the old standalone "findings" page instead of a second screen. */
function FindingsSection({
  findings,
  trackerLabel,
}: {
  findings: FindingsData;
  /** Null without a connected tracker: escalations cannot be counted yet. */
  trackerLabel: string | null;
}) {
  if (trackerLabel === null) {
    return (
      <NoTrackerNotice description="Support-side commitments are tracked already. Connect Jira, Linear or another tracker to see which tickets were escalated and how long they waited in engineering." />
    );
  }

  const hasFindings = findings.totalEscalated > 0;

  if (!hasFindings) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No escalations yet"
        description={`No tickets have been escalated to ${trackerLabel} in the last ${findings.periodDays} days. Once cases escalate and issues get linked, findings will appear here automatically — nothing to configure.`}
      />
    );
  }

  return (
    <div className="space-y-5 rounded-xl bg-surface-container p-6 shadow-elevated">
      <p className="font-body-md text-body-md text-on-surface">
        Over the last {findings.periodDays} days,{" "}
        <strong className="text-primary">{findings.totalEscalated}</strong>{" "}
        ticket{findings.totalEscalated === 1 ? " was" : "s were"} escalated to{" "}
        {trackerLabel}. <strong className="text-error">{findings.exceededTarget}</strong>{" "}
        of {findings.exceededTarget === 1 ? "it" : "them"} exceeded{" "}
        {findings.exceededTarget === 1 ? "its" : "their"} customer resolution
        target.
        {findings.avgEngineeringMinutes !== null && (
          <>
            {" "}
            Escalated tickets spent an average of{" "}
            <strong>
              {formatMinutes(findings.avgEngineeringMinutes)}
            </strong>{" "}
            waiting to be picked up in {trackerLabel}.
          </>
        )}
      </p>

      {findings.topAccounts.length > 0 && (
        <div>
          <h3 className="font-label-caps text-label-caps mb-3 uppercase tracking-wider text-on-surface-variant">
            Top affected accounts
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Escalations</TableHead>
                <TableHead>Exceeded target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.topAccounts.map((account) => (
                <TableRow key={account.customerName}>
                  <TableCell className="font-medium">
                    {account.customerName}
                  </TableCell>
                  <TableCell>{account.escalatedCases}</TableCell>
                  <TableCell>{account.breachedCases}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Compact invite form — same `Actions.Invitations.invite` the Settings → Members page uses, styled for this screen instead of duplicating logic. */
function InviteTeammateBox() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();
  const [submitting, setSubmitting] = useState(false);

  async function handleInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setStatus(undefined);

    const { ok, body } = await Actions.Invitations.invite(trimmed);

    setSubmitting(false);

    if (!ok) {
      setStatus({
        type: "error",
        message: body.error ?? "Failed to send invitation",
      });
      return;
    }

    setEmail("");
    setStatus({
      type: "success",
      message: body.resent ? "Invitation resent." : "Invitation sent.",
    });
  }

  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <UserPlus className="size-[18px] shrink-0" />
          <span className="font-label-caps text-label-caps uppercase tracking-wider">
            Recommended next step
          </span>
        </div>
        <h4 className="font-headline-sm text-headline-sm text-on-surface">
          Align engineering &amp; support leads
        </h4>
        <p className={DESCRIPTION_CLASS}>
          Invite your engineering and support leads so both teams share the same
          live SLA runway view.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInvite();
            }}
            placeholder="colleague@company.com"
            disabled={submitting}
            className="bg-surface-container-low"
          />
          <Button
            type="button"
            size="sm"
            variant="tonal"
            disabled={submitting || !email.trim()}
            onClick={() => void handleInvite()}
            className="shrink-0"
          >
            {submitting ? "Sending…" : "Invite"}
          </Button>
        </div>
        {status && (
          <p
            className={`font-body-sm text-body-sm ${
              status.type === "success" ? "text-tertiary" : "text-error"
            }`}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

export function ActivationView({ data }: { data: ActivationPageData }) {
  const {
    status,
    atRiskPreview,
    atRiskTotal,
    slackConnected,
    emailConfigured,
    importedPolicyCount,
    findings,
  } = data;

  // Names the ticket source and tracker that are actually connected. The
  // tracker is optional (N5.2): without one, engineering time is "not yet".
  const { ticketSource, tracker } = deriveOnboardingProgress(status);
  const source = ticketSource ? providerStatus(status, ticketSource) : null;
  const trackerStatus = tracker ? providerStatus(status, tracker) : null;
  const sourceLabel = source?.label ?? "Your helpdesk";
  const trackerLabel = trackerStatus?.label ?? null;
  const ticketNoun = source ? providerPresentation(source.provider).caseNoun : "tickets";

  const overflowCount = Math.max(0, atRiskTotal - atRiskPreview.length);

  return (
    <OnboardingShell
      title="Activation"
      currentStep={4}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value="TRACKING_LIVE" />
      }
    >
      <Reveal>
        <SetupProgressBar
          steps={[
            {
              number: "01",
              label: `${sourceLabel} workspace`,
              detail: `${status.ticketsFetched.toLocaleString()} ${ticketNoun} ingested`,
            },
            {
              number: "02",
              label: "90d Baseline Data",
              detail: `${status.ticketsFetched.toLocaleString()} ${ticketNoun} verified`,
            },
            trackerLabel !== null
              ? {
                  number: "03",
                  label: trackerLabel,
                  detail: `${status.linkedIssues.toLocaleString()} issue keys paired`,
                }
              : {
                  number: "03",
                  label: "Work tracker",
                  detail: "Optional — not connected yet",
                  pending: true,
                },
            {
              number: "04",
              label: "Live SLA",
              detail: "Continuous tracking active",
            },
          ]}
        />
      </Reveal>

      <Reveal>
        <div className="relative overflow-hidden rounded-xl bg-surface-container shadow-2xl">
          <div className="h-1 w-full bg-gradient-to-r from-primary via-tertiary to-primary" />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 inset-e-0 size-72 rounded-full bg-primary/10 blur-3xl"
          />

          <div className="relative flex flex-col gap-6 p-6 md:p-8 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-2xl space-y-4">
              <span className="font-label-caps text-label-caps inline-flex items-center gap-1.5 rounded bg-primary/10 px-2.5 py-1 uppercase text-primary">
                <LockKeyhole className="size-4 shrink-0" />
                Deterministic verification pass
              </span>
              <h1 className="font-headline-lg text-headline-lg leading-tight text-on-surface">
                Zero-config setup complete —{" "}
                <span className="text-primary">live SLA tracking</span> is
                online
              </h1>
              <p className={`${DESCRIPTION_CLASS} max-w-xl`}>
                {trackerLabel !== null
                  ? `${sourceLabel} and ${trackerLabel} are deterministically paired. The continuous customer SLA clock is running across every open commitment, including handoffs between support and engineering.`
                  : `${sourceLabel} is connected and the customer SLA clock is running across every open commitment. Engineering time appears once a tracker is connected.`}
              </p>
              <div className="font-label-caps text-label-caps flex flex-wrap items-center gap-6 pt-1 text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <Ticket className="size-4 text-primary shrink-0" />
                  <span>
                    {ticketNoun.charAt(0).toUpperCase() + ticketNoun.slice(1)}{" "}
                    ingested:{" "}
                    <strong className="font-mono-metric-md text-mono-metric-md text-on-surface">
                      {status.ticketsFetched.toLocaleString()}
                    </strong>
                  </span>
                </div>
                {trackerLabel !== null && (
                  <div className="flex items-center gap-2">
                    <Workflow className="size-4 text-primary shrink-0" />
                    <span>
                      Escalated to {trackerLabel}:{" "}
                      <strong className="font-mono-metric-md text-mono-metric-md text-on-surface">
                        {status.escalatedCases.toLocaleString()}
                      </strong>
                    </span>
                  </div>
                )}
                {trackerLabel !== null && status.linkedIssues > 0 && (
                  <div className="flex items-center gap-2">
                    <Network className="size-4 text-tertiary shrink-0" />
                    <span>
                      Linked issues:{" "}
                      <strong className="font-mono-metric-md text-mono-metric-md text-on-surface">
                        {status.linkedIssues.toLocaleString()}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:flex-col">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Launch live operations dashboard
                  <ArrowRight className="size-[18px] shrink-0" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings/integrations">
                  Confirm SLA policies &amp; connect Slack
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-[18px] text-on-surface-variant shrink-0" />
            <h3 className="font-label-caps text-label-caps uppercase tracking-wide text-on-surface-variant">
              What the 90-day backfill found
            </h3>
          </div>
          <FindingsSection findings={findings} trackerLabel={trackerLabel} />
        </div>
      </Reveal>

      <Reveal>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ListChecks className="size-[18px] text-on-surface-variant shrink-0" />
            <h3 className="font-label-caps text-label-caps uppercase tracking-wide text-on-surface-variant">
              Pre-flight synchronization &amp; health matrix
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <HealthCard
              icon={Headset}
              label={`${sourceLabel} feed`}
              status="Healthy"
              statusTone="good"
              value={status.ticketsFetched.toLocaleString()}
              valueUnit={ticketNoun}
              description={`Historical ${ticketNoun} indexed`}
              footer={[{ label: "Sync mode", value: "Read-only, incremental" }]}
            />

            {trackerLabel !== null ? (
              <HealthCard
                icon={Workflow}
                label={`${trackerLabel} tracker`}
                status="Active"
                statusTone="good"
                value={status.linkedIssues.toLocaleString()}
                valueUnit="issues linked"
                description={
                  status.escalatedCases > 0
                    ? `${status.escalatedCases.toLocaleString()} escalated case${status.escalatedCases === 1 ? "" : "s"} linked`
                    : `No cases escalated to ${trackerLabel} yet`
                }
                footer={[
                  {
                    label: "Escalated cases",
                    value: status.escalatedCases.toLocaleString(),
                  },
                ]}
              />
            ) : (
              <HealthCard
                icon={Workflow}
                label="Work tracker"
                status="Not connected"
                statusTone="warn"
                value="—"
                description="Engineering time appears once a tracker is connected"
                footer={[{ label: "Escalated cases", value: "Not measured" }]}
              />
            )}

            <HealthCard
              icon={AlarmClockCheck}
              label="Clock daemon"
              status="Synchronized"
              statusTone="good"
              value="Continuous"
              description="Wall-clock SLA tracking across support and engineering handoffs"
              footer={[
                {
                  label: "SLA policies imported",
                  value: importedPolicyCount.toLocaleString(),
                },
              ]}
            />

            <HealthCard
              icon={Megaphone}
              label="Escalation channels"
              status={
                slackConnected || emailConfigured ? "Configured" : "Not set up"
              }
              statusTone={slackConnected || emailConfigured ? "good" : "warn"}
              value={[slackConnected, emailConfigured]
                .filter(Boolean)
                .length.toString()}
              valueUnit="of 2 wired"
              description="Slack and email alerts fire on warning/breach"
              footer={[
                {
                  label: "Slack",
                  value: slackConnected ? "Connected" : "Not connected",
                },
                {
                  label: "Email (SMTP)",
                  value: emailConfigured ? "Configured" : "Not configured",
                },
              ]}
            />
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="overflow-hidden rounded-xl bg-surface-container shadow-elevated">
          <div className="flex flex-col gap-3 bg-surface-container-low p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-error" />
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  Live operations dashboard preview
                </h3>
              </div>
              <p className={DESCRIPTION_CLASS}>
                Open commitments currently consuming SLA runway right now.
              </p>
            </div>
            {atRiskTotal > 0 && (
              <span className="font-code-audit text-code-audit rounded bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                {atRiskTotal} open commitment{atRiskTotal === 1 ? "" : "s"} at
                risk or breached
              </span>
            )}
          </div>

          {atRiskPreview.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={CheckCircle2}
                title="Nothing at risk right now"
                description="No open commitment is currently at risk or breached."
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <AtRiskSnapshotTable
                  rows={atRiskPreview}
                  engineeringMeasured={trackerLabel !== null}
                />
              </div>
              {overflowCount > 0 && (
                <div className="border-t border-outline-variant/20 px-5 py-3">
                  <Link
                    href="/at-risk"
                    className="font-body-sm text-body-sm text-primary hover:underline"
                  >
                    +{overflowCount} more open commitment
                    {overflowCount === 1 ? "" : "s"} — view all
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <div className="flex h-full flex-col gap-4 rounded-xl bg-surface-container p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
                What Elapsed guarantees from here
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex items-start gap-2.5 rounded-lg bg-surface-container-low p-3">
                <Lock className="mt-0.5 size-[18px] text-primary shrink-0" />
                <div className="text-xs">
                  <div className="font-medium text-on-surface">
                    Zero mutation
                  </div>
                  <div className={DESCRIPTION_CLASS}>
                    Read-only access — nothing is ever written back to{" "}
                    {sourceLabel}
                    {trackerLabel !== null ? ` or ${trackerLabel}` : ""}.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-surface-container-low p-3">
                <Network className="mt-0.5 size-[18px] text-primary shrink-0" />
                <div className="text-xs">
                  <div className="font-medium text-on-surface">
                    Deterministic correlation
                  </div>
                  <div className={DESCRIPTION_CLASS}>
                    Cases are matched via official issue links only — never
                    fuzzy guesswork.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-surface-container-low p-3">
                <Hourglass className="mt-0.5 size-[18px] text-primary shrink-0" />
                <div className="text-xs">
                  <div className="font-medium text-on-surface">
                    Continuous SLA clock
                  </div>
                  <div className={DESCRIPTION_CLASS}>
                    The clock keeps running across support and engineering
                    handoffs.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal>
          <InviteTeammateBox />
        </Reveal>
      </div>
      <Reveal>
        <div className="flex flex-col items-center justify-between gap-3 rounded-lg bg-surface-container-lowest p-4 text-center sm:flex-row sm:text-start">
          <div className="font-code-audit text-code-audit flex flex-wrap items-center justify-center gap-3 text-on-surface-variant sm:justify-start">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-tertiary" />
              <span className="font-semibold text-on-surface">
                Elapsed — live SLA engine
              </span>
            </span>
            <span className="text-on-surface-variant/40">|</span>
            <span>Read-only by design</span>
          </div>
          <div className="font-code-audit text-code-audit text-on-surface-variant">
            Zero mutation · Deterministic correlation · Continuous clock
          </div>
        </div>
      </Reveal>
    </OnboardingShell>
  );
}
