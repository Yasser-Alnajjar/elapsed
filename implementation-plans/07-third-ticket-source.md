# N7 — Third Ticket Source (Contract Test): Implementation Plan

> **Roadmap phase:** [N7 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n7--third-ticket-source). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N2](02-provider-contract-and-projector.md) (contract, projector, registries) and [N3](03-provider-isolation-and-freshness.md) (freshness applies automatically). It is sequenced after [N6](06-entitlements-and-billing.md) in the roadmap chain. Because N6 is trigger-based, N7 may start once N5 is done if N6's trigger has not fired; record that in the roadmap when it happens.
> **Decision (closed, roadmap D29):** the third ticket source is **Zoho Desk**, for the Egyptian market. Due diligence: [`d29-zoho-desk-due-diligence.md`](d29-zoho-desk-due-diligence.md). Freshdesk, Pylon and HubSpot remain future candidates. The N7.1 spike kill criteria in that record still apply.
> **Estimate:** 3–4 weeks. **Branch:** `phase/n7-third-ticket-source`.

---

## 1. Objective

Add a third ticket-source provider **with zero changes to `@sla/core`, `@sla/commitments`, `@sla/notifications` and the projector in `@sla/ingestion`**. This proves the N1/N2 boundary holds for a provider it was not designed around.

## 2. Why this phase exists

The 2×2 matrix proves the boundary for providers that existed while the boundary was drawn. A provider added afterwards is the real test of the contract. It also answers the business question behind review trigger "change provider priority": which helpdesk the next customers use.

## 3. The provider (D29: Zoho Desk)

**Decided.** The old evidence rule (at least two customers or prospects on the same helpdesk, chosen from Freshdesk, Pylon or HubSpot) is **removed**; N7 is triggered by the recorded Zoho Desk demand and Egyptian-market decision (D29). D29 adopts Zoho Desk. It is technically compatible with the existing provider contract and shared projector, with no change to the core domain model. Use Zoho's API for backfill and incremental reconciliation; use webhooks only where the customer's edition supports them, keeping polling/reconciliation as the correctness mechanism. The checks below are now the N7.1 spike's pass/fail criteria for Zoho Desk, not a selection process; if one fails, stop and record it in the roadmap.

**Technical checks (kept as the spike checklist):**

- **Also check before committing:**
  - The provider has a read-only OAuth or API-token model.
  - It has an incremental change API or audit log.
  - It has an account/company concept for `CustomerIdentity`, or a documented fallback like Intercom's contact.
  - Its tickets are linked to Jira or Linear in a way the tracker exposes as a URL or reference.
- **If the N7.1 spike fails the technical kill criteria** in [`d29-zoho-desk-due-diligence.md`](d29-zoho-desk-due-diligence.md) §13, N7 stops and the failure is recorded in the roadmap.

## 4. Tasks, in implementation order

### N7.1 — Spike (≤1 week)
- Using a sandbox account, capture real payloads:
  - tickets
  - status history or audits
  - replies
  - organizations / companies
  - priorities
  - the URL format of links created by its Jira and Linear integrations
- Store them as fixtures in the new package's `test/fixtures/`.
- Map every status to an existing `NormalizedState`.
- **If a status cannot be mapped without a new semantic state, stop.** That is a domain change and needs a roadmap decision, not an adapter change.
- **Verify:** a written mapping table in this plan (§6); fixtures committed.

### N7.2 — Package skeleton
- Create `packages/<provider>`, mirroring `packages/intercom` (the closest shape): `client.ts`, `oauth.ts`, `tokenLifecycle.ts`, `backfill.ts`, `rawEvents.ts`, `normalize.ts`, `hash.ts`, `types.ts`, `index.ts`, `test/`.
- Dependencies: `@sla/core` (types), `@sla/db`, `@sla/http-retry`, and `@sla/ingestion` (types and errors only).
- **Verify:** `pnpm type-check`; boundary test passes.

### N7.3 — Adapter record
- `role: "ticket_source"`
- `capabilities`: set honestly. For example, `webhooks: false` unless a receiver is built in this phase.
- `ingest`: backfill plus incremental, using `http-retry` with the N3 timeouts. Throws the shared errors.
- `normalize`: returns a `CanonicalBatch`: cases, customer identities, events with `sourceRole`, priorities mapped to `CanonicalPriority`.
- `recognizeCaseUrl`: only the org's own tenant host or workspace.
- Web adapter: `externalUrl`, `renderConversation`.
- **Verify:** unit tests from the fixtures, for normalize, URL recognition (including lookalike and other-tenant rejection), and token lifecycle.

### N7.4 — Registration and settings surface
- Add the provider to `IntegrationProvider` (migration), `apps/worker/src/providers.ts`, `apps/web/src/lib/providers.ts`, `app/api/integrations/<provider>/{connect,callback,config,disconnect,backfill}`, a settings card in `modules/settings/integrations/csr/`, and `lib/<provider>-env.ts`.
- These are the **only** permitted changes outside the new package. _(Rev 8 correction, 2026-10-09: the list above under-counts the real registration surface. The per-provider literals that must also change, or that a new provider silently appears in, include `lib/types/integrations.ts` (the `IntegrationProvider` union, `INTEGRATION_PROVIDERS`, `INTEGRATION_PROVIDER_LABELS`, `IntegrationsPageData`), `lib/integrations-data.ts`, `modules/settings/integrations/csr/provider-presentation.tsx` and `source-integration-specs.tsx`, `modules/settings/integration-detail/csr/IntegrationDetailHeader.tsx`, `lib/onboarding-data.ts` (iterates every registered provider), `lib/security-summary.ts`, and the plan copy in `packages/db/src/plans.ts`. The exact, verified checklist is [plan 09 §9.2](09-custom-ticket-provider.md#92-registration-checklist-verified-2026-10-09); use it for N7 too.)_
- **Verify:** `git diff --stat main -- packages/core packages/commitments packages/notifications packages/ingestion/src/projector.ts` is empty.

### N7.5 — Matrix extension
- Extend `apps/web/test/provider-matrix-smoke.test.ts` with `<provider> + Jira` and `<provider> + Linear`.
- **Verify:** all six pairs pass. L1 + L2 replay for existing tenants shows 0 differences.

### N7.6 — Onboarding, via capabilities
- The new provider appears in onboarding step 1 automatically (N5.1). It is labelled **Beta** (D17: tests passing ≠ production).
- **Verify:** browser walkthrough with the sandbox.

## 5. Acceptance criteria

1. Zero lines changed in `packages/core`, `packages/commitments`, `packages/notifications` and the projector.
2. Changes outside the new package are limited to the registration points in N7.4.
3. Six matrix pairs pass; existing tenants' replay is clean.
4. If any core change turned out to be necessary, it is documented as a **contract gap** (fixed in `@sla/ingestion` with replay) or a **domain gap** (roadmap decision) before merging. N7 is not "done" by quietly editing the core.

## 6. Status mapping table

_Filled in during N7.1._

| Provider status | `NormalizedState` | Pauses Resolution? | Notes |
|---|---|---|---|
| — | — | — | — |

## 7. Verification commands

```bash
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run packages/core/test/provider-boundary.test.ts apps/web/test/provider-matrix-smoke.test.ts
git diff --stat main -- packages/core packages/commitments packages/notifications packages/ingestion/src/projector.ts
pnpm --filter @sla/commitments replay:compare -- <baseline.jsonl> <after.jsonl>
```

## 8. Rollback

The provider is additive. Disconnecting soft-disables integrations. The `IntegrationProvider` enum value stays; removing an enum value is never required for rollback.

## 9. Out of scope

- Webhooks for the new provider (unless trivially available and verified live).
- Policy import from the new provider (native policies cover it, like Intercom, D9).
- Promotion out of Beta.
- A second new provider in the same phase.
