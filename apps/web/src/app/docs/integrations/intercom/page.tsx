import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const toc = [
  { id: "purpose", title: "Purpose", level: 2 as const },
  {
    id: "create-oauth-app",
    title: "Create the Intercom app",
    level: 2 as const,
  },
  {
    id: "configure-redirect-url",
    title: "Configure the OAuth redirect URL",
    level: 2 as const,
  },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect Intercom", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "data-imported", title: "Data imported", level: 2 as const },
  {
    id: "pause-behavior",
    title: "Pause behavior is different",
    level: 2 as const,
  },
  {
    id: "sla-policies",
    title: "SLA policies are not imported",
    level: 2 as const,
  },
  { id: "not-modified", title: "Data not modified", level: 2 as const },
  { id: "sync", title: "Sync behavior", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

export default function IntercomIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Integrations</Badge>
            <Badge variant="beta">Beta</Badge>
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Intercom</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              An alternative ticket source alongside Zendesk, not a replacement
              — it contributes conversations, customers, and support-side
              timeline events, with a few real differences from Zendesk worth
              knowing before you rely on it. This integration is in Beta — see{" "}
              <Link
                href="#limitations"
                className="underline underline-offset-4"
              >
                Known limitations
              </Link>
              .
            </p>
          </div>
        </header>

        <section id="purpose" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Purpose</h2>

          <p className="leading-7 text-muted-foreground">
            Intercom supplies customer-facing conversation history the same way
            Zendesk supplies ticket history: conversations become cases, and
            companies become customers. It does not currently supply SLA policy
            definitions or business-hours calendars the way Zendesk does — see{" "}
            <Link href="#sla-policies" className="underline underline-offset-4">
              SLA policies are not imported
            </Link>{" "}
            below.
          </p>
        </section>

        <section id="create-oauth-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the Intercom app
          </h2>

          <ol className="space-y-3">
            {[
              <>
                Go to Intercom&apos;s <strong>Developer Hub</strong> and create
                a new app for your workspace.
              </>,
              <>
                Enable OAuth and add the redirect URL — see{" "}
                <Link
                  href="#configure-redirect-url"
                  className="underline underline-offset-4"
                >
                  Configure the OAuth redirect URL
                </Link>{" "}
                below.
              </>,
              <>
                Under <strong>Basic Information</strong>, copy the{" "}
                <strong>Client ID</strong> and <strong>Client Secret</strong>.
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

          <Alert>
            <Info className="size-4" />
            <AlertTitle>
              The redirect URL is registered once, on the app itself
            </AlertTitle>
            <AlertDescription>
              Unlike Zendesk, Jira, and Linear, Intercom does not take a
              redirect URI as part of each authorization request — it uses
              whatever Redirect URL is saved on the app in the Developer Hub.
              Make sure it is saved there before connecting.
            </AlertDescription>
          </Alert>
        </section>

        <section id="configure-redirect-url" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Configure the OAuth redirect URL
          </h2>

          <p className="leading-7 text-muted-foreground">
            To configure the OAuth redirect URL for the Intercom application:
          </p>

          <ol className="space-y-3">
            {[
              <>
                Open the Intercom Developer Hub OAuth configuration page:{" "}
                <a
                  href="https://app.intercom.com/a/apps/v9jrtlg9/developer-hub/app-packages/206109/oauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline underline-offset-4"
                >
                  https://app.intercom.com/a/apps/v9jrtlg9/developer-hub/app-packages/206109/oauth
                </a>
              </>,
              <>
                Click <strong>Edit</strong> to modify the OAuth configuration.
              </>,
              <>
                Enable <strong>Use OAuth</strong>.
              </>,
              <>
                Under <strong>Redirect URLs</strong>, add the callback URL used
                by the application:
                <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
                  <code>
                    http://localhost:3000/api/integrations/intercom/callback
                  </code>
                </pre>
              </>,
              <>
                Make sure the application callback URL is added as the{" "}
                <strong>first</strong> URL, since Intercom uses the first URL as
                the default redirect URL.
              </>,
              <>Save the changes.</>,
            ].map((content, index) => (
              <li key={index} className="flex gap-4 rounded-lg border p-4">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                  {index + 1}
                </div>
                <div className="min-w-0 text-sm text-muted-foreground">
                  {content}
                </div>
              </li>
            ))}
          </ol>

          <p className="leading-7 text-muted-foreground">
            After saving the configuration, the Intercom OAuth flow can redirect
            the user back to the application after authorization.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>Important</AlertTitle>
            <AlertDescription>
              The Redirect URL configured in Intercom must match the callback
              endpoint implemented by the application. If the URL is missing or
              incorrect, Intercom may complete the authorization but fail to
              redirect the user back to the application with the authorization
              code.
            </AlertDescription>
          </Alert>
        </section>

        <section id="configure-in-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Add the credentials
          </h2>

          <p className="leading-7 text-muted-foreground">
            In Elapsed, go to{" "}
            <strong>Settings → Integrations → Intercom → Configure</strong> and
            paste in the Client ID and Client Secret, then save.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect Intercom
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page, click{" "}
            <strong>Connect Intercom</strong> and approve the OAuth prompt for
            your workspace.
          </p>
        </section>

        <Separator />

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            Read-only access is a property of the app&apos;s requested
            permissions, configured once in Intercom&apos;s Developer Hub rather
            than passed as an OAuth scope parameter. No write permission is ever
            requested or used.
          </p>
        </section>

        <section id="data-imported" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data imported
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Conversations</li>
            <li>
              • Conversation parts (the event/reply history within each
              conversation)
            </li>
            <li>
              • For Intercom tickets, the ticket&apos;s state history (which
              state each status change moved it to — needed to see{" "}
              <strong>Waiting on customer</strong>)
            </li>
            <li>• Companies (become Customers)</li>
            <li>
              • Admins/teammates (workspace name list only — resolves{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                admin_assignee_id
              </code>{" "}
              to a display name for the case header&apos;s assignee. Display
              only — never used for matching, routing, or SLA calculations.)
            </li>
          </ul>
        </section>

        <section id="pause-behavior" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Pause behavior is different from Zendesk
          </h2>

          <p className="leading-7 text-muted-foreground">
            A conversation has three states: open, snoozed, and closed. An
            Intercom <strong>ticket</strong> also has its own state — Submitted,
            In progress, <strong>Waiting on customer</strong>, or Resolved —
            which is separate from the conversation&apos;s: a ticket waiting on
            the customer is still an open conversation. Both are read, and
            combined in this order:
          </p>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Closed conversation (a resolved ticket closes it) →{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                resolved
              </code>
            </li>
            <li>
              • Ticket <strong>Waiting on customer</strong> →{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pending_customer
              </code>
              , shown as waiting on the customer, and paused by Elapsed-created
              policies. It outranks snoozed.
            </li>
            <li>
              • Snoozed conversation →{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pending_internal
              </code>
            </li>
            <li>
              • Anything else (including ticket Submitted and In progress) →{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">open</code>
            </li>
          </ul>

          <p className="leading-7 text-muted-foreground">
            A conversation that was never made a ticket has no waiting state;
            only snoozing it is available, and snoozing does not pause.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>
              Snoozed is not treated as customer-caused waiting
            </AlertTitle>
            <AlertDescription>
              A snoozed conversation normalizes to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pending_internal
              </code>
              , not{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pending_customer
              </code>
              , because snoozing represents an agent deliberately deferring a
              conversation — not the customer being asked to respond. Since only{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                pending_customer
              </code>{" "}
              pauses a commitment&apos;s clock (see{" "}
              <Link
                href="/docs/sla#customer-waiting"
                className="underline underline-offset-4"
              >
                SLA &amp; Targets
              </Link>
              ), snoozing an Intercom conversation does not pause its
              commitment.
            </AlertDescription>
          </Alert>
        </section>

        <section id="sla-policies" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            SLA policies are not imported
          </h2>

          <p className="leading-7 text-muted-foreground">
            Unlike Zendesk, Intercom does not currently supply SLA policy
            definitions or business-hours schedules to this product. Commitments
            are matched from your organization&apos;s existing SLA policies
            regardless of which system a case came from — so if your
            organization has connected Intercom without also having
            Zendesk-imported policies in place, Intercom-sourced cases may not
            match any policy and will have no commitments at all.
          </p>

          <p className="text-sm text-muted-foreground">
            If you rely on Intercom as your ticket source, connect Zendesk as
            well (even without using it day to day) so its imported policies and
            calendars are available for matching, or ask your account contact
            about your options.
          </p>
        </section>

        <section id="not-modified" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data not modified
          </h2>

          <p className="leading-7 text-muted-foreground">
            Nothing. No conversation, contact, or field is ever created or
            changed in Intercom.
          </p>
        </section>

        <section id="sync" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sync behavior
          </h2>

          <p className="leading-7 text-muted-foreground">
            Poll only — the same 5-minute (active cases) / 60-minute
            (reconciliation) schedule as Zendesk and Jira, but with no real-time
            webhook. Each sync also re-checks conversations changed in the
            previous 5 minutes, so an update Intercom&apos;s search had not
            indexed yet is still picked up on the next poll.
          </p>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>Waiting on customer needs ticket access</AlertTitle>
            <AlertDescription>
              The ticket&apos;s state history comes from Intercom&apos;s ticket
              API. If the app you registered cannot read tickets, the sync still
              succeeds, but only a ticket&apos;s latest status change is
              recognized (from its current state): earlier changes, and a
              ticket that changed status more than once between syncs, can be
              missed or timed late. Allow the app to read tickets in the
              Developer Hub to get the full history.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>No webhook support</AlertTitle>
            <AlertDescription>
              Intercom relies entirely on the poll schedule.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>Not reflected in onboarding progress</AlertTitle>
            <AlertDescription>
              The live counters on the onboarding screen cover Zendesk and Jira
              only. Intercom&apos;s backfill status is visible on the
              Integrations settings page instead.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/integrations/zendesk"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Zendesk</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  See where SLA policies actually come from.
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
                  Understand pause rules in detail.
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
