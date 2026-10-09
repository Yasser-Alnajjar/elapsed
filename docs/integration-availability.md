# Integration availability (operator runbook)

How platform operators control which integration providers customers can use, and what each control does. Decision: D33. Design: [`implementation-plans/10-integration-control-center.md`](../implementation-plans/10-integration-control-center.md).

## Who can change it

Only platform operators listed in `PLATFORM_ADMIN_EMAILS` (see [`deployment.md`](deployment.md)). Organization owners and members get 403 from the API and a 404 for the page. No organization setting can override a platform restriction. **No new environment variables** are needed.

## States

Each provider has two independent settings.

| Setting | Values |
|---|---|
| **Enabled** | On / Off. Off makes the provider unavailable to everyone, whatever its stage. |
| **Release stage** | **Stable** (every organization), **Beta** (every organization, or only an allowlist), **Coming Soon** (listed, nobody can connect or sync) |

| Enabled | Stage | Beta access | Available to |
|---|---|---|---|
| Off | any | any | nobody (`integration_disabled`) |
| On | Stable | — | everyone |
| On | Beta | All organizations | everyone, with a Beta label |
| On | Beta | Allowlist | allowlisted organizations only; others get `integration_beta_restricted` |
| On | Coming Soon | — | nobody (`integration_coming_soon`) |

Starting state (seeded by the N10 migration): Zendesk, Jira, Linear Stable; Intercom and GitHub Beta for all organizations; Custom REST Beta, allowlist (organizations that had the old Custom REST flag on).

**Platform availability is not a customer's connection status.** Disabling never changes `Integration.status`. A customer's own disconnect is `disconnected`; a platform restriction shows to the customer as "Paused by Elapsed" (connected) or "Unavailable" / "Coming soon" (not connected).

## What "unavailable" blocks

For an organization the provider is unavailable to:

| Path | Behavior |
|---|---|
| Connect, reconnect, OAuth callback | Refused. A callback does not exchange the code or store credentials. API: 403 `{ error, code, provider }`. Browser: redirect to `/settings/integrations?availability=<code>&provider=<provider>`. |
| Connect links | Creating one is refused (403); opening one redirects to the link page with the reason; the link is **not** consumed. |
| OAuth app configuration (`/config`) | Writes refused (403); reads allowed. |
| Manual backfill / import | 403 |
| Webhooks (Zendesk, Jira) | **HTTP 200** `{ "status": "ignored", "reason": <code> }` after the secret check. Nothing is stored. |
| Concierge exports | 403 |
| Custom REST routes (test, sample, preview, validate, activate, rollback, draft, overrides) | 403 with the code |
| Worker ingest | Skipped like an operator pause: no provider request, no failure recorded, no "failing since" streak |
| Custom REST request in flight | Aborted within about 5 seconds; the response is discarded |
| Disconnect | **Allowed** |

Error codes: `integration_disabled`, `integration_coming_soon`, `integration_beta_restricted`. The admin API adds `stale_version`, `rollout_blocked` and `already_listed` (all 409).

## What is never touched

Disabling, narrowing a stage or removing an organization from an allowlist never deletes or rewrites integration rows, credentials, cursors, webhook secrets, raw events, cases, events, commitments, evaluations, notifications or customer records.

Work on data already stored keeps running: normalization, commitments, evaluation and alerts. The source goes stale (freshness, D22): at-risk alerts carry the stale marker and breach alerts are held until the source is fresh (D13).

## In-flight and queued work

- There is no job queue. Each organization run checks availability before ingesting each integration, so the next run after a change obeys it.
- Every check reads the database (no cache), so all web and worker processes observe a change on their next check.
- A built-in provider (Zendesk, Jira, Linear, Intercom, GitHub) request that is already running when you disable it finishes its current bounded run (each request is limited to 30 s per attempt); nothing new starts after it.
- A Custom REST request in flight is aborted within about 5 seconds.

## Re-enabling

Nothing needs repairing. The next organization run ingests from the stored cursor and catches up on everything changed meanwhile, including changes whose webhooks were ignored (Zendesk's incremental export and Jira's `updated >=` query both resume from the stored cursor). Webhooks are processed again immediately.

Re-enabling does **not** undo anything stopped separately: a customer's disconnect, a `reauth_required` integration, or a per-integration operator pause (`/admin/tenants/<id>`, N4.5) all stay as they are.

## Procedure: disable a provider during an incident

1. Open `/admin/integrations` and select the provider.
2. Turn **Enabled** off. Write a short customer-facing message (for example "Paused while we investigate a Zendesk API issue") and the audit reason.
3. Read the impact preview (organizations and connections that lose access) and confirm.
4. Check: `/admin` shows no new ingest failures for the provider; the worker logs `integration_ingest_unavailable` for its integrations.
5. When the incident is over, turn **Enabled** back on with a reason. Watch `/admin` for the first successful syncs; freshness recovers within one active-poll interval.

To stop **one** organization's integration only, use the per-integration **Pause polling** control on the tenant page instead; note that it does not stop webhooks for that integration.

## Procedure: Beta allowlist

- Select the provider, set Beta access to **Allowlist**, then add organizations. Removing an organization takes effect on its next check; its data and connection are kept.
- Moving a provider from "All organizations" to "Allowlist" removes access from every organization not on the list, including connected ones: the impact preview shows how many.
- **Custom REST:** removing an organization also pauses polling on its custom integration; re-adding does not resume it (use **Resume polling** on the tenant page). This is plan 09 §8.7's behavior.

## Rollout block: Custom REST (N9.14-F1)

Until N9.14-F1 is closed (roadmap), the backend refuses with 409 `rollout_blocked`: adding an organization to the Custom REST allowlist, opening Custom REST to all organizations, and promoting it to Stable. The console shows the block and its reason. Narrowing changes (disable, Coming Soon, removing an organization) are allowed. Lifting the block is a reviewed code change in `packages/db/src/integration-catalog.ts` made when N9.14-F1 closes.

## Promoting a provider (D17)

A promotion out of Beta is an owner decision recorded in the roadmap (D17). After it is recorded: change the stage to Stable in the console with the decision as the reason. The in-app Beta label follows automatically. The public pages under `/docs/integrations/*` are static and still say "Beta": update their copy in a source change.

## Concurrent edits

Every policy change carries the version the operator saw. If someone else saved first, the save fails with `stale_version`; the console reloads the row so you can review and retry.

## Audit log

Every change writes one row to `/admin/audit`:

| Action | Contents |
|---|---|
| `update_integration_availability` | provider, the policy before and after, reason |
| `add_integration_allowlist` | provider, organization, reason |
| `remove_integration_allowlist` | provider, organization, reason, whether polling was paused |

No credential, token or secret is ever read or recorded by these paths. Older rows `enable_custom_provider` / `disable_custom_provider` come from the pre-N10 Custom REST flag.

## Adding a new provider

1. Add the value to `IntegrationProvider` (migration) and its adapters to both registries (`apps/web/src/lib/providers.ts`, `apps/worker/src/providers.ts`); D16 requires static registration.
2. Add its entry to `INTEGRATION_CATALOG` (`packages/db/src/integration-catalog.ts`): name, category, connection type and default availability. It will not compile without one.
3. Seed its `IntegrationAvailability` row in the provider's migration (usually Beta, allowlist, so nobody gets it by accident). Without a row the catalog default applies.
4. Every route that calls the provider must call `requireIntegrationAvailable` (or the redirect variant); the route boundary test (`integration-availability-boundary.test.ts`, on `testing`) fails otherwise.

A provider that has no adapter cannot be listed as Coming Soon, because adding it to the enum requires an adapter.

## Rollback

The N10 schema is additive. If the code is reverted, the old Custom REST flag (`Organization.customProviderEnabled`) is read again; allowlist changes made after the deploy are not reflected in it, so check the flag on each organization that uses Custom REST.
