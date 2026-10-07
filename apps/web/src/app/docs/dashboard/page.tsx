import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  { id: "overview", title: "Overview", level: 2 as const },
  {
    id: "unusual-cycle-times",
    title: "Unusual cycle times",
    level: 2 as const,
  },
  {
    id: "headline-numbers",
    title: "The three headline numbers",
    level: 2 as const,
  },
  { id: "sla-analytics", title: "SLA analytics", level: 2 as const },
  {
    id: "operational-attention",
    title: "Operational attention",
    level: 2 as const,
  },
  { id: "findings", title: "Findings (first run)", level: 2 as const },
  { id: "exports", title: "Reports and exports", level: 2 as const },
];

const tiles = [
  {
    tile: "Breached",
    meaning:
      "Count of commitments that crossed their target and are still open or closed as breached.",
    period: "Last 30 days",
  },
  {
    tile: "Compliance",
    meaning:
      "Percentage of closed commitments in the period that closed met rather than breached, with a trend indicator against the prior 30-day period.",
    period: "Last 30 days",
  },
  {
    tile: "Aging in engineering",
    meaning:
      "Count of cases currently sitting in the engineering leg right now.",
    period: "Point-in-time",
  },
];

const charts = [
  {
    name: "Breaches Over Time",
    description:
      "A daily line chart of breach counts across the period, by the UTC day each commitment actually ran out of time (business hours and customer pauses included), not the day it was first synced or evaluated.",
  },
  {
    name: "SLA Compliance",
    description:
      "A donut chart of all cases in the period by their worst commitment status: Met, At Risk, Breached.",
  },
  {
    name: "Breaches by Stage",
    description:
      'A horizontal bar chart of breached time attributed to each leg (support, engineering, waiting on customer, unknown) — the "where did the time go" view, not a ranking of teams.',
  },
];

export const generateMetadata = () => getPageMetadata("/docs/dashboard");

export default function DashboardPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Product</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              The single screen meant to answer &quot;what needs attention right
              now,&quot; followed by a monthly-report-style analytics section.
            </p>
          </div>
        </header>

        <section id="overview" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>

          <p className="leading-7 text-muted-foreground">
            The MVP dashboard is designed to answer three questions immediately:
            what needs attention now, what breached during the selected period,
            and which escalations are aging. The core dashboard areas are
            at-risk commitments, breached commitments, and escalations by age.
          </p>
        </section>

        <section id="unusual-cycle-times" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Unusual cycle times
          </h2>

          <p className="leading-7 text-muted-foreground">
            Shown only when detected: a warning banner listing
            customer/commitment-type combinations whose recent resolution times
            are statistically unusual compared to their own history.
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              &quot;Acme Corp · Resolution is running slower than usual: recent
              median 6h 40m vs. baseline 2h 10m (5 recent of 18 historical
              cases).&quot;
            </p>
          </div>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>Statistics, not AI</AlertTitle>
            <AlertDescription>
              This is a statistical comparison — a modified z-score against the
              customer&apos;s own historical median — not a prediction or a
              generative-AI insight. It requires at least 12 historical closed
              commitments and 5 recent ones before it says anything for a given
              customer/kind pair.
            </AlertDescription>
          </Alert>
        </section>

        <Separator />

        <section id="headline-numbers" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            The three headline numbers
          </h2>

          <div className="grid gap-4 sm:grid-cols-3">
            {tiles.map((tile) => (
              <div key={tile.tile} className="rounded-lg border p-4">
                <p className="text-sm font-semibold">{tile.tile}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tile.meaning}
                </p>
                <Badge variant="outline" className="mt-3">
                  {tile.period}
                </Badge>
              </div>
            ))}
          </div>
        </section>

        <section id="sla-analytics" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            SLA analytics
          </h2>

          <p className="leading-7 text-muted-foreground">
            Three charts, all computed from the same 30-day period as the tiles
            above. Each chart shows a plain empty state (e.g. &quot;No breaches
            in this period&quot;) rather than an empty or broken-looking chart
            when there&apos;s nothing to plot yet.
          </p>

          <div className="space-y-3">
            {charts.map((chart) => (
              <div key={chart.name} className="rounded-lg border p-4">
                <p className="text-sm font-medium">{chart.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {chart.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="operational-attention" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Operational attention
          </h2>

          <div className="space-y-3">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">At risk now</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A live, searchable, sortable table of every open commitment,
                showing customer, case (linked to its detail page), ticket
                number, commitment type, status, remaining time (shown as
                &quot;X overdue&quot; in red once past due), current leg, and
                time in that leg. Includes a CSV export of what&apos;s currently
                shown and a manual refresh control.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Breached cases</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A collapsible list of every case that breached in the last 30
                days, each linking to its case detail page.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Aging in engineering</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A list of cases currently in the engineering leg, sorted by how
                long they&apos;ve been there, showing remaining/over-by time
                against the engineering leg target if one is configured.
              </p>
            </div>
          </div>
        </section>

        <section id="findings" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Findings (first run)
          </h2>

          <p className="leading-7 text-muted-foreground">
            Before you reach the dashboard for the first time, the findings
            screen gives you a plain-language summary of your last 90 days,
            computed with zero configuration — e.g. &quot;Over the last 90 days,
            318 tickets were escalated to Jira. 47 of them exceeded their
            customer resolution target,&quot; plus a{" "}
            <strong>Top affected accounts</strong> table (up to 5 rows). See{" "}
            <Link
              href="/docs/getting-started"
              className="underline underline-offset-4"
            >
              Getting Started
            </Link>{" "}
            for the full onboarding flow.
          </p>
        </section>

        <section id="exports" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Reports and exports
          </h2>

          <p className="leading-7 text-muted-foreground">
            The <strong>At risk now</strong> table and the{" "}
            <strong>All cases</strong> table both have an{" "}
            <strong>Export CSV</strong> button that downloads exactly
            what&apos;s currently shown in that table (respecting your current
            search/filter/sort).
          </p>

          <p className="leading-7 text-muted-foreground">
            The dashboard&apos;s <strong>Export Full Report</strong> button
            (top right) covers every commitment your organization has, open
            and closed, with no date-range or status filter — the report to
            use for a QBR or an audit trail. It offers CSV or JSON. PDF export is not currently available.
          </p>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/cases"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Cases</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drill into a single case&apos;s timeline.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/notifications"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Notifications</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Get alerted before a breach happens.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#overview"
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
