"use client";

import { ShieldCheck } from "lucide-react";
import { TRIAL_LENGTH_DAYS } from "@sla/db/plans";
import { Reveal } from "@/components/shared/reveal";
import type { PricingViewer } from "@/lib/types/pricing";
import { FAQS, PLANS } from "./pricing-content";
import { PricingContextStrip } from "./PricingContextStrip";
import { PricingPlanCard } from "./PricingPlanCard";

export const PricingView = ({ viewer }: { viewer: PricingViewer }) => {
  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border/60">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grain" />

        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center sm:py-20">
          <Reveal>
            <span className="border-primary/30 bg-primary/10 text-primary inline-flex flex-wrap items-center justify-center gap-x-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold tracking-wide uppercase">
              {TRIAL_LENGTH_DAYS}-day trial
              <span aria-hidden className="text-foreground-subtle">
                ·
              </span>
              <span className="text-muted-foreground normal-case">Full access · No credit card required</span>
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">Simple pricing, per organization</h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-lg leading-8 text-muted-foreground text-balance">
              Flat monthly rates with no per-seat penalties or usage spikes. Every plan includes read-only integrations and automatic case correlation.
            </p>
          </Reveal>
          {viewer.strip && (
            <Reveal delay={0.15} className="w-full">
              <PricingContextStrip strip={viewer.strip} />
            </Reveal>
          )}
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-6 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 0.05}>
              <PricingPlanCard plan={plan} state={viewer.cards[plan.id]} />
            </Reveal>
          ))}
        </div>

        <div className="mx-auto mt-10 w-full max-w-7xl px-6">
          <div className="border-border bg-card flex items-start gap-4 rounded-lg border p-5">
            <span aria-hidden className="border-primary/30 bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md border">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Operational continuity guarantee</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                If your organization temporarily exceeds integration or policy limits, <strong className="text-foreground font-semibold">monitoring, alerts, cases and historical data never pause</strong>.
                You will see an informational warning, but protection is never interrupted.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 py-20">
        <div className="mx-auto w-full max-w-2xl px-6">
          <h2 className="text-center font-display text-2xl font-medium tracking-tight">Frequently asked questions</h2>

          <div className="mt-10 divide-y divide-border">
            {FAQS.map((faq, i) => (
              <Reveal key={faq.question} delay={i * 0.05}>
                <div className="py-5">
                  <h3 className="text-sm font-medium">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
