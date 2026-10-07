import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  { id: "all-cases", title: "All cases", level: 2 as const },
  {
    id: "sla-vs-case-status",
    title: "SLA status vs. case status",
    level: 2 as const,
  },
  { id: "case-detail", title: "Case detail", level: 2 as const },
  { id: "case-journey", title: "Case journey", level: 2 as const },
  { id: "activity-timeline", title: "Activity timeline", level: 2 as const },
  { id: "time-by-stage", title: "Time by stage", level: 2 as const },
  { id: "linked-records", title: "Linked records", level: 2 as const },
  {
    id: "missing-uncertain",
    title: "Missing or uncertain events",
    level: 2 as const,
  },
];

export const generateMetadata = () => getPageMetadata("/docs/cases");

export default function CasesPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Product</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Cases</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              A case follows one customer request across every system it
              touches. The All cases table finds it; the case detail page
              explains it.
            </p>
          </div>
        </header>

        <section id="all-cases" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">All cases</h2>

          <p className="leading-7 text-muted-foreground">
            The <strong>All cases</strong> page (
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              /cases
            </code>
            ) lists every case your organization has — open and closed, from
            every connected ticket source — in one searchable, sortable,
            paginated table.
          </p>

          <p className="leading-7 text-muted-foreground">
            Columns: Customer, Case (subject), Ticket number, Priority, Tier,
            Channel, SLA status, Case status, Opened date, Closed date.
            Priority, tier, and channel are read as-is from the source ticket —
            they are not modified or interpreted beyond being used to match SLA
            policies.
          </p>

          <p className="text-sm text-muted-foreground">
            The table supports full-text search, column sort, column reordering
            and resizing, adjustable page size, and CSV export of every case
            matching the current view.
          </p>
        </section>

        <section id="sla-vs-case-status" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            SLA status vs. case status
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">SLA status</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Rolls up all of a case&apos;s commitments into one badge, in
                priority order: Breached &gt; At Risk &gt; On Track &gt; Met
                &gt; Cancelled.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Case status</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open or Closed — independent of SLA status. A case can be closed
                and still show a breached SLA status, because closing the ticket
                doesn&apos;t erase what already happened to its commitments.
              </p>
            </div>
          </div>
        </section>

        <Separator />

        <section id="case-detail" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Case detail</h2>

          <p className="leading-7 text-muted-foreground">
            The case detail page (
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              /cases/[caseId]
            </code>
            ) is where a specific number gets explained. It reconstructs the
            full lifecycle of one case from every recorded event, across every
            connected system.
          </p>

          <p className="leading-7 text-muted-foreground">
            The header shows customer, subject/ticket number, current leg,
            priority/tier/channel badges, opened and (if applicable) resolved
            timestamps, and a direct link back to the ticket in Zendesk.
          </p>

          <p className="leading-7 text-muted-foreground">
            Below it, one card per active commitment (first response,
            resolution) shows its status, its headline number (remaining,
            overdue, or over-target), its target and due time, and a{" "}
            <strong>&quot;How this was calculated&quot;</strong> disclosure —
            the number is never presented without a way to see how it was
            produced.
          </p>
        </section>

        <section id="case-journey" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Case journey
          </h2>

          <p className="leading-7 text-muted-foreground">
            A horizontal stage-timeline bar shows one colored segment per period
            the case spent in a given leg — support, engineering, waiting on
            customer, unknown — with a legend showing total time per leg. Below
            it, a second bar shows the commitment&apos;s running vs. paused
            intervals across the same timeline, so you can see at a glance when
            the clock was and wasn&apos;t counting.
          </p>

          <div className="rounded-xl border bg-muted/30 p-5 font-mono text-xs leading-6 text-muted-foreground">
            <p>09:10 Ticket created</p>
            <p>10:05 Support activity</p>
            <p>11:20 Escalated to engineering</p>
            <p>11:20 Engineering leg starts</p>
            <p>13:45 Engineering status changes</p>
            <p>14:10 Waiting on customer</p>
            <p>15:00 Customer responds</p>
            <p>16:20 Case resolved</p>
          </div>

          <p className="text-sm text-muted-foreground">
            The exact events shown depend on the source data available for that
            case.
          </p>
        </section>

        <section id="activity-timeline" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Activity timeline
          </h2>

          <p className="leading-7 text-muted-foreground">
            Every normalized event on the case, in order, with an icon by type
            (created, status changed, issue linked/unlinked, case closed), who
            or what triggered it (customer, agent, or system), and which
            connected system it came from. A glossary (the &quot;?&quot; icon)
            explains every normalized status in plain language directly in the
            UI.
          </p>

          <p className="leading-7 text-muted-foreground">
            The timeline is a rendering of events your own connected systems
            reported — it is not an inference about intent, and it will never
            show a boundary between two legs that isn&apos;t backed by an actual
            recorded event (or, for the very first span on a case, bounded by
            the case&apos;s own creation time when no earlier event exists).
          </p>
        </section>

        <section id="time-by-stage" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Time by stage
          </h2>

          <p className="leading-7 text-muted-foreground">
            For a breached commitment, the product reports time by stage rather
            than assigning blame. The preferred language is time in support,
            time in engineering, time waiting on customer, and unattributed
            time.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>Time by stage is not a verdict</AlertTitle>
            <AlertDescription>
              Avoid framing a breach as proving that a particular team caused
              it. Time-by-stage answers &quot;where did the time go,&quot; not
              &quot;whose fault was it.&quot;
            </AlertDescription>
          </Alert>
        </section>

        <section id="linked-records" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Linked records
          </h2>

          <p className="leading-7 text-muted-foreground">
            Every external record this case is connected to — the Zendesk ticket
            itself, plus any linked Jira issue, Linear issue, or GitHub pull
            request — is shown along with how the link was established and its
            live status label pulled from that system. Read more about how links
            are established on the{" "}
            <Link
              href="/docs/how-it-works"
              className="underline underline-offset-4"
            >
              How It Works
            </Link>{" "}
            page.
          </p>
        </section>

        <section id="missing-uncertain" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Missing or uncertain events
          </h2>

          <p className="leading-7 text-muted-foreground">
            The system is designed to surface uncertainty rather than hide it.
            The goal is that you can distinguish a measured fact from a
            reconstructed or incomplete interval.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                cause: "Ambiguous handoff",
                result: "Unattributed/unknown span",
              },
              {
                cause: "Missing handoff event",
                result: "Inferred boundary",
              },
              {
                cause: "Contradictory signals",
                result: "Unknown",
              },
              {
                cause: "Missing Zendesk–Jira link",
                result: "No engineering leg",
              },
            ].map((row) => (
              <div key={row.cause} className="rounded-lg border p-4">
                <p className="text-sm font-medium">{row.cause}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  → {row.result}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/sla"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">SLA &amp; Targets</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  How commitments and statuses are calculated.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/dashboard"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Dashboard</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  See which cases need attention first.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#all-cases"
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
