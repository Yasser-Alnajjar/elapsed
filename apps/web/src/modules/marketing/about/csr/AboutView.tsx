"use client";

import { Eye, GitMerge, ScanSearch, Users } from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import type { MarketingPrinciple } from "@/lib/types/marketing";

const PRINCIPLES: MarketingPrinciple[] = [
  {
    icon: ScanSearch,
    title: "Derived, not entered",
    description:
      "Customers, cases, and timelines are computed from the events your systems already emit. Nothing is typed in by hand, so nothing drifts out of sync with reality.",
  },
  {
    icon: GitMerge,
    title: "One case, every system",
    description:
      "A customer request doesn't stop at the helpdesk. We follow it into engineering — a Jira issue, a Linear ticket, a GitHub pull request — and treat it as one continuous story.",
  },
  {
    icon: Eye,
    title: "Read-only by design",
    description:
      "We only ever read from Zendesk, Jira, Linear, Intercom, and GitHub. We never write back, reassign, or comment on your behalf.",
  },
  {
    icon: Users,
    title: "Built for both sides of the handoff",
    description:
      "Support teams and engineering teams see the same case, the same clock, and the same definition of at risk — so a breach is never a surprise to either side.",
  },
];

export const AboutView = () => {
  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grain"
        />

        <div className="relative mx-auto w-full max-w-3xl px-6 py-24 text-center sm:py-28">
          <Reveal>
            <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              Support and engineering, working off the same clock.
            </h1>
          </Reveal>

          <Reveal delay={0.05}>
            <p className="mt-6 text-lg leading-8 text-muted-foreground text-balance">
              A customer request rarely stays in one system. It starts as a
              support ticket, gets escalated to engineering, waits on a release,
              and comes back to the customer — and the SLA clock keeps running
              the whole time. We built Elapsed to make that whole path visible,
              in one place, before anything breaches.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="border-b border-border/60 py-24">
        <div className="mx-auto w-full max-w-3xl px-6">
          <Reveal>
            <h2 className="font-display text-2xl font-medium tracking-tight">
              The problem we kept running into
            </h2>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="mt-4 space-y-4 text-muted-foreground leading-7">
              <p>
                Helpdesk tools know about the support side of a case.
                Engineering trackers know about the engineering side. Neither
                one knows about the other, so the moment a ticket gets handed to
                engineering, its SLA effectively goes dark — tracked in a
                spreadsheet, a Slack thread, or nowhere at all.
              </p>
              <p>
                By the time someone notices a commitment is close to breaching,
                it&apos;s often because the customer mentioned it first. We
                think that&apos;s backwards.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto w-full max-w-7xl px-6">
          <Reveal>
            <h2 className="text-center font-display text-2xl font-medium tracking-tight">
              What guides how we build it
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-8 sm:grid-cols-2">
            {PRINCIPLES.map((principle, i) => {
              const Icon = principle.icon;
              return (
                <Reveal key={principle.title} delay={i * 0.05}>
                  <div className="flex gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                      <Icon className="size-5" />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-base font-medium tracking-tight">
                        {principle.title}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {principle.description}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
};
