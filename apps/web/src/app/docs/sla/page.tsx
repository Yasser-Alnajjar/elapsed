import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";

const toc = [
  {
    id: "what-is-measured",
    title: "What is being measured",
    level: 2 as const,
  },
  {
    id: "commitment-creation",
    title: "Commitment creation",
    level: 2 as const,
  },
  { id: "business-hours", title: "Business hours vs. 24/7", level: 2 as const },
  {
    id: "running-vs-paused",
    title: "Running vs. paused time",
    level: 2 as const,
  },
  {
    id: "customer-waiting",
    title: "Customer-caused waiting",
    level: 2 as const,
  },
  { id: "engineering-leg", title: "Engineering leg", level: 2 as const },
  { id: "statuses", title: "At-risk and breached states", level: 2 as const },
  { id: "reopened-tickets", title: "Reopened tickets", level: 2 as const },
  { id: "policy-changes", title: "Policy changes", level: 2 as const },
  { id: "correlation", title: "Correlation rules", level: 2 as const },
  { id: "reproducibility", title: "Reproducibility", level: 2 as const },
  {
    id: "not-calculated",
    title: "What SLA does not calculate",
    level: 2 as const,
  },
];

const statuses = [
  {
    status: "On track",
    definition:
      "Elapsed working time is below every configured warning threshold.",
    trigger: "Default state on creation.",
    variant: "outline" as const,
  },
  {
    status: "At risk",
    definition:
      "Elapsed working time has crossed a warning threshold (default: 50%, 80%, 95% of target) but the target has not been exceeded.",
    trigger: "Working time crosses a threshold.",
    variant: "warning" as const,
  },
  {
    status: "Breached",
    definition:
      "Elapsed working time has exceeded the target, or the case closed after its target was already consumed.",
    trigger: "Target exceeded, evaluated on every sync cycle.",
    variant: "destructive" as const,
  },
  {
    status: "Met",
    definition:
      "The case closed with elapsed working time still within target.",
    trigger:
      "First response: an agent's first public reply before target is exceeded (a reply-less close is never met). Resolution: the case closes (Zendesk marks it solved) before target is exceeded.",
    variant: "success" as const,
  },
  {
    status: "Cancelled",
    definition:
      "Defined in the data model but not currently produced by any part of the product.",
    trigger: "—",
    variant: "outline" as const,
  },
];

export default function SlaPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Product</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">
              SLA &amp; Targets
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              The engine&apos;s one governing rule: elapsed time is always
              computed from the recorded event history, a specific policy
              version, and a specific calendar version — never stored as a
              running counter.
            </p>
          </div>
        </header>

        <section id="what-is-measured" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            What is being measured
          </h2>

          <p className="leading-7 text-muted-foreground">
            SLA evaluates customer commitments using ordered events, the
            applicable SLA policy version, the applicable business calendar
            version, pause behavior, and the reconstructed work intervals.
            Elapsed time is calculated from the event history rather than
            treated as a permanently stored number — this is what lets any
            number, on any screen, be recomputed and explained later.
          </p>
        </section>

        <section id="commitment-creation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Commitment creation
          </h2>

          <p className="leading-7 text-muted-foreground">
            When a case is created, its attributes — priority, customer, and
            (where populated) tier — are matched against your imported SLA
            policies in Zendesk&apos;s own policy order: the first policy in
            that order whose conditions match wins, exactly as Zendesk itself
            would apply them. A policy created directly in this product has no
            Zendesk order to follow, so it and any other unordered policy fall
            back to most-specific-match-wins: a policy that names this
            specific customer beats one that only names a priority, which beats
            a catch-all default policy. Ties are broken deterministically so the
            same inputs always produce the same match.
          </p>

          <p className="leading-7 text-muted-foreground">
            A case gets exactly one first-response commitment and one
            resolution commitment, matched once, at creation. Changing
            priority, customer, or tier afterward is not ignored, though: on
            the next poll or webhook delivery, any commitment on that case
            that is still open is re-matched and moved onto whichever policy
            version now applies (see{" "}
            <Link
              href="#policy-changes"
              className="underline underline-offset-4"
            >
              Policy changes
            </Link>{" "}
            below). Only a commitment that has already completed — met, or
            breached and closed — keeps the exact policy and calendar version
            it finished under, permanently, so a historical result stays
            reproducible.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>Tier-based matching has no effect yet</AlertTitle>
            <AlertDescription>
              Tier-based policy matching exists in the engine, but no currently
              connected data source (Zendesk or Intercom) populates a customer
              or case tier automatically today.
            </AlertDescription>
          </Alert>
        </section>

        <Separator />

        <section id="business-hours" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Business hours vs. 24/7
          </h2>

          <p className="leading-7 text-muted-foreground">
            A deadline is not simply calculated as{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              start time + target duration
            </code>
            . Each SLA policy is bound to a business calendar — either a set of
            weekly working windows with a timezone and holiday list (imported
            from Zendesk&apos;s own business-hours schedules), or an always-open
            calendar for 24/7 targets. Working minutes are accumulated through
            the applicable calendar; non-working periods and holidays are
            skipped.
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              An 8-hour resolution target opened at 4pm on a Friday, under a
              9-to-5 weekday calendar, doesn&apos;t come due until well into the
              following week — even though far more than 8 clock hours will have
              passed.
            </p>
          </div>

          <p className="leading-7 text-muted-foreground">
            A date marked as a holiday on the applicable calendar contributes
            zero working minutes, even if it would otherwise fall inside a
            normal working window.
          </p>
        </section>

        <section id="running-vs-paused" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Running vs. paused time
          </h2>

          <p className="leading-7 text-muted-foreground">
            The engine reconstructs intervals from normalized events, then
            intersects the running intervals with working hours to sum elapsed
            working time:
          </p>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-5">
            {[
              "Ordered events",
              "Running / paused intervals",
              "Intersect with working hours",
              "Sum elapsed working time",
            ].map((step, index, arr) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border bg-background px-3 py-1.5 text-sm font-medium">
                  {step}
                </span>
                {index < arr.length - 1 && (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section id="customer-waiting" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Customer-caused waiting
          </h2>

          <p className="leading-7 text-muted-foreground">
            A pause is a state predicate over normalized events, not simply a
            provider status string. The customer-facing commitment pauses on
            customer-caused waiting, regardless of which system reports that
            state, and the case timeline shows the pause and its cause.
          </p>

          <p className="leading-7 text-muted-foreground">
            <strong>Zendesk-imported policies never pause Resolution while a
            ticket is Pending</strong>, exactly like Zendesk&apos;s own Total
            Resolution timer, so breach times match Zendesk&apos;s SLA view.
            Policies you create in Elapsed pause on the normalized{" "}
            <strong>&quot;Pending customer&quot;</strong> state by default;
            this is not adjustable per policy from the settings UI today.
            Putting a ticket <strong>on hold</strong> (Zendesk&apos;s internal
            hold status) does not pause the resolution clock — that time
            keeps counting. This is a deliberate choice for the current
            implementation, not a gap: on-hold is for internal triage, not
            customer waiting.
          </p>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>
              Zendesk Pending is not automatically a pause
            </AlertTitle>
            <AlertDescription>
              Zendesk&apos;s First Reply, Next Reply, Periodic Update, and Total
              Resolution targets do not pause merely because a ticket is in
              Pending status, and neither do Zendesk-imported policies here.
              Only policies created in Elapsed pause Resolution on Pending
              customer.
            </AlertDescription>
          </Alert>
        </section>

        <section id="engineering-leg" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Engineering leg
          </h2>

          <p className="leading-7 text-muted-foreground">
            The engineering leg measures the time an escalated case spends in
            the engineering system. Rather than a full OLA policy builder, an
            optional engineering-leg target can be configured as one org-wide
            target number (in hours). Where a target exists, the UI reports the
            observed leg duration against that target on the &quot;Aging in
            engineering&quot; dashboard view.
          </p>

          <p className="text-sm text-muted-foreground">
            Cases exceeding the target show as at-risk/breached for that leg
            specifically, but it does not currently send its own Slack or email
            alert. Configure it under{" "}
            <Link
              href="/docs/configuration"
              className="underline underline-offset-4"
            >
              Settings → SLA
            </Link>
            .
          </p>
        </section>

        <Separator />

        <section id="statuses" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            At-risk and breached states
          </h2>

          <p className="leading-7 text-muted-foreground">
            A commitment moves through a small, fixed set of statuses. Warning
            thresholds are currently fixed at 50%, 80%, and 95% of target for
            every imported policy and are not adjustable from the settings UI.
          </p>

          <DataTableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Definition</TableHead>
                  <TableHead>Transition trigger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((row) => (
                  <TableRow key={row.status}>
                    <TableCell>
                      <Badge variant={row.variant}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.definition}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.trigger}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>

          <p className="text-sm text-muted-foreground">
            Crossing into at risk or breached triggers a Slack and/or email
            alert, if configured — but only for the customer-facing
            first-response and resolution commitments. See{" "}
            <Link
              href="/docs/notifications"
              className="underline underline-offset-4"
            >
              Notifications
            </Link>
            .
          </p>
        </section>

        <section id="reopened-tickets" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Reopened tickets
          </h2>

          <p className="leading-7 text-muted-foreground">
            If a Zendesk ticket is solved and later reopened, the resolution
            commitment&apos;s clock is not reset. It resumes live evaluation
            from the original commitment start time, over the full event
            history — so a ticket that was marked met at solve time can read
            as breached once reopened and re-evaluated, if the total working
            time now exceeds target. The time the ticket spent solved is
            excluded: the clock pauses automatically between the solve and
            the reopen, matching Zendesk&apos;s own behavior, so only time the
            ticket was actually open counts toward the target.
          </p>

          <p className="leading-7 text-muted-foreground">
            A first-response commitment is not affected by a reopen: once an
            agent has replied, its result is final. Closing a ticket before
            an agent ever replied publicly is not treated as a met first
            response — it is reported as breached (once past target) rather
            than shown as met the moment the case closes. On a ticket an
            agent created on the customer&apos;s behalf, the first-response
            clock does not start at ticket creation — it starts at the
            customer&apos;s first message.
          </p>

          <p className="leading-7 text-muted-foreground">
            Closing a case also ends any Next Reply cycle that was still
            waiting on an agent&apos;s answer — an unanswered customer
            message is not carried forward as an open obligation once the
            ticket is closed. If the ticket is reopened and the customer
            writes again, that starts a fresh Next Reply cycle from that new
            message.
          </p>
        </section>

        <section id="policy-changes" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Policy changes
          </h2>

          <p className="leading-7 text-muted-foreground">
            Editing a policy&apos;s target never rewrites history in the sense
            of altering a past record, but it is not invisible to commitments
            already in progress: it creates a new version of that policy, and
            any currently open commitment still matched to that policy moves
            onto the new version — its target, calendar version, and due date
            update, while its clock keeps running from its original start
            time. Only a commitment that has already completed (met, or
            breached and closed) keeps the exact policy version it finished
            under, permanently, so a policy correction never changes a number
            that&apos;s already been reported and closed out.
          </p>
        </section>

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Correlation rules
          </h2>

          <p className="leading-7 text-muted-foreground">
            Only a deterministic, verifiable link is ever created between a
            Zendesk ticket and an engineering-tracker record — nothing is
            guessed. A Jira or Linear issue is linked via its own remote-link
            data, accepted only if the linked URL&apos;s hostname is exactly
            your connected Zendesk subdomain. A GitHub pull request is linked by
            scanning its title or branch name for a Jira- or Linear-style issue
            key that already has a confirmed link.
          </p>

          <p className="leading-7 text-muted-foreground">
            If no verifiable link exists, the case simply has no engineering leg
            — it is excluded from &quot;escalated&quot; counts rather than
            silently attributed to engineering. See the full picture on the{" "}
            <Link
              href="/docs/how-it-works"
              className="underline underline-offset-4"
            >
              How It Works
            </Link>{" "}
            page.
          </p>
        </section>

        <section id="reproducibility" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Reproducibility
          </h2>

          <p className="leading-7 text-muted-foreground">
            The architecture&apos;s central rule is:{" "}
            <strong>store events, not computed time.</strong> The elapsed-time
            result can therefore be recomputed from the same inputs at any point
            — important when you need to understand why a historical number
            changed, or verify how a result was produced. Every commitment on a
            case detail page includes a &quot;How this was calculated&quot;
            disclosure showing the exact policy version, calendar, and pause
            rule applied.
          </p>
        </section>

        <section id="not-calculated" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            What SLA does not calculate
          </h2>

          <p className="leading-7 text-muted-foreground">
            SLA does not calculate service credits, penalties, or financial
            exposure. Account value or tier may be used for prioritization where
            supported, but the product is not intended to make contractual
            financial conclusions.
          </p>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/dashboard"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Dashboard</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  See at-risk and breached commitments in context.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/configuration"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Configuration</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Override targets and calendars.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#what-is-measured"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Back to top
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </DocsLayout>
  );
}
