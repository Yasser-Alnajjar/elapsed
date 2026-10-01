/**
 * Seeds 11 independent Organizations (tenants — companies that each bought Elapsed). Every tenant
 * gets the same complete fixture: its own users, Zendesk + Jira integrations, SLA policies, business
 * calendars, the 11 Zendesk-sourced Customers, their requesters and cases, and the Jira escalations
 * behind some of them. Organization != Customer; nothing is shared between tenants and every external
 * id is unique per tenant (see tenant-config.ts).
 *
 * How: the provider payloads from `dataset.ts` are written as `RawEvent`s
 * (exactly what a backfill stores), then the *real* pipelines derive the rest —
 * Zendesk normalization (Customers, Cases, NormalizedEvents), the official-link
 * and remote-link correlators (CaseLinks), calendar + SLA-policy import, the
 * commitment / re-resolution / next-reply / evaluation pipelines. Nothing here
 * contacts Zendesk, Jira, Slack or an SMTP server: no `IntegrationConfig`,
 * `SlackIntegration` or email settings row is created, so even a worker cycle
 * pointed at this organization stops before any network call.
 *
 * Deterministic: every timestamp is an offset from the anchor and every
 * pipeline runs with an explicit `asOf`. Two rows are still minted by the
 * engine itself with random ids (`Commitment.id`, and the `Evaluation.id`
 * hashed from it), so those ids differ after `reset`; their content does not.
 */
import { createHash } from "node:crypto";
import {
  createNativePolicy,
  createNativeCalendar,
  ensureDefaultCalendarVersion,
  runCommitmentPipeline,
  runCommitmentReResolutionPipeline,
  runEvaluationPipeline,
  runNextReplyCyclePipeline,
  setCustomerCalendar,
  type NotificationCandidate,
} from "@sla/commitments";
import { recordSlaImportSummary, type Prisma, type PrismaClient } from "@sla/db";
import { correlateAndProject, normalizeAndProject, type IntegrationRef } from "@sla/ingestion";
import { runZendeskSlaPolicyImport, type SlaPolicyImportResult } from "@sla/zendesk";
import {
  DEFAULT_ANCHOR_ISO,
  ENGINEERING_LEG_TARGET_MINUTES,
  LEGACY_SEED_ORG,
  NATIVE_CALENDAR,
  NATIVE_TARGETS,
  SEED_PASSWORD_HASH,
  TENANTS,
  type TenantDef,
} from "./config";
import { caseRefResolverFor } from "../../src/case-ref";
import { PROVIDERS } from "../../src/providers";
import { buildSeedDataset, NATIVE_WEEKLY, type SeedDataset, type SeedRawEvent } from "./dataset";
import { DAY, HOUR, MIN } from "./scenarios";

export interface SeedOptions {
  /** Seed only these tenants (by key, e.g. "halcyon"). Default: all 11. */
  tenants?: string[];
  /** The dataset's "now". Defaults to the fixed `DEFAULT_ANCHOR_ISO`, which keeps the dataset identical on every run. */
  anchor?: Date;
  /** Delete the seed organization (and everything under it) first, for a clean rebuild. Only ever touches the fixed seed org id. */
  reset?: boolean;
  onProgress?: (message: string) => void;
}

export interface SeedSummary {
  organizationId: string;
  tenantKey: string;
  anchor: Date;
  rawEventsWritten: number;
  checkpoints: number;
  commitmentsCreated: number;
  evaluationsCreated: number;
  notificationsRecorded: number;
  notificationFailuresRecorded: number;
  slaImport: SlaPolicyImportResult;
}

const NATIVE_POLICY_NAME = "Starter Plan (native)";
const FAKE_TOKEN = "seed-fixture-token-not-a-credential";
const CHUNK = 500;

export function defaultAnchor(): Date {
  return new Date(DEFAULT_ANCHOR_ISO);
}

/** `--anchor=now`: the current time floored to the hour, so reruns within the hour still agree. */
export function currentHourAnchor(): Date {
  return new Date(Math.floor(Date.now() / HOUR) * HOUR);
}

export interface SeedRunSummary {
  anchor: Date;
  tenants: SeedSummary[];
}

export function selectTenants(keys?: string[]): TenantDef[] {
  if (!keys || keys.length === 0) return TENANTS;
  const unknown = keys.filter((key) => !TENANTS.some((t) => t.key === key));
  if (unknown.length > 0) throw new Error(`Unknown tenant(s): ${unknown.join(", ")}. Known: ${TENANTS.map((t) => t.key).join(", ")}`);
  return TENANTS.filter((t) => keys.includes(t.key));
}

/**
 * Seeds every selected tenant, one after the other. `reset` deletes each selected tenant's organization
 * first (never anything else — a look-alike id with a different name is refused), and also removes the
 * single organization the previous, single-tenant version of this seed created.
 */
export async function seedTestCustomers(prisma: PrismaClient, options: SeedOptions = {}): Promise<SeedRunSummary> {
  const log = options.onProgress ?? (() => undefined);
  const anchorDate = options.anchor ?? defaultAnchor();
  const tenants = selectTenants(options.tenants);

  if (options.reset) {
    await deleteSeedOrganization(prisma, LEGACY_SEED_ORG.id, LEGACY_SEED_ORG.name, log);
    for (const tenant of tenants) await deleteSeedOrganization(prisma, tenant.orgId, tenant.name, log);
  }

  const summaries: SeedSummary[] = [];
  for (const tenant of tenants) {
    summaries.push(await seedTenant(prisma, tenant, anchorDate, (message) => log(`[${tenant.key}] ${message}`)));
  }
  return { anchor: anchorDate, tenants: summaries };
}

async function deleteSeedOrganization(prisma: PrismaClient, id: string, name: string, log: (message: string) => void): Promise<void> {
  const existing = await prisma.organization.findUnique({ where: { id } });
  if (!existing) return;
  if (existing.name !== name) throw new Error(`Refusing to delete organization ${id}: its name is "${existing.name}", not the seed org's.`);
  await prisma.organization.delete({ where: { id } });
  log(`deleted existing seed organization ${id}`);
}

async function seedTenant(prisma: PrismaClient, tenant: TenantDef, anchorDate: Date, log: (message: string) => void): Promise<SeedSummary> {
  const anchor = anchorDate.getTime();
  const dataset = buildSeedDataset(anchorDate, tenant);
  log(`dataset built: ${dataset.tickets.length} tickets, ${dataset.issues.length} Jira issues, ${dataset.rawEvents.length} raw events`);

  // ---- Organization, people, integrations --------------------------------------------
  const organizationId = tenant.orgId;
  await prisma.organization.upsert({
    where: { id: organizationId },
    create: {
      id: organizationId,
      name: tenant.name,
      timezone: "America/New_York",
      engineeringLegTargetMinutes: ENGINEERING_LEG_TARGET_MINUTES,
    },
    update: { name: tenant.name, timezone: "America/New_York", engineeringLegTargetMinutes: ENGINEERING_LEG_TARGET_MINUTES },
  });

  for (const user of tenant.users) {
    const data = {
      organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: SEED_PASSWORD_HASH,
      emailVerifiedAt: new Date(anchor - 60 * DAY),
    };
    await prisma.user.upsert({ where: { id: user.id }, create: { id: user.id, ...data }, update: data });
  }
  const invitationHash = createHash("sha256").update(`seed-fixture-invitation-token:${tenant.key}`).digest("hex");
  const invitationData = {
    organizationId,
    email: tenant.inviteeEmail,
    status: "pending" as const,
    invitedByUserId: tenant.users[0]!.id,
    expiresAt: new Date(anchor + 7 * DAY),
  };
  await prisma.organizationInvitation.upsert({
    where: { tokenHash: invitationHash },
    create: { tokenHash: invitationHash, ...invitationData },
    update: invitationData,
  });

  const connectedAt = new Date(anchor - 90 * DAY);
  const zendesk = await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "zendesk" } },
    create: {
      organizationId,
      provider: "zendesk",
      status: "connected",
      connectedAt,
      lastSyncAt: anchorDate,
      webhookSecret: `seed-fixture-webhook-secret-zendesk-${tenant.key}`,
      credentials: {
        subdomain: tenant.zendeskSubdomain,
        accessToken: FAKE_TOKEN,
        refreshToken: FAKE_TOKEN,
        tokenType: "Bearer",
        scope: "read",
      },
      cursor: {
        tickets: { startTime: Math.floor(anchor / 1000) },
        organizations: { startTime: Math.floor(anchor / 1000) },
        backfillCompletedAt: anchorDate.toISOString(),
      },
    },
    update: {},
  });
  const jira = await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "jira" } },
    create: {
      organizationId,
      provider: "jira",
      status: "connected",
      connectedAt,
      lastSyncAt: anchorDate,
      webhookSecret: `seed-fixture-webhook-secret-jira-${tenant.key}`,
      credentials: {
        cloudId: tenant.jiraCloudId,
        siteUrl: tenant.jiraSiteUrl,
        accessToken: FAKE_TOKEN,
        refreshToken: FAKE_TOKEN,
        tokenType: "Bearer",
        scope: "read:jira-work offline_access",
      },
      cursor: { issues: { updatedSince: anchorDate.toISOString() }, backfillCompletedAt: anchorDate.toISOString() },
    },
    update: {},
  });

  await assertNotStale(prisma, zendesk.id, dataset);

  const integrationIdFor = { zendesk: zendesk.id, jira: jira.id } as const;
  let rawEventsWritten = 0;
  const ingest = async (phase: "A" | "B") => {
    const rows = dataset.rawEvents.filter((row) => row.phase === phase);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await prisma.rawEvent.createMany({
        data: rows.slice(i, i + CHUNK).map((row) => toRawEventInput(row, integrationIdFor, organizationId)),
        skipDuplicates: true,
      });
      rawEventsWritten += result.count;
    }
    log(`phase ${phase}: ${rows.length} raw events offered`);
  };

  // ---- Phase A: the world as of the priority bump --------------------------------------
  await ingest("A");
  await derive(prisma, zendesk.id, jira.id, log);
  await applyCustomerMetadata(prisma, organizationId, dataset);
  const slaImport = await runZendeskSlaPolicyImport(prisma, zendesk.id, (orgId) =>
    ensureDefaultCalendarVersion(prisma, orgId),
  );
  await pinPolicyVersions(prisma, organizationId, anchor);

  const commitments = await runCommitmentPipeline(prisma, organizationId);
  if (commitments.casesFailed.length > 0) throw new Error(`commitment pipeline failed: ${JSON.stringify(commitments.casesFailed)}`);
  await recordSlaImportSummary(prisma, organizationId, {
    provider: "zendesk",
    unsupportedConditions: slaImport.unsupportedConditions,
    unsupportedMetrics: slaImport.unsupportedMetrics,
    policiesWithNoUsableTargets: slaImport.policiesWithNoUsableTargets,
    policiesWithUnresolvedSchedule: slaImport.policiesWithUnresolvedSchedule,
    policiesArchived: slaImport.policiesArchived,
    casesWithNoMatchingPolicy: commitments.casesWithNoMatchingPolicy,
  });
  log(`commitments created: ${commitments.commitmentsCreated} (no matching policy: ${commitments.casesWithNoMatchingPolicy})`);

  const startedByCase = await loadCaseReadiness(prisma, organizationId);
  const boundary = dataset.phaseBoundary.getTime() + 5 * MIN;
  const checkpoints = buildCheckpoints(anchor, startedByCase, boundary);
  const candidates: (NotificationCandidate & { asOf: number })[] = [];
  let evaluationsCreated = 0;
  const runCheckpoint = async (asOf: number) => {
    const caseIds = readyCaseIds(startedByCase, asOf);
    if (caseIds.length === 0) return;
    const asOfIso = new Date(asOf).toISOString();
    const cycles = await runNextReplyCyclePipeline(prisma, organizationId, { asOf: asOfIso, caseIds });
    if (cycles.casesFailed.length > 0) throw new Error(`next-reply pipeline failed: ${JSON.stringify(cycles.casesFailed)}`);
    const evaluation = await runEvaluationPipeline(prisma, organizationId, { asOf: asOfIso, scope: "active", caseIds });
    if (evaluation.commitmentsFailed.length > 0) throw new Error(`evaluation pipeline failed: ${JSON.stringify(evaluation.commitmentsFailed)}`);
    evaluationsCreated += evaluation.evaluationsCreated;
    for (const candidate of evaluation.notificationCandidates) candidates.push({ ...candidate, asOf });
  };

  // Replaying history over commitments that are already evaluated would stack stale Evaluation rows
  // (each checkpoint would "transition" back from the final status), so a re-run in place skips it.
  const alreadyEvaluated = (await prisma.evaluation.count({ where: { commitment: { case: { organizationId } } } })) > 0;
  if (alreadyEvaluated) log("evaluations already exist: skipping the history replay (use --reset to rebuild it)");
  const replay = async (points: number[]) => {
    if (!alreadyEvaluated) for (const asOf of points) await runCheckpoint(asOf);
  };

  await replay(checkpoints.filter((t) => t <= boundary));

  // ---- Phase B: the bump and the unlink arrive, active commitments re-resolve ----------------
  await ingest("B");
  await derive(prisma, zendesk.id, jira.id, log);
  const reResolution = await runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: new Date(boundary).toISOString() });
  if (reResolution.casesFailed.length > 0) throw new Error(`re-resolution failed: ${JSON.stringify(reResolution.casesFailed)}`);
  log(`re-resolution: ${reResolution.commitmentsUpdated} commitment(s) moved to a different policy`);

  await replay(checkpoints.filter((t) => t > boundary));
  if (!alreadyEvaluated) log(`${checkpoints.length} evaluation checkpoints run`);

  // ---- Alert history, then normalize the few wall-clock columns the pipelines stamp ----------
  const alerts = await recordAlerts(prisma, organizationId, dataset, candidates, anchor);
  await normalizeTimestamps(prisma, organizationId, dataset, anchor);

  const summary: SeedSummary = {
    organizationId,
    tenantKey: tenant.key,
    anchor: anchorDate,
    rawEventsWritten,
    checkpoints: alreadyEvaluated ? 0 : checkpoints.length,
    commitmentsCreated: commitments.commitmentsCreated,
    evaluationsCreated,
    notificationsRecorded: alerts.notifications,
    notificationFailuresRecorded: alerts.failures,
    slaImport,
  };
  log(`seed complete: ${JSON.stringify({ ...summary, slaImport: undefined })}`);
  return summary;
}

// --- helpers ---------------------------------------------------------------------------------

function toRawEventInput(
  row: SeedRawEvent,
  integrationIdFor: { zendesk: string; jira: string },
  organizationId: string,
): Prisma.RawEventCreateManyInput {
  return {
    // Stable ids: derived keys (e.g. a Next Reply cycleKey) embed the RawEvent id, so a random cuid here
    // would make those differ after every rebuild.
    id: `seed-raw-${createHash("sha256").update(`${organizationId}|${row.integration}|${row.providerEventId}`).digest("hex").slice(0, 24)}`,
    integrationId: integrationIdFor[row.integration],
    providerEventId: row.providerEventId,
    sourceHash: row.sourceHash,
    payload: row.payload as Prisma.InputJsonValue,
    fetchedAt: row.fetchedAt,
  };
}

/**
 * Ticket snapshots are content-hashed, so a rerun with a different anchor (or after the fixtures
 * changed) would silently stack a second, conflicting snapshot per ticket. Fail instead.
 */
async function assertNotStale(prisma: PrismaClient, zendeskIntegrationId: string, dataset: SeedDataset): Promise<void> {
  const expected = new Set(dataset.rawEvents.filter((r) => r.providerEventId.startsWith("ticket:")).map((r) => r.providerEventId));
  const existing = await prisma.rawEvent.findMany({
    where: { integrationId: zendeskIntegrationId, providerEventId: { startsWith: "ticket:" } },
    select: { providerEventId: true },
  });
  const foreign = existing.filter((row) => !expected.has(row.providerEventId));
  if (foreign.length > 0) {
    throw new Error(
      `The seed organization already holds ${foreign.length} ticket snapshot(s) from a different anchor or fixture version. Re-run with --reset.`,
    );
  }
}

/** The ingestion-tail stages, in the worker's own order. All idempotent. */
async function derive(
  prisma: PrismaClient,
  zendeskId: string,
  jiraId: string,
  log: (message: string) => void,
): Promise<void> {
  const refOf = async (id: string): Promise<IntegrationRef> => {
    const row = await prisma.integration.findUniqueOrThrow({ where: { id } });
    return { id: row.id, organizationId: row.organizationId, provider: row.provider, status: row.status };
  };
  const zendesk = await refOf(zendeskId);
  const jira = await refOf(jiraId);
  const normalization = await normalizeAndProject(PROVIDERS.zendesk, { prisma, integration: zendesk, mode: "full" });
  if (normalization.failures.length > 0) throw new Error(`Zendesk normalization failed: ${JSON.stringify(normalization.failures)}`);
  await PROVIDERS.zendesk.importCalendars!({
    prisma,
    integration: zendesk,
    ensureDefaultCalendarVersion: (orgId) => ensureDefaultCalendarVersion(prisma, orgId),
  });
  await correlateAndProject(PROVIDERS.zendesk, { prisma, integration: zendesk, resolveCaseRef: null });
  const resolveCaseRef = await caseRefResolverFor(prisma, jira.organizationId);
  await correlateAndProject(PROVIDERS.jira, { prisma, integration: jira, resolveCaseRef });
  const jiraNormalization = await normalizeAndProject(PROVIDERS.jira, { prisma, integration: jira, mode: "full" });
  if (jiraNormalization.failures.length > 0) throw new Error(`Jira normalization failed: ${JSON.stringify(jiraNormalization.failures)}`);
  log(
    `derived: ${normalization.customersUpserted} customers, ${normalization.casesUpserted} cases, ${normalization.eventsDerived} zendesk events, ${jiraNormalization.eventsDerived} jira events on linked issues`,
  );
}

/**
 * Customer.tier and the calendar override have no provider source (a customer is a Zendesk
 * organization, nothing more), so they are set the way the app sets them: directly, and via
 * `setCustomerCalendar`. Native calendar/policy go through the same helpers the settings UI uses.
 */
async function applyCustomerMetadata(prisma: PrismaClient, organizationId: string, dataset: SeedDataset): Promise<void> {
  const identities = await prisma.customerIdentity.findMany({
    where: { organizationId, provider: "zendesk", kind: "organization" },
    select: { customerId: true, externalId: true },
  });
  const idByZendeskOrg = new Map(identities.map((i) => [i.externalId, i.customerId]));

  for (const def of dataset.customers) {
    const id = idByZendeskOrg.get(String(def.zendeskOrgId));
    if (!id) throw new Error(`Customer for Zendesk org ${def.zendeskOrgId} (${def.name}) was not created by normalization`);
    await prisma.customer.update({ where: { id }, data: { tier: def.tier } });
    // Cases carry their own tier column (a legacy policy-match input); mirror the customer's.
    await prisma.case.updateMany({ where: { organizationId, customerId: id }, data: { tier: def.tier } });
  }

  let nativeCalendar = await prisma.businessCalendar.findFirst({ where: { organizationId, name: NATIVE_CALENDAR.name, source: "native" } });
  if (!nativeCalendar) {
    const created = await createNativeCalendar(prisma, organizationId, NATIVE_CALENDAR.name, {
      timezone: NATIVE_CALENDAR.timezone,
      weekly: NATIVE_WEEKLY,
      holidays: [],
    });
    nativeCalendar = await prisma.businessCalendar.findUniqueOrThrow({ where: { id: created.calendarId } });
  }
  for (const def of dataset.customers.filter((c) => c.calendarOverride === "24x7")) {
    await setCustomerCalendar(prisma, organizationId, idByZendeskOrg.get(String(def.zendeskOrgId))!, nativeCalendar.id);
  }

  const nativeOwner = dataset.customers.find((c) => c.policy === "native");
  const existingNative = await prisma.sLAPolicy.findFirst({ where: { organizationId, name: NATIVE_POLICY_NAME, source: "native" } });
  if (nativeOwner && !existingNative) {
    await createNativePolicy(prisma, organizationId, NATIVE_POLICY_NAME, {
      match: { customerIds: [idByZendeskOrg.get(String(nativeOwner.zendeskOrgId))!] },
      targets: [
        { kind: "first_response", minutes: NATIVE_TARGETS.fr },
        { kind: "resolution", minutes: NATIVE_TARGETS.res },
        { kind: "next_reply", minutes: NATIVE_TARGETS.nr! },
      ],
      warnAtPercent: [60, 90],
    });
  }

  // A ticket whose source no longer exists: kept for audit, excluded from evaluation and default views.
  const deleted = dataset.tickets.filter((t) => t.softDeleted).map((t) => String(t.ticketId));
  if (deleted.length > 0) {
    await prisma.case.updateMany({
      where: { organizationId, externalId: { in: deleted } },
      data: { deletedAt: new Date(dataset.anchor.getTime() - 12 * HOUR) },
    });
  }
}

/** Policy versions are stamped `effectiveFrom: new Date()` on creation; make them start well before any seeded case. */
async function pinPolicyVersions(prisma: PrismaClient, organizationId: string, anchor: number): Promise<void> {
  await prisma.sLAPolicyVersion.updateMany({
    where: { policy: { organizationId } },
    data: { effectiveFrom: new Date(anchor - 120 * DAY) },
  });
}

interface CaseReadiness {
  openedAt: number;
  /** Latest start among the case's first_response/resolution commitments. */
  latestStart: number;
}

async function loadCaseReadiness(prisma: PrismaClient, organizationId: string): Promise<Map<string, CaseReadiness>> {
  const commitments = await prisma.commitment.findMany({
    where: { case: { organizationId, deletedAt: null }, kind: { in: ["first_response", "resolution"] } },
    select: { caseId: true, startedAt: true, case: { select: { openedAt: true } } },
  });
  const map = new Map<string, CaseReadiness>();
  for (const c of commitments) {
    const existing = map.get(c.caseId);
    const start = c.startedAt.getTime();
    if (!existing) map.set(c.caseId, { openedAt: c.case.openedAt.getTime(), latestStart: start });
    else existing.latestStart = Math.max(existing.latestStart, start);
  }
  return map;
}

/** A case is evaluated at a checkpoint only once it (and every commitment on it) has started — never before its own clock. */
function readyCaseIds(readiness: Map<string, CaseReadiness>, asOf: number): string[] {
  return [...readiness.entries()].filter(([, r]) => r.openedAt <= asOf && r.latestStart <= asOf).map(([id]) => id);
}

/**
 * Daily checkpoints back to the earliest case, every six hours over the last two days, the anchor
 * itself, and one just before the Phase B boundary (the worker "ran" right before the priority bump
 * landed, so commitments already completed by then are finalized and re-resolution leaves them alone).
 */
function buildCheckpoints(anchor: number, readiness: Map<string, CaseReadiness>, boundary: number): number[] {
  const earliest = Math.min(anchor, ...[...readiness.values()].map((r) => r.latestStart));
  const points = new Set<number>([boundary - 10 * MIN]);
  for (let t = anchor; t >= earliest; t -= anchor - t < 2 * DAY ? 6 * HOUR : DAY) points.add(t);
  return [...points].sort((a, b) => a - b);
}

/**
 * Alert history: what `claimNotifications` would have recorded had a Slack workspace been connected
 * (none is — no request can be sent). One `Notification` per (commitment, threshold), at the first
 * checkpoint that crossed it; tickets flagged `failNotify` record their breach alert as a
 * `NotificationFailure` instead (delivery kept failing), which is how the app models it.
 */
async function recordAlerts(
  prisma: PrismaClient,
  organizationId: string,
  dataset: SeedDataset,
  candidates: (NotificationCandidate & { asOf: number })[],
  anchor: number,
): Promise<{ notifications: number; failures: number }> {
  const firstSeen = new Map<string, NotificationCandidate & { asOf: number }>();
  for (const candidate of [...candidates].sort((a, b) => a.asOf - b.asOf)) {
    const key = `${candidate.commitmentId}:${candidate.threshold}`;
    if (!firstSeen.has(key)) firstSeen.set(key, candidate);
  }

  const failing = new Set(dataset.tickets.filter((t) => t.failNotify).map((t) => String(t.ticketId)));
  const failingCaseIds = new Set(
    (await prisma.case.findMany({ where: { organizationId, externalId: { in: [...failing] } }, select: { id: true } })).map((c) => c.id),
  );

  const notifications: Prisma.NotificationCreateManyInput[] = [];
  let failures = 0;
  for (const candidate of firstSeen.values()) {
    if (failingCaseIds.has(candidate.caseId) && candidate.threshold === 100) {
      const failedAt = new Date(Math.min(candidate.asOf + 30 * MIN, anchor));
      await prisma.notificationFailure.upsert({
        where: { commitmentId_threshold: { commitmentId: candidate.commitmentId, threshold: candidate.threshold } },
        create: {
          commitmentId: candidate.commitmentId,
          threshold: candidate.threshold,
          error: "slack: channel_not_found (seed fixture)",
          attempts: 3,
          firstFailedAt: new Date(candidate.asOf),
          lastFailedAt: failedAt,
        },
        update: {},
      });
      failures += 1;
    } else {
      notifications.push({
        commitmentId: candidate.commitmentId,
        threshold: candidate.threshold,
        channel: "slack",
        sentAt: new Date(candidate.asOf),
      });
    }
  }
  const created = await prisma.notification.createMany({ data: notifications, skipDuplicates: true });
  return { notifications: created.count, failures };
}

/** The correlators stamp `confirmedAt: new Date()`; a link was confirmed when it was first observed. */
async function normalizeTimestamps(prisma: PrismaClient, organizationId: string, dataset: SeedDataset, anchor: number): Promise<void> {
  for (const issue of dataset.issues) {
    if (issue.ticketId === null || issue.linkedAt === null) continue;
    await prisma.caseLink.updateMany({
      where: { system: "jira", externalId: issue.key, case: { organizationId, externalId: String(issue.ticketId) } },
      data: { confirmedAt: issue.linkedAt },
    });
  }
  await prisma.integration.updateMany({ where: { organizationId }, data: { lastSyncAt: new Date(anchor), lastSyncError: null } });
}
