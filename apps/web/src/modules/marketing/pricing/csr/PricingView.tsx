"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PricingFaq, PricingPlan } from "@/lib/types/marketing";

const PLANS: PricingPlan[] = [
  {
    name: "Starter",
    price: "$49",
    cadence: "/month",
    description:
      "For a single support team getting SLA visibility for the first time.",
    cta: "Get started",
    href: "/sign-up",
    highlighted: false,
    features: [
      "1 support integration (Zendesk or Intercom)",
      "1 engineering integration",
      "Up to 3 SLA policies",
      "5 seats",
      "Email alerts on at-risk cases",
    ],
  },
  {
    name: "Team",
    price: "$149",
    cadence: "/month",
    description:
      "For teams handing cases between support and engineering every day.",
    cta: "Get started",
    href: "/sign-up",
    highlighted: true,
    features: [
      "Unlimited integrations (Zendesk, Jira, Linear, Intercom, GitHub)",
      "Unlimited SLA policies and calendars",
      "20 seats",
      "Slack notifications before breach",
      "Full case correlation across engineering",
      "90-day case history",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description:
      "For organizations with multiple teams, regions, or compliance needs.",
    cta: "Talk to us",
    href: "/sign-up",
    highlighted: false,
    features: [
      "Everything in Team",
      "Unlimited seats",
      "SSO / SAML",
      "Custom data retention",
      "Dedicated onboarding support",
    ],
  },
];

const FAQS: PricingFaq[] = [
  {
    question: "Is there a free trial?",
    answer:
      "Yes — every plan starts with a 14-day trial with full access, no credit card required.",
  },
  {
    question: "What counts as a seat?",
    answer:
      "Any teammate who signs in to view the dashboard, configure SLA policies, or manage integrations. Read-only Slack alerts don't use a seat.",
  },
  {
    question: "Can I change plans later?",
    answer:
      "Yes, you can upgrade, downgrade, or cancel at any time from your account settings. Changes are prorated automatically.",
  },
  {
    question: "Do you write back to our connected tools?",
    answer:
      "No. Every integration is read-only — we never create, edit, or comment on tickets, issues, or pull requests on your behalf.",
  },
];

export const PricingView = () => {
  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grain"
        />

        <div className="relative mx-auto w-full max-w-2xl px-6 py-20 text-center sm:py-24">
          <Reveal>
            <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              Simple pricing, per organization
            </h1>
          </Reveal>
          <Reveal delay={0.05}>
            <p className="mt-5 text-lg leading-8 text-muted-foreground text-balance">
              Every plan includes read-only integrations, automatic case
              correlation, and unlimited case history for the plan&apos;s
              retention window.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-6 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.05}>
              <Card
                className={cn(
                  "flex h-full flex-col",
                  plan.highlighted && "border-foreground/20 shadow-elevated",
                )}
              >
                <CardHeader className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-medium tracking-tight">
                      {plan.name}
                    </h2>
                    {plan.highlighted && (
                      <Badge variant="primary">Most popular</Badge>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-medium tracking-tight">
                      {plan.price}
                    </span>
                    {plan.cadence && (
                      <span className="text-sm text-muted-foreground">
                        {plan.cadence}
                      </span>
                    )}
                  </div>

                  <p className="text-sm leading-6 text-muted-foreground">
                    {plan.description}
                  </p>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-6">
                  <ul className="flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2.5 text-sm"
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    asChild
                    variant={plan.highlighted ? "default" : "outline"}
                    className="w-full"
                  >
                    <Link href={plan.href}>
                      {plan.cta}
                      <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-t border-border/60 py-20">
        <div className="mx-auto w-full max-w-2xl px-6">
          <h2 className="text-center font-display text-2xl font-medium tracking-tight">
            Frequently asked questions
          </h2>

          <div className="mt-10 divide-y divide-border">
            {FAQS.map((faq, i) => (
              <Reveal key={faq.question} delay={i * 0.05}>
                <div className="py-5">
                  <h3 className="text-sm font-medium">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
