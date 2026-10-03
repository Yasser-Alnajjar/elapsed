"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  GitBranch,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketingFeature, MarketingStep } from "@/lib/types/marketing";
import { useSession } from "next-auth/react";

const FEATURES: MarketingFeature[] = [
  {
    icon: GitBranch,
    title: "Cross-system correlation",
    description:
      "Every customer request is followed across every system it touches — a Zendesk ticket linked to a Jira issue, a Linear ticket, or a GitHub pull request — automatically, without manual tagging.",
  },
  {
    icon: Timer,
    title: "Real-time breach detection",
    description:
      "Commitments are evaluated continuously against the policy and calendar in effect when they were created, so you see at-risk and breached cases the moment they happen.",
  },
  {
    icon: BellRing,
    title: "Notify before it breaches",
    description:
      "Configurable warning thresholds send Slack alerts while there's still time to act, not a postmortem after the customer has already noticed.",
  },
  {
    icon: ShieldCheck,
    title: "Read-only by design",
    description:
      "Nothing is written back to Zendesk, Jira, Linear, Intercom, or GitHub. Every integration only reads, so it's safe to connect on day one.",
  },
];

const STEPS: MarketingStep[] = [
  {
    number: "01",
    title: "Connect your systems",
    description:
      "Link your support desk and engineering trackers. Customers and cases are derived automatically from what's already there.",
  },
  {
    number: "02",
    title: "Cases and commitments compute themselves",
    description:
      "The timeline for every case — who owns it, how much SLA time is left, which leg it's in — is calculated from the events your systems already emit.",
  },
  {
    number: "03",
    title: "Act before the breach",
    description:
      "See what's at risk on one dashboard, and get notified in Slack before a commitment runs out — not after.",
  },
];

const INTEGRATIONS = [
  "Zendesk",
  "Jira",
  "Linear",
  "Intercom",
  "GitHub",
  "Slack",
];

export const HomeView = () => {
  const { status } = useSession();

  const isAuthenticated = status === "authenticated";

  return (
    <main className="flex-1">
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grain"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-144 w-xl -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-[120px]"
        />

        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center sm:py-32">
          <Reveal>
            <Badge variant="outline" className="mb-6">
              SLA monitoring for support &amp; engineering
            </Badge>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-6xl">
              Know before your customer does.
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground text-balance">
              Elapsed correlates your helpdesk and engineering systems into a
              single timeline per case, so you always know what&apos;s at risk
              of breaching — before it does.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href={isAuthenticated ? "/dashboard" : "/sign-up"}>
                  {isAuthenticated ? "Go to dashboard" : "Get started"}
                  <ArrowRight />
                </Link>
              </Button>

              <Button asChild size="lg" variant="outline">
                <Link href="/docs">View documentation</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border/60 py-10">
        <div className="mx-auto w-full max-w-7xl px-6">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reads directly from the tools you already use
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {INTEGRATIONS.map((name) => (
              <span
                key={name}
                className="text-sm font-medium text-muted-foreground/80"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 py-24">
        <div className="mx-auto w-full max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Built for the moment a case starts slipping
            </h2>
            <p className="mt-4 text-muted-foreground">
              Everything the dashboard shows is derived from data your systems
              already have — nothing to type in, nothing to keep in sync by
              hand.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <Reveal key={feature.title} delay={i * 0.05}>
                  <Card className="h-full">
                    <CardHeader>
                      <div className="mb-2 flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
                        <Icon className="size-5" />
                      </div>
                      <CardTitle>{feature.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {feature.description}
                      </p>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 bg-muted/30 py-24">
        <div className="mx-auto w-full max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              How it works
            </h2>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.number} delay={i * 0.08}>
                <div className="space-y-3">
                  <span className="font-display text-sm text-muted-foreground">
                    {step.number}
                  </span>
                  <h3 className="text-lg font-medium tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 py-24">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Stop finding out about breaches from your customers.
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Connect your systems in minutes and see every at-risk case on one
            dashboard.
          </p>
          <Button asChild size="lg">
            <Link href={isAuthenticated ? "/dashboard" : "/sign-up"}>
              {isAuthenticated ? "Go to dashboard" : "Get started"}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
};
