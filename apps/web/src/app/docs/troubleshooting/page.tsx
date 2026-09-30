import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const toc = [
  {
    id: "zendesk-wont-connect",
    title: "Zendesk won't connect",
    level: 2 as const,
  },
  { id: "jira-wont-connect", title: "Jira won't connect", level: 2 as const },
  {
    id: "jira-pending",
    title: "Jira authorization is pending",
    level: 2 as const,
  },
  { id: "no-tickets", title: "No tickets appear", level: 2 as const },
  { id: "no-jira-issues", title: "No Jira issues appear", level: 2 as const },
  { id: "no-cases-linked", title: "No cases are linked", level: 2 as const },
  {
    id: "historical-missing",
    title: "Historical data is missing",
    level: 2 as const,
  },
  {
    id: "numbers-unexpected",
    title: "SLA numbers look unexpected",
    level: 2 as const,
  },
  {
    id: "wrong-state",
    title: "A case is showing the wrong state",
    level: 2 as const,
  },
  {
    id: "incomplete-timeline",
    title: "Timeline is incomplete",
    level: 2 as const,
  },
  {
    id: "slack-not-arriving",
    title: "Slack notifications are not arriving",
    level: 2 as const,
  },
  { id: "data-stale", title: "Data appears stale", level: 2 as const },
  {
    id: "needs-reauth",
    title: "Integration needs reauthentication",
    level: 2 as const,
  },
  {
    id: "contact-support",
    title: "When to contact support",
    level: 2 as const,
  },
];

type Issue = {
  id: string;
  title: string;
  symptom: string;
  cause?: string;
  check?: string;
  resolution: string;
};

const issues: Issue[] = [
  {
    id: "zendesk-wont-connect",
    title: "Zendesk won't connect",
    symptom:
      "OAuth redirect fails, or you're returned to the connect screen without success.",
    cause:
      "An incorrect subdomain, or the OAuth application isn't configured for your organization yet.",
    check:
      "Confirm the subdomain matches exactly what precedes .zendesk.com in your Zendesk URL, and that your organization has configured Zendesk OAuth credentials under Settings → Integrations → Zendesk → Configure.",
    resolution:
      "Re-enter the correct subdomain and retry. If the Configure step hasn't been completed, complete it first — you can't connect without it.",
  },
  {
    id: "jira-wont-connect",
    title: "Jira won't connect",
    symptom:
      "Atlassian's consent screen doesn't appear, or the connection fails afterward.",
    cause:
      "Jira OAuth credentials not configured for your organization, or the approving user doesn't have access to a Jira site.",
    check:
      "Settings → Integrations → Jira → Configure has valid credentials; the Atlassian account approving the connection has access to the Jira site you intend to connect.",
    resolution: "Complete the Configure step, then retry the connection.",
  },
  {
    id: "jira-pending",
    title: "Jira authorization is pending",
    symptom:
      "A Head of Support has connected Zendesk, but Jira approval is waiting on an engineering administrator.",
    resolution:
      "Proceed with onboarding on Zendesk alone — findings and first-response/resolution accuracy are available without Jira. Connect Jira later from Settings → Integrations with no loss of Zendesk history.",
  },
  {
    id: "no-tickets",
    title: "No tickets appear",
    symptom: "The dashboard or cases list is empty after connecting Zendesk.",
    cause:
      "Backfill hasn't completed yet, or there are genuinely no tickets in the last 90 days.",
    check:
      'The Integrations → Zendesk detail page\'s "Sync status" card shows whether a backfill has completed and when it last ran.',
    resolution:
      'Wait for backfill to complete, or trigger it manually from the "Run backfill" button on that page.',
  },
  {
    id: "no-jira-issues",
    title: "No Jira issues appear",
    symptom:
      "Cases never show an engineering leg even though your team escalates to Jira.",
    cause:
      "Jira isn't connected yet, its backfill hasn't finished, or issues aren't linked using Jira's native remote-link feature.",
    check:
      "Integrations → Jira detail page's sync status; confirm your team links issues via Jira's \"link\" feature (or the official Zendesk-for-Jira app, if in use) rather than pasting URLs into free text.",
    resolution:
      "Connect Jira if not already connected; if it is connected and synced, review your team's linking habits — a pasted URL is not detected as a link.",
  },
  {
    id: "no-cases-linked",
    title: "No cases are linked",
    symptom:
      'Findings or the dashboard show a low or zero "escalations" number despite genuine escalations happening.',
    cause:
      "Links are being created outside Jira/Linear's native remote-link or attachment feature.",
    resolution:
      "Standardize on the native linking feature going forward — this cannot be fixed retroactively for tickets that were linked by convention rather than by feature.",
  },
  {
    id: "historical-missing",
    title: "Historical data is missing",
    symptom: "Tickets or issues older than 90 days don't appear.",
    cause:
      "The backfill window is a fixed 90 days in the current implementation; nothing older is imported.",
    resolution: "None available today — this is a fixed limit, not a setting.",
  },
  {
    id: "numbers-unexpected",
    title: "SLA numbers look unexpected",
    symptom:
      "A commitment's remaining/elapsed time doesn't match your mental math.",
    check:
      'Open the case detail page and expand "How this was calculated" on the commitment in question — it shows the exact policy version, calendar, and pause rule applied.',
    resolution:
      'Most surprises trace back to a business-hours calendar (not 24/7) or the fixed "Pending customer" pause rule not matching your team\'s actual workflow status. Do not assume Zendesk Pending automatically means the customer SLA clock paused.',
  },
  {
    id: "wrong-state",
    title: "A case is showing the wrong state",
    symptom:
      "The leg (support/engineering/waiting on customer) doesn't match what you'd expect.",
    check:
      "The case detail page's activity timeline for the most recent status event; leg attribution is driven entirely by the last recorded status from your connected systems, not by manual assignment.",
    resolution:
      "Confirm the underlying event history in the source system — the leg reflects what was reported, not an expectation.",
  },
  {
    id: "incomplete-timeline",
    title: "Timeline is incomplete",
    symptom: "Gaps in the case journey or activity timeline.",
    cause:
      "The case predates when an integration was connected, or a sync hasn't caught up yet.",
    check:
      "Whether the earliest event shown corresponds to when the relevant integration was first connected and backfilled.",
    resolution:
      "Reconnect or wait for the next sync cycle; a gap before the connection date is expected.",
  },
  {
    id: "slack-not-arriving",
    title: "Slack notifications are not arriving",
    symptom: "No alerts despite commitments crossing thresholds.",
    check:
      "Settings → Integrations → Slack shows a chosen channel; confirm the bot hasn't been removed from that channel in Slack itself.",
    resolution: "Reconnect Slack and re-select a channel if needed.",
  },
  {
    id: "data-stale",
    title: "Data appears stale",
    symptom: "A known recent change in Zendesk/Jira hasn't shown up yet.",
    resolution:
      "Allow up to 5 minutes for an active case under normal polling, or up to 30 minutes in the worst case (reconciliation-only), unless a webhook is configured for that provider (Zendesk/Jira only).",
  },
  {
    id: "needs-reauth",
    title: "Integration needs reauthentication",
    symptom:
      'An integration shows "Needs reconnect" on the Integrations page, or a reconnect banner appears elsewhere.',
    cause: "The stored access/refresh token was rejected or has expired.",
    resolution:
      "Click the reconnect link/button for that provider and re-approve the OAuth prompt. No history is lost — only the credential is refreshed.",
  },
];

export default function TroubleshootingPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Administration</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">
              Troubleshooting
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Find answers to common setup, integration, synchronization, and
              SLA issues.
            </p>
          </div>
        </header>

        <div className="space-y-6">
          {issues.map((issue) => (
            <section
              key={issue.id}
              id={issue.id}
              className="scroll-mt-24 space-y-3 rounded-xl border p-5"
            >
              <h2 className="text-lg font-semibold tracking-tight">
                {issue.title}
              </h2>

              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium text-foreground">Symptom: </span>
                  <span className="text-muted-foreground">{issue.symptom}</span>
                </p>

                {issue.cause && (
                  <p>
                    <span className="font-medium text-foreground">
                      Possible cause:{" "}
                    </span>
                    <span className="text-muted-foreground">{issue.cause}</span>
                  </p>
                )}

                {issue.check && (
                  <p>
                    <span className="font-medium text-foreground">Check: </span>
                    <span className="text-muted-foreground">{issue.check}</span>
                  </p>
                )}

                <p>
                  <span className="font-medium text-foreground">
                    Resolution:{" "}
                  </span>
                  <span className="text-muted-foreground">
                    {issue.resolution}
                  </span>
                </p>
              </div>
            </section>
          ))}
        </div>

        <Separator />

        <section id="contact-support" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            When to contact support
          </h2>

          <Alert>
            <AlertTitle>Signs of a genuine defect</AlertTitle>
            <AlertDescription>
              Contact support if a backfill has been stuck in progress for an
              extended period, if a connection repeatedly fails
              &quot;Configure,&quot; or if a specific case&apos;s calculated
              number contradicts what&apos;s on its &quot;How this was
              calculated&quot; disclosure panel — that would indicate a genuine
              defect rather than one of the expected limitations above.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/faq"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">FAQ</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Answers to common product questions.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/sla"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">SLA &amp; Targets</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Understand how a number was calculated.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#zendesk-wont-connect"
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
