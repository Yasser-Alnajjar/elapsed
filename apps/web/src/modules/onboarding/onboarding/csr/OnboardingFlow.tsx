"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Icon } from "@/components/shared/material-icon";
import { Button } from "@/components/ui/button";
import type { OnboardingStatus } from "@/lib/types/onboarding";

import { IntegrationConfigGate } from "@modules/settings/integrations/csr/IntegrationConfigGate";
import { JiraConnectButton } from "@modules/settings/integrations/csr/JiraCard";
import { LinearConnectButton } from "@modules/settings/integrations/csr/LinearCard";
import { GithubConnectForm } from "@modules/settings/integrations/csr/GithubCard";
import { ZendeskConnectForm } from "@modules/settings/integrations/csr/ZendeskCard";

import { OnboardingProgress } from "./OnboardingProgress";
import { useOnboardingBackfill } from "./useOnboardingBackfill";

const DESCRIPTION_CLASS = "font-body-sm text-body-sm text-on-surface-variant";
const REVIEWED_POLICIES_KEY = "onboarding:reviewedPolicies";

interface ConnectorHeaderProps {
  iconName: string;
  name: string;
  badge: string;
  tagline: string;
}

/** Icon + name + connector badge above a provider's connect form — ported from the mockups' connector card header. */
function ConnectorHeader({
  iconName,
  name,
  badge,
  tagline,
}: ConnectorHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
        <Icon name={iconName} />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-headline-md text-headline-md text-on-surface">
            {name}
          </span>
          <span className="font-label-caps text-label-caps rounded bg-primary/10 px-1.5 py-0.5 uppercase text-primary">
            {badge}
          </span>
        </div>
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {tagline}
        </span>
      </div>
    </div>
  );
}

/** Read-only OAuth scope banner with the pill list from the mockups' "Permission Scope Banner". */
function ScopeBanner({ label, scopes }: { label: string; scopes: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <Icon
          name="verified_user"
          className="text-[18px] shrink-0 text-tertiary"
        />
        <span className="font-body-sm text-body-sm">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {scopes.map((scope) => (
          <span
            key={scope}
            className="font-code-audit text-code-audit rounded bg-surface-container-high px-1.5 py-0.5 text-primary"
          >
            {scope}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Engine-state status chip shown next to the step title — the mockups' "Engine State" readout. */
function EngineStateChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-container-low p-3 shadow-sm">
      <div className="flex flex-col text-right">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
          {label}
        </span>
        <span className="font-mono-metric-md text-mono-metric-md text-tertiary">
          {value}
        </span>
      </div>
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
        <Icon name="hub" className="text-[20px]" />
      </div>
    </div>
  );
}

interface StatItem {
  label: string;
  value: string;
  unit: string;
}

/** Fixed-fact backfill specs — the mockups' inline metric strip, kept to claims the product actually guarantees. */
function StatStrip({ stats }: { stats: StatItem[] }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low p-3.5">
      <div className="flex items-center gap-4">
        {stats.map((stat, index) => (
          <div key={stat.label} className="flex items-center gap-4">
            {index > 0 && (
              <div className="hidden h-8 w-px bg-outline-variant/30 sm:block" />
            )}
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                {stat.label}
              </span>
              <span className="font-mono-metric-lg text-mono-metric-lg text-on-surface">
                {stat.value}{" "}
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {stat.unit}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <span className="font-code-audit text-code-audit hidden rounded bg-tertiary-container/10 px-2 py-1 text-tertiary sm:inline">
        REST + INCREMENTAL API
      </span>
    </div>
  );
}

/** Secondary, not-yet-available connector — the mockups' "Intercom (Beta)" card, kept static since there's nothing to wire up yet. */
function SecondaryProviderCard({
  iconName,
  name,
  badge,
  tagline,
}: {
  iconName: string;
  name: string;
  badge: string;
  tagline: string;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl bg-surface-container-low p-5 opacity-85 transition-opacity hover:opacity-100 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-on-surface-variant">
          <Icon name={iconName} className="text-[20px]" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm text-on-surface">
              {name}
            </span>
            <span className="font-label-caps text-label-caps rounded bg-secondary-container/40 px-1.5 py-0.5 uppercase text-on-secondary-container">
              {badge}
            </span>
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {tagline}
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" disabled>
        Coming soon
      </Button>
    </div>
  );
}

interface AlternativeTrackerCardProps {
  provider: "linear" | "github";
  iconName: string;
  name: string;
  tagline: string;
  config: OnboardingStatus["linearConfig"];
  descriptionText: string;
  helpUrl: string;
  helpLabel: string;
  connectAction: ReactNode;
}

/** A real, working alternative engineering-leg connector (Linear/GitHub) — gated the same way as Jira/Zendesk, not a "coming soon" placeholder. */
function AlternativeTrackerCard({
  provider,
  iconName,
  name,
  tagline,
  config,
  descriptionText,
  helpUrl,
  helpLabel,
  connectAction,
}: AlternativeTrackerCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
          <Icon name={iconName} className="text-[20px]" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm text-on-surface">
              {name}
            </span>
            <span className="font-label-caps text-label-caps rounded bg-secondary-container/40 px-1.5 py-0.5 uppercase text-on-secondary-container">
              Beta
            </span>
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {tagline}
          </span>
        </div>
      </div>

      <IntegrationConfigGate
        provider={provider}
        providerLabel={name}
        config={config}
        descriptionClass="font-body-sm text-body-sm text-on-surface-variant"
        helpUrl={helpUrl}
        helpLabel={helpLabel}
      >
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {descriptionText}
          </p>
          {connectAction}
        </div>
      </IntegrationConfigGate>
    </div>
  );
}

/** Right-column "what's ahead" panel shown during Stage 02 backfill — the mockups' "Next Step Connection" card, without inventing numbers that don't exist yet. */
function NextStepPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
          System reconciliation
        </span>
        <Icon name="account_tree" className="text-primary" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">
          Next: connect engineering
        </h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          The SLA clock keeps running when a case moves into engineering.
          Connecting Jira next links each escalated ticket to its issue so that
          time is never silently dropped.
        </p>
      </div>
      <span className="font-label-caps text-label-caps self-start rounded bg-primary-container/20 px-1.5 py-0.5 uppercase text-primary">
        Ready in step 3
      </span>
    </div>
  );
}

/** Right-column panel for Stage 03 — the mockups' "Continuous Timeline Engine" panel, kept to the two guarantees the product actually makes. */
function CorrelationPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
          Continuous timeline engine
        </span>
        <Icon name="route" className="text-primary" />
      </div>

      <div className="flex gap-2.5 rounded-lg bg-surface-container p-3">
        <Icon
          name="verified_user"
          className="text-[16px] shrink-0 text-primary"
        />
        <div className="flex flex-col gap-0.5">
          <span className="font-headline-sm text-[14px] leading-tight text-on-surface">
            Zero mutation guarantee
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Elapsed requests strictly read-only authorization — it can&apos;t
            edit issues, add comments, or transition workflows.
          </p>
        </div>
      </div>

      <div className="flex gap-2.5 rounded-lg bg-surface-container p-3">
        <Icon name="hub" className="text-[16px] shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-headline-sm text-[14px] leading-tight text-on-surface">
              Deterministic correlation
            </span>
            <span className="font-label-caps text-label-caps rounded bg-tertiary/10 px-1 py-0.5 uppercase text-tertiary">
              Zero guessing
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Tickets are matched strictly via official remote issue links and
            issue keys — never fuzzy guesswork or synthetic estimation.
          </p>
        </div>
      </div>
    </div>
  );
}

/** SOC2 trust micro-badge under the trust rail. */
function Soc2Badge() {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3.5 py-2.5 text-on-surface-variant">
      <div className="flex items-center gap-2">
        <Icon name="check_circle" className="text-[16px] text-tertiary" />
        <span className="font-body-sm text-body-sm">
          SOC 2 Type II–aligned architecture
        </span>
      </div>
      <span className="font-code-audit text-code-audit text-on-surface-variant/60">
        Read-only by design
      </span>
    </div>
  );
}

interface TrustItem {
  iconName: string;
  title: string;
  description: string;
}

/** Trust rail under a connector's form — the mockups' "Engine Safety & Trust Contract" panel, with copy that matches what the product actually does. */
function TrustList({ items }: { items: TrustItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map(({ iconName, title, description }) => (
        <div
          key={title}
          className="flex gap-2.5 rounded-lg bg-surface-container-low p-3"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
            <Icon name={iconName} className="text-[16px]" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-headline-sm text-[15px] leading-tight text-on-surface">
              {title}
            </span>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectorCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-xl bg-surface-container p-6 shadow-elevated">
      {children}
    </div>
  );
}

interface OnboardingFlowProps {
  initialStatus: OnboardingStatus;
  zendeskSubdomain: string | null;
}

export function OnboardingFlow({
  initialStatus,
  zendeskSubdomain,
}: OnboardingFlowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { status, error, zendeskRunning, jiraRunning, refresh } =
    useOnboardingBackfill({
      status: initialStatus,
    });

  const consumedConnectedParam = useRef(false);

  useEffect(() => {
    const connected = searchParams.get("connected");

    if (!connected || consumedConnectedParam.current) {
      return;
    }

    consumedConnectedParam.current = true;

    void refresh();
    router.replace("/onboarding");
  }, [searchParams, refresh, router]);

  const [reviewedPolicies, setReviewedPolicies] = useState(false);

  useEffect(() => {
    setReviewedPolicies(
      window.sessionStorage.getItem(REVIEWED_POLICIES_KEY) === "true",
    );
  }, []);

  const consumedReviewedParam = useRef(false);

  useEffect(() => {
    const reviewed = searchParams.get("reviewed");

    if (!reviewed || consumedReviewedParam.current) {
      return;
    }

    consumedReviewedParam.current = true;

    window.sessionStorage.setItem(REVIEWED_POLICIES_KEY, "true");
    setReviewedPolicies(true);
    router.replace("/onboarding");
  }, [searchParams, router]);

  const onboardingComplete =
    status.zendesk.connected &&
    status.zendesk.backfillComplete &&
    status.jira.connected;

  const readyToReviewPolicies =
    status.zendesk.connected && status.zendesk.backfillComplete;

  const readyToConnectJira =
    readyToReviewPolicies && (reviewedPolicies || status.jira.connected);

  const currentStep: 1 | 2 | 3 | null = !status.zendesk.connected
    ? 1
    : !readyToConnectJira
      ? 2
      : !status.jira.connected
        ? 3
        : null;

  useEffect(() => {
    if (!onboardingComplete) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.push("/onboarding/activation");
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [router, onboardingComplete]);

  if (!status.zendesk.connected) {
    return (
      <OnboardingShell
        title="Connect your support helpdesk in 30 seconds"
        description="Elapsed ingests read-only ticket timestamps to uncover unmonitored SLA time. Zero write access, zero agent plugins, zero workflow changes required."
        currentStep={currentStep}
        wide
        headerAside={
          <EngineStateChip
            label="Engine state"
            value="AWAITING_INGESTION_SRC"
          />
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <Reveal>
              <ConnectorCard>
                <div className="flex items-start justify-between gap-3">
                  <ConnectorHeader
                    iconName="confirmation_number"
                    name="Zendesk Support"
                    badge="Primary connector"
                    tagline="Ticket timestamps, SLA policies, and organizations"
                  />
                </div>

                <ScopeBanner
                  label="Read-only scopes enforced:"
                  scopes={["tickets:read", "users:read", "audit_logs:read"]}
                />

                <IntegrationConfigGate
                  provider="zendesk"
                  providerLabel="Zendesk"
                  config={status.zendeskConfig}
                  descriptionClass={DESCRIPTION_CLASS}
                  onConfigured={refresh}
                >
                  <p className={DESCRIPTION_CLASS}>
                    Connect Zendesk to pull your last 90 days of tickets, SLA
                    policies, and organizations — read-only, one click.
                  </p>

                  <div className="mt-4">
                    <ZendeskConnectForm />
                  </div>
                </IntegrationConfigGate>

                <StatStrip
                  stats={[
                    {
                      label: "Backfill horizon",
                      value: "90",
                      unit: "days historical",
                    },
                    {
                      label: "Sync mode",
                      value: "Read",
                      unit: "-only, incremental",
                    },
                  ]}
                />
              </ConnectorCard>
            </Reveal>

            <Reveal>
              <SecondaryProviderCard
                iconName="chat_bubble"
                name="Intercom Workspace"
                badge="On the roadmap"
                tagline="Conversation timelines and customer response deltas"
              />
            </Reveal>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-5">
            <Reveal>
              <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
                <div className="flex items-center justify-between">
                  <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
                    Trust & safety
                  </span>
                  <Icon name="shield" className="text-primary" />
                </div>

                <TrustList
                  items={[
                    {
                      iconName: "lock_reset",
                      title: "Zero write permissions",
                      description:
                        "Credentials run under a read-only OAuth scope — Elapsed can't touch your tickets.",
                    },
                    {
                      iconName: "hourglass_top",
                      title: "Continuous SLA clock",
                      description:
                        "Raw ticket timestamps build the uncompromised clock across support and engineering handoffs.",
                    },
                    {
                      iconName: "history",
                      title: "Fixed 90-day backfill",
                      description:
                        "An instant historical baseline starts as soon as you're authenticated — no waiting on new tickets.",
                    },
                  ]}
                />
              </div>
            </Reveal>

            <Reveal>
              <Soc2Badge />
            </Reveal>
          </div>
        </div>

        <Reveal>
          <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-surface-container-low p-5 shadow-lg sm:flex-row sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary">
                <Icon name="key" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  Ready to begin your SLA backfill
                </span>
                <span className={DESCRIPTION_CLASS}>
                  Step 1 of 3 — connect Zendesk to calculate continuous
                  resolution times
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </OnboardingShell>
    );
  }

  if (status.zendesk.reauthRequired) {
    return (
      <OnboardingShell title="Reconnect Zendesk" currentStep={currentStep}>
        <Reveal>
          <ReauthBanner
            provider="Zendesk"
            reconnectHref={`/api/integrations/zendesk/connect?subdomain=${encodeURIComponent(
              zendeskSubdomain ?? "",
            )}`}
          />
        </Reveal>
      </OnboardingShell>
    );
  }

  // Stage 03 in the mockups: backfill is done and it's time to connect the
  // issue tracker. Drives both the top ribbon and which card takes the
  // primary (7-col) vs. secondary (5-col) slot below.
  const showJiraCard = readyToConnectJira && !status.jira.connected;

  const engineStateValue = onboardingComplete
    ? "FINDINGS_READY"
    : showJiraCard
      ? "AWAITING_TRACKER_AUTH"
      : zendeskRunning || jiraRunning
        ? "REPLAYING_RECORDS"
        : "SYNCED";

  return (
    <OnboardingShell
      title={
        showJiraCard
          ? "Connect engineering to close the SLA blindspot"
          : "Ingesting 90 days of historical tickets"
      }
      description={
        showJiraCard
          ? "When support escalates a ticket, does the SLA clock pause? Connect your issue tracker to reconstruct the continuous clock."
          : "Deterministic event replay in progress — parsing raw audit logs and inter-tier handoffs without mutating your Zendesk source records."
      }
      currentStep={currentStep}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value={engineStateValue} />
      }
    >
      {showJiraCard && (
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-1.5 shadow-sm">
              <span className="font-label-caps text-label-caps text-primary tracking-widest">
                STEP 03 // 03
              </span>
              <span className="size-1.5 rounded-full bg-outline-variant" />
              <span className="font-code-audit text-code-audit text-on-surface-variant">
                RECONSTRUCT_CLOCK_CONTINUITY
              </span>
            </div>
            <div className="flex items-center gap-2 rounded bg-surface-container-low px-3 py-1.5 text-tertiary shadow-sm">
              <span className="size-2 rounded-full bg-tertiary animate-ping" />
              <span className="font-code-audit text-code-audit font-semibold uppercase">
                Zendesk linked ({status.ticketsFetched.toLocaleString()}{" "}
                tickets)
              </span>
            </div>
          </div>
        </Reveal>
      )}

      {readyToReviewPolicies && (
        <Reveal>
          <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Icon
                name="fact_check"
                className="text-[18px] shrink-0 text-primary"
              />
              <p className={DESCRIPTION_CLASS}>
                {reviewedPolicies
                  ? "Your SLA policies have been imported and reviewed."
                  : "Your SLA policies have been imported — review what matched before connecting Jira."}
              </p>
            </div>
            <Button variant={reviewedPolicies ? "outline" : "default"} asChild>
              <Link href="/onboarding/review-policies">
                {reviewedPolicies ? "Review again" : "Review policies"}
              </Link>
            </Button>
          </div>
        </Reveal>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {showJiraCard ? (
            <Reveal>
              <ConnectorCard>
                <ConnectorHeader
                  iconName="dataset"
                  name="Jira Software"
                  badge="Primary connector"
                  tagline="Engineering-leg timing for escalated cases"
                />

                <ScopeBanner
                  label="Read-only scopes enforced:"
                  scopes={["read:jira-work", "offline_access"]}
                />

                <IntegrationConfigGate
                  provider="jira"
                  providerLabel="Jira"
                  config={status.jiraConfig}
                  descriptionClass={DESCRIPTION_CLASS}
                  onConfigured={refresh}
                >
                  <p className={DESCRIPTION_CLASS}>
                    Connect Jira to add engineering-leg timing and correlate
                    support cases with engineering work.
                  </p>

                  <div className="mt-4">
                    <JiraConnectButton />
                  </div>
                </IntegrationConfigGate>
              </ConnectorCard>
            </Reveal>
          ) : (
            <Reveal>
              <ConnectorCard>
                <ConnectorHeader
                  iconName="confirmation_number"
                  name="Zendesk Support"
                  badge="Connected"
                  tagline="Ingesting ticket timestamps and SLA policies"
                />

                <OnboardingProgress
                  status={status}
                  zendeskRunning={zendeskRunning}
                  jiraRunning={jiraRunning}
                  error={error}
                />

                {onboardingComplete && (
                  <Button asChild>
                    <Link href="/onboarding/activation">
                      Setup complete
                      <Icon name="arrow_forward" className="text-[18px]" />
                    </Link>
                  </Button>
                )}
              </ConnectorCard>
            </Reveal>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Reveal>
            {showJiraCard ? (
              <CorrelationPanel />
            ) : (
              !onboardingComplete && <NextStepPanel />
            )}
          </Reveal>
        </div>
      </div>

      {showJiraCard && (
        <Reveal>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Alternative issue trackers
              </span>
              <span className="font-code-audit text-code-audit text-on-surface-variant/70">
                Connect alongside Jira, or configure later from Settings
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <AlternativeTrackerCard
                provider="linear"
                iconName="dataset_linked"
                name="Linear"
                tagline="Alternative engineering-leg source"
                config={status.linearConfig}
                descriptionText="Read-only access — no issues, comments, or fields are ever written back to Linear."
                helpUrl="https://linear.app/settings/api"
                helpLabel="Get your Linear OAuth app credentials"
                connectAction={<LinearConnectButton />}
              />

              <AlternativeTrackerCard
                provider="github"
                iconName="code"
                name="GitHub"
                tagline="Pull request lifecycle"
                config={status.githubConfig}
                descriptionText="Read-only access — correlated through whichever issue a pull request already references."
                helpUrl="/docs/integrations/github#create-github-app"
                helpLabel="Create your read-only GitHub App"
                connectAction={<GithubConnectForm />}
              />
            </div>
          </div>
        </Reveal>
      )}
    </OnboardingShell>
  );
}
