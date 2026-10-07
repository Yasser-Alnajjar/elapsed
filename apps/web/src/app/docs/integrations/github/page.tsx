import Link from "next/link";
import { ArrowRight, ExternalLink, Info } from "lucide-react";

import { DocsLayout } from "@/components/docs/docs-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPageMetadata } from "@/lib/seo/metadata";

const toc = [
  { id: "purpose", title: "Purpose", level: 2 as const },
  {
    id: "create-github-app",
    title: "Create the GitHub App",
    level: 2 as const,
  },
  { id: "configure-in-app", title: "Add the credentials", level: 2 as const },
  { id: "connection", title: "Connect GitHub", level: 2 as const },
  { id: "permissions", title: "Permissions", level: 2 as const },
  { id: "data-imported", title: "Data imported", level: 2 as const },
  { id: "correlation", title: "Data used for correlation", level: 2 as const },
  { id: "not-modified", title: "Data not modified", level: 2 as const },
  { id: "sync", title: "Sync behavior", level: 2 as const },
  { id: "limitations", title: "Known limitations", level: 2 as const },
];

export const generateMetadata = () => getPageMetadata("/docs/integrations/github");

export default function GithubIntegrationPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Integrations</Badge>
            <Badge variant="beta">Beta</Badge>
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">GitHub</h1>

            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Tracks engineering-leg time directly from pull requests, for teams
              whose escalations show up as code changes before they show up as
              tickets. This integration is in Beta — see{" "}
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
            GitHub connects one repository&apos;s pull requests to the cases
            they resolve, alongside Jira and Linear. A case is linked to GitHub
            through whichever Jira or Linear issue a pull request&apos;s title
            or branch name already references — GitHub is never the first link
            in the chain.
          </p>
        </section>

        <section id="create-github-app" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create the GitHub App
          </h2>

          <p className="leading-7 text-muted-foreground">
            GitHub is connected through a GitHub App, not a classic OAuth App. A
            GitHub App can be limited to read-only permissions and to the
            repositories you install it on.
          </p>

          <ol className="space-y-3">
            {[
              <>
                Go to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  github.com/settings/apps
                </code>{" "}
                (or your organization&apos;s{" "}
                <strong>Settings → Developer settings → GitHub Apps</strong>)
                and click <strong>New GitHub App</strong>.
              </>,
              <>
                Name it (e.g. &quot;Elapsed&quot;), set a{" "}
                <strong>Homepage URL</strong> (any valid URL for your deployment
                works), and set the <strong>Callback URL</strong> to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://your-app-domain/api/integrations/github/callback
                </code>
                , replacing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  your-app-domain
                </code>{" "}
                with the domain you access this product at. Leave{" "}
                <strong>Expire user authorization tokens</strong> checked.
              </>,
              <>
                Under <strong>Webhook</strong>, uncheck <strong>Active</strong>.
                This integration polls and needs no webhook.
              </>,
              <>
                Under <strong>Repository permissions</strong>, set{" "}
                <strong>Pull requests</strong> and <strong>Contents</strong> to{" "}
                <strong>Read-only</strong>. Leave every other permission at{" "}
                <strong>No access</strong> (GitHub adds Metadata: Read-only on
                its own).
              </>,
              <>
                Create the app, then copy the <strong>Client ID</strong> and
                generate a new <strong>Client secret</strong>. Copy the secret
                right away, since GitHub won&apos;t show it again.
              </>,
              <>
                Click <strong>Install App</strong>, pick the account that owns
                the repository, choose <strong>Only select repositories</strong>
                , and select the repository you&apos;ll track.
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
            <strong>Settings → Integrations → GitHub → Configure</strong> and
            paste in the Client ID and Client Secret, then save.
          </p>
        </section>

        <section id="connection" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect GitHub
          </h2>

          <p className="leading-7 text-muted-foreground">
            From the same Integrations page, enter the repository to track in{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              owner/repo
            </code>{" "}
            form (e.g.{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              acme/widgets
            </code>
            ) and click <strong>Connect GitHub</strong>.
          </p>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>One repository at a time</AlertTitle>
            <AlertDescription>
              A GitHub App can be installed on many repositories and has no
              single &quot;workspace&quot; the way a Jira site or Linear
              workspace does, so your organization names one repository to track
              when connecting. Connecting fails with an error if the GitHub App
              isn&apos;t installed on that repository, or if the user
              authorizing it can&apos;t read it.
            </AlertDescription>
          </Alert>
        </section>

        <Separator />

        <section id="permissions" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">Permissions</h2>

          <p className="leading-7 text-muted-foreground">
            GitHub App repository permissions:{" "}
            <strong>Pull requests: Read-only</strong>,{" "}
            <strong>Contents: Read-only</strong>, and{" "}
            <strong>Metadata: Read-only</strong> (always included by GitHub). No
            OAuth scope is requested.
          </p>

          <p className="leading-7 text-muted-foreground">
            The token this product holds can only do what both the GitHub App
            and the user who connected it are allowed to do, and only on
            repositories the App is installed on. It can&apos;t write to GitHub.
          </p>

          <Alert variant="warning">
            <Info className="size-4" />
            <AlertTitle>Connected with a classic OAuth App?</AlertTitle>
            <AlertDescription>
              Earlier versions connected GitHub through a classic OAuth App with
              the{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">repo</code>{" "}
              scope, which includes write access. It was never used to write,
              but that connection keeps its broader token until you switch. To
              switch, create a GitHub App as described above, replace the Client
              ID and secret under{" "}
              <strong>Settings → Integrations → GitHub → Configure</strong>,
              reconnect, then delete the old OAuth App in GitHub to revoke its
              token.
            </AlertDescription>
          </Alert>
        </section>

        <section id="data-imported" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data imported
          </h2>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Pull requests on the connected repository</li>
            <li>
              • Timeline events on each pull request (the status/review history
              used for leg attribution)
            </li>
          </ul>
        </section>

        <section id="correlation" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Data used for correlation
          </h2>

          <p className="leading-7 text-muted-foreground">
            A pull request&apos;s title or branch name is scanned for a Jira- or
            Linear-style issue key — letters followed by a dash and a number,
            e.g.{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              ENG-456
            </code>
            . If that key already has a confirmed Jira or Linear link to a case,
            the pull request is linked to the same case. A single pull request
            can reference more than one issue key (e.g. &quot;Fixes ENG-1 and
            PROJ-2&quot;) and link to more than one case if so.
          </p>

          <p className="text-sm text-muted-foreground">
            GitHub never originates a link on its own — it only extends a link
            that Jira or Linear&apos;s own remote-link data already established.
            See{" "}
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
            Nothing. No pull request, review, comment, status, or file is ever
            created or modified through this connection, and the GitHub
            App&apos;s read-only permissions mean it couldn&apos;t be.
          </p>
        </section>

        <section id="sync" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sync behavior
          </h2>

          <p className="leading-7 text-muted-foreground">
            Poll only — the same 5-minute (active cases) / 60-minute
            (reconciliation) schedule as every other integration, with no
            real-time webhook.
          </p>
        </section>

        <section id="limitations" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Known limitations
          </h2>

          <Alert>
            <AlertTitle>One repository per organization</AlertTitle>
            <AlertDescription>
              Only the single repository named at connect time is tracked. To
              track a different or additional repository, reconnect with the new
              owner/repo value.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>No webhook support</AlertTitle>
            <AlertDescription>
              GitHub relies entirely on the poll schedule.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>API limits on very active repositories</AlertTitle>
            <AlertDescription>
              GitHub&apos;s search results are practically bounded by
              GitHub&apos;s own API limits for very high pull-request volumes on
              a single repository.
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertTitle>Not reflected in onboarding progress</AlertTitle>
            <AlertDescription>
              The live counters on the onboarding screen cover Zendesk and Jira
              only. GitHub&apos;s backfill status is visible on the Integrations
              settings page instead.
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
                  Where the first link to a case usually comes from.
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
                  The other source a GitHub link can extend.
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
