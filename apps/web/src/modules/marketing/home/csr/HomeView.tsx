"use client";

import { Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import {
  formatPlanPrice,
  PLAN_LIST,
  planFeatureLines,
  TRIAL_LENGTH_DAYS,
} from "@sla/db/plans";

import {
  ArrowLink,
  MarketingContainer,
  MarketingCta,
  MONO_CAPTION,
  MONO_LABEL,
  SectionHeading,
} from "@/components/marketing/marketing-ui";
import { Reveal } from "@/components/shared/reveal";
import { cn } from "@/lib/utils";

const TRIAL = `${TRIAL_LENGTH_DAYS}-day trial`;

const INTEGRATION_GROUPS: { label: string; tools: string[]; beta?: boolean }[] =
  [
    { label: "Ticket sources", tools: ["Zendesk", "Intercom"], beta: true },
    { label: "Engineering", tools: ["Jira", "Linear", "GitHub"], beta: true },
    { label: "Alerts", tools: ["Slack", "Email"] },
  ];

const PROBLEMS = [
  {
    title: "The clock keeps running.",
    description:
      "Escalating a ticket to Jira, Linear, or a pull request doesn't pause the customer's resolution target. The time keeps counting in someone else's tracker.",
  },
  {
    title: "Visibility splits in two.",
    description:
      "The helpdesk shows “escalated”. The tracker shows “In Progress”. Neither tells you how much of the customer's window is already gone.",
  },
  {
    title: "Two tools, two numbers.",
    description:
      "Each system does its own time arithmetic. Reconciling them by hand is the hour-before-the-QBR work Elapsed removes.",
  },
];

const SMALL_CAPABILITIES: {
  title: string;
  description: string;
  footer: ReactNode;
  footerClass?: string;
}[] = [
  {
    title: "Warned before it breaches",
    description:
      "At-risk alerts at 50%, 80%, and 95% of target by default, then on breach. Each threshold alerts once, never twice.",
    footer: (
      <div className="flex items-center gap-1">
        <span className="bg-surface-raised rounded px-1.5 py-0.5">50%</span>
        <span>→</span>
        <span className="bg-surface-raised text-warning rounded px-1.5 py-0.5 font-bold">
          80%
        </span>
        <span>→</span>
        <span className="bg-surface-raised text-danger rounded px-1.5 py-0.5 font-bold">
          95%
        </span>
      </div>
    ),
    footerClass: MONO_LABEL,
  },
  {
    title: "Slack and email alerts",
    description:
      "Alerts name the ticket, the customer, the policy, the target, and link straight to the case.",
    footer: "Direct deep links included",
  },
  {
    title: "A dashboard for right now",
    description:
      "Breaches, compliance, and cases aging in engineering over the last 30 days, plus a live At risk now table.",
    footer: "Live view",
    footerClass: "text-success",
  },
  {
    title: "Exports for the QBR",
    description:
      "Download what's on screen as CSV, or the full commitment history behind every number.",
    footer: "CSV export",
    footerClass: "text-primary",
  },
];

const STEPS: { title: string; description: string; sample?: string }[] = [
  {
    title: "Connect your tools",
    description:
      "Authorize read-only access to your helpdesk (Zendesk, Intercom) and engineering tracker (Jira, Linear, GitHub). No agent code required.",
  },
  {
    title: "See your last 90 days",
    description:
      "Elapsed reconstructs the clock for every past escalated request, revealing historical breaches and handoff latency.",
    sample:
      "Over the last 90 days, 318 tickets were escalated. 47 exceeded their customer resolution target.",
  },
  {
    title: "Act before the breach",
    description:
      "Configure notifications. Your team is alerted in Slack or email before commitments slip, while there's still runway to intervene.",
  },
];

const DIFFERENTIATORS = [
  {
    title: "Deterministic, not guessed",
    description:
      "Calculations use recorded event timestamps only. No heuristics, smoothing, or predictive hand-waving.",
  },
  {
    title: "Time by stage, not fault",
    description:
      "We measure how long requests spend in each stage. Neutral numbers that end inter-team finger pointing.",
  },
  {
    title: "No AI in the numbers",
    description:
      "No LLMs or machine-learning models touch duration arithmetic. Clean, inspectable accounting.",
  },
  {
    title: "Honest about uncertainty",
    description:
      "When there is no verified link, a case has no engineering leg. Elapsed never guesses a match to fill the gap.",
  },
];

const SECURITY = [
  {
    title: "Read-only by design",
    description:
      "Elapsed never modifies tickets, changes issue states, or writes to repositories.",
  },
  {
    title: "Read-only GitHub App",
    description:
      "A GitHub App you create with read-only permissions, installed only on the repositories you choose.",
  },
  {
    title: "Encrypted credentials",
    description:
      "Integration secrets are encrypted at rest with AES-256-GCM before they reach the database.",
  },
  {
    title: "Tenant isolation",
    description:
      "Every record is scoped to its organization, so one customer's data never reaches another.",
  },
];

const FAQS = [
  {
    question: "Is Elapsed read-only?",
    answer:
      "Yes, for every connected data source (Zendesk, Jira, Linear, Intercom, GitHub). The only outbound writes anywhere in the product are a Slack message and an alert email.",
  },
  {
    question: "How fresh is the data?",
    answer:
      "Every 5 minutes for open cases, every 30 minutes for a full reconciliation sweep, and near-instantly for Zendesk and Jira when a webhook is configured.",
  },
  {
    question: "How does Elapsed know which Jira issue belongs to a ticket?",
    answer:
      "By reading Jira's own remote-link data on the issue and matching a Zendesk URL against your exact connected subdomain. When there is no link, the case has no engineering leg and is never guessed at.",
  },
  {
    question: "Does it handle business hours and holidays?",
    answer:
      "Yes. Calendars imported from Zendesk business-hours schedules, or a 24/7 always-open calendar, are used to compute working time. A date marked as a holiday contributes zero working minutes.",
  },
  {
    question: "How far back does history go?",
    answer:
      "90 days from the date each integration was connected, so you see your baseline on day one.",
  },
];

const PLANS = PLAN_LIST.map((plan) => ({
  ...plan,
  ...formatPlanPrice(plan),
  features: planFeatureLines(plan),
}));

const CARD = "bg-card rounded-lg";

function CaseCardPreview() {
  return (
    <div className="relative mt-6 lg:col-span-6 lg:mt-0">
      <Reveal className={cn(CARD, "p-5")} variant="right">
        <div className="flex items-center justify-between gap-2 pb-4">
          <span className="font-mono text-sm font-bold text-foreground">
            Acme Corp · #4821 · Resolution
          </span>

          <span
            className={cn(
              MONO_LABEL,
              "bg-warning/10 text-warning flex items-center gap-1.5 rounded px-2 py-0.5",
            )}
          >
            <span aria-hidden>•</span>
            At risk
          </span>
        </div>

        <div className="bg-surface-raised rounded p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-warning font-mono text-xl font-bold tabular-nums">
              1h 36m remaining
            </span>

            <span className="text-muted-foreground font-mono text-xs">
              80% of 8h target used
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className={cn(MONO_LABEL, "text-foreground-subtle")}>
                Case journey
              </span>

              <span className="text-foreground-subtle font-mono text-xs">
                Total: 6h 24m elapsed
              </span>
            </div>

            <div className="bg-background flex h-3 w-full overflow-hidden rounded">
              <div
                className="bg-stage-support h-full"
                style={{ width: "10.4%" }}
                title="Support: 0h 40m"
              />

              <div
                className="bg-stage-eng h-full"
                style={{ width: "89.6%" }}
                title="Engineering: 5h 44m"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                <span className="bg-stage-support size-2 rounded" />
                Support 0h 40m
              </span>

              <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                <span className="bg-stage-eng size-2 rounded" />
                Engineering 5h 44m
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className={cn(MONO_LABEL, "text-foreground-subtle")}>
                Clock
              </span>

              <span
                className={cn(MONO_LABEL, "text-foreground-subtle normal-case")}
              >
                Business window active
              </span>
            </div>

            <div className="bg-background flex h-1.5 w-full overflow-hidden rounded">
              <div
                className="bg-success h-full"
                style={{ width: "72%" }}
                title="Running"
              />

              <div
                className="bg-surface-overlay h-full"
                style={{ width: "18%" }}
                title="Paused (outside business hours)"
              />

              <div
                className="bg-success h-full"
                style={{ width: "10%" }}
                title="Running"
              />
            </div>
          </div>
        </div>

        <p className="text-foreground-subtle mt-4 pt-3 font-mono text-xs">
          <span className="text-primary font-semibold">
            How this was calculated ▸
          </span>

          <span className="text-muted-foreground ml-1">
            Policy: Standard SLA v3 · Calendar: Business hours (Mon–Fri
            09:00–17:00) · Thresholds 50/80/95%
          </span>
        </p>
      </Reveal>

      <Reveal
        delay={0.14}
        variant="left"
        className="bg-surface-overlay mt-3 w-full rounded-lg p-3.5 shadow-elevated sm:absolute sm:-right-4 sm:-bottom-6 sm:mt-0 sm:w-95"
      >
        <div className="flex items-start gap-2">
          <span aria-hidden className="text-warning mt-0.5 text-sm select-none">
            ⚠️
          </span>

          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs leading-tight font-semibold text-foreground">
              Resolution SLA at risk — #4821 for Acme Corp
            </span>

            <span className="text-muted-foreground font-mono text-xs">
              80% of target used, 1h 36m remaining.
            </span>

            <span
              className={cn(
                MONO_LABEL,
                "text-foreground-subtle mt-1 normal-case",
              )}
            >
              Policy: Standard SLA · Target: 8h
            </span>

            <span className="text-primary mt-1 font-mono text-xs">
              View ticket →
            </span>
          </div>
        </div>
      </Reveal>

      <Reveal
        delay={0.26}
        variant="left"
        className={cn(MONO_LABEL, "text-foreground-subtle mt-8 sm:mt-10")}
      >
        Sample data
      </Reveal>
    </div>
  );
}

export const HomeView = () => {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const primaryHref = isAuthenticated ? "/dashboard" : "/sign-up";
  const primaryLabel = isAuthenticated ? "Go to dashboard" : `Start ${TRIAL}`;

  return (
    <main className="flex w-full flex-1 flex-col bg-background text-foreground">
      {/* Hero */}
      <MarketingContainer className="py-8 lg:py-16">
        <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <Reveal
            variant="up"
            className="flex flex-col justify-center lg:col-span-6"
          >
            <div>
              <span
                className={cn(
                  MONO_LABEL,
                  "text-primary bg-surface-overlay inline-flex items-center rounded px-2 py-0.5",
                )}
              >
                SLA monitoring for support &amp; engineering
              </span>
            </div>

            <h1 className="mt-4 text-[36px] leading-11 font-bold tracking-[-0.02em] text-foreground">
              Know before your customer does.
            </h1>

            <p className="text-muted-foreground mt-4 text-base leading-relaxed">
              Elapsed follows every customer request from your helpdesk into
              engineering and keeps one clock running across the handoff, so you
              see what&apos;s at risk of breaching before it does.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2">
              <MarketingCta href={primaryHref}>{primaryLabel} →</MarketingCta>

              <MarketingCta href="#how-it-works" variant="secondary">
                See how it works
              </MarketingCta>
            </div>

            <p className={cn(MONO_CAPTION, "text-foreground-subtle mt-4")}>
              {TRIAL} · Full access · No credit card · Read-only access to your
              tools
            </p>
          </Reveal>

          <CaseCardPreview />
        </section>
      </MarketingContainer>

      {/* Integrations */}
      <section className="bg-surface-raised my-6 w-full py-8">
        <MarketingContainer>
          <div className="flex flex-col justify-between gap-4 pb-6 md:flex-row md:items-center">
            <Reveal
              delay={0.04}
              variant="left"
              className={cn(MONO_CAPTION, "text-foreground-subtle uppercase")}
            >
              Reads from the tools you already use
            </Reveal>

            <Reveal delay={0.12} variant="right">
              <ArrowLink href="/docs/integrations/zendesk">
                Integration details
              </ArrowLink>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {INTEGRATION_GROUPS.map((group, index) => (
              <Reveal
                key={group.label}
                variant={index === 0 ? "left" : index === 1 ? "up" : "right"}
                delay={0.12 + index * 0.08}
                className="bg-card flex flex-col gap-2 rounded p-4"
              >
                <span
                  className={cn(
                    MONO_LABEL,
                    "text-foreground-subtle tracking-widest",
                  )}
                >
                  {group.label}
                </span>

                <div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-sm">
                  {group.tools.map((tool, i) => (
                    <span key={tool} className="flex items-center gap-2">
                      {i > 0 && (
                        <span className="text-foreground-subtle">·</span>
                      )}
                      {tool}
                    </span>
                  ))}

                  {group.beta && (
                    <span
                      className={cn(
                        MONO_LABEL,
                        "bg-surface-overlay text-primary rounded px-1.5 py-0.5",
                      )}
                    >
                      Beta
                    </span>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </MarketingContainer>
      </section>

      {/* The problem */}
      <MarketingContainer className="py-8">
        <Reveal variant="up">
          <SectionHeading
            eyebrow="The problem"
            title="The customer's clock doesn't stop when the ticket moves."
            className="mb-10"
          />
        </Reveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PROBLEMS.map((problem, i) => (
            <Reveal
              key={problem.title}
              variant={i === 0 ? "left" : i === 1 ? "up" : "right"}
              delay={0.08 + i * 0.08}
              className={cn(CARD, "p-6")}
            >
              <span className="text-primary font-mono text-xl font-bold">
                {String(i + 1).padStart(2, "0")}
              </span>

              <h3 className="mt-3 text-xl font-semibold tracking-[-0.01em] text-foreground">
                {problem.title}
              </h3>

              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {problem.description}
              </p>
            </Reveal>
          ))}
        </div>
      </MarketingContainer>

      {/* Capabilities */}
      <MarketingContainer className="py-8">
        <Reveal variant="up">
          <SectionHeading
            eyebrow="Capabilities"
            title="Built for the moment a case starts slipping"
            description="Everything Elapsed shows is derived from data your systems already have. Nothing to type in, nothing to keep in sync by hand."
            className="mb-10"
          />
        </Reveal>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <Reveal
            variant="left"
            delay={0.08}
            className={cn(
              CARD,
              "flex flex-col justify-between p-6 md:col-span-6",
            )}
          >
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                One case, every system
              </h3>

              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Elapsed detects linked records deterministically across systems
                using official links, remote links, and explicit references.
              </p>
            </div>

            <div className="bg-surface-raised mt-6 flex flex-col gap-2 rounded p-4 font-mono text-xs">
              {[
                {
                  record: "Zendesk #4821",
                  kind: "Customer ticket",
                  link: "Official Zendesk↔Jira link",
                },
                {
                  record: "Jira ENG-1234",
                  kind: "Bug tracker",
                  link: "Issue key in PR title",
                },
                { record: "GitHub PR #892", kind: "Pull request" },
              ].map((row) => (
                <div key={row.record} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">
                      {row.record}
                    </span>

                    <span className={cn(MONO_LABEL, "text-foreground-subtle")}>
                      {row.kind}
                    </span>
                  </div>

                  {row.link && (
                    <div className="text-foreground-subtle flex items-center gap-2 pl-3">
                      <span aria-hidden>↓</span>

                      <span
                        className={cn(
                          MONO_LABEL,
                          "bg-surface-overlay text-primary rounded px-1.5 py-0.5 normal-case",
                        )}
                      >
                        {row.link}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal
            variant="right"
            delay={0.08}
            className={cn(
              CARD,
              "flex flex-col justify-between p-6 md:col-span-6",
            )}
          >
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                Business hours, done properly
              </h3>

              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Working time is computed against business-hours calendars
                imported from Zendesk, or a 24/7 calendar, with holidays
                respected. No false alarms at midnight.
              </p>
            </div>

            <div className="bg-surface-raised mt-6 rounded p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={cn(MONO_LABEL, "text-foreground-subtle")}>
                  US-East operations calendar
                </span>

                <span className={cn(MONO_LABEL, "text-success")}>
                  09:00–17:00 EDT
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-xs">
                {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => {
                  const holiday = day === "Thu";

                  return (
                    <div
                      key={day}
                      className={cn(
                        "rounded p-2",
                        holiday ? "bg-surface-overlay" : "bg-card",
                      )}
                    >
                      <span
                        className={cn(
                          MONO_LABEL,
                          "text-foreground-subtle block",
                        )}
                      >
                        {day}
                      </span>

                      <span
                        className={cn(
                          "mt-1 block",
                          holiday ? "text-warning" : "text-success",
                        )}
                      >
                        {holiday ? "0h" : "8h"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                className={cn(
                  MONO_LABEL,
                  "text-foreground-subtle mt-2.5 text-right normal-case",
                )}
              >
                Thursday: Holiday · 0 working minutes
              </div>
            </div>
          </Reveal>

          {SMALL_CAPABILITIES.map((capability, index) => (
            <Reveal
              key={capability.title}
              variant="up"
              delay={0.16 + index * 0.07}
              className={cn(
                CARD,
                "flex flex-col justify-between p-5 md:col-span-6 lg:col-span-3",
              )}
            >
              <div>
                <h4 className="font-mono text-sm font-bold text-foreground">
                  {capability.title}
                </h4>

                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  {capability.description}
                </p>
              </div>

              <div
                className={cn(
                  "text-foreground-subtle mt-4 pt-3 font-mono text-xs",
                  capability.footerClass,
                )}
              >
                {capability.footer}
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal
          variant="up"
          delay={0.12}
          className="mt-8 flex flex-wrap items-center gap-4"
        >
          <MarketingCta href={primaryHref}>{primaryLabel}</MarketingCta>

          <ArrowLink href="/docs" className="font-sans text-sm">
            Read the documentation
          </ArrowLink>
        </Reveal>
      </MarketingContainer>

      {/* How it works */}
      <MarketingContainer id="how-it-works" className="scroll-mt-20 py-8">
        <Reveal variant="up">
          <SectionHeading
            eyebrow="How it works"
            title="From connected to monitored."
            className="mb-12"
          />
        </Reveal>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.title}
              variant="up"
              delay={0.08 + i * 0.1}
              className="flex flex-col"
            >
              <div className="flex items-center gap-3">
                <span className="text-primary font-mono text-xl font-bold">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <span className="bg-surface-overlay h-px flex-1" />
              </div>

              <h3 className="mt-4 text-xl font-semibold text-foreground">
                {step.title}
              </h3>

              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {step.description}
              </p>

              {step.sample && (
                <Reveal
                  variant="scale"
                  delay={0.18}
                  className={cn(CARD, "mt-4 p-4")}
                >
                  <p className="font-mono text-xs leading-snug text-foreground">
                    {step.sample}
                  </p>

                  <div
                    className={cn(MONO_LABEL, "text-foreground-subtle mt-2")}
                  >
                    Sample data
                  </div>
                </Reveal>
              )}
            </Reveal>
          ))}
        </div>
      </MarketingContainer>

      {/* Why Elapsed */}
      <MarketingContainer className="py-8">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <Reveal variant="left" className="flex flex-col lg:col-span-5">
            <SectionHeading
              eyebrow="Why Elapsed"
              title="A number you can defend, because it shows its work."
            />

            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Every commitment has a &ldquo;How this was calculated&rdquo;
              disclosure: the policy and its version, why it matched, the
              calendar used, what pauses the clock, and the warning thresholds.
              The timeline never shows a boundary that isn&apos;t backed by a
              recorded event.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
            {DIFFERENTIATORS.map((item, index) => (
              <Reveal
                key={item.title}
                variant="up"
                delay={0.08 + index * 0.07}
                className="bg-card rounded p-5"
              >
                <h4 className="font-mono text-sm font-bold text-foreground">
                  {item.title}
                </h4>

                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  {item.description}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </MarketingContainer>

      {/* Security */}
      <section className="bg-surface-raised my-6 w-full py-8">
        <MarketingContainer>
          <Reveal
            variant="up"
            className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"
          >
            <SectionHeading
              eyebrow="Security"
              title="Safe to connect on day one."
            />

            <Reveal delay={0.12} variant="right">
              <ArrowLink href="/docs/security">
                Read the security summary
              </ArrowLink>
            </Reveal>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map((item, i) => (
              <Reveal
                key={item.title}
                variant="up"
                delay={0.1 + i * 0.07}
                className="bg-card rounded p-4"
              >
                <span
                  className={cn(
                    MONO_CAPTION,
                    "text-primary mb-1 block font-bold",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>

                <h4 className="font-mono text-sm font-semibold text-foreground">
                  {item.title}
                </h4>

                <p className="text-foreground-subtle mt-2 text-xs">
                  {item.description}
                </p>
              </Reveal>
            ))}
          </div>
        </MarketingContainer>
      </section>

      {/* Pricing preview */}
      <MarketingContainer className="py-8">
        <Reveal variant="up">
          <SectionHeading
            eyebrow="Pricing"
            title="Simple pricing, per organization."
            description={`Flat monthly rates. No per-seat billing. Every plan starts with a ${TRIAL}.`}
            align="center"
            className="mb-10"
          />
        </Reveal>

        <div className="mx-auto grid max-w-4xl grid-cols-1 items-stretch gap-6 md:grid-cols-3">
          {PLANS.map((plan, index) => {
            const isContract = plan.monthlyPriceUsd === null;

            return (
              <Reveal
                key={plan.id}
                variant="scale"
                delay={0.08 + index * 0.08}
                className={cn(
                  "relative flex flex-col justify-between rounded-lg p-6",
                  plan.highlighted
                    ? "bg-surface-raised shadow-elevated"
                    : "bg-card",
                )}
              >
                {plan.highlighted && (
                  <span
                    className={cn(
                      MONO_LABEL,
                      "bg-primary text-primary-foreground absolute -top-3 right-6 rounded px-2 py-0.5 font-bold",
                    )}
                  >
                    Recommended
                  </span>
                )}

                <div>
                  <span className="font-mono text-sm font-bold text-foreground">
                    {plan.name}
                  </span>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span
                      className={cn(
                        "font-mono text-[36px] leading-11 font-bold",
                        plan.highlighted ? "text-primary" : "text-foreground",
                      )}
                    >
                      {isContract ? "Contract" : plan.price}
                    </span>

                    {plan.cadence && (
                      <span className="text-foreground-subtle font-mono text-xs">
                        {plan.cadence}
                      </span>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-3 text-xs">
                    {plan.description}
                  </p>

                  <ul
                    className={cn(
                      "mt-6 flex flex-col gap-2 font-mono text-xs",
                      plan.highlighted
                        ? "text-muted-foreground"
                        : "text-foreground-subtle",
                    )}
                  >
                    {plan.features.map((feature) => (
                      <li key={feature}>✓ {feature}</li>
                    ))}
                  </ul>
                </div>

                <MarketingCta
                  href={isContract || isAuthenticated ? "/pricing" : "/sign-up"}
                  variant={plan.highlighted ? "primary" : "secondary"}
                  size="sm"
                  className={cn(
                    "mt-8",
                    !plan.highlighted &&
                      "bg-surface-raised hover:bg-surface-hover",
                  )}
                >
                  {isContract
                    ? "Talk to us"
                    : isAuthenticated
                      ? "View plan"
                      : `Start ${TRIAL}`}
                </MarketingCta>
              </Reveal>
            );
          })}
        </div>

        <Reveal variant="up" delay={0.16} className="mt-10 text-center">
          <MarketingCta href="/pricing" variant="secondary" size="sm">
            Compare plans →
          </MarketingCta>
        </Reveal>
      </MarketingContainer>

      {/* FAQ */}
      <div className="mx-auto w-full max-w-200 px-4 py-8 lg:px-6">
        <Reveal variant="up">
          <SectionHeading
            eyebrow="Questions & answers"
            title="Frequently asked questions"
            align="center"
            className="mb-8"
          />
        </Reveal>

        <div className="flex flex-col gap-3">
          {FAQS.map((faq, index) => (
            <Reveal key={faq.question} variant="up" delay={0.05 + index * 0.06}>
              <details className="group bg-card open:bg-surface-raised rounded-lg p-4 transition-colors">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  <span>{faq.question}</span>

                  <Plus
                    aria-hidden
                    className="text-primary size-4 shrink-0 transition-transform group-open:rotate-45"
                  />
                </summary>

                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                  {faq.answer}
                </p>
              </details>
            </Reveal>
          ))}
        </div>

        <Reveal variant="up" delay={0.12} className="mt-6 text-center">
          <ArrowLink href="/docs/faq">More questions in the docs</ArrowLink>
        </Reveal>
      </div>

      {/* Final CTA */}
      <section className="bg-surface-raised mt-6 w-full py-16">
        <Reveal
          variant="scale"
          className="mx-auto flex max-w-200 flex-col items-center px-4 text-center lg:px-6"
        >
          <h2 className="text-[36px] leading-11 font-bold tracking-[-0.02em] text-foreground">
            Stop finding out about breaches from your customers.
          </h2>

          <p className="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
            Connect your helpdesk and engineering tracker and see every at-risk
            case on one dashboard.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <MarketingCta href={primaryHref} className="px-6">
              {primaryLabel} →
            </MarketingCta>

            <MarketingCta
              href="/pricing"
              variant="secondary"
              className="hover:bg-surface-hover px-6"
            >
              View pricing
            </MarketingCta>
          </div>

          <p className={cn(MONO_CAPTION, "text-foreground-subtle mt-4")}>
            {TRIAL} · Full access · No credit card
          </p>
        </Reveal>
      </section>
    </main>
  );
};
