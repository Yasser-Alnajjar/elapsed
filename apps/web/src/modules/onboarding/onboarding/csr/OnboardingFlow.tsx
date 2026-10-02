"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CircleCheck,
  Hourglass,
  History,
  KeyRound,
  ListChecks,
  Lock,
  Network,
  Route,
  Shield,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Button } from "@/components/ui/button";
import { deriveOnboardingProgress, providerStatus } from "@/lib/onboarding-progress";
import type { OnboardingStatus, ProviderOnboardingStatus } from "@/lib/types/onboarding";

import { IntegrationConfigGate } from "@modules/settings/integrations/csr/IntegrationConfigGate";
import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

import { OnboardingProgress } from "./OnboardingProgress";
import { RequestTrackerAccess } from "./RequestTrackerAccess";
import { useOnboardingBackfill } from "./useOnboardingBackfill";

const DESCRIPTION_CLASS = "font-body-sm text-body-sm text-on-surface-variant";
const REVIEWED_POLICIES_KEY = "onboarding:reviewedPolicies";

interface ConnectorHeaderProps {
  icon: LucideIcon;
  name: string;
  badge: string;
  tagline: string;
  /** Not promoted out of Beta yet (D17). */
  beta?: boolean;
}

/** Icon + name + connector badge above a provider's connect form — ported from the mockups' connector card header. */
function ConnectorHeader({
  icon: Icon,
  name,
  badge,
  tagline,
  beta = false,
}: ConnectorHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
        <Icon className="size-5 shrink-0" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-headline-md text-headline-md text-on-surface">
            {name}
          </span>
          <span className="font-label-caps text-label-caps rounded bg-primary/10 px-1.5 py-0.5 uppercase text-primary">
            {badge}
          </span>
          {beta && (
            <span className="font-label-caps text-label-caps rounded bg-secondary-container/40 px-1.5 py-0.5 uppercase text-on-secondary-container">
              Beta
            </span>
          )}
        </div>
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {tagline}
        </span>
      </div>
    </div>
  );
}

/**
 * Read-only access banner. The scopes are the ones the provider's authorize
 * URL is built from (via its adapter), never a copy; a provider that takes no
 * scope per request prints where its read-only grant is configured instead.
 */
function ScopeBanner({ access }: { access: ProviderOnboardingStatus["access"] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <ShieldCheck className="size-[18px] shrink-0 text-tertiary" />
        <span className="font-body-sm text-body-sm">
          {access.scopes.length > 0 ? "Read-only scopes enforced:" : (access.note ?? "Read-only access.")}
        </span>
      </div>
      {access.scopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {access.scopes.map((scope) => (
            <span
              key={scope}
              className="font-code-audit text-code-audit rounded bg-surface-container-high px-1.5 py-0.5 text-primary"
            >
              {scope}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Engine-state status chip shown next to the step title — the mockups' "Engine State" readout. */
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

interface ProviderCardProps {
  provider: ProviderOnboardingStatus;
  onConfigured?: () => void;
}

/** A compact connect card for a provider that is offered next to the primary one: gated on its OAuth app config like the primary card. */
function AlternativeConnectorCard({ provider, onConfigured }: ProviderCardProps) {
  const { icon: Icon, tagline, beta, help, readOnlyNote, Connect } = providerPresentation(provider.provider);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
          <Icon className="size-5 shrink-0" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm text-on-surface">
              {provider.label}
            </span>
            {beta && (
              <span className="font-label-caps text-label-caps rounded bg-secondary-container/40 px-1.5 py-0.5 uppercase text-on-secondary-container">
                Beta
              </span>
            )}
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {tagline}
          </span>
        </div>
      </div>

      <IntegrationConfigGate
        provider={provider.provider}
        providerLabel={provider.label}
        config={provider.config}
        descriptionClass={DESCRIPTION_CLASS}
        helpUrl={help?.url}
        helpLabel={help?.label}
        onConfigured={onConfigured}
      >
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {readOnlyNote}
          </p>
          <Connect returnTo="onboarding" />
        </div>
      </IntegrationConfigGate>
    </div>
  );
}

/** The large connect card for a role's primary connector: header, read-only scopes, then the gated connect control. */
function PrimaryConnectorCard({
  provider,
  description,
  footer,
  onConfigured,
}: ProviderCardProps & { description: string; footer?: ReactNode }) {
  const { icon, tagline, beta, help, Connect } = providerPresentation(provider.provider);

  return (
    <ConnectorCard>
      <ConnectorHeader
        icon={icon}
        name={provider.label}
        badge="Primary connector"
        tagline={tagline}
        beta={beta}
      />

      <ScopeBanner access={provider.access} />

      <IntegrationConfigGate
        provider={provider.provider}
        providerLabel={provider.label}
        config={provider.config}
        descriptionClass={DESCRIPTION_CLASS}
        helpUrl={help?.url}
        helpLabel={help?.label}
        onConfigured={onConfigured}
      >
        <p className={DESCRIPTION_CLASS}>{description}</p>

        <div className="mt-4">
          <Connect returnTo="onboarding" />
        </div>
      </IntegrationConfigGate>

      {footer}
    </ConnectorCard>
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
        <Workflow className="size-5 text-primary shrink-0" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">
          Next: connect engineering
        </h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          The SLA clock keeps running when a case moves into engineering.
          Connecting a work tracker next links each escalated ticket to its
          issue so that time is never silently dropped. It is optional: you can
          start without one.
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
        <Route className="size-5 text-primary shrink-0" />
      </div>

      <div className="flex gap-2.5 rounded-lg bg-surface-container p-3">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
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
        <Network className="size-4 shrink-0 text-primary" />
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
        <CircleCheck className="size-4 text-tertiary shrink-0" />
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
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Trust rail under a connector's form — the mockups' "Engine Safety & Trust Contract" panel, with copy that matches what the product actually does. */
function TrustList({ items }: { items: TrustItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map(({ icon: Icon, title, description }) => (
        <div
          key={title}
          className="flex gap-2.5 rounded-lg bg-surface-container-low p-3"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
            <Icon className="size-4 shrink-0" />
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
}

/**
 * The guided flow (N5.1), built from what each connected provider can do and
 * not from which provider it is: step 1 connects a ticket source, step 2
 * watches its backfill and then either reviews imported policies (a source
 * with the `policyImport` capability) or offers a first native policy, step 3
 * optionally connects a work tracker. Any supported pair takes the same path.
 */
export function OnboardingFlow({ initialStatus }: OnboardingFlowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { status, error, isRunning, refresh } = useOnboardingBackfill({
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

  const { ticketSource, ticketSourceReady, importsPolicies, tracker, complete } =
    deriveOnboardingProgress(status);
  const onboardingComplete = complete;

  const source = ticketSource ? providerStatus(status, ticketSource) : null;
  const trackerStatus = tracker ? providerStatus(status, tracker) : null;
  const sourceLabel = source?.label ?? "your helpdesk";
  const caseNoun = source ? providerPresentation(source.provider).caseNoun : "tickets";
  const trackerLabel = trackerStatus?.label ?? null;
  const sourceRunning = isRunning(ticketSource);
  const trackerRunning = isRunning(tracker);
  const trackerConnected = tracker !== null;

  const ticketSources = status.providers.filter((p) => p.role === "ticket_source");
  const trackers = status.providers.filter((p) => p.role === "work_tracker");
  const codeHosts = status.providers.filter((p) => p.role === "code_host");

  // A source that imports policies stops the flow to review them; one that
  // does not (D9) offers creating a first native policy, never blocking.
  const readyToReviewPolicies = ticketSourceReady && importsPolicies;
  const readyToCreatePolicy = ticketSourceReady && !importsPolicies;

  const readyToConnectTracker =
    ticketSourceReady &&
    (!importsPolicies || reviewedPolicies || trackerConnected);

  const currentStep: 1 | 2 | 3 | null = ticketSource === null
    ? 1
    : !readyToConnectTracker
      ? 2
      : !trackerConnected
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

  if (source === null) {
    const [primarySource, ...otherSources] = ticketSources;
    const primary = primarySource ? providerPresentation(primarySource.provider) : null;

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
            {primarySource && primary && (
              <Reveal>
                <PrimaryConnectorCard
                  provider={primarySource}
                  onConfigured={refresh}
                  description={`Connect ${primarySource.label} to pull your last 90 days of ${primary.caseNoun}${
                    primarySource.capabilities.policyImport
                      ? ", SLA policies, and organizations"
                      : ""
                  }, read-only, one click.`}
                  footer={
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
                  }
                />
              </Reveal>
            )}

            {otherSources.map((provider) => (
              <Reveal key={provider.provider}>
                <AlternativeConnectorCard provider={provider} onConfigured={refresh} />
              </Reveal>
            ))}
          </div>

          <div className="flex flex-col gap-5 lg:col-span-5">
            <Reveal>
              <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
                <div className="flex items-center justify-between">
                  <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
                    Trust & safety
                  </span>
                  <Shield className="size-5 text-primary shrink-0" />
                </div>

                <TrustList
                  items={[
                    {
                      icon: Lock,
                      title: "Zero write permissions",
                      description:
                        "Credentials run under a read-only OAuth scope — Elapsed can't touch your tickets.",
                    },
                    {
                      icon: Hourglass,
                      title: "Continuous SLA clock",
                      description:
                        "Raw ticket timestamps build the uncompromised clock across support and engineering handoffs.",
                    },
                    {
                      icon: History,
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
                <KeyRound className="size-5 shrink-0" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  Ready to begin your SLA backfill
                </span>
                <span className={DESCRIPTION_CLASS}>
                  Step 1 of 3 — connect {ticketSources.map((p) => p.label).join(" or ")}{" "}
                  to calculate continuous resolution times
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </OnboardingShell>
    );
  }

  if (source.reauthRequired) {
    return (
      <OnboardingShell
        title={`Reconnect ${source.label}`}
        currentStep={currentStep}
      >
        <Reveal>
          <ReauthBanner
            provider={source.label}
            reconnectHref={providerPresentation(source.provider).reconnectHref({
              subdomain: source.subdomain,
            })}
          />
        </Reveal>
      </OnboardingShell>
    );
  }

  // Stage 03 in the mockups: backfill is done and it's time to connect the
  // issue tracker. Drives both the top ribbon and which card takes the
  // primary (7-col) vs. secondary (5-col) slot below.
  const showTrackerCard = readyToConnectTracker && !trackerConnected;

  const engineStateValue = onboardingComplete
    ? "FINDINGS_READY"
    : showTrackerCard
      ? "AWAITING_TRACKER_AUTH"
      : sourceRunning || trackerRunning
        ? "REPLAYING_RECORDS"
        : "SYNCED";

  const [primaryTracker, ...otherTrackers] = trackers;
  const sourcePresentation = providerPresentation(source.provider);

  return (
    <OnboardingShell
      title={
        showTrackerCard
          ? "Connect engineering to close the SLA blindspot"
          : `Ingesting 90 days of historical ${caseNoun}`
      }
      description={
        showTrackerCard
          ? "When support escalates a ticket, does the SLA clock pause? Connect your issue tracker to reconstruct the continuous clock, or continue without one and add it later."
          : `Deterministic event replay in progress — parsing raw audit logs and inter-tier handoffs without mutating your ${sourceLabel} source records.`
      }
      currentStep={currentStep}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value={engineStateValue} />
      }
    >
      {showTrackerCard && (
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
                {sourceLabel} linked ({status.ticketsFetched.toLocaleString()}{" "}
                {caseNoun})
              </span>
            </div>
          </div>
        </Reveal>
      )}

      {readyToReviewPolicies && (
        <Reveal>
          <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <ListChecks className="size-[18px] shrink-0 text-primary" />
              <p className={DESCRIPTION_CLASS}>
                {reviewedPolicies
                  ? "Your SLA policies have been imported and reviewed."
                  : "Your SLA policies have been imported — review what matched before connecting your issue tracker."}
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

      {readyToCreatePolicy && (
        <Reveal>
          <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <ListChecks className="size-[18px] shrink-0 text-primary" />
              <p className={DESCRIPTION_CLASS}>
                {sourceLabel} has no SLA policies to import — create your
                first native policy so every case gets First Response and
                Resolution commitments.
              </p>
            </div>
            <Button variant="default" asChild>
              <Link href="/settings/sla/configuration">
                Create your first policy
              </Link>
            </Button>
          </div>
        </Reveal>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {showTrackerCard && primaryTracker ? (
            <Reveal>
              <PrimaryConnectorCard
                provider={primaryTracker}
                onConfigured={refresh}
                description={`Connect ${primaryTracker.label} to add engineering-leg timing and correlate support cases with engineering work${
                  otherTrackers.length > 0
                    ? `, or choose ${otherTrackers.map((p) => p.label).join(" or ")} below`
                    : ""
                }.`}
                footer={
                  <div className="flex flex-col gap-4">
                    <RequestTrackerAccess provider={primaryTracker.provider} label={primaryTracker.label} />
                    <Button variant="outline" asChild className="self-start">
                      <Link href="/onboarding/activation">
                        Continue without a tracker
                        <ArrowRight className="size-[18px] shrink-0" />
                      </Link>
                    </Button>
                  </div>
                }
              />
            </Reveal>
          ) : (
            <Reveal>
              <ConnectorCard>
                <ConnectorHeader
                  icon={sourcePresentation.icon}
                  name={source.label}
                  badge="Connected"
                  tagline={`Ingesting ${sourcePresentation.caseNoun} and their timelines`}
                  beta={sourcePresentation.beta}
                />

                <OnboardingProgress
                  status={status}
                  sourceLabel={sourceLabel}
                  caseNoun={caseNoun}
                  sourceRunning={sourceRunning}
                  trackerLabel={trackerLabel}
                  trackerRunning={trackerRunning}
                  error={error}
                />

                {onboardingComplete && (
                  <Button asChild>
                    <Link href="/onboarding/activation">
                      Setup complete
                      <ArrowRight className="size-[18px] shrink-0" />
                    </Link>
                  </Button>
                )}
              </ConnectorCard>
            </Reveal>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Reveal>
            {showTrackerCard ? (
              <CorrelationPanel />
            ) : (
              !onboardingComplete && <NextStepPanel />
            )}
          </Reveal>
        </div>
      </div>

      {showTrackerCard && (otherTrackers.length > 0 || codeHosts.length > 0) && (
        <Reveal>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Or choose another issue tracker
              </span>
              <span className="font-code-audit text-code-audit text-on-surface-variant/70">
                {otherTrackers.length > 0
                  ? `${otherTrackers.map((p) => p.label).join(" or ")} completes this step like ${primaryTracker?.label ?? "the primary tracker"} does; configure the rest later from Settings`
                  : "Configure the rest later from Settings"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[...otherTrackers, ...codeHosts].map((provider) => (
                <AlternativeConnectorCard
                  key={provider.provider}
                  provider={provider}
                  onConfigured={refresh}
                />
              ))}
            </div>
          </div>
        </Reveal>
      )}
    </OnboardingShell>
  );
}
