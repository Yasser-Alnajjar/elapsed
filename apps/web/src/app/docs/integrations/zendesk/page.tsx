import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const toc = [
  { id: "purpose", title: "Purpose", level: 2 as const },
  {
    id: "create-oauth-client",
    title: "Create the Zendesk OAuth client",
    level: 2 as const,
  },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect Zendesk", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "data-imported", title: "Data imported", level: 2 as const },
  { id: "data-used", title: "Data used for calculations", level: 2 as const },
  { id: "correlation", title: "Data used for correlation", level: 2 as const },
  { id: "not-modified", title: "Data not modified", level: 2 as const },
  { id: "sync", title: "Sync behavior", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

export default function ZendeskIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Integrations</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Zendesk</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Zendesk is the system of record for what you promised — SLA
              policies, business calendars, customers, and the full ticket
              history.
            </p>
          </div>
        </header>

        <section id="purpose" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Purpose</h2>

          <p className="leading-7 text-muted-foreground">
            Zendesk supplies your SLA policy definitions, your business-hours
            calendars, your customers (as Zendesk organizations), and the full
            ticket history the resolution and first-response clocks are computed
            from.
          </p>
        </section>

        <section id="create-oauth-client" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the Zendesk OAuth client
          </h2>

          <p className="leading-7 text-muted-foreground">
            Every organization brings its own Zendesk OAuth application — there
            is no shared, built-in app you connect through by default. An
            administrator on your Zendesk account creates one, once:
          </p>

          <ol className="space-y-3">
            {[
              <>
                In Zendesk, go to{" "}
                <strong>
                  Admin Center → Apps and integrations → APIs → Zendesk API
                </strong>
                , then open the <strong>OAuth Clients</strong> tab.
              </>,
              <>
                Click <strong>Add OAuth client</strong>. Give it a name (e.g.
                &quot;Elapsed&quot;) — the unique identifier fills in
                automatically.
              </>,
              <>
                In <strong>Redirect URLs</strong>, add the callback URL for this
                product:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://your-app-domain/api/integrations/zendesk/callback
                </code>
                , replacing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  your-app-domain
                </code>{" "}
                with the domain you access this product at.
              </>,
              <>
                Save the client. Zendesk shows the <strong>Secret</strong>{" "}
                exactly once — copy it immediately, along with the{" "}
                <strong>Unique identifier</strong> (this is your Client ID).
                Zendesk will not show the secret again; if you lose it,
                you&apos;ll need to regenerate it.
              </>,
            ].map((content, index) => (
              <li key={index} className="flex gap-4 rounded-lg border p-4">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                  {index + 1}
                </div>
                <p className="text-sm text-muted-foreground">{content}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="configure-in-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Add the credentials
          </h2>

          <p className="leading-7 text-muted-foreground">
            Back in Elapsed, go to{" "}
            <strong>Settings → Integrations → Zendesk → Configure</strong> and
            paste in the <strong>Client ID</strong> (the unique identifier from
            step 2) and the <strong>Client Secret</strong> you copied, then
            save. The secret is write-only — once saved, it is never displayed
            again; editing it later means supplying a new one, not viewing the
            old one.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect Zendesk
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page (or during onboarding), enter your
            Zendesk subdomain — the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">xxx</code>{" "}
            in{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              xxx.zendesk.com
            </code>{" "}
            — and click <strong>Connect Zendesk</strong>. You&apos;ll be
            redirected to Zendesk to approve the read-only OAuth prompt, then
            returned automatically once approved.
          </p>
        </section>

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            OAuth scope:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">read</code>
            . No write scope is ever requested.
          </p>
        </section>

        <Separator />

        <section id="data-imported" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data imported
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Tickets (incremental export — every ticket, current and
              historical, within the 90-day backfill window)
            </li>
            <li>
              • Full audit trail per ticket (every status change and event)
            </li>
            <li>• Organizations (become Customers)</li>
            <li>• SLA policy definitions</li>
            <li>• Business-hours schedules and holidays</li>
            <li>
              • Requester and assignee display names (from the ticket&apos;s own
              user sideload). Display only — shown on the case header, never
              used for matching, routing, or SLA calculations.
            </li>
          </ul>
        </section>

        <section id="data-used" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for calculations
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Ticket status transitions drive the case timeline and the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                pending_customer
              </code>{" "}
              pause state.
            </li>
            <li>
              • Imported SLA policies supply commitment targets (first-response
              and resolution minutes) and warning thresholds.
            </li>
            <li>
              • Imported business-hours schedules supply the calendar used to
              compute working time, unless overridden per customer.
            </li>
          </ul>
        </section>

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for correlation
          </h2>

          <p className="leading-7 text-muted-foreground">
            Zendesk doesn&apos;t initiate correlation itself — Jira and Linear
            look for a Zendesk ticket URL in their own records (remote links,
            attachments) and match it back to a Zendesk ticket by exact
            subdomain. See{" "}
            <Link
              href="/docs/how-it-works"
              className="underline underline-offset-4"
            >
              How It Works
            </Link>
            .
          </p>
        </section>

        <section id="not-modified" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data not modified
          </h2>

          <p className="leading-7 text-muted-foreground">
            Nothing. No ticket, field, tag, or comment is ever created or
            changed in Zendesk.
          </p>
        </section>

        <Separator />

        <section id="sync" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sync behavior
          </h2>

          <p className="leading-7 text-muted-foreground">
            Polled every 5 minutes (active cases) and every 60 minutes (full
            reconciliation). SLA policies and business-hours schedules are
            re-imported every cycle, so a policy edit in Zendesk is picked up
            automatically without reconnecting.
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              Optional: enable the real-time webhook
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Once Zendesk is connected, its detail page shows a copyable{" "}
              <strong>Endpoint URL</strong> and <strong>Bearer token</strong>.
              In <strong>Zendesk Admin Center</strong>, create a webhook using
              that Endpoint URL (Request format: JSON), with Authentication set
              to <strong>Bearer token</strong> using the token shown (Zendesk
              only generates its own signing secret after creation, so use this
              field instead). Then add a trigger that calls the webhook on
              ticket status changes, with request body{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {`{"ticket_id": "{{ticket.id}}", "timestamp": "{{ticket.updated_at_with_timestamp}}"}`}
              </code>
              . The{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                timestamp
              </code>{" "}
              field is required for replay protection and must use that exact
              placeholder: plain{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{ticket.updated_at}}`}</code>{" "}
              renders only a date (e.g. &ldquo;May 18&rdquo;), so those requests
              are rejected with{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                401
              </code>
              . Zendesk&rsquo;s <strong>Test webhook</strong> button sends a
              sample body with no{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                timestamp
              </code>{" "}
              and doesn&rsquo;t fill in placeholders, so it gets that{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                401
              </code>{" "}
              too. To test from there, replace the body with a real ticket id
              and the current UTC time, e.g.{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{"ticket_id": "123", "timestamp": "2026-09-17T08:40Z"}`}</code>
              , sent within 5 minutes of that time. This closes the last few
              minutes of latency between polls — it is optional, and everything
              works without it.
            </p>
          </div>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>Only two SLA metrics map to commitments</AlertTitle>
            <AlertDescription>
              First reply time → first-response, and resolution time →
              resolution. Other Zendesk metrics (next-reply time, requester-wait
              time, agent-work time, periodic-update time) are not currently
              imported as separate commitments.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>
              Only priority and organization conditions apply
            </AlertTitle>
            <AlertDescription>
              Policy conditions based on fields other than priority and
              organization (e.g. tags, ticket form, group) are not currently
              applied — a policy using them will still import, but those extra
              conditions are dropped from the match, which can make the imported
              policy match more broadly than it does inside Zendesk itself.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>Missing schedules fall back to 24/7</AlertTitle>
            <AlertDescription>
              If a policy references a business-hours schedule that hasn&apos;t
              been imported yet, it falls back to an always-open (24/7) calendar
              until that schedule is available — the product never guesses at a
              calendar.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/docs/integrations/jira"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Jira</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect the engineering-side source.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/integrations/intercom"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Intercom</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  An alternative ticket source.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/troubleshooting"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Troubleshooting</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connection or data issues? Start here.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>

        <div className="border-t pt-8">
          <a
            href="#purpose"
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
