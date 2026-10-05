# Elapsed

_Know before your customer does._

Support teams promise customers response and resolution times, but once a
ticket is escalated to engineering, the clock keeps running in a tool support
can't see. Elapsed connects the helpdesk and the engineering
tracker, rebuilds one timeline per customer case across both, and tracks
each commitment against its target through the handoff. It warns before a
breach and shows which stage the time went to afterwards.

- **Ticket sources:** Zendesk, Intercom
- **Engineering sources:** Jira, Linear, GitHub (pull requests)
- **Alerts:** Slack, email

Every data-source connection is read-only. GitHub connects through a GitHub
App with read-only repository permissions; see the
[customer guide](docs/customer-guide.md#22-security-and-access).

## Repository layout

```text
apps/
  web/         Next.js app: sign-in, onboarding, dashboard, cases, settings,
               billing and pricing, Platform Admin (/admin), webhook
               receivers, in-app /docs
  worker/      Background workers: per-organization scheduling with leases
               (any number of workers can run side by side), token refresh,
               ingestion, SLA evaluation, notifications, monthly reports
  concierge/   CLI that turns Zendesk and Jira CSV exports into a one-page
               findings report (an internal aid; its validation plan is
               superseded)
packages/
  core/        Pure SLA/OLA engine: business-hours calendars, elapsed time,
               leg attribution, evaluation, freshness
  commitments/ Commitment creation and evaluation pipelines
  ingestion/   Provider adapter contract, shared projector and shared errors
  db/          Prisma schema, migrations, client, secret encryption, plans,
               entitlements and the internal billing domain
  zendesk/ intercom/ jira/ linear/ github/
               Provider adapters: OAuth, backfill, normalization
  http-retry/  Shared retry and timeout handling for provider requests
  logger/      Structured JSON logging
  slack/ email/ notifications/
               Alert channels and delivery, and the monthly report
implementation-plans/  Product roadmap (ROADMAP_Product.md), per-phase
                       implementation plans and decision records
plans/                 Product research and strategy (historical)
docs/                  Customer guide, deployment, runbooks, capacity limits
```

## Running locally

Requires Node 22, pnpm 10, and Docker (for Postgres).

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create `.env` in the repo root. Both apps and Prisma read it from there:

   ```bash
   cp .env.example .env
   ```

   Set `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`,
   `SMTP_ENCRYPTION_KEY` and `INTEGRATION_TOKEN_ENCRYPTION_KEY` to four
   different values, each generated with:

   ```bash
   openssl rand -base64 32
   ```

   The default `DATABASE_URL` already matches the local Postgres below.
   Everything under "Observability" is optional.

3. Start Postgres:

   ```bash
   docker compose up -d postgres
   ```

4. Generate the Prisma client and apply migrations:

   ```bash
   pnpm --filter @sla/db generate
   pnpm --filter @sla/db migrate:dev
   ```

5. Start the web app and the worker, each in its own terminal:

   ```bash
   pnpm web:dev
   ```

   ```bash
   pnpm worker:dev
   ```

6. Open <http://localhost:3000/sign-up> and create an account. Each sign-up
   creates its own organization. Before connecting a provider, save that
   provider's OAuth client ID and secret on **Settings → Integrations**
   (see [Bringing your own OAuth app](docs/customer-guide.md#5-integrations)).

### Tests and type checks

```bash
pnpm test
```

```bash
pnpm type-check
```

The tenant-isolation suite (`apps/web/test/tenant-isolation.test.ts`) runs
against a real Postgres, and is skipped unless `TEST_DATABASE_URL` is set. It
truncates every table, so it refuses a database whose name doesn't contain
`test`. To run it locally, create a database next to your dev one:

```bash
docker compose exec postgres createdb -U user sla_test
```

```bash
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_test?schema=public"
```

```bash
pnpm test:db:prepare
```

`test:db:prepare` applies migrations to that database; run it again after
pulling new migrations. CI does all of this against a Postgres service
container.

## Deploying

Self-hosting with Docker Compose (environment variables, migrations,
backups and restore, health checks, Sentry, and alerts for a stalled worker)
is covered in [docs/deployment.md](docs/deployment.md).

## Documentation

- **[docs/customer-guide.md](docs/customer-guide.md)** is the full product
  reference: every integration, how SLA time is calculated, the dashboard
  and case timeline, notifications, limitations, troubleshooting and FAQ.
- **[docs/deployment.md](docs/deployment.md)** covers self-hosting.
- **In-app docs** at `/docs` in the running web app
  (`apps/web/src/app/docs`) give a per-page guide for end users, with one
  page per integration.
- **[implementation-plans/ROADMAP_Product.md](implementation-plans/ROADMAP_Product.md)**
  records what has been built, step by step, and why.

When behavior changes, update `docs/customer-guide.md` and the matching
in-app `/docs` page together. These are the only two user-facing doc sets.
