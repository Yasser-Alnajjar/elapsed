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

const toc = [
  { id: "the-problem", title: "The problem", level: 2 as const },
  { id: "the-core-idea", title: "The core idea", level: 2 as const },
  { id: "glossary", title: "A short glossary", level: 2 as const },
  { id: "worked-example", title: "A worked example", level: 2 as const },
  { id: "data-flow", title: "From provider data to a case", level: 2 as const },
  { id: "case-lifecycle", title: "Case lifecycle", level: 2 as const },
  { id: "correlation", title: "Correlation", level: 2 as const },
  { id: "confidence", title: "Confidence", level: 2 as const },
  { id: "read-only", title: "Read-only by design", level: 2 as const },
  { id: "next-steps", title: "Next steps", level: 2 as const },
];

const glossary = [
  {
    term: "Customer",
    meaning:
      "An account, derived automatically from your helpdesk's organizations/companies — never typed in by hand.",
  },
  {
    term: "Case",
    meaning:
      "One customer request, followed across every system it touches (a Zendesk ticket, possibly linked to a Jira issue, a Linear issue, or a GitHub pull request).",
  },
  {
    term: "Commitment",
    meaning:
      'One obligation attached to a case — e.g. "first response, 1 hour" or "resolution, 8 business hours" — bound to the specific policy and calendar in effect when it was created.',
  },
  {
    term: "Leg",
    meaning:
      "Which system currently owns the case: support, engineering, waiting_customer, or unknown.",
  },
  {
    term: "At risk",
    meaning:
      "A commitment has consumed enough of its target time to cross a warning threshold, but has not yet run out.",
  },
  {
    term: "Breached",
    meaning: "A commitment's target has been exceeded.",
  },
  {
    term: "Timeline",
    meaning:
      "The ordered sequence of every recorded event on a case, across every connected system, used to compute everything above.",
  },
];

const flowSteps = [
  "Provider API",
  "Adapter",
  "Raw events",
  "Normalizer",
  "Normalized events",
  "Correlator",
  "Case + Case Link",
  "SLA / leg engine",
  "Evaluation",
  "Dashboard + notifications",
];

const lifecycleSteps = [
  "Ticket created",
  "Case opened",
  "Customer resolved from Zendesk organization",
  "Commitments created from the applicable SLA policy",
  "Events accumulate from Zendesk and Jira",
  "Support / engineering / waiting-on-customer spans are derived",
  "Commitments are evaluated",
  "On-track → At-risk → Met or Breached",
  "Case closed and evaluation retained",
];

export default function HowItWorksPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">How It Works</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">
              How Elapsed works
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              SLA treats an escalated customer issue as one case whose timeline
              can cross system boundaries — reconstructing a single, explainable
              clock from the events your connected systems actually reported.
            </p>
          </div>
        </header>

        <section id="the-problem" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">The problem</h2>

          <p className="leading-7 text-muted-foreground">
            A support commitment is easy to track as long as a ticket stays
            inside the helpdesk. The moment it&apos;s escalated — linked to a
            Jira issue, handed to an engineer — the customer&apos;s clock keeps
            running, but visibility splits across two systems that don&apos;t
            talk to each other in SLA terms. Zendesk shows
            &quot;escalated&quot;; Jira shows &quot;In Progress&quot; or
            &quot;Blocked&quot;. Neither tells you what fraction of the
            customer&apos;s window has already been consumed while the case sat
            in the other one.
          </p>

          <p className="leading-7 text-muted-foreground">
            Elapsed reconstructs one honest elapsed-time number per commitment,
            across however many systems the work touched, from the events those
            systems actually reported — and shows its work, so the number is
            something you can explain rather than defend.
          </p>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>A word on how we talk about this</AlertTitle>
            <AlertDescription>
              When a commitment breaches while most of the elapsed time occurred
              inside engineering&apos;s queue, that is a fact about where the
              time went — not a verdict about who is at fault. SLA reports time
              by stage; it never names a &quot;responsible team.&quot;
            </AlertDescription>
          </Alert>
        </section>

        <section id="the-core-idea" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            The core idea
          </h2>

          <p className="leading-7 text-muted-foreground">
            Zendesk records the customer-facing support work. Jira records the
            engineering-side work. SLA reconstructs the events from both systems
            and evaluates the customer commitment against the combined timeline.
          </p>

          <p className="leading-7 text-muted-foreground">
            The MVP uses two primary work legs — <strong>support</strong> (work
            represented in the helpdesk) and <strong>engineering</strong> (work
            represented in the engineering tracker) — plus a{" "}
            <strong>waiting-on-customer</strong> state. Ownership is derived
            from the observable event history rather than configured through
            team mapping. A handoff is treated as an event boundary, represented
            by the linked engineering issue being created or the ticket entering
            an escalated state, depending on the available signals.
          </p>
        </section>

        <section id="glossary" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            A short glossary
          </h2>

          <div className="overflow-hidden rounded-lg border px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">Term</TableHead>
                  <TableHead className="pe-4">Meaning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {glossary.map((row) => (
                  <TableRow key={row.term}>
                    <TableCell className="ps-4 font-medium">
                      {row.term}
                    </TableCell>
                    <TableCell className="pe-4 text-muted-foreground">
                      {row.meaning}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <Separator />

        <section id="worked-example" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            A worked example
          </h2>

          <p className="leading-7 text-muted-foreground">
            A customer submits a P1 ticket in Zendesk. The moment the ticket is
            created, Elapsed matches it against your imported Zendesk SLA
            policies and opens two commitments — a first-response target and a
            resolution target — each bound to the exact policy version and
            business calendar in effect at that instant.
          </p>

          <p className="leading-7 text-muted-foreground">
            Support responds, then escalates the ticket by linking it to a Jira
            issue through Jira&apos;s own remote-link mechanism — no manual
            re-entry. The case&apos;s leg switches from{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              support
            </code>{" "}
            to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              engineering
            </code>{" "}
            the instant that link is recorded. The resolution commitment&apos;s
            clock keeps running — it does not pause on escalation, only on
            customer-caused waiting (by default, only Zendesk&apos;s
            &quot;Pending&quot; status).
          </p>

          <p className="leading-7 text-muted-foreground">
            Engineering works the issue. Every status change on the Jira issue
            is recorded as a normalized event on the case&apos;s timeline. As
            elapsed working time climbs past 80% of the 8-hour target, the case
            shows as at risk on the dashboard and a Slack alert fires, if
            configured. If the Jira issue is resolved and the Zendesk ticket is
            marked solved before the target is consumed, the commitment closes
            met. If not, it closes breached, and the case detail page shows
            exactly how much elapsed time was spent in each leg.
          </p>

          <p className="leading-7 text-muted-foreground">
            That&apos;s the whole model: two legs plus a customer-wait state, a
            small number of explicit statuses, and one clock that survives the
            handoff.
          </p>
        </section>

        <section id="data-flow" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            From provider data to a case
          </h2>

          <p className="leading-7 text-muted-foreground">
            The provider-specific adapter is kept separate from the SLA
            calculation layer, so the calculation model never depends on
            Zendesk-specific or Jira-specific status strings.
          </p>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-5">
            {flowSteps.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border bg-background px-3 py-1.5 text-sm font-medium">
                  {step}
                </span>
                {index < flowSteps.length - 1 && (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section id="case-lifecycle" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Case lifecycle
          </h2>

          <div className="space-y-2">
            {lifecycleSteps.map((step, index) => (
              <div
                key={step}
                className="flex items-center gap-4 rounded-lg border p-4"
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                  {index + 1}
                </div>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Correlation</h2>

          <p className="leading-7 text-muted-foreground">
            SLA deliberately favors deterministic relationships. It uses signals
            such as official Zendesk–Jira integration links, Jira remote links
            pointing to a Zendesk ticket, and structured external references.
            Weak signals such as title similarity or shared participants are
            never treated as proof that two records are the same case.
          </p>

          <p className="leading-7 text-muted-foreground">
            If SLA cannot confidently establish that a Jira issue belongs to a
            Zendesk ticket, the product does not use that relationship to
            manufacture an SLA number — coverage is visible instead:
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              Linked 214 of 318 escalations (67%).
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The remaining cases are not silently assigned to engineering.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Read the full correlation rules on the{" "}
            <Link href="/docs/sla" className="underline underline-offset-4">
              SLA &amp; Targets
            </Link>{" "}
            page.
          </p>
        </section>

        <section id="confidence" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Confidence</h2>

          <p className="leading-7 text-muted-foreground">
            The architecture defines three levels for timeline certainty.
            Unknown or unattributed time remains visible rather than being
            silently redistributed.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <Badge variant="success" className="mb-2">
                Certain
              </Badge>
              <p className="text-sm text-muted-foreground">
                Boundaries are backed by explicit events.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <Badge variant="warning" className="mb-2">
                Inferred
              </Badge>
              <p className="text-sm text-muted-foreground">
                A boundary is bounded by surrounding known events.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <Badge variant="outline" className="mb-2">
                Unknown
              </Badge>
              <p className="text-sm text-muted-foreground">
                Signals are contradictory or missing.
              </p>
            </div>
          </div>
        </section>

        <section id="read-only" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Read-only by design
          </h2>

          <p className="leading-7 text-muted-foreground">
            The product is designed around observation. It does not
            auto-reassign tickets, auto-comment, or write back to Zendesk or
            Jira. Keeping the integrations read-only reduces the security and
            procurement impact of connecting them.
          </p>
        </section>

        <section id="next-steps" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Next steps</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/sla"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">SLA &amp; Targets</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  See exactly how elapsed time is calculated.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/cases"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Cases</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Learn how a case timeline is built.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#the-problem"
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
