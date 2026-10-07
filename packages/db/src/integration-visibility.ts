import { IntegrationProvider } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";

/**
 * Read-side half of the integration disconnect behaviour.
 *
 * Disconnect is a soft state, never a delete: the `Integration` row and
 * everything derived from it stay in the database, and
 * `Integration.status = "disconnected"` is the single switch. These
 * predicates are what makes that switch visible. Spread one into any query
 * that feeds the UI, metrics, search, exports or alerts and a disconnected
 * integration's data disappears; reconnecting flips the status back and the
 * same rows reappear. There is no second flag to keep in sync.
 *
 * Derivation code (normalization, correlation, projection) must NOT use
 * these: it owns the rows it writes and has to see all of them, or it would
 * recreate what it can no longer see.
 */

/**
 * A case belongs to the ticket source that created it
 * (`Case.sourceIntegrationId`). Commitments, evaluations, leg spans,
 * notifications and events all hang off a case, so scoping the case scopes
 * them too. A case with no recorded source integration (a pre-N1.15 row) has
 * no integration whose status could hide it and stays visible.
 */
export const CASE_SOURCE_CONNECTED = {
  sourceIntegration: { isNot: { status: "disconnected" } },
} satisfies Prisma.CaseWhereInput;

/**
 * The same for rows that name their integration by `system` rather than by
 * foreign key: a `CaseLink` to an issue tracker, or a `NormalizedEvent` a
 * tracker contributed to a case. A row is hidden when the integration for
 * its `system` in the case's organization is disconnected. Written as one
 * pure `where` clause rather than a lookup, so a loader keeps its single
 * query and the hot path (nothing disconnected) costs only an indexed probe
 * per provider.
 */
export const SYSTEM_SOURCE_CONNECTED = {
  NOT: {
    OR: Object.values(IntegrationProvider).map((system) => ({
      system,
      case: {
        organization: {
          integrations: { some: { provider: system, status: "disconnected" as const } },
        },
      },
    })),
  },
} satisfies Prisma.CaseLinkWhereInput & Prisma.NormalizedEventWhereInput;

/** Raw provider payloads, which reference their integration directly. */
export const RAW_EVENT_SOURCE_CONNECTED = {
  integration: { status: { not: "disconnected" } },
} satisfies Prisma.RawEventWhereInput;
