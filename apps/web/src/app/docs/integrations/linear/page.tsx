import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const toc = [
  { id: "purpose", title: "Purpose", level: 2 as const },
  {
    id: "create-oauth-app",
    title: "Create the Linear OAuth application",
    level: 2 as const,
  },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect Linear", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "data-imported", title: "Data imported", level: 2 as const },
  { id: "correlation", title: "Data used for correlation", level: 2 as const },
  { id: "not-modified", title: "Data not modified", level: 2 as const },
  { id: "sync", title: "Sync behavior", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

export default function LinearIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Integrations</Badge>
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Linear</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              An alternative engineering-leg source alongside Jira, not a
              replacement — connect whichever tracker your engineers actually
              use. See{" "}
              <Link href="#limitations" className="underline underline-offset-4">
                Known limitations
              </Link>
              .
            </p>
          </div>
        </header>

        <section id="purpose" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Purpose</h2>

          <p className="leading-7 text-muted-foreground">
            Linear supplies the same kind of engineering-side history that Jira
            does: what happened to an escalated case once it was linked to a
            Linear issue. If your team uses Linear instead of (or alongside)
            Jira, connecting it turns on the same engineering-leg timeline
            described in{" "}
            <Link
              href="/docs/integrations/jira"
              className="underline underline-offset-4"
            >
              Jira
            </Link>
            .
          </p>
        </section>

        <section id="create-oauth-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the Linear OAuth application
          </h2>

          <ol className="space-y-3">
            {[
              <>
                In Linear, go to <strong>Settings → API</strong> (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  linear.app/settings/api
                </code>
                ) and, under <strong>OAuth applications</strong>, click{" "}
                <strong>Create new</strong>.
              </>,
              <>
                Name the application (e.g. &quot;SLA Breach Monitoring&quot;)
                and set its <strong>Callback URL</strong> to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://your-app-domain/api/integrations/linear/callback
                </code>
                , replacing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  your-app-domain
                </code>{" "}
                with the domain you access this product at.
              </>,
              <>
                Save, then copy the <strong>Client ID</strong> and{" "}
                <strong>Client Secret</strong> shown on the application&apos;s
                page.
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
            In SLA Breach Monitoring, go to{" "}
            <strong>Settings → Integrations → Linear → Configure</strong> and
            paste in the Client ID and Client Secret, then save.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect Linear
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page, click{" "}
            <strong>Connect Linear</strong> and approve the OAuth consent screen
            for your workspace.
          </p>
        </section>

        <Separator />

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            OAuth scope:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">read</code>
            . No write scope is ever requested. Unlike Jira, Linear&apos;s
            access tokens don&apos;t expire, so there is no separate
            &quot;offline access&quot; scope to request.
          </p>
        </section>

        <section id="data-imported" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data imported
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Issues</li>
            <li>• Issue history entries (workflow state changes)</li>
            <li>
              • Attachments and links on each issue (used to find the linked
              Zendesk ticket)
            </li>
          </ul>
        </section>

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for correlation
          </h2>

          <p className="leading-7 text-muted-foreground">
            The same rule as Jira: a Linear issue&apos;s attachment/link data is
            read for a URL pointing at your Zendesk subdomain. If found, the
            case is linked with certain confidence via a remote link — never a
            fuzzy or suggested match.
          </p>
        </section>

        <section id="not-modified" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data not modified
          </h2>

          <p className="leading-7 text-muted-foreground">
            Nothing. No issue, status, comment, or field in Linear is ever
            created or changed.
          </p>
        </section>

        <section id="sync" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sync behavior
          </h2>

          <p className="leading-7 text-muted-foreground">
            Poll only — the same 5-minute (active cases) / 60-minute
            (reconciliation) schedule as Zendesk and Jira, but with no real-time
            webhook. Expect Linear-sourced data to be current as of the last
            successful poll, not instantaneous.
          </p>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>No webhook support</AlertTitle>
            <AlertDescription>
              Linear relies entirely on the poll schedule — there is no
              real-time webhook option the way there is for Zendesk and Jira.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>Not reflected in onboarding progress</AlertTitle>
            <AlertDescription>
              The live counters on the onboarding screen (tickets, escalations,
              linked issues) cover Zendesk and Jira only. Linear&apos;s backfill
              status is visible on the Integrations settings page instead.
            </AlertDescription>
          </Alert>
        </section>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/integrations/jira"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Jira</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Compare with the other engineering-side source.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/integrations/github"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">GitHub</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Track engineering leg time from pull requests.
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
