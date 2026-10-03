import Link from "next/link";
import { ArrowRight, ExternalLink, Info, ShieldCheck } from "lucide-react";

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
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { getAppUrl } from "@/lib/app-url";

const toc = [
  { id: "overview", title: "Overview", level: 2 as const },
  { id: "prerequisites", title: "Prerequisites", level: 2 as const },
  {
    id: "configure-environment",
    title: "1. Configure environment",
    level: 2 as const,
  },
  { id: "build-and-start", title: "2. Build and start", level: 2 as const },
  { id: "run-migrations", title: "3. Run migrations", level: 2 as const },
  {
    id: "first-account",
    title: "4. Create the first account",
    level: 2 as const,
  },
  { id: "updating", title: "Updating", level: 2 as const },
  { id: "security-notes", title: "Security notes", level: 2 as const },
  { id: "image-notes", title: "Image notes", level: 2 as const },
];

const environment = [
  {
    variable: "DATABASE_URL",
    usedBy: "web, worker",
    notes:
      "PostgreSQL connection string. With the bundled postgres service, use postgres as the host and match POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB.",
  },
  {
    variable: "POSTGRES_USER",
    usedBy: "postgres",
    notes:
      "Username for the bundled PostgreSQL service. Omit when using an external database.",
  },
  {
    variable: "POSTGRES_PASSWORD",
    usedBy: "postgres",
    notes:
      "Password for the bundled PostgreSQL service. Omit when using an external database.",
  },
  {
    variable: "POSTGRES_DB",
    usedBy: "postgres",
    notes:
      "Database name for the bundled PostgreSQL service. Omit when using an external database.",
  },
  {
    variable: "NEXTAUTH_SECRET",
    usedBy: "web",
    notes:
      "Random secret used to sign session tokens. Generate one with openssl rand -base64 32.",
  },
  {
    variable: "NEXTAUTH_URL",
    usedBy: "web, worker",
    notes:
      "Public URL where the app is served. The worker uses it to build OAuth redirect URIs, so it must match the URLs registered with the providers.",
  },
  {
    variable: "INTEGRATION_CONFIG_ENCRYPTION_KEY",
    usedBy: "web, worker",
    notes:
      "Encrypts each organization's Zendesk, Jira, and Slack OAuth client secrets at rest. Generate it with openssl rand -base64 32.",
  },
  {
    variable: "SMTP_ENCRYPTION_KEY",
    usedBy: "web, worker",
    notes:
      "Encrypts saved SMTP passwords at rest. Generate it with openssl rand -base64 32 and keep it distinct from the other secrets.",
  },
  {
    variable: "WORKER_ACTIVE_POLL_MS",
    usedBy: "worker",
    notes: "Optional. Defaults to 300000 ms (5 minutes).",
  },
  {
    variable: "WORKER_RECONCILIATION_MS",
    usedBy: "worker",
    notes: "Optional. Defaults to 1800000 ms (30 minutes), which is also the maximum: larger values are capped at 30 minutes.",
  },
];

const services = [
  {
    name: "postgres",
    description: "The PostgreSQL database.",
  },
  {
    name: "web",
    description:
      "The Next.js application in apps/web: sign-in, dashboard, settings, and webhook receivers.",
  },
  {
    name: "worker",
    description:
      "The background poller in apps/worker: OAuth token refresh, event ingestion, SLA/OLA evaluation, and notifications.",
  },
];

const securityNotes = [
  "Both app containers run as non-root users. The web image runs as nextjs and the worker image runs as worker.",
  "Put a reverse proxy such as Caddy, nginx, or Traefik in front of web for TLS. Zendesk and Jira webhooks and OAuth redirects require HTTPS in practice.",
  "NEXTAUTH_SECRET, INTEGRATION_CONFIG_ENCRYPTION_KEY, and SMTP_ENCRYPTION_KEY are independent secrets. Keep them separate and back them up alongside the database.",
  "Losing any encryption key makes the data protected by that key unrecoverable.",
  "To rotate secrets, run scripts/rotate-secrets.sh --apply-to-db .env.prod after a backup, then restart the stack. Changing NEXTAUTH_SECRET signs everyone out. Changing either encryption key means each organization must re-enter its saved integration secrets or SMTP password. See the Rotating secrets section of docs/deployment.md.",
  "Security headers, CSRF hardening, rate limiting, and health-check endpoints are tracked separately in the roadmap and are not provided by containerization alone.",
];

export default function DeploymentPage() {
  return (
    <DocsLayout toc={toc}>
      <div className="space-y-12">
        <header className="space-y-4">
          <Badge variant="outline">Operations</Badge>

          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Deployment</h1>

            <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
              Run SLA on your own infrastructure with Docker — a VPS, a
              bare-metal server, or any host that can run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
                docker compose
              </code>
              . There is no managed-hosting target; this is the self-host path.
            </p>
          </div>
        </header>

        <section id="overview" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>

          <p className="leading-7 text-muted-foreground">
            The production stack consists of three containers. Both application
            containers are stateless and communicate through PostgreSQL; there
            is no shared filesystem between them.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            {services.map((service) => (
              <div key={service.name} className="rounded-lg border p-4">
                <code className="text-sm font-semibold">{service.name}</code>

                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {service.description}
                </p>
              </div>
            ))}
          </div>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>Stateless application containers</AlertTitle>
            <AlertDescription>
              The web and worker containers read and write application state
              through PostgreSQL. You do not need to configure a shared
              filesystem between them.
            </AlertDescription>
          </Alert>
        </section>

        <section id="prerequisites" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Prerequisites
          </h2>

          <div className="space-y-3">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Docker Engine + Compose</p>

              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Docker Engine with the Compose plugin installed on the host.
              </p>

              <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                <code>docker compose version</code>
              </pre>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">PostgreSQL</p>

              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                A PostgreSQL instance reachable from the host. You can use the
                bundled{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">postgres</code>{" "}
                service in{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  docker-compose.prod.yml
                </code>{" "}
                or point{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  DATABASE_URL
                </code>{" "}
                at your own managed database.
              </p>
            </div>
          </div>
        </section>

        <Separator />

        <section id="configure-environment" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            1. Configure environment
          </h2>

          <p className="leading-7 text-muted-foreground">
            Copy{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              .env.prod.example
            </code>{" "}
            to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              .env.prod
            </code>{" "}
            on the host, then generate its secrets with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              scripts/rotate-secrets.sh
            </code>{" "}
            and fill in the remaining values.{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.env.prod</code>{" "}
            is gitignored: keep it on the host and never commit it.
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`cp .env.prod.example .env.prod
chmod 600 .env.prod
scripts/rotate-secrets.sh .env.prod`}</code>
          </pre>

          <p className="text-sm leading-6 text-muted-foreground">
            The production Compose file validates required variables before
            starting the services, so missing configuration fails loudly instead
            of starting with blank values.
          </p>

          <DataTableCard>
            <Table className="min-w-190">
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {environment.map((item) => (
                  <TableRow key={item.variable}>
                    <TableCell className="align-top">
                      <code className="text-xs">{item.variable}</code>
                    </TableCell>

                    <TableCell className="align-top text-muted-foreground">
                      {item.usedBy}
                    </TableCell>

                    <TableCell className="align-top leading-6 text-muted-foreground">
                      {item.notes}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>

          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Secrets are runtime configuration</AlertTitle>
            <AlertDescription>
              Production secrets are not baked into the Docker images. They are
              supplied when the containers start through Compose environment
              configuration.
            </AlertDescription>
          </Alert>
        </section>

        <section id="build-and-start" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            2. Build and start
          </h2>

          <p className="leading-7 text-muted-foreground">
            Build both application images from the repository root and start the
            production stack:
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`}</code>
          </pre>

          <p className="leading-7 text-muted-foreground">
            This builds{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              apps/web/Dockerfile
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              apps/worker/Dockerfile
            </code>{" "}
            and starts the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              postgres
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">web</code>,
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              worker
            </code>{" "}
            services.
          </p>
        </section>

        <section id="run-migrations" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            3. Run migrations
          </h2>

          <p className="leading-7 text-muted-foreground">
            Starting the containers does not automatically apply the Prisma
            schema. Migrations are intentionally a one-off deployment step.
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`docker compose -f docker-compose.prod.yml --env-file .env.prod \\
  run --rm --user root worker \\
  pnpm --filter @sla/db exec prisma migrate deploy`}</code>
          </pre>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>Why root is used here</AlertTitle>
            <AlertDescription>
              The long-running worker runs as an unprivileged user. The one-off
              migration command uses <code>--user root</code> because Prisma
              migration deployment may need to write into{" "}
              <code>node_modules</code>. The worker process itself does not run
              as root.
            </AlertDescription>
          </Alert>

          <p className="text-sm leading-6 text-muted-foreground">
            Run migrations once after the first deployment and again after
            pulling an update that introduces new migration files.
          </p>
        </section>

        <section id="first-account" className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            4. Create the first account
          </h2>

          <p className="leading-7 text-muted-foreground">
            Account creation is self-serve. Open the sign-up page at:
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`${getAppUrl()}/sign-up`}</code>
          </pre>

          <p className="leading-7 text-muted-foreground">
            Create an account using an email address and password. There is no
            separate database seed or admin bootstrap step.
          </p>

          <Link
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
          >
            Read Getting Started
            <ArrowRight className="size-3.5" />
          </Link>
        </section>

        <section id="updating" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Updating</h2>

          <p className="leading-7 text-muted-foreground">
            Pull the latest code and rebuild the application images:
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`git pull

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`}</code>
          </pre>

          <p className="leading-7 text-muted-foreground">
            If the update contains new Prisma migrations, apply them after the
            containers have been rebuilt:
          </p>

          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            <code>{`docker compose -f docker-compose.prod.yml --env-file .env.prod \\
  run --rm --user root worker \\
  pnpm --filter @sla/db exec prisma migrate deploy`}</code>
          </pre>
        </section>

        <section id="security-notes" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Security notes
          </h2>

          <div className="space-y-3">
            {securityNotes.map((note) => (
              <div key={note} className="rounded-lg border p-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {note}
                </p>
              </div>
            ))}
          </div>

          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Back up your encryption keys</AlertTitle>
            <AlertDescription>
              The encryption keys protect persisted credentials and secrets.
              Losing a key makes the data encrypted with it unrecoverable. Store
              the keys securely alongside your database backup strategy.
            </AlertDescription>
          </Alert>
        </section>

        <section id="image-notes" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Image notes</h2>

          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Web image</p>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The web application uses Next.js{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  output: &quot;standalone&quot;
                </code>
                . The runtime image contains the traced server bundle and
                required production dependencies rather than the full pnpm
                workspace and development dependencies.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Worker image</p>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The worker currently runs its TypeScript directly through{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">tsx</code>.
                Workspace packages are consumed from their TypeScript source, so
                the worker image keeps the full monorepo installation, including
                development dependencies.
              </p>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Slimming this image would require changing how the worker
                package is built and executed and is therefore outside the
                current deployment scope.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Runtime base image</p>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Neither application image requires Prisma query-engine binaries
                or native OpenSSL/libssl dependencies. The database package uses
                Prisma&apos;s driver-adapter client with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  @prisma/adapter-pg
                </code>
                , so{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">
                  node:22-alpine
                </code>{" "}
                is sufficient for both runtime images.
              </p>
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/docs/getting-started"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Getting Started</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set up your organization and first integration.
                </p>
              </div>

              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>

            <Link
              href="/docs/integrations"
              className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">Integrations</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure Zendesk, Jira, and Slack connections.
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
