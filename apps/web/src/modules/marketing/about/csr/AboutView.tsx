"use client";

import { ArrowLeftRight, Check, EyeOff, GitMerge, Lock, Minus, Network, Timer } from "lucide-react";
import Link from "next/link";
import { TRIAL_LENGTH_DAYS } from "@sla/db/plans";

import { MarketingContainer, MarketingCta } from "@/components/marketing/marketing-ui";
import { Reveal } from "@/components/shared/reveal";
import type { MarketingPrinciple } from "@/lib/types/marketing";
import { cn } from "@/lib/utils";

const TRIAL = `${TRIAL_LENGTH_DAYS}-day trial`;

const EYEBROW = "text-primary font-mono text-xs tracking-wider uppercase";
const LABEL = "font-mono text-[10px] leading-3 font-semibold tracking-[0.06em] uppercase";
const H2 = "text-[28px] leading-9 font-semibold tracking-[-0.015em] text-foreground";

const PRINCIPLES: (MarketingPrinciple & { meta: [string, string] })[] = [
  {
    icon: Network,
    title: "Derived, not entered",
    description:
      "Customers, cases, and timelines are computed from the events your systems already emit. Nothing is typed in by hand, so nothing drifts out of sync with reality.",
    meta: ["Source events", "Webhook & polling log"],
  },
  {
    icon: GitMerge,
    title: "One case, every system",
    description:
      "A customer request doesn't stop at the helpdesk. We follow it into engineering — a Jira issue, a Linear ticket, a GitHub pull request — and treat it as one continuous story.",
    meta: ["Case identity", "Verified cross-system links"],
  },
  {
    icon: Lock,
    title: "Read-only by design",
    description:
      "We only ever read from Zendesk, Jira, Linear, Intercom, and GitHub. We never write back, reassign, or comment on your behalf.",
    meta: ["Security invariant", "Read-only scopes"],
  },
  {
    icon: ArrowLeftRight,
    title: "Built for both sides of the handoff",
    description:
      "Support teams and engineering teams see the same case, the same clock, and the same definition of at risk — so a breach is never a surprise to either side.",
    meta: ["Handoff parity", "One set of thresholds"],
  },
];

const IS = [
  "One clock per commitment that survives the handoff",
  "A timeline of where the time went, by stage",
  "A warning while there's still time to act",
  "A record you can open in a QBR to explain a number",
];

const IS_NOT = [
  "A workflow or ticketing tool",
  "A verdict on which team is at fault",
  "An AI that guesses links or predicts outcomes",
  "A service-credit or financial calculator",
];

const LEGS = [
  { x: 30, width: 170, opacity: 0.2, label: "01 Support intake", offset: "+00:14:02" },
  { x: 208, width: 180, opacity: 0.35, label: "02 Engineering triage", offset: "+02:41:19" },
  { x: 396, width: 140, opacity: 0.5, label: "03 PR & build stage", offset: "+04:12:00" },
];

/** Sample stage-leg progression for one case across its systems. */
function StageDiagram() {
  return (
    <div className="bg-card mt-10 w-full rounded p-6 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
        <div className="flex items-center gap-2">
          <span className={cn(LABEL, "text-foreground-subtle")}>One case, every leg</span>
          <span className="text-primary font-mono text-xs">SAMPLE DATA</span>
        </div>
        <div className={cn(LABEL, "text-foreground-subtle flex items-center gap-4")}>
          <span className="flex items-center gap-1.5">
            <span className="bg-primary size-2 rounded-full" /> One commitment clock
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-success size-2 rounded-full" /> Target met
          </span>
        </div>
      </div>
      <div className="w-full overflow-x-auto py-2">
        <svg className="h-20 w-full min-w-[620px] font-mono" fill="none" viewBox="0 0 760 80" role="img" aria-label="Sample case timeline across four stages">
          <line className="text-surface-raised" stroke="currentColor" strokeWidth="2" x1="30" x2="730" y1="40" y2="40" />
          <line className="text-primary" stroke="currentColor" strokeWidth="2" x1="30" x2="520" y1="40" y2="40" />
          {LEGS.map((leg, i) => (
            <g key={leg.label}>
              <rect className="text-surface-raised" fill="currentColor" height="16" rx="2" width={leg.width} x={leg.x} y="32" />
              <rect className="text-primary" fill="currentColor" fillOpacity={leg.opacity} height="16" rx="2" width={leg.width} x={leg.x} y="32" />
              <circle className="text-primary" cx={leg.x} cy="40" fill="currentColor" r={i === 0 ? 5 : 4} />
              <text className="text-primary text-[11px]" fill="currentColor" x={leg.x} y="24">
                {leg.label}
              </text>
              <text className="text-foreground-subtle text-[10px]" fill="currentColor" x={leg.x} y="64">
                {leg.offset}
              </text>
            </g>
          ))}
          <rect className="text-surface-raised" fill="currentColor" height="16" rx="2" width="186" x="544" y="32" />
          <circle className="text-muted-foreground" cx="544" cy="40" fill="currentColor" r="4" />
          <circle className="text-success" cx="730" cy="40" fill="currentColor" r="5" />
          <text className="text-muted-foreground text-[11px]" fill="currentColor" x="544" y="24">
            04 Back to the customer
          </text>
          <text className="text-foreground-subtle text-[10px]" fill="currentColor" x="544" y="64">
            Target 18:00:00
          </text>
        </svg>
      </div>
    </div>
  );
}

function ComparisonRow({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="bg-surface-raised flex items-center justify-between rounded p-2">
      <span className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

export const AboutView = () => {
  return (
    <main className="w-full flex-1 bg-background">
      <MarketingContainer>
        {/* Hero */}
        <section className="pt-8 pb-16">
          <Reveal className="flex flex-col items-start lg:w-2/3">
            <div className="bg-card mb-6 inline-flex items-center gap-2 rounded px-2 py-1 shadow-soft">
              <span className="bg-primary inline-block size-1.5 rounded-full" />
              <span className={EYEBROW}>About Elapsed</span>
            </div>
            <h1 className="mb-6 text-[36px] leading-[44px] font-bold tracking-[-0.02em] text-foreground">
              Support and engineering, working off the same clock.
            </h1>
            <p className="text-muted-foreground max-w-3xl text-base leading-relaxed">
              A customer request rarely stays in one system. It starts as a support ticket, gets escalated to engineering, waits on a release, and
              comes back to the customer — and the SLA clock keeps running the whole time. We built Elapsed to make that whole path visible, in one
              place, before anything breaches.
            </p>
            <StageDiagram />
          </Reveal>
        </section>

        {/* The problem */}
        <section className="bg-card/40 -mx-4 rounded-xl px-4 py-16 lg:-mx-6 lg:px-6">
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-24">
                <span className={cn(EYEBROW, "mb-2 block")}>01 / Diagnosis</span>
                <h2 className={H2}>The problem we kept running into</h2>
              </div>
            </div>
            <div className="flex flex-col gap-6 lg:col-span-7 lg:col-start-6">
              <p className="text-muted-foreground text-base leading-relaxed">
                Helpdesk tools know about the support side of a case. Engineering trackers know about the engineering side. Neither one knows about
                the other, so the moment a ticket gets handed to engineering, its SLA effectively goes dark — tracked in a spreadsheet, a Slack
                thread, or nowhere at all.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed">
                By the time someone notices a commitment is close to breaching, it&apos;s often because the customer mentioned it first. We think
                that&apos;s backwards.
              </p>

              <div className="bg-card my-4 rounded-lg p-6 shadow-soft">
                <div className="flex items-start gap-4">
                  <div className="bg-primary w-1 shrink-0 self-stretch rounded-full" />
                  <blockquote className="text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
                    &ldquo;One honest elapsed-time number per commitment, across every system the work touched.&rdquo;
                  </blockquote>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="bg-card rounded p-4 shadow-soft">
                  <div className="mb-3 flex items-center justify-between">
                    <span className={cn(LABEL, "text-foreground-subtle")}>Disconnected silos</span>
                    <EyeOff aria-hidden className="text-foreground-subtle size-4" />
                  </div>
                  <div className="flex flex-col gap-2 font-mono text-xs">
                    <ComparisonRow label="Zendesk #8841" value="Pending 3d" valueClass="text-warning" />
                    <ComparisonRow label="Jira ENG-409" value="In Sprint 24" valueClass="text-foreground-subtle" />
                    <div className="text-foreground-subtle mt-1 text-[11px]">SLA clock: unaccounted</div>
                  </div>
                </div>
                <div className="bg-card rounded p-4 shadow-soft">
                  <div className="mb-3 flex items-center justify-between">
                    <span className={cn(LABEL, "text-primary")}>With Elapsed</span>
                    <Timer aria-hidden className="text-primary size-4" />
                  </div>
                  <div className="flex flex-col gap-2 font-mono text-xs">
                    <ComparisonRow label="Combined path" value="14h 22m total" strong valueClass="text-primary font-bold" />
                    <ComparisonRow label="Runway left" value="03h 38m" strong valueClass="text-warning font-bold" />
                    <div className="text-primary mt-1 text-[11px]">One continuous timeline</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Principles */}
        <section className="py-20">
          <div className="mb-10">
            <span className={cn(EYEBROW, "mb-2 block")}>02 / Core principles</span>
            <h2 className={H2}>What guides how we build it</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {PRINCIPLES.map((principle, i) => {
              const Icon = principle.icon;
              return (
                <Reveal key={principle.title} delay={i * 0.05} className="h-full">
                  <div className="bg-card hover:bg-surface-raised flex h-full flex-col justify-between rounded-lg p-8 shadow-soft transition-colors">
                    <div>
                      <div className="bg-surface-raised mb-6 flex size-9 items-center justify-center rounded shadow-inner">
                        <Icon aria-hidden className="text-primary size-5" />
                      </div>
                      <h3 className="mb-3 text-xl font-semibold text-foreground">{principle.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">{principle.description}</p>
                    </div>
                    <div className="mt-6 flex items-center gap-2 pt-6">
                      <span className={cn(LABEL, "text-foreground-subtle")}>{principle.meta[0]}</span>
                      <span className="bg-foreground-subtle inline-block size-1 rounded-full" />
                      <span className={cn(LABEL, "text-primary normal-case")}>{principle.meta[1]}</span>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* Is / isn't */}
        <section className="py-16">
          <div className="mb-10">
            <span className={cn(EYEBROW, "mb-2 block")}>03 / Definition</span>
            <h2 className={H2}>What Elapsed is — and isn&apos;t</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[
              { title: "Elapsed is", chip: "Capabilities", items: IS, positive: true },
              { title: "Elapsed is not", chip: "Non-goals", items: IS_NOT, positive: false },
            ].map((column) => (
              <div key={column.title} className="bg-card rounded-lg p-8 shadow-soft">
                <div className="mb-6 flex items-center justify-between pb-6">
                  <h3 className="text-xl font-semibold text-foreground">{column.title}</h3>
                  <span className={cn(LABEL, "bg-surface-raised rounded px-2 py-1", column.positive ? "text-primary" : "text-foreground-subtle")}>
                    {column.chip}
                  </span>
                </div>
                <ul className="flex flex-col gap-5">
                  {column.items.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      {column.positive ? (
                        <Check aria-hidden className="text-primary mt-0.5 size-5 shrink-0" />
                      ) : (
                        <Minus aria-hidden className="text-foreground-subtle mt-0.5 size-5 shrink-0" />
                      )}
                      <span className={cn("text-sm", column.positive ? "text-foreground" : "text-muted-foreground")}>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Transparency */}
        <section className="py-16">
          <div className="bg-card rounded-xl p-8 shadow-panel sm:p-12">
            <div className="flex max-w-3xl flex-col items-start">
              <span className={cn(EYEBROW, "mb-3 block")}>04 / Transparency</span>
              <h2 className={cn(H2, "mb-4")}>We publish what Elapsed doesn&apos;t do yet.</h2>
              <p className="text-muted-foreground mb-6 text-base leading-relaxed">
                Our documentation lists current limitations alongside every feature, from fixed warning thresholds to which integrations are still in
                beta, so you can evaluate the product as it actually is.
              </p>
              <Link href="/docs" className="group text-primary inline-flex items-center gap-2 font-mono text-sm font-semibold transition-colors hover:text-foreground">
                <span>Read the product documentation</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mb-8 py-20">
          <div className="bg-card mx-auto flex max-w-4xl flex-col items-center rounded-2xl p-10 text-center shadow-elevated sm:p-16">
            <span className={cn(EYEBROW, "mb-3")}>Get started</span>
            <h2 className="mb-4 text-[36px] leading-[44px] font-bold tracking-[-0.02em] text-foreground">See your last 90 days in Elapsed.</h2>
            <p className="text-muted-foreground mb-8 max-w-2xl text-base leading-relaxed">
              Connect your helpdesk and engineering tracker and see every at-risk case on one dashboard.
            </p>
            <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row">
              <MarketingCta href="/sign-up" className="h-11 px-6">
                Start {TRIAL} →
              </MarketingCta>
              <MarketingCta href="/pricing" variant="secondary" className="bg-surface-raised hover:bg-surface-hover h-11 px-6 shadow-soft">
                View pricing
              </MarketingCta>
            </div>
            <div className="text-foreground-subtle font-mono text-xs tracking-tight">{TRIAL} · Full access · No credit card</div>
          </div>
        </section>
      </MarketingContainer>
    </main>
  );
};
