import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const faqs = [
  {
    q: "What systems does SLA Breach Monitoring support?",
    a: "Zendesk and Intercom as ticket sources; Jira, Linear, and GitHub as engineering-side sources; Slack and email for alerts.",
  },
  {
    q: "Is SLA Breach Monitoring read-only?",
    a: "Yes, for every connected data source (Zendesk, Jira, Linear, Intercom, GitHub) — it only reads. The only outbound writes anywhere in the product are a Slack message and an alert email. GitHub is connected through a GitHub App you create with read-only permissions, installed only on the repositories you choose.",
  },
  {
    q: "Does SLA Breach Monitoring modify Zendesk?",
    a: "No. No ticket, field, tag, or comment is ever created or changed.",
  },
  {
    q: "Does SLA Breach Monitoring modify Jira?",
    a: "No. No issue, status, comment, or field is ever created or changed.",
  },
  {
    q: "How far back does historical data go?",
    a: "90 days from the date each integration was connected. This window is fixed and not currently adjustable.",
  },
  {
    q: "How often is data refreshed?",
    a: "Every 5 minutes for open cases, every 30 minutes for a full reconciliation sweep, and near-instantly for Zendesk/Jira when a webhook is configured.",
  },
  {
    q: "How is an SLA calculated?",
    a: 'As working time elapsed against a target, computed from the recorded event history under a specific policy and calendar version, pausing only on the "Pending customer" state by default.',
  },
  {
    q: "What happens when a ticket is escalated?",
    a: "The case's leg switches to engineering the moment a verified link to an engineering-tracker record is recorded. The customer commitment's clock keeps running — escalation itself does not pause it.",
  },
  {
    q: "How does SLA know which Jira issue belongs to a ticket?",
    a: "By reading Jira's own remote-link data on that issue and matching a Zendesk URL against your exact connected subdomain.",
  },
  {
    q: "What happens when there is no link?",
    a: "The case has no engineering leg. It's excluded from escalation counts and never guessed at.",
  },
  {
    q: 'What does "At Risk" mean?',
    a: "A commitment has consumed enough working time to cross a warning threshold (50/80/95% of target by default) without yet exceeding it.",
  },
  {
    q: 'What does "Breached" mean?',
    a: "A commitment's elapsed working time has exceeded its target.",
  },
  {
    q: "Can SLA calculate business hours?",
    a: "Yes — calendars imported from Zendesk's business-hours schedules, or a 24/7 always-open calendar, are used to compute working time.",
  },
  {
    q: "What happens on holidays?",
    a: "A date marked as a holiday on the applicable calendar contributes zero working minutes.",
  },
  {
    q: "Can I change an SLA policy?",
    a: "You can override a policy's first-response/resolution target minutes from Settings → SLA. This creates a new policy version; existing commitments are unaffected, and only new commitments use the new target. Other parts of a policy (match conditions, pause states, warning thresholds) aren't editable from the UI today.",
  },
  {
    q: "What happens when an integration stops working?",
    a: 'It\'s marked "Needs reconnect," a banner appears with a one-click fix, other integrations and organizations keep syncing normally, and no history is lost.',
  },
  {
    q: "Can multiple users access the same organization?",
    a: "The data model supports it, but the current sign-up flow always creates a new organization along with a new user — there is no self-service invite flow to add a teammate to an existing organization today.",
  },
  {
    q: "What data does SLA store?",
    a: "The raw data returned by each connected system's API, a normalized (provider-independent) version of every event, the customers/cases/commitments derived from it, and point-in-time evaluation snapshots.",
  },
  {
    q: "Can SLA calculate service credits?",
    a: "No. There is no financial or service-credit calculation anywhere in the product.",
  },
  {
    q: "Does SLA use AI?",
    a: 'No. The one place that might look like it — the "unusual cycle times" dashboard banner — is a statistical comparison (a modified z-score against each customer\'s own historical median), not a machine-learning or generative model.',
  },
];

export default function FaqPage() {
  return (
    <DocsLayout>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Administration</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">
              Frequently Asked Questions
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Quick, direct answers to the questions that come up most when
              evaluating or running SLA Breach Monitoring.
            </p>
          </div>
        </header>

        <div className="divide-y rounded-xl border">
          {faqs.map((faq) => (
            <div key={faq.q} className="space-y-2 p-5">
              <h2 className="font-medium">{faq.q}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>

        <Separator />

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/troubleshooting"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Troubleshooting</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Running into a specific issue? Start here.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/how-it-works"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">How It Works</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Understand the model behind these answers.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#top"
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
