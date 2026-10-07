import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  {
    id: "overview",
    title: "Overview",
    level: 2 as const,
  },
  {
    id: "who-is-it-for",
    title: "Who is it for?",
    level: 2 as const,
  },
  {
    id: "how-it-works",
    title: "How it works",
    level: 2 as const,
  },
  {
    id: "before-you-start",
    title: "Before you start",
    level: 2 as const,
  },
  {
    id: "setup",
    title: "Setup",
    level: 2 as const,
  },
  {
    id: "first-dashboard",
    title: "Your first dashboard",
    level: 2 as const,
  },
  {
    id: "next-steps",
    title: "Next steps",
    level: 2 as const,
  },
];

const setupSteps = [
  {
    number: "01",
    title: "Connect your support system",
    description:
      "Connect Zendesk so the product can monitor customer-facing cases and their activity.",
  },
  {
    number: "02",
    title: "Connect your engineering system",
    description:
      "Connect Jira so engineering work related to customer cases can be identified and tracked.",
  },
  {
    number: "03",
    title: "Configure SLA behavior",
    description:
      "Define the SLA targets and engineering response expectations that should be monitored.",
  },
  {
    number: "04",
    title: "Review your cases",
    description:
      "Once data is synchronized, review cases, timelines, SLA state, and engineering handoffs.",
  },
];

export const generateMetadata = () => getPageMetadata("/docs/getting-started");

export default function GettingStartedPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Getting Started</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">
              Get started with Elapsed
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Connect your support and engineering systems to understand where
              customer-facing SLA time is being consumed and identify cases that
              are approaching or exceeding their targets.
            </p>
          </div>
        </header>

        <section id="overview" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>

          <p className="leading-7 text-muted-foreground">
            Elapsed brings customer support and engineering activity together
            into a single view. It helps teams identify cases where
            customer-facing work continues while the case is being handled
            across different systems or teams.
          </p>

          <p className="leading-7 text-muted-foreground">
            Instead of relying on manual checks across support tickets,
            engineering issues, and communication channels, the product
            normalizes activity and presents the resulting case timeline and SLA
            state in one place.
          </p>
        </section>

        <section id="who-is-it-for" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Who is it for?
          </h2>

          <p className="leading-7 text-muted-foreground">
            Elapsed is designed for teams responsible for customer response,
            support operations, customer success, and engineering delivery.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "Head of Support",
              "Support Operations",
              "Customer Success",
              "Engineering Managers",
            ].map((role) => (
              <div
                key={role}
                className="flex items-center gap-3 rounded-lg border p-4"
              >
                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{role}</span>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section id="how-it-works" className="scroll-mt-24 space-y-6">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              How it works
            </h2>

            <p className="leading-7 text-muted-foreground">
              The product follows the activity of a customer case across the
              systems involved in handling it.
            </p>
          </div>

          <div className="grid gap-4">
            {[
              {
                title: "Collect",
                description:
                  "Relevant activity is synchronized from your connected systems.",
              },
              {
                title: "Normalize",
                description:
                  "Different provider events are converted into a consistent case timeline.",
              },
              {
                title: "Correlate",
                description:
                  "Related support and engineering records are connected to the same case.",
              },
              {
                title: "Calculate",
                description:
                  "SLA state and elapsed time are calculated from the normalized timeline.",
              },
              {
                title: "Monitor",
                description:
                  "Cases approaching or exceeding their configured targets become visible for action.",
              },
            ].map((step, index) => (
              <div
                key={step.title}
                className="flex gap-4 rounded-lg border p-5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                  {index + 1}
                </div>

                <div className="space-y-1">
                  <h3 className="font-medium">{step.title}</h3>

                  <p className="text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="before-you-start" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Before you start
          </h2>

          <p className="leading-7 text-muted-foreground">
            Make sure you have access to the systems you want to connect and the
            permissions required to configure their integrations.
          </p>

          <Alert>
            <Info className="size-4" />

            <AlertTitle>Recommended setup</AlertTitle>

            <AlertDescription>
              Start with Zendesk and Jira. This gives the product the support
              and engineering context required to track customer handoffs.
            </AlertDescription>
          </Alert>

          <ul className="space-y-3 pt-2">
            {[
              "Access to your Zendesk workspace",
              "Access to your Jira Cloud workspace",
              "Permission to configure the required integrations",
              "Your organization's SLA targets",
              "The engineering response target, if your team uses one",
            ].map((requirement) => (
              <li
                key={requirement}
                className="flex items-start gap-3 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>{requirement}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="setup" className="scroll-mt-24 space-y-6">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">Setup</h2>

            <p className="leading-7 text-muted-foreground">
              Follow these steps to get your workspace ready for monitoring.
            </p>
          </div>

          <div className="space-y-4">
            {setupSteps.map((step) => (
              <div
                key={step.number}
                className="flex gap-5 rounded-xl border p-5"
              >
                <div className="text-sm font-semibold text-muted-foreground">
                  {step.number}
                </div>

                <div className="space-y-1">
                  <h3 className="font-medium">{step.title}</h3>

                  <p className="text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="first-dashboard" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Your first dashboard
          </h2>

          <p className="leading-7 text-muted-foreground">
            After your integrations have synchronized, the dashboard gives you
            an overview of the cases currently being monitored.
          </p>

          <div className="rounded-xl border bg-muted/30 p-6">
            <p className="text-sm font-medium">
              Focus on cases that need attention first.
            </p>

            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review cases approaching their SLA target, cases that have
              breached, and cases currently in an engineering handoff.
            </p>
          </div>
        </section>

        <section id="next-steps" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Next steps</h2>

          <p className="leading-7 text-muted-foreground">
            Once your initial setup is complete, explore the following areas to
            understand the product in more detail.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/integrations/zendesk"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Connect Zendesk</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure your support integration.
                </p>
              </div>

              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/integrations/jira"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Connect Jira</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure engineering tracking.
                </p>
              </div>

              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/cases"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Understand Cases</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Learn how cases and timelines work.
                </p>
              </div>

              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/sla"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Configure SLA</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Understand targets and SLA behavior.
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
