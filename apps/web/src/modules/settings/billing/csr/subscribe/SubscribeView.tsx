"use client";

import Link from "next/link";
import { ArrowLeft, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { BillingPill } from "@/components/billing/billing-ui";
import { BillingToast, useBillingToast } from "@/components/billing/billing-toast";
import { formatRate } from "@/lib/billing-format";
import { TONE_SURFACE } from "@/lib/status-styles";
import type { SubscribeAlert, SubscribeReview } from "@/lib/types/billing-subscribe";
import { cn } from "@/lib/utils";
import { BillingPageHeader } from "../BillingPageHeader";
import { useSubscriptionRunner } from "../useSubscriptionRunner";
import { ChangesCard } from "./ChangesCard";
import { SubscribeSuccess } from "./SubscribeSuccess";
import { PrimaryAction, SubscribeSummary } from "./SubscribeSummary";
import { TargetPlanCard } from "./TargetPlanCard";

const ALERT_ICON = { info: Info, warning: TriangleAlert, danger: CircleAlert } as const;
const ALERT_TONE = { info: "primary", warning: "warning", danger: "danger" } as const;

function InlineAlert({ alert }: { alert: SubscribeAlert }) {
  const Icon = ALERT_ICON[alert.tone];
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border p-4", TONE_SURFACE[ALERT_TONE[alert.tone]])}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <h2 className="text-xs font-bold tracking-wider uppercase">{alert.title}</h2>
        <p className="mt-1 text-xs leading-5 opacity-90">{alert.body}</p>
        {alert.link && (
          <Link href={alert.link.href} className="mt-2 inline-block font-mono text-xs font-bold underline">
            {alert.link.label}
          </Link>
        )}
      </div>
    </div>
  );
}

interface SubscribeViewProps {
  review: SubscribeReview;
}

/**
 * Review & Subscribe (Stitch): confirms one subscription operation after
 * showing what it changes and what it invoices. The server resolved
 * `review.action` from the version the page saw, so a change made elsewhere
 * since is refused by the billing domain as a conflict and the page re-reads.
 */
export function SubscribeView({ review }: SubscribeViewProps) {
  const toast = useBillingToast();
  const { run, busy } = useSubscriptionRunner(toast.show);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<SubscribeAlert | null>(null);

  const confirm = useCallback(async () => {
    if (!review.action) return;
    setFailure(null);
    const result = await run(review.action, review.success.title);
    if (result.ok) {
      setDone(true);
      return;
    }
    setFailure(
      result.code === "network"
        ? { tone: "danger", title: "Could not reach the server", body: "Check your connection and try again. No billing changes were recorded." }
        : result.code === "conflict"
          ? { tone: "danger", title: "Billing changed since this page loaded", body: "The details below were reloaded. Review them and confirm again." }
          : result.code === "invalid_transition"
            ? { tone: "danger", title: "This change can't be made now", body: result.error ?? "The subscription is not in a state that allows it.", link: { label: "Go to Billing →", href: "/billing" } }
            : { tone: "danger", title: "The change was not made", body: result.error ?? "The billing change could not be made." },
    );
  }, [review.action, review.success.title, run]);

  if (done) {
    return (
      <>
        <SubscribeSuccess review={review} />
        <BillingToast message={toast.message} onDismiss={toast.dismiss} />
      </>
    );
  }

  const alert = failure ?? review.alert;
  const back = (
    <Link href="/pricing" className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 text-sm">
      <ArrowLeft aria-hidden className="size-3.5" />
      Back to pricing
    </Link>
  );

  return (
    <div className="flex flex-col gap-5" aria-busy={busy}>
      <BillingPageHeader
        crumb="Subscribe"
        parent={{ label: "Billing & Subscriptions", href: "/billing" }}
        title={review.heading}
        description={review.subheading}
        actions={
          <BillingPill tone={review.statusPill.tone} dot={review.statusPill.tone === "primary"} pulse={review.statusPill.tone === "primary"} className="px-2.5 py-1 text-xs">
            {review.statusPill.label}
          </BillingPill>
        }
      />

      {alert && <InlineAlert alert={alert} />}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <TargetPlanCard review={review} />
          <ChangesCard rows={review.limits} />
          <p className="text-muted-foreground bg-card border-border flex items-start gap-3 rounded-lg border p-4 text-sm leading-6">
            <Info aria-hidden className="text-primary mt-1 size-4 shrink-0" />
            <span>
              <strong className="text-foreground font-semibold">Continuous measurement covenant:</strong> going over integration or policy thresholds never halts data processing. Handoff time
              calculation, live alerts and historical proof chains keep running without interruption.
            </span>
          </p>
        </div>

        <SubscribeSummary review={review} busy={busy} onConfirm={confirm} footer={back} />
      </div>

      <div className="bg-card/95 border-border sticky bottom-0 z-30 -mx-4 flex items-center justify-between gap-3 border-t p-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <p className="text-foreground truncate text-xs font-bold">
            {review.planName} · {review.priceCents === null ? "Contract" : formatRate(review.priceCents, "month")}
          </p>
          <p className="text-foreground-subtle font-mono text-[10px]">{review.settlement.label}</p>
        </div>
        <PrimaryAction review={review} busy={busy} onConfirm={confirm} size="sm" className="shrink-0" />
      </div>

      <BillingToast message={toast.message} onDismiss={toast.dismiss} />
    </div>
  );
}
