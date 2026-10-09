import type { CanonicalPriority, NormalizedEventType, NormalizedState, Actor, SourceRole } from "@sla/core";
import type { CaseLinkMethod, IntegrationOAuthCredentials, IntegrationProvider, IntegrationStatus, PrismaClient } from "@sla/db";
import type { Logger } from "@sla/logger";

/**
 * The one typed record a provider is reached through. Registries are static
 * object literals (`satisfies Record<IntegrationProvider, ProviderAdapter>`),
 * so a missing provider is a compile error. There is no plugin loading and no
 * runtime registration (D16, amended by D31): every member maps to a function
 * that exists. The one data-driven member, `custom`, is itself a statically
 * registered adapter that interprets a validated, versioned configuration;
 * it never executes customer-supplied code.
 */
export interface ProviderAdapter {
  provider: IntegrationProvider;
  role: SourceRole;
  capabilities: ProviderCapabilities;
  /** Fetch and store raw events: backfill plus incremental. Writes `RawEvent` and the cursor only. */
  ingest(ctx: IngestContext): Promise<IngestResult>;
  /** Derive canonical records from stored raw events. Writes nothing; the projector persists the batch. */
  normalize(ctx: NormalizeContext): Promise<CanonicalBatch>;
  /** Trackers and code hosts: the case links this integration's raw events establish. */
  correlate?(ctx: CorrelateContext): Promise<CorrelationOutput>;
  /**
   * Ticket sources: the case external id a URL names on this integration, or
   * null when it is not one of this organization's own tickets. `credentials`
   * is the integration's stored credentials.
   */
  recognizeCaseUrl?(url: string, credentials: unknown): string | null;
  importPolicies?(ctx: ImportContext): Promise<PolicyImportResult>;
  importCalendars?(ctx: ImportContext): Promise<CalendarImportResult>;
}

export interface ProviderCapabilities {
  webhooks: boolean;
  policyImport: boolean;
  calendarImport: boolean;
  incrementalNormalization: boolean;
  replyEvents: boolean;
  priorityChanges: boolean;
  officialLinks: boolean;
}

/** The slice of an `Integration` row an adapter needs; never credentials, which the adapter loads itself. */
export interface IntegrationRef {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
}

interface AdapterContext {
  prisma: PrismaClient;
  integration: IntegrationRef;
  /** Carries the run's context (cycle, organization, integration). Callers with none (a webhook route) omit it. */
  logger?: Logger;
}

export interface IngestContext extends AdapterContext {
  /** The app's public URL (OAuth redirect base); null when the worker has none configured. */
  appUrl: string | null;
  /** The organization's OAuth app credentials for this provider, or null when none are configured. */
  loadOAuthConfig(): Promise<IntegrationOAuthCredentials | null>;
  sinceDays?: number;
}

export interface IngestResult {
  /** Records the pass fetched from the provider (tickets, issues, ...); `counts` breaks that down in the provider's own terms. */
  recordsFetched: number;
  counts: Record<string, number>;
  /**
   * Optional (N9, Q12 and R3); no existing adapter sets it. Present only when
   * the run ended early *solely because* its time or record budget ran out:
   * not a success and not a failure. A run that sets it never advances
   * `lastSuccessfulSyncAt` and never touches the failure counters.
   */
  partial?: {
    reason: "budget_exhausted" | "run_cap_reached";
    /** How far the run got (pages completed, whether the initial import is still running); counts and flags only. */
    progress?: Record<string, number | boolean | string | null>;
  };
  /**
   * Optional: facts for the sync-run record. Counts and fixed codes only,
   * never a payload, URL or credential.
   */
  syncRun?: {
    requests?: number;
    bytes?: number;
    /** Tickets that could not be stored (`payload_too_large`, `missing_required`, ...), up to 50. */
    recordFailures?: { recordId: string; code: string }[];
    /** Total record failures, which may exceed `recordFailures.length`. */
    recordFailureCount?: number;
  };
}

export interface NormalizeContext extends AdapterContext {
  /**
   * `incremental` re-derives only what changed since the adapter's own
   * watermark (the active-set poll); `full` re-derives everything (the
   * reconciliation sweep). Adapters without `incrementalNormalization`
   * ignore it. The projector is scope-agnostic: it persists whatever batch
   * it is given.
   */
  mode: "incremental" | "full";
  /**
   * Narrows normalization to the named source records, as the webhook
   * pipeline does: ticket ids for a ticket source, issue keys for a tracker.
   * A narrowed run is not a view of the whole integration, so it never moves
   * a watermark.
   */
  externalIds?: string[];
}

/** What an external URL points at, decided by the caller from the registry's ticket-source adapters. */
export type CaseRefResolution =
  | { kind: "case"; caseId: string }
  /** No connected ticket source recognizes the URL as its own. */
  | { kind: "unrecognized" }
  /** A source recognized it, but that source has no live case for the id. */
  | { kind: "no_case" };

export type CaseRefResolver = (url: string) => Promise<CaseRefResolution>;

export interface CorrelateContext extends AdapterContext {
  /**
   * Turns a ticket URL into one of this organization's cases. `null` when the
   * organization has no connected ticket source: trackers then have nothing to
   * correlate onto.
   */
  resolveCaseRef: CaseRefResolver | null;
  /** Narrows correlation to the named source records (issue keys), as the webhook pipeline does; also skips the account-wide unlink sweeps. */
  externalIds?: string[];
}

export interface ImportContext extends AdapterContext {
  /** Creates the organization's always-open default calendar when it has none; a policy that names no schedule falls back to it. */
  ensureDefaultCalendarVersion(organizationId: string): Promise<{ id: string }>;
}

/** Counters stay in the importing provider's own terms (they are Zendesk concepts, and belong to its import). */
export interface PolicyImportResult {
  policiesEvaluated: number;
  policyVersionsCreated: number;
  unsupportedConditions: number;
  unsupportedMetrics: number;
  policiesWithNoUsableTargets: number;
  policiesWithUnresolvedSchedule: number;
  policiesArchived: number;
}

export interface CalendarImportResult {
  schedulesEvaluated: number;
  calendarVersionsCreated: number;
  /** Schedules skipped because their time zone could not be normalized; never guessed at. */
  schedulesWithUnresolvedTimeZone: number;
}

/**
 * Everything one normalization pass derives for one integration. A ticket
 * source supplies `customers`, `cases` and an event group per case; a work
 * tracker or code host supplies only event groups, aimed at the cases its
 * `CaseLink`s already name.
 */
export interface CanonicalBatch {
  customers: CustomerIdentityFact[];
  cases: CaseFacts[];
  eventGroups: EventGroup[];
  /** `Case.externalId`s the source no longer has; the projector soft-deletes them. */
  deletedCaseExternalIds: string[];
  /** Records the adapter could not derive (an unknown status, say). Reported, never fatal to the rest of the batch. */
  failures: ProjectionFailure[];
  /**
   * Runs once the projector has persisted the batch. A ticket source that
   * keeps a normalization watermark advances it here, so the watermark never
   * moves past rows that were derived but not written.
   */
  afterProject?: () => Promise<void>;
}

export interface ProjectionFailure {
  /** The source record's id: a ticket id, an issue key, a pull request id. */
  id: string;
  error: string;
}

export interface CaseFacts {
  externalId: string;
  subject: string | null;
  assigneeName: string | null;
  /** Canonical where the source maps it; a value the adapter could not map is passed through as the source gave it. */
  priority: string | null;
  channel: string | null;
  openedAt: Date;
  closedAt: Date | null;
  /** The identity of the case's customer, when the source names one. Resolved through `CustomerIdentity`; unknown identities leave the case without a customer. */
  customer: CustomerIdentityRef | null;
  /**
   * The fields below are written only when the adapter supplies them: omitted
   * (`undefined`) leaves what is stored, `null` or empty clears it. A source
   * that does not derive a field must omit it, because another writer may own
   * it (the seed script sets `tier`).
   */
  requesterName?: string | null;
  tier?: string | null;
  tags?: string[];
  /** Source-specific match inputs with no dedicated column. */
  attributes?: Record<string, unknown> | null;
}

export interface CustomerIdentityRef {
  provider: IntegrationProvider;
  /** Adapter-defined identity kind: "organization", "company", "contact". */
  kind: string;
  externalId: string;
}

export interface CustomerIdentityFact extends CustomerIdentityRef {
  name: string;
}

/**
 * The events one source record (a ticket, an issue, a pull request) derives
 * for one case. The projector reconciles the stored events of this case that
 * were sourced from `ownRawEventIds` against `events`: unchanged events keep
 * their id and `createdAt`, the rest are created or deleted. Events another
 * provider wrote onto the same case are never touched, because their raw
 * events are not listed here.
 */
export interface EventGroup {
  target: { caseExternalId: string } | { caseId: string };
  /** Every `RawEvent` this record's derivation could ever have sourced an event from, snapshots included. */
  ownRawEventIds: string[];
  events: NormalizedEventFact[];
  /** Fields to merge into the `evidence` of this integration's `CaseLink` on the target case, in the same transaction as the events. */
  linkEvidencePatch?: { externalId: string; patch: Record<string, unknown> };
  /** The source record's id, for failure reports. */
  recordId: string;
}

/** An event as the adapter derives it; the projector adds the case and `system`. */
export interface NormalizedEventFact {
  type: NormalizedEventType;
  occurredAt: Date;
  actor: Actor;
  sourceRole: SourceRole;
  fromState: NormalizedState | CanonicalPriority | null;
  toState: NormalizedState | CanonicalPriority | null;
  sourceRawEventId: string;
  sourceSequence: number;
}

/** What a correlation pass establishes: the links it observed, and the unlink sweeps it wants run afterwards. */
export interface CorrelationOutput {
  links: LinkFact[];
  sweeps: LinkSweep[];
  /** How many source records (remote links, attachments, pull requests, official links) the pass looked at. */
  evaluated: number;
  /** Records it could not turn into a link, by reason (`unrecognizedUrl`, `noCase`, `noIdentifier`, ...). Counted, never guessed at. */
  unmatched: Record<string, number>;
}

/**
 * One relationship between a case and an issue or code change, as an
 * integration's raw events establish it. Identity is `(caseId, system,
 * externalId)`: when two producers evidence the same relationship (a Jira
 * remote link and a Zendesk official link) they upsert the same row.
 */
export interface LinkFact {
  caseId: string;
  /** The provider of the issue or code change; not always the producing integration (Zendesk reports Jira links). */
  system: IntegrationProvider;
  /** The issue or code change's id in `system`. */
  externalId: string;
  /** The method of a newly created row. */
  method: CaseLinkMethod;
  /**
   * What an existing row's method becomes, or `keep`. A row whose evidence
   * holds an `officialLink` is `official_link` whatever this says: the
   * authoritative signal always wins.
   */
  methodOnUpdate: CaseLinkMethod | "keep";
  evidence: Record<string, unknown>;
  /**
   * `merge` lays these keys over the row's existing evidence, so two
   * producers each keep their own key; `replace` overwrites it.
   */
  evidenceMode: "merge" | "replace";
  sourceRole: SourceRole;
  /** The `issue_linked` event for a first sighting: the earliest observation of the link. */
  linkedEvent: LinkEventSource;
  /** The `issue_linked` event for a re-link, when the row had been marked unlinked: the latest observation. */
  relinkedEvent?: LinkEventSource;
  /**
   * `false`: events are written only when the row is created or re-linked.
   * `true`: the first-sighting event is also repaired when missing from an
   * existing row, keyed on `(case, issue_linked, sourceRawEventId)`.
   */
  repairLinkedEvent: boolean;
}

export interface LinkEventSource {
  sourceRawEventId: string;
  occurredAt: Date;
}

/**
 * Marks links unlinked when a fresh full listing (a manifest) no longer
 * reports them. A link evidenced by two sources (`evidenceKey` and
 * `otherEvidenceKey`) is unlinked only once both have gone; one source
 * disappearing never deletes a relationship the other still proves.
 */
export interface LinkSweep {
  system: IntegrationProvider;
  /** The evidence key whose link record (`{ id }`) this sweep checks, e.g. `remoteLink`. */
  evidenceKey: string;
  /** The other producer's evidence key, e.g. `officialLink`. */
  otherEvidenceKey: string;
  sourceRole: SourceRole;
  /** The current manifest for the link on this issue, or null when none was ever written (nothing to diff against). */
  manifestFor(externalId: string): LinkManifest | null;
}

export interface LinkManifest {
  rawEventId: string;
  fetchedAt: Date;
  activeLinkIds: ReadonlySet<number>;
}

/**
 * What an integration is allowed to do in the provider's own system. The
 * onboarding wizard and the public security summary both print this, so the
 * `scopes` are the constants the authorize URL is built from, never a copy.
 */
export interface ProviderAccess {
  /** OAuth scopes requested at connect time; empty when the provider takes none per request (see `note`). */
  scopes: readonly string[];
  /** Where read-only access is enforced when it is not a request parameter (an app registered with read-only permissions). */
  note?: string;
}

/** Web-side rendering and webhook hooks, in `apps/web/src/lib/providers.ts`. */
export interface ProviderWebAdapter {
  /** What connecting this provider grants; read-only for every provider (Phase 10). */
  access: ProviderAccess;
  /**
   * Ticket sources: the `providerEventId` prefix of the raw event that holds
   * one case's snapshot. Onboarding counts these as "tickets ingested" while a
   * backfill is in flight, before anything is normalized.
   */
  snapshotEventPrefix?: string;
  /** A link to the record in the provider's own UI, or null when the stored credentials or evidence cannot name one. */
  externalUrl(ref: { externalId: string; credentials: unknown; evidence?: unknown }): string | null;
  /**
   * Ticket sources: `providerEventId` prefixes of raw events, beyond the reply
   * events' own, that `renderConversation` reads (Zendesk's ticket snapshot
   * carries the opening message). The latest raw event under each prefix is
   * handed over, in prefix order.
   */
  conversationContext?(externalId: string): string[];
  /**
   * Ticket sources whose rendering depends on stored configuration (the `custom`
   * source, N9): loaded once per rendered case and handed to `renderConversation`
   * as `input.config`. Rendering-time interpretation is deliberate: nothing is
   * frozen into raw payloads, so replay is preserved. Optional; every other
   * adapter omits it.
   */
  loadRenderConfig?(prisma: PrismaClient, integrationId: string): Promise<unknown>;
  /** Ticket sources: the case's message-only Conversation, read from its raw events. Never the Activity Timeline. */
  renderConversation?(input: ConversationInput): ConversationMessage[];
  /** Webhook providers: whether the delivery carries the integration's secret. Never consumes the request body. */
  verifyWebhook?(req: Request, secret: string): Promise<boolean>;
}

/** What a ticket source needs to render one case's Conversation. */
export interface ConversationInput {
  case: { externalId: string; requesterName: string | null };
  /** The case's events in the engine's total order. */
  events: ConversationEventRef[];
  /** Payloads of the reply events' own raw events, by `RawEvent.id`. */
  payloads: ReadonlyMap<string, unknown>;
  /** Payloads of the raw events `conversationContext` asked for; `undefined` where none exists. */
  context: readonly unknown[];
  /** What `loadRenderConfig` returned, for the adapters that have one (N9). */
  config?: unknown;
}

export interface ConversationEventRef {
  id: string;
  type: NormalizedEventType;
  actor: Actor;
  occurredAt: string;
  sourceRawEventId: string;
  sourceSequence?: number;
}

export interface ConversationMessage {
  id: string;
  occurredAt: string;
  actor: Actor;
  type: "agent_replied" | "customer_replied" | "case_created";
  authorName: string | null;
  /** Set when the author is the case's requester. */
  isRequester?: true;
  /** Plain text. */
  body: string;
}
