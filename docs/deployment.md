# Deployment

This covers running SLA on your own infrastructure with Docker — a VPS, a
bare-metal box, or any host that can run `docker compose`. There is no
managed-hosting target; this is the self-host path.

The stack is three containers:

- **postgres** — the database.
- **web** (`apps/web`) — the Next.js app: sign-in, dashboard, settings,
  webhook receivers.
- **worker** (`apps/worker`) — the background poller: OAuth token refresh,
  event ingestion, SLA/OLA evaluation, notifications.

Both app containers are stateless and read/write nothing but Postgres —
there's no shared filesystem between them to worry about.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose version`) on the
  host.
- A Postgres instance reachable from the host — either the `postgres`
  service in [`docker-compose.prod.yml`](../docker-compose.prod.yml), or
  your own managed database, in which case skip that service and point
  `DATABASE_URL` at it.

## 1. Configure environment

Create `.env.prod` on the host from [`.env.prod.example`](../.env.prod.example),
then generate its secrets. `.env.prod` is gitignored: it lives only on the
host and in your secure backups, never in the repository.
`docker-compose.prod.yml` refuses to start any service that's missing a
required variable, so this errors loudly rather than booting with blanks:

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
scripts/rotate-secrets.sh .env.prod
```

`scripts/rotate-secrets.sh` replaces the `change-me` placeholders for
`POSTGRES_PASSWORD` (and the matching password in `DATABASE_URL`),
`NEXTAUTH_SECRET`, and all three encryption keys with fresh random values,
without printing them. Then set `NEXTAUTH_URL` and any optional values by
hand.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | web, worker | `postgresql://user:password@host:5432/db?schema=public`. If you're using the bundled `postgres` service, the host is `postgres` (the Compose service name) and the user/password/db must match `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` below. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | postgres | Only read by the bundled `postgres` service. Omit if you're pointing `DATABASE_URL` at your own database instead. |
| `NEXTAUTH_SECRET` | web | Random secret used to sign session tokens. Generate one with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | web, worker | The public URL the app is served at, e.g. `https://sla.example.com`. The worker uses this to build OAuth redirect URIs — it must match what's registered with each provider. |
| `PLATFORM_ADMIN_EMAILS` | web | Comma-separated emails of the platform operators who run this deployment. Only these accounts (checked server-side against the signed-in session's email, not a `UserRole`) may change Worker/Monitoring settings; every tenant, including an org owner, gets a read-only view. |
| `INTEGRATION_CONFIG_ENCRYPTION_KEY` | web, worker | Encrypts each org's Zendesk/Jira/Slack OAuth client secrets at rest. Generate with `openssl rand -base64 32`. Rotating it invalidates every saved integration config. |
| `SMTP_ENCRYPTION_KEY` | web, worker | Encrypts each org's saved SMTP password at rest. Generate with `openssl rand -base64 32`, keep distinct from the other encryption keys so rotating one doesn't invalidate the others. |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | web, worker | Encrypts each connected integration's OAuth access/refresh tokens at rest. Generate with `openssl rand -base64 32`, keep distinct from the other encryption keys. Rotating it makes every connected integration's tokens unreadable — each organization must reconnect. Existing plaintext rows from before this key was introduced are migrated with `pnpm db:encrypt-tokens`. |
| `WORKER_ACTIVE_POLL_MS`, `WORKER_RECONCILIATION_MS` | web, worker | Optional; bootstrap defaults are 300000 (5 min) and 3600000 (1 hour), used only to seed the database on a fresh install. Once a platform operator changes either interval from the Monitoring settings page, the saved database value is authoritative and these env vars are no longer read. |
| `SENTRY_DSN` | web, worker | Optional. Enables error tracking in both apps when set; omit it and the SDK stays disabled with no other effect. See [Health checks and observability](#health-checks-and-observability). |
| `WORKER_HEALTH_PORT` | worker | Optional, defaults to `8081`. The port `GET /health` listens on inside the worker container. |
| `WORKER_LOCK_RETRY_MS`, `WORKER_LOCK_PING_MS` | worker | Optional, default `15000` and `30000`. How often a standby worker retries the single-instance lock, and how often the active one checks its lock connection is still alive. See [Single worker instance](#single-worker-instance). |
| `OPS_ALERT_SLACK_WEBHOOK_URL`, `OPS_ALERT_EMAIL` | worker | Optional. Where a stalled-worker-cycle alert goes — see [Health checks and observability](#health-checks-and-observability). This is a deployment-owner channel, unrelated to any organization's own SLA breach notifications. `OPS_ALERT_EMAIL` is only the recipient; its SMTP transport is the shared `DEPLOYMENT_SMTP_*` below, so email alerting stays off if that's unset. |
| `DEPLOYMENT_SMTP_*` | web, worker | Deployment-owned SMTP, shared by every deployment-level email concern: account-lifecycle email sent from web (invitations, password resets, email verification — required, fails explicitly if unset when triggered) and worker's ops alert above (optional — that channel just stays off if unset). Deliberately separate from an organization's own saved SMTP (Settings → Notifications, used only for SLA breach/at-risk alerts, customer-owned) — that's the boundary that matters; there's no separate SMTP transport per deployment-level feature, since both already go through the same mailer. |

None of these secrets are baked into the images — the Dockerfiles only ever
see fixed placeholder values at build time (see the comments in
[`apps/web/Dockerfile`](../apps/web/Dockerfile) and
[`apps/worker/Dockerfile`](../apps/worker/Dockerfile)). Real values are
supplied at container start via `environment:`/`--env-file`, the same as any
other 12-factor deployment.

## 2. Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This builds `apps/web/Dockerfile`, `apps/worker/Dockerfile`, and
`packages/db/Dockerfile` from the repo root, and starts every service in
order (roadmap 7.1): `postgres` becomes healthy, then the one-shot
`migrate` service applies every pending Prisma migration and exits 0, then
`web` and `worker` start — both `depends_on: migrate: condition:
service_completed_successfully`, so neither can come up against an
unmigrated schema, and `up`'s own dependency graph blocks on that exit
rather than needing a separate step below.

## 3. Migrations after an update

The first `up` above already applies every migration that existed at that
point — there's no separate first-run step anymore. After pulling a later
update that adds new migrations, re-run `up` and the same `migrate`
service applies them before `web`/`worker` restart:

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

If you only need to force the migration step on its own (rare — `up`
already runs it), you can still invoke it directly:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate
```

## 4. Create the first account

Sign-up is self-serve — visit `${NEXTAUTH_URL}/sign-up` and create an
account with an email and password (see
[Getting Started](customer-guide.md#4-getting-started)). There is no separate seed/admin
bootstrap step.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Migrations run automatically as part of `up` (see above) — there is no
separate migration command to remember on update.

## Backups

The database is the only state this stack has: both app containers are
stateless. Back it up on a schedule, keep copies off the host, and practice
a restore before you need one.

### What to back up

1. **The database**, with [`scripts/backup.sh`](../scripts/backup.sh).
2. **`.env.prod`**, stored separately and securely (for example, in a
   password manager). A database dump without the matching
   `INTEGRATION_CONFIG_ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY`, and
   `INTEGRATION_TOKEN_ENCRYPTION_KEY` still restores, but every saved
   integration OAuth secret, connected integration's tokens, and SMTP
   password in it becomes unreadable, and each organization would have to
   re-enter/reconnect them. Never put `.env.prod` in the same place as the
   dumps: whoever holds both holds everything.

### Scheduled backups

`scripts/backup.sh` runs `pg_dump` inside the `postgres` container. It
writes a compressed, custom-format dump to `backups/sla-<UTC timestamp>.dump`
(owner-only permissions), confirms `pg_restore` can read it, and only then
deletes dumps older than `RETENTION_DAYS`. A failed or unreadable dump exits
non-zero and leaves the previous backups in place.

Run it once by hand to check it works:

```bash
scripts/backup.sh
```

Then schedule it with the host's crontab (`crontab -e`). This takes a
backup at 03:15 every day and logs the output:

```cron
15 3 * * * cd /srv/sla && scripts/backup.sh >> /var/log/sla-backup.log 2>&1
```

Replace `/srv/sla` with the checkout path. Settings are environment
variables, set inline in the cron line if you need them:

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Ignored by git. |
| `RETENTION_DAYS` | `14` | Dumps older than this are deleted after each successful backup. |
| `COMPOSE_FILE` | `docker-compose.prod.yml` | |
| `ENV_FILE` | `.env.prod` | |
| `DB_NAME` | the container's `POSTGRES_DB` | |

**Copy dumps off the host.** A backup on the same disk as the database
won't survive losing the server. Add a second cron line that syncs
`backups/` to object storage or another machine with your usual tool
(`rclone`, `aws s3 sync`, `restic`), scheduled after the backup.

If you run your own managed Postgres instead of the bundled service, use the
provider's automated snapshots and point-in-time recovery; these scripts
only target the bundled `postgres` container.

### Restoring

`scripts/restore.sh` replaces the database's entire contents with a dump.

```bash
scripts/restore.sh backups/sla-20260916T031500Z.dump
```

In order, it:

1. Checks the file is a readable dump.
2. Asks you to type the database name. Pass `--yes` to skip the prompt.
3. Takes a safety backup of the current data, so a mistaken restore can be
   undone. Set `SKIP_SAFETY_BACKUP=1` to skip it.
4. Stops `web` and `worker` so nothing writes mid-restore.
5. Restores in a single transaction. If anything fails, the old data stays.
6. Starts `web` and `worker` again, even if the restore failed.

After restoring, run migrations in case the dump predates the running code
(the command under [Updating](#updating)), then check `GET /api/health`.
Each integration's sync cursor is restored along with the data, so the
worker re-fetches provider changes made since the dump on its next cycles.
OAuth tokens are restored as they were at dump time too. If a provider
rotated a refresh token after that, the integration shows **Needs
reconnect**, and one click on the Integrations page fixes it.

### Test the restore

An untested backup is a guess. Once a quarter, and after any change to the
setup, restore the latest dump into a scratch database next to the real one
and check the row counts:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres \
  sh -c 'createdb -U "$POSTGRES_USER" sla_restore_check'
```

```bash
DB_NAME=sla_restore_check SKIP_SAFETY_BACKUP=1 \
  scripts/restore.sh "$(ls backups/sla-*.dump | tail -1)" --yes
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d sla_restore_check -c "select count(*) from cases"'
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres \
  sh -c 'dropdb -U "$POSTGRES_USER" sla_restore_check'
```

A restore into a scratch database still briefly stops `web` and `worker`,
so run the check at a quiet time.

## Security notes

- Both app containers run as a non-root user (`nextjs` in the web image,
  `worker` in the worker image) — everything except the one-off migration
  command above.
- Put a reverse proxy (Caddy, nginx, Traefik) in front of `web` for TLS.
  Zendesk and Jira webhooks, and the OAuth redirect flows, all require
  HTTPS in practice.
- `web` is published on `127.0.0.1:3000` only (`WEB_BIND`), so the proxy is
  the only way in. If you set `WEB_BIND=0.0.0.0` because the proxy runs on
  another host, firewall the port to that host. A client that reaches `web`
  directly can forge `X-Forwarded-For`.
- The proxy must append the connecting address to `X-Forwarded-For`. Caddy
  and Traefik do this by default; in nginx use
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` along with
  `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Proto $scheme;`.
  The app reads the client IP from the right end of that header, skipping
  `TRUSTED_PROXY_COUNT - 1` entries (default `1`). Set it to `2` if a CDN or
  load balancer sits in front of your proxy. Too low and every visitor
  shares the CDN's rate-limit bucket; too high and clients can spoof their
  IP again.
- `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`,
  `SMTP_ENCRYPTION_KEY`, and `INTEGRATION_TOKEN_ENCRYPTION_KEY` are four
  independent secrets by design — see the table above and the comments on
  each in `.env.example`. Back them up with the database, but store them
  separately (see [Backups](#backups)): losing any of them makes the data
  it encrypts unrecoverable, not just un-decryptable-until-fixed.
- `.env.prod` is never committed. It was tracked in this repository until
  roadmap step 39, so every value in any copy of it from before then must
  be treated as leaked — **rotated 2026-09-19** (see
  [Rotating secrets](#rotating-secrets)).
- Basic rate limiting and webhook replay protection (roadmap step 30) are
  in place: `/api/sign-up`, `/api/auth/callback/credentials`, and
  `/api/webhooks/**` are throttled per client IP in `apps/web/src/proxy.ts`
  (in-memory, since this stack runs a single `web` container — see the
  reverse-proxy note above for where the client IP comes from), and both
  webhook receivers reject stale payloads via a timestamp check alongside
  their existing secret verification.
- Jira webhook secrets (roadmap step 43): new Jira webhooks put the
  integration's secret in Jira's own **Secret** field, and Jira signs each
  delivery (`X-Hub-Signature`, HMAC-SHA256 of the body). Nothing secret is
  in the URL. Webhooks set up before this step use a URL ending in
  `?secret=…`, which still works but ends up wherever request URLs are
  logged. The app strips it from Sentry events. Your reverse proxy's
  access log is yours to handle: either have those customers move the
  secret into the Secret field (the Jira settings card explains how), or
  don't log query strings for `/api/webhooks/jira/*`. In Caddy, the
  default access log is off unless you add `log`; if you use it, filter
  the field with
  `log { format filter { request>uri query { delete secret } } }`.
  In nginx, use a `log_format` that logs `$uri` instead of `$request` or
  `$request_uri` for that location.
- Security headers and CSRF hardening (roadmap step 33): every response
  carries a CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  a `Referrer-Policy`, and, in production, HSTS (see
  `apps/web/security-headers.mjs`). HSTS only takes effect once the reverse
  proxy serves the app over HTTPS. State-changing `/api/**` requests (all
  except webhooks and NextAuth's own endpoints) must send an `Origin`
  matching `NEXTAUTH_URL` or the forwarded host, or they get `403`. Make sure
  `NEXTAUTH_URL` is the exact public origin, and that the reverse proxy
  forwards `Host` or sets `X-Forwarded-Host`.

### Rotating secrets

Rotate when a secret may have leaked (for example, `.env.prod` ended up in
git, a chat, or a shared drive), or when someone with access leaves.

**Rotation log**

| Date | Reason | Scope | Method |
| --- | --- | --- | --- |
| 2026-09-19 | `.env.prod` was tracked in git from `1ec4936` (2026-09-14) to `23c06cb` (2026-09-17); every value in that history must be treated as leaked (roadmap step 0.4). | `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY` | `scripts/rotate-secrets.sh --apply-to-db .env.prod` |

```bash
scripts/backup.sh
scripts/rotate-secrets.sh --apply-to-db .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Know what each rotation costs before running it:

| Secret | What happens when it changes |
| --- | --- |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | Postgres only reads `POSTGRES_PASSWORD` when it first creates its volume. For an existing database, `--apply-to-db` runs `ALTER USER` in the running `postgres` container before the file is rewritten. Without that flag, web and worker can't connect after the restart. If you use a managed database, change the password there and update `DATABASE_URL` yourself. |
| `NEXTAUTH_SECRET` | Every user is signed out. Nothing is lost. |
| `INTEGRATION_CONFIG_ENCRYPTION_KEY` | Every saved integration OAuth client secret becomes unreadable (`IntegrationConfigUnreadableError`), and each organization must re-enter it under **Settings → Integrations → Configure**. There's no re-encryption path. |
| `SMTP_ENCRYPTION_KEY` | Every saved SMTP password becomes unreadable, and each organization must re-enter it under **Settings → Notifications**. |

The script keeps the previous file as `.env.prod.before-rotate-<timestamp>`
(owner-only, gitignored). Delete it once the stack is healthy. Dumps taken
before the rotation still hold ciphertext for the old encryption keys, so
restoring one also needs that old `.env.prod`.

The script can't rotate third-party credentials. Revoke and replace these with
their provider, then edit `.env.prod`: `DEPLOYMENT_SMTP_PASSWORD` (for Gmail,
delete the app password in your Google account and create a new one),
`OPS_ALERT_SLACK_WEBHOOK_URL`, and `SENTRY_DSN`.

## Single worker instance

Run exactly one active worker per database. Two workers running cycles at
once would race on each integration's sync cursor. The worker enforces
this itself: at startup it takes a Postgres advisory lock
(`pg_try_advisory_lock`) on a dedicated connection and holds it for its
whole lifetime. A second worker, whether from a deploy that briefly
overlaps two containers or from `docker compose up --scale worker=2`, logs
`worker_standby`, runs no cycles, reports `standby` on `/health`, and
retries every `WORKER_LOCK_RETRY_MS`. It takes over once the holder exits
and Postgres releases the lock with its session.

If the active worker's lock connection drops, it logs `worker_lock_lost`
and exits with code 1 rather than keep running without the lock;
`restart: unless-stopped` brings it back. This is not horizontal scaling.
A standby only waits.

## Health checks and observability

- **`GET /api/health`** (web) checks database connectivity only —
  `SELECT 1` through Prisma — and is deliberately unauthenticated (see
  `apps/web/src/proxy.ts`) so an uptime monitor or orchestrator can call it
  with no session. Returns `200 {"status":"ok",...}` or `503
  {"status":"error",...}`.
- **`GET /health`** (worker, `WORKER_HEALTH_PORT`, default `8081`) is a
  plain `node:http` listener — the worker had no HTTP surface at all before
  this. Returns the same `running`/`degraded`/`stopped` status the
  Monitoring settings page already derives from `WorkerSettings`
  (`degraded` means the process is alive but a recent cycle recorded
  per-organization failures; `stopped` means no heartbeat at all, i.e. the
  process itself looks wedged), plus `lastSuccessfulCycleAt` and an
  aggregate `integrations.mostRecentSyncAt`/`withErrors` across every
  connected integration. Responds `503` only for `stopped`, since that's
  the one case an orchestrator restart can actually fix. Not published to
  the host by `docker-compose.prod.yml` — only the container's own
  `HEALTHCHECK` (and Docker's resulting restart-on-unhealthy behavior with
  `restart: unless-stopped`) uses it; add your own `ports:` mapping if an
  external monitor should poll it directly. A standby worker (see below)
  answers `200 {"status":"standby"}` instead; `503 {"status":"starting"}`
  means it hasn't reached the database to try the lock yet.
- **Error tracking**: set `SENTRY_DSN` to enable
  [Sentry](https://sentry.io) (or any Sentry-protocol-compatible service)
  in both apps — unhandled exceptions in either app, every per-integration
  `Integration.lastSyncError` (excluding routine reauth-required errors,
  which the settings UI already surfaces), and each worker cycle's own
  uncaught failure. Leaving it unset disables the SDK outright with no
  other effect. No build-time source-map upload is wired up — this is
  runtime error capture only.
- **Stalled-cycle alerting**: the worker checks its own `WorkerSettings`
  every two minutes and, if either the active-set poll or the
  reconciliation sweep hasn't completed successfully in over 3x its
  configured interval, sends an alert — to you, the deployment owner, not
  your customers — through whichever of `OPS_ALERT_SLACK_WEBHOOK_URL`
  (a plain Slack incoming-webhook URL) or `OPS_ALERT_EMAIL` (sent through
  the shared `DEPLOYMENT_SMTP_*`) is configured; both, either, or neither is
  fine. A recovery is announced the same way once the cycle catches up. This only
  catches a worker that's alive but not completing cycles — a fully
  crashed process stops this check along with everything else, which is
  what the `HEALTHCHECK`/restart policy above is for instead.

## Image notes

- **web** builds with Next.js's `output: "standalone"`
  (`apps/web/next.config.mjs`), so the runtime image ships only the traced
  server bundle and pruned `node_modules` — none of the pnpm workspace or
  devDependencies.
- **worker** has no equivalent bundling step: `apps/worker`'s own `start`
  script runs its TypeScript directly via `tsx` rather than a compiled
  `dist/`, and every `@sla/*` package it imports is consumed as workspace
  TypeScript source (each package's `main` points at `src/index.ts`, not a
  build artifact). The worker image therefore keeps the full monorepo
  install, including devDependencies — there's no way to slim it down
  without changing how the package is run, which is out of scope here.
- Neither image needs Prisma query-engine binaries or `libssl`/OpenSSL —
  `packages/db` generates Prisma's driver-adapter client
  (`@prisma/adapter-pg`), which is pure JS/TS with no native engine, so
  plain `node:22-alpine` is enough for both.
