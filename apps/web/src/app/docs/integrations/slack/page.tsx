import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const toc = [
  { id: "purpose", title: "Purpose", level: 2 as const },
  { id: "create-slack-app", title: "Create the Slack app", level: 2 as const },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect Slack", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "choosing-a-channel", title: "Choosing a channel", level: 2 as const },
  { id: "message-format", title: "What messages look like", level: 2 as const },
  { id: "not-a-data-source", title: "Not a data source", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

export default function SlackIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Integrations</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Slack</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Slack is the self-service alert channel — post a message to one
              channel the moment a commitment crosses a warning threshold or
              breaches.
            </p>
          </div>
        </header>

        <section id="purpose" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Purpose</h2>

          <p className="leading-7 text-muted-foreground">
            The intended use is operational: notify about important at-risk
            cases, avoid duplicate alerts, and alert at meaningful warning
            thresholds.
          </p>
        </section>

        <section id="create-slack-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the Slack app
          </h2>

          <p className="leading-7 text-muted-foreground">
            Slack requires its own app definition per organization — created
            once by anyone with permission to install apps to your workspace:
          </p>

          <ol className="space-y-3">
            {[
              <>
                Go to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  api.slack.com/apps
                </code>{" "}
                and click <strong>Create New App → From scratch</strong>. Name
                it (e.g. &quot;Elapsed&quot;) and pick your workspace.
              </>,
              <>
                Open <strong>OAuth &amp; Permissions</strong> in the sidebar.
                Under <strong>Redirect URLs</strong>, add{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://your-app-domain/api/integrations/slack/callback
                </code>
                , replacing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  your-app-domain
                </code>{" "}
                with the domain you access this product at, then save URLs.
              </>,
              <>
                On the same page, under{" "}
                <strong>Scopes → Bot Token Scopes</strong>, add exactly four
                scopes:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  chat:write
                </code>
                ,{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  chat:write.public
                </code>
                ,{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  channels:read
                </code>
                , and{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  groups:read
                </code>
                .
              </>,
              <>
                Open <strong>Basic Information</strong> in the sidebar and
                expand <strong>App Credentials</strong> — copy the{" "}
                <strong>Client ID</strong> and <strong>Client Secret</strong>{" "}
                shown there.
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
            In Elapsed, go to{" "}
            <strong>Settings → Integrations → Slack → Configure</strong> and
            paste in the Client ID and Client Secret, then save.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect Slack
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page, click{" "}
            <strong>Connect Slack</strong> and approve the OAuth install prompt
            for your workspace. You&apos;ll be returned automatically, ready to
            choose an alert channel.
          </p>
        </section>

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            Bot scopes requested:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              chat:write
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              chat:write.public
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              channels:read
            </code>
            , and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              groups:read
            </code>{" "}
            — enough to post messages and list channels for the picker; nothing
            else.
          </p>
        </section>

        <Separator />

        <section id="choosing-a-channel" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Choosing a channel
          </h2>

          <p className="leading-7 text-muted-foreground">
            After connecting, click <strong>Choose a channel</strong> to load
            the list of public and private channels the bot can see, select one
            from the dropdown, and click <strong>Save channel</strong>. You can
            change it later with the <strong>Change channel</strong> button on
            the same page.
          </p>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>One channel per organization</AlertTitle>
            <AlertDescription>
              There is exactly one alert channel per organization in the current
              implementation — no per-severity or per-team routing.
            </AlertDescription>
          </Alert>
        </section>

        <section id="message-format" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            What messages look like
          </h2>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-6">
            <p>
              🚨 First response SLA breached — #4821 for Acme Corp, over target
              by 1h 12m.
            </p>
            <p>
              ⚠️ Resolution SLA at risk — #4821 for Acme Corp, 80% of target
              used, 1h 36m remaining.
            </p>
          </div>

          <p className="leading-7 text-muted-foreground">
            Messages are sent the moment a first-response or resolution
            commitment crosses a warning threshold (50/80/95%) or breaches,
            checked on every sync cycle and immediately on a Zendesk/Jira
            webhook delivery, if configured. Each commitment/threshold
            combination alerts at most once, ever.
          </p>
        </section>

        <section id="not-a-data-source" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Not a data source
          </h2>

          <p className="leading-7 text-muted-foreground">
            Slack is outbound-only. It does not become a source of truth for SLA
            timing in the core model, and nothing SLA reads from Slack feeds
            back into a case&apos;s calculation.
          </p>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>No per-severity routing</AlertTitle>
            <AlertDescription>
              At-risk and breach alerts for every customer and commitment type
              go to the same single channel.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>Engineering-leg target has no alert</AlertTitle>
            <AlertDescription>
              The optional, org-wide engineering-leg target is dashboard-only —
              it does not trigger its own Slack alert.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/notifications"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Notifications</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Compare Slack and email alerting.
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
                  Notifications not arriving? Start here.
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
