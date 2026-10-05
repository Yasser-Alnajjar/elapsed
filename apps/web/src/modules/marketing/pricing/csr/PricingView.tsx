"use client";

import { CalendarDays, ChevronDown, Download, Eye, History, Info, Network, ShieldCheck, Table2, Timer } from "lucide-react";
import { TRIAL_LENGTH_DAYS } from "@sla/db/plans";
import { ArrowLink, MarketingContainer, MarketingCta, MONO_LABEL } from "@/components/marketing/marketing-ui";
import { Reveal } from "@/components/shared/reveal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { PricingViewer } from "@/lib/types/pricing";
import { cn } from "@/lib/utils";
import { BILLING_DETAILS, COMPARE_SECTIONS, FAQS, INCLUDED_IN_EVERY_PLAN, PLANS } from "./pricing-content";
import { PricingContextStrip } from "./PricingContextStrip";
import { PricingPlanCard } from "./PricingPlanCard";

const INCLUDED_ICONS = [Eye, Network, CalendarDays, History, Table2, Download, ShieldCheck, Timer];

const H2 = "text-[28px] leading-9 font-bold tracking-[-0.015em] text-foreground";
const EYEBROW = cn(MONO_LABEL, "text-primary tracking-widest");

function EnterpriseContact() {
  const contact = getUpgradeCta();
  const className = "h-10 w-full rounded border-border bg-card px-4 hover:border-border-strong hover:bg-surface-hover md:w-auto";
  return contact.href ? (
    <Button asChild variant="outline" className={className}>
      <a href={contact.href}>Talk to us</a>
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled className={className}>
      Talk to us
    </Button>
  );
}

export const PricingView = ({ viewer }: { viewer: PricingViewer }) => {
  return (
    <main className="w-full flex-1 bg-background">
      <MarketingContainer className="flex flex-col gap-8 py-8">
        {/* Hero */}
        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 flex flex-col items-center text-center lg:col-span-8 lg:col-start-3">
            <Reveal>
              <div className="bg-surface-raised inline-flex items-center gap-1 rounded border border-border px-2.5 py-1">
                <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                <span className={cn(MONO_LABEL, "text-primary tracking-wider")}>
                  {TRIAL_LENGTH_DAYS}-day trial · Full access · No credit card required
                </span>
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="mt-4 text-[36px] leading-[44px] font-bold tracking-[-0.02em] text-foreground">Simple pricing, per organization</h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-relaxed">
                Flat monthly rates with no per-seat billing or usage spikes. Every plan includes read-only integrations and automatic case correlation.
              </p>
            </Reveal>
            {viewer.strip && (
              <Reveal delay={0.15} className="mt-6 w-full">
                <PricingContextStrip strip={viewer.strip} />
              </Reveal>
            )}
          </div>
        </section>

        {/* Plans */}
        <section className="grid grid-cols-1 items-stretch gap-4 pt-3 md:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 0.05} className="h-full">
              <PricingPlanCard plan={plan} state={viewer.cards[plan.id]} />
            </Reveal>
          ))}
        </section>

        {/* Continuity guarantee */}
        <section className="bg-card w-full rounded border border-border p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="bg-surface-raised flex size-10 shrink-0 items-center justify-center rounded border border-border">
              <ShieldCheck aria-hidden className="text-primary size-6" />
            </div>
            <div className="flex max-w-4xl flex-col gap-1">
              <h2 className="text-xl font-semibold text-foreground">Operational continuity guarantee</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                If your organization temporarily exceeds integration or policy limits,{" "}
                <strong className="font-semibold text-foreground">monitoring, alerts, cases and historical data never pause</strong>. You will see an
                informational warning, but protection is never interrupted.
              </p>
            </div>
          </div>
        </section>

        {/* Compare */}
        <section id="compare-matrix" className="flex scroll-mt-20 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className={EYEBROW}>Compare</span>
            <h2 className={H2}>Compare plan capabilities</h2>
          </div>
          <div className="bg-card w-full overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead className="bg-surface-raised border-b border-border">
                <tr>
                  <th scope="col" className={cn(MONO_LABEL, "text-foreground-subtle w-2/5 p-4 text-[11px] tracking-wider")}>
                    Specification
                  </th>
                  {PLANS.map((plan) => (
                    <th
                      key={plan.id}
                      scope="col"
                      className={cn(
                        MONO_LABEL,
                        "w-1/5 p-4 text-[11px] tracking-wider",
                        plan.highlighted ? "bg-surface-overlay/30 text-primary border-x border-border" : "text-foreground",
                      )}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1">
                          {plan.name}
                          {plan.highlighted && <span className="bg-primary size-1.5 rounded-full" />}
                        </span>
                        <span className="text-foreground-subtle font-mono text-xs font-normal tracking-normal normal-case">
                          {plan.cadence ? `${plan.price}/mo` : "Contract"}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {COMPARE_SECTIONS.map((section) => [
                  <tr key={section.title} className="bg-surface-raised/40">
                    <td colSpan={PLANS.length + 1} className={cn(MONO_LABEL, "text-foreground-subtle px-4 py-2 tracking-wider")}>
                      {section.title}
                    </td>
                  </tr>,
                  ...section.rows.map((row) => (
                    <tr key={`${section.title}-${row.label}`} className="hover:bg-surface-raised/20">
                      <td className="px-4 py-3 text-foreground">{row.label}</td>
                      {PLANS.map((plan) => (
                        <td
                          key={plan.id}
                          className={cn("px-4 py-3 font-mono text-foreground", plan.highlighted && "bg-surface-overlay/10 border-x border-border")}
                        >
                          {row.values[plan.id]}
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <div className="text-foreground-subtle flex items-center gap-1 px-1">
            <Info aria-hidden className="text-primary size-4" />
            <span className="font-mono text-xs">Policies imported from Zendesk never count toward the policy limit.</span>
          </div>
        </section>

        {/* Included in every plan */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className={EYEBROW}>Every plan</span>
            <h2 className={H2}>Included in every plan</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED_IN_EVERY_PLAN.map((item, i) => {
              const Icon = INCLUDED_ICONS[i] ?? ShieldCheck;
              return (
                <div key={item.title} className="bg-card flex flex-col gap-1 rounded border border-border p-4">
                  <Icon aria-hidden className="text-primary mb-1 size-5" />
                  <span className="text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="text-foreground-subtle text-xs">{item.description}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Billing details */}
        <section className="bg-card flex w-full flex-col gap-4 rounded border border-border p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <h2 className="text-xl font-semibold text-foreground">Billing details</h2>
            <span className={cn(MONO_LABEL, "text-foreground-subtle")}>Contract &amp; term parameters</span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            {BILLING_DETAILS.map((item, i) => (
              <div
                key={item.term}
                className={cn("flex flex-col gap-1", i < BILLING_DETAILS.length - 1 && "border-b border-border/50 pb-2 md:border-b-0 md:pb-0")}
              >
                <dt className="text-foreground-subtle font-mono text-[11px] leading-[14px] font-semibold tracking-wider uppercase">{item.term}</dt>
                <dd className="text-sm text-foreground">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* FAQ */}
        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 flex flex-col gap-1 lg:col-span-4">
            <span className={EYEBROW}>Direct answers</span>
            <h2 className={H2}>Frequently asked questions</h2>
            <p className="text-foreground-subtle mt-1 text-xs">Clear billing policies without unexpected seat expansions.</p>
            <ArrowLink href="/docs/faq" className="mt-2 underline underline-offset-4">
              More answers in the docs
            </ArrowLink>
          </div>
          <Accordion
            type="multiple"
            defaultValue={FAQS.slice(0, 1).map((faq) => faq.question)}
            className="col-span-12 gap-1 lg:col-span-8"
          >
            {FAQS.map((faq) => (
              <AccordionItem
                key={faq.question}
                value={faq.question}
                className="bg-card rounded border border-border p-4"
              >
                <AccordionTrigger
                  icon={null}
                  className="items-center gap-4 rounded-none border-0 py-0 text-[length:inherit] font-semibold text-foreground hover:no-underline"
                >
                  <span>{faq.question}</span>
                  <ChevronDown aria-hidden className="text-primary size-5 shrink-0 transition-transform group-data-[state=open]/accordion-trigger:rotate-180" />
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground mt-2 border-t border-border pt-1 pb-0 text-xs leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Enterprise band */}
        <section className="bg-surface-raised flex w-full flex-col items-center justify-between gap-6 rounded border border-border p-4 sm:p-6 md:flex-row">
          <div className="flex max-w-xl flex-col gap-1 text-left">
            <div className="flex items-center gap-2">
              <span className="bg-primary size-2 rounded-full" />
              <span className={cn(MONO_LABEL, "text-foreground-subtle tracking-wider")}>Enterprise inquiries</span>
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground">Need contract terms or unlimited seats?</h3>
            <p className="text-muted-foreground text-sm">Talk to us about Enterprise: contract terms, procurement support, and onboarding support on request.</p>
          </div>
          <div className="flex w-full shrink-0 flex-col items-center gap-2 sm:flex-row md:w-auto">
            <EnterpriseContact />
            {viewer.mode === "anonymous" && (
              <MarketingCta href="/sign-up" className="w-full px-6 md:w-auto">
                Start {TRIAL_LENGTH_DAYS}-day trial →
              </MarketingCta>
            )}
          </div>
        </section>
      </MarketingContainer>
    </main>
  );
};
