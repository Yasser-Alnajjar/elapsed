import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

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
  { id: "purpose", title: "Purpose", level: 2 as const },
  {
    id: "create-oauth-app",
    title: "Create the Atlassian OAuth app",
    level: 2 as const,
  },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect Jira", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "data-imported", title: "Data imported", level: 2 as const },
  { id: "data-used", title: "Data used for calculations", level: 2 as const },
  { id: "correlation", title: "Data used for correlation", level: 2 as const },
  { id: "not-modified", title: "Data not modified", level: 2 as const },
  { id: "sync", title: "Sync behavior", level: 2 as const },
  { id: "what-happens-when", title: "What happens when...", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

const situations = [
  {
    situation: "A Jira issue is linked to a Zendesk ticket (via remote link)",
    behavior:
      "The case's leg switches to engineering on the next sync; the customer commitment keeps running under its own pause rules — linking does not pause anything by itself.",
  },
  {
    situation: "A Jira issue is not linked",
    behavior:
      'The case simply has no engineering leg. It is excluded from "escalated" counts, and its leg reads as support (or unknown if no ticket status has been observed at all).',
  },
  {
    situation: "A link is missing or can't be confirmed",
    behavior:
      "The case is treated as unlinked — never guessed at. Coverage is reported honestly, not inflated.",
  },
  {
    situation: "A linked issue's status changes",
    behavior:
      "Recorded as a new event on the timeline immediately at the next poll (or the next webhook delivery).",
  },
  {
    situation: "A linked issue is resolved or closed",
    behavior:
      'The case\'s leg switches back to support. Only Zendesk closing the ticket closes the case itself — a Jira issue reaching "Done" does not close the Zendesk case or its commitments.',
  },
  {
    situation: "Jira data is missing or a fetch temporarily fails",
    behavior:
      'The last known state is kept; the next successful poll catches up. If the failure is due to an expired/revoked connection, the integration is marked "Needs reconnect."',
  },
];

export default function JiraIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Integrations</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Jira</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Jira supplies the engineering side of the timeline — what happened
              to an escalated case after a Zendesk ticket was linked to a Jira
              issue.
            </p>
          </div>
        </header>

        <section id="purpose" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Purpose</h2>

          <p className="leading-7 text-muted-foreground">
            Jira tells you what happened to the work once it left the helpdesk —
            status changes, who touched it, and when it moved.
          </p>
        </section>

        <section id="create-oauth-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the Atlassian OAuth app
          </h2>

          <p className="leading-7 text-muted-foreground">
            Jira authorization is often the step that needs an engineering
            administrator, since it&apos;s created in the Atlassian developer
            console rather than inside Jira itself:
          </p>

          <ol className="space-y-3">
            {[
              <>
                Go to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  developer.atlassian.com/console/myapps
                </code>{" "}
                and click <strong>Create</strong> →{" "}
                <strong>OAuth 2.0 integration</strong>. Name the app (e.g.
                &quot;Elapsed&quot;) and accept the developer terms.
              </>,
              <>
                Open the new app&apos;s <strong>Authorization</strong> tab, find{" "}
                <strong>OAuth 2.0 (3LO)</strong>, and click <strong>Add</strong>
                . Set the <strong>Callback URL</strong> to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://your-app-domain/api/integrations/jira/callback
                </code>
                , replacing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  your-app-domain
                </code>{" "}
                with the domain you access this product at.
              </>,
              <>
                Open the <strong>Permissions</strong> tab, add the{" "}
                <strong>Jira API</strong>, and configure its scopes to include{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  read:jira-work
                </code>{" "}
                and{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  offline_access
                </code>
                . No write scope should be added — none is ever used.
              </>,
              <>
                Open the <strong>Settings</strong> tab and copy the{" "}
                <strong>Client ID</strong> and <strong>Secret</strong>.
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
            <strong>Settings → Integrations → Jira → Configure</strong> and
            paste in the Client ID and Secret, then save.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect Jira
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page (or during onboarding), click{" "}
            <strong>Connect Jira</strong> and approve Atlassian&apos;s OAuth
            consent screen, choosing the Jira site to grant access to. The
            product uses the first Jira site your account has access to. Jira is
            optional at onboarding — you can connect it later from Settings →
            Integrations with no loss of history; the 90-day backfill runs from
            whenever you connect it, not from your Zendesk connection date.
          </p>
        </section>

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            OAuth scopes:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              read:jira-work offline_access
            </code>
            .{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              offline_access
            </code>{" "}
            exists only to obtain a refresh token so the connection doesn&apos;t
            need re-approval on every use — it grants no additional data access.
            No write scope is ever requested.
          </p>
        </section>

        <Separator />

        <section id="data-imported" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data imported
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Issues (via JQL search, incrementally by updated timestamp)
            </li>
            <li>• Each issue&apos;s changelog (status transitions)</li>
            <li>
              • Each issue&apos;s remote links (used to find the linked Zendesk
              ticket)
            </li>
            <li>• Site-wide status list (for readable status labels)</li>
          </ul>
        </section>

        <section id="data-used" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for calculations
          </h2>

          <p className="leading-7 text-muted-foreground">
            Every status transition on a linked Jira issue becomes a normalized
            event on the case&apos;s timeline and contributes to leg attribution
            — whether the case is currently in the engineering leg, and for how
            long.
          </p>
        </section>

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for correlation
          </h2>

          <p className="leading-7 text-muted-foreground">
            A Jira issue&apos;s own remote links are read for a URL pointing at
            your Zendesk subdomain. If found, the case is linked with certain
            confidence via the method labeled &quot;Remote link.&quot; See{" "}
            <Link
              href="/docs/how-it-works"
              className="underline underline-offset-4"
            >
              How It Works
            </Link>{" "}
            for how strict this match is.
          </p>
        </section>

        <section id="not-modified" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data not modified
          </h2>

          <p className="leading-7 text-muted-foreground">
            Nothing. No issue, status, comment, or field in Jira is ever created
            or changed.
          </p>
        </section>

        <Separator />

        <section id="sync" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sync behavior
          </h2>

          <p className="leading-7 text-muted-foreground">
            Same two-speed poll as Zendesk (5 min / 60 min), plus an optional
            webhook for near-real-time updates on issue creation and updates.
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              Optional: enable the real-time webhook
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Once Jira is connected, its detail page shows a copyable{" "}
              <strong>Webhook URL</strong> (with a secret already embedded as a
              query parameter). In Jira, go to{" "}
              <strong>Settings → System → WebHooks</strong> and add it as a new
              WebHook, subscribed to the <strong>Issue: created</strong> and{" "}
              <strong>Issue: updated</strong> events. This is optional —
              everything works on the poll schedule alone.
            </p>
          </div>
        </section>

        <section id="what-happens-when" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            What happens when...
          </h2>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">Situation</TableHead>
                  <TableHead className="pe-4">Behavior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {situations.map((row) => (
                  <TableRow key={row.situation}>
                    <TableCell className="ps-4 font-medium">
                      {row.situation}
                    </TableCell>
                    <TableCell className="pe-4 text-muted-foreground">
                      {row.behavior}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>One Jira site per organization</AlertTitle>
            <AlertDescription>
              Only one Jira site is used per organization — the first one your
              OAuth grant has access to.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>No manual linking</AlertTitle>
            <AlertDescription>
              There is no manual &quot;link this ticket to this issue&quot;
              action in the product today — correlation is entirely automatic,
              based on Jira&apos;s own remote-link data.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/docs/integrations/zendesk"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Zendesk</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect your customer-facing ticket source.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/integrations/linear"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Linear</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  An alternative engineering-side source.
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
                  Escalations with no engineering leg? Start here.
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
