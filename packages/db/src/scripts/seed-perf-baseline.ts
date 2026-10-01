import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  CommitmentKind,
  CommitmentStatus,
  IntegrationProvider,
} from "../../generated/prisma/client";

/**
 * Generates a large, shape-realistic dataset for roadmap task 7.7 (Performance
 * baseline with 5,000 cases and 200,000+ events).
 *
 * By default every run creates a fresh Organization (named via `orgName`,
 * default includes a timestamp) so a profiling run never mixes data from a
 * previous one; pass `--org-name` to reuse a fixed name and `--reset` to
 * delete that organization (cascades through every table below) before
 * reseeding it.
 *
 * Pass `--user-email` (or `--organization-id`) instead to seed into an
 * *existing* organization — e.g. so the data shows up in the app for a real
 * logged-in user — rather than creating a new one. In that mode the existing
 * zendesk Integration / BusinessCalendar(Version) / SLAPolicy(Version) are
 * reused if present (an Integration is unique per organization+provider, so
 * creating a second one would fail) instead of creating new ones, `--reset`
 * is rejected (deleting a real organization by accident would take its real
 * users/cases with it), and every generated Case gets a `perf-` prefixed
 * `externalId` so it can never collide with the organization's real cases.
 *
 * This only produces volume and referential shape for profiling case list /
 * dashboard / case detail / evaluation / worker / database queries — it does
 * not run the real SLA engine, so `Commitment`/`Evaluation` rows are
 * plausible but not reproducible the way `packages/core` would derive them.
 * Run via `pnpm db:seed:perf-baseline -- --cases=5000 --events-per-case=40`.
 */

export interface SeedPerfBaselineOptions {
  /** Organization display name. A fresh default (with a timestamp) avoids colliding with a prior run's data. Ignored when `userEmail`/`organizationId` is set. */
  orgName?: string;
  /** Seed into the organization this user's email belongs to, instead of creating a new one. */
  userEmail?: string;
  /** Seed into this existing organization id, instead of creating a new one. */
  organizationId?: string;
  /** Number of Case rows to create. Roadmap target: 5,000. */
  cases?: number;
  /** Average NormalizedEvent (and backing RawEvent) rows per case. Roadmap target: 200,000+ total. */
  eventsPerCase?: number;
  /** Number of Customer rows cases are distributed across. */
  customers?: number;
  /** Average Evaluation rows per Commitment (2 Commitments per Case). */
  evaluationsPerCommitment?: number;
  /** Rows per INSERT batch. Lower this if the target database has a small statement/parameter limit. */
  batchSize?: number;
  /** Delete any existing Organization with this name (and everything it cascades to) before seeding. Not allowed together with `userEmail`/`organizationId`. */
  reset?: boolean;
  onProgress?: (message: string) => void;
}

export interface SeedPerfBaselineResult {
  organizationId: string;
  customers: number;
  cases: number;
  rawEvents: number;
  normalizedEvents: number;
  commitments: number;
  evaluations: number;
  durationMs: number;
}

const PRIORITIES = ["low", "normal", "high", "urgent"];
const TIERS = ["free", "standard", "enterprise"];
const CHANNELS = ["email", "web", "chat", "api"];
const TAG_POOL = [
  "billing",
  "bug",
  "onboarding",
  "feature_request",
  "outage",
  "vip",
  "renewal",
];
const EVENT_TYPES = [
  "ticket_created",
  "agent_reply",
  "customer_reply",
  "status_changed",
  "ticket_closed",
];

type SeedScenario =
  | "on_track"
  | "at_risk"
  | "first_response_breached"
  | "resolution_breached"
  | "both_breached"
  | "met"
  | "open_aging"
  | "edge_mixed";

const SCENARIO_WEIGHTS: Array<{ key: SeedScenario; weight: number }> = [
  { key: "on_track", weight: 20 },
  { key: "at_risk", weight: 15 },
  { key: "first_response_breached", weight: 15 },
  { key: "resolution_breached", weight: 15 },
  { key: "both_breached", weight: 10 },
  { key: "met", weight: 10 },
  { key: "open_aging", weight: 10 },
  { key: "edge_mixed", weight: 5 },
];

function scenarioForCase(index: number, total: number): SeedScenario {
  const position = index / Math.max(1, total);
  let cursor = 0;
  for (const scenario of SCENARIO_WEIGHTS) {
    cursor += scenario.weight / 100;
    if (position < cursor) return scenario.key;
  }
  return "edge_mixed";
}

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function pickSome<T>(pool: T[], max: number): T[] {
  const count = Math.floor(Math.random() * (max + 1));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Splits `items` into chunks of at most `size`, preserving order. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function insertBatched<T>(
  label: string,
  rows: T[],
  batchSize: number,
  insert: (batch: T[]) => Promise<unknown>,
  onProgress?: (message: string) => void,
): Promise<void> {
  const batches = chunk(rows, batchSize);
  for (let i = 0; i < batches.length; i++) {
    await insert(batches[i]!);
    onProgress?.(
      `${label}: ${Math.min((i + 1) * batchSize, rows.length)}/${rows.length}`,
    );
  }
}

export async function seedPerfBaseline(
  prisma: PrismaClient,
  options: SeedPerfBaselineOptions = {},
): Promise<SeedPerfBaselineResult> {
  const caseCount = options.cases ?? 5000;
  const eventsPerCase = options.eventsPerCase ?? 42; // 5,000 * 42 = 210,000, clears the 200,000+ target with headroom
  const customerCount =
    options.customers ?? Math.max(50, Math.round(caseCount / 10));
  const evaluationsPerCommitment = options.evaluationsPerCommitment ?? 3;
  const batchSize = options.batchSize ?? 2000;
  const onProgress = options.onProgress;
  const startedAt = Date.now();

  const targetingExisting = Boolean(
    options.userEmail || options.organizationId,
  );
  if (options.reset && targetingExisting) {
    throw new Error(
      "--reset cannot be combined with --user-email/--organization-id — it would delete a real organization.",
    );
  }

  let organization: { id: string };
  if (options.userEmail) {
    const user = await prisma.user.findUnique({
      where: { email: options.userEmail },
      select: { organizationId: true },
    });
    if (!user)
      throw new Error(`No user found with email "${options.userEmail}"`);
    organization = { id: user.organizationId };
    onProgress?.(
      `Seeding into existing organization ${organization.id} (owner of ${options.userEmail})`,
    );
  } else if (options.organizationId) {
    const existing = await prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { id: true },
    });
    if (!existing)
      throw new Error(
        `No organization found with id "${options.organizationId}"`,
      );
    organization = existing;
    onProgress?.(`Seeding into existing organization ${organization.id}`);
  } else {
    const orgName =
      options.orgName ?? `Perf Baseline ${new Date().toISOString()}`;
    if (options.reset) {
      const existing = await prisma.organization.findFirst({
        where: { name: orgName },
        select: { id: true },
      });
      if (existing) {
        onProgress?.(
          `Deleting existing organization "${orgName}" (${existing.id})`,
        );
        await prisma.organization.delete({ where: { id: existing.id } });
      }
    }
    organization = await prisma.organization.create({
      data: { name: orgName },
    });
  }

  let calendarVersion = await prisma.businessCalendarVersion.findFirst({
    where: { calendar: { organizationId: organization.id } },
    orderBy: { version: "desc" },
  });
  if (!calendarVersion) {
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId: organization.id,
        name: "Always Open (perf baseline)",
      },
    });
    calendarVersion = await prisma.businessCalendarVersion.create({
      data: {
        calendarId: calendar.id,
        version: 1,
        timezone: "UTC",
        weekly: {},
        holidays: [],
        alwaysOpen: true,
        source: "native",
      },
    });
  }

  let policyVersion = await prisma.sLAPolicyVersion.findFirst({
    where: { policy: { organizationId: organization.id } },
    orderBy: { version: "desc" },
  });
  if (!policyVersion) {
    const policy = await prisma.sLAPolicy.create({
      data: {
        organizationId: organization.id,
        name: "Default (perf baseline)",
        source: "native",
      },
    });
    policyVersion = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [
          { kind: "first_response", minutes: 60 },
          { kind: "resolution", minutes: 480 },
        ],
        pauseOnStates: [],
        calendarVersionId: calendarVersion.id,
        warnAtPercent: [80],
        effectiveFrom: new Date(0),
        source: "native",
      },
    });
  }

  let integration = await prisma.integration.findFirst({
    where: {
      organizationId: organization.id,
      provider: IntegrationProvider.zendesk,
    },
  });
  if (!integration) {
    integration = await prisma.integration.create({
      data: {
        organizationId: organization.id,
        provider: IntegrationProvider.zendesk,
      },
    });
  }

  // Unique per run (not just per row) so re-running against the same
  // organization — expected in `userEmail`/`organizationId` mode — never
  // collides with a previous run's rows on a `@@unique` constraint.
  const runId = crypto.randomUUID().slice(0, 8);

  // --- Customers -----------------------------------------------------------
  const customerRows = Array.from({ length: customerCount }, (_, i) => ({
    id: crypto.randomUUID(),
    organizationId: organization.id,
    name: `Customer ${i + 1} (perf ${runId})`,
    tier: pick(TIERS),
  }));
  await insertBatched(
    "customers",
    customerRows,
    batchSize,
    (batch) => prisma.customer.createMany({ data: batch }),
    onProgress,
  );
  await insertBatched(
    "customer identities",
    customerRows.map((c, i) => ({
      organizationId: organization.id,
      customerId: c.id,
      provider: IntegrationProvider.zendesk,
      kind: "organization",
      externalId: `zendesk-org-${runId}-${i + 1}`,
    })),
    batchSize,
    (batch) => prisma.customerIdentity.createMany({ data: batch }),
    onProgress,
  );
  const customerIds = customerRows.map((c) => c.id);

  // --- Cases -----------------------------------------------------------------
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  interface CaseRow {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    scenario: SeedScenario;
  }
  const caseRows: CaseRow[] = [];
  const caseInserts: Prisma.CaseCreateManyInput[] = [];
  for (let i = 0; i < caseCount; i++) {
    const id = crypto.randomUUID();
    const scenario = scenarioForCase(i, caseCount);
    let openedAt = new Date(now - Math.floor(Math.random() * ninetyDaysMs));
    let closedAt: Date | null =
      Math.random() < 0.6
        ? new Date(
            openedAt.getTime() + randomInt(10 * 60_000, 5 * 24 * 60 * 60_000),
          )
        : null;

    switch (scenario) {
      case "on_track":
        openedAt = new Date(now - 30 * 60_000);
        closedAt = null;
        break;
      case "at_risk":
        openedAt = new Date(now - 7 * 60 * 60_000);
        closedAt = null;
        break;
      case "first_response_breached":
        openedAt = new Date(now - 2 * 60 * 60_000);
        closedAt = new Date(now - 30 * 60_000);
        break;
      case "resolution_breached":
        openedAt = new Date(now - 10 * 60 * 60_000);
        closedAt = new Date(now - 60 * 60_000);
        break;
      case "both_breached":
        openedAt = new Date(now - 12 * 60 * 60_000);
        closedAt = new Date(now - 60 * 60_000);
        break;
      case "met":
        openedAt = new Date(now - 4 * 60 * 60_000);
        closedAt = new Date(now - 60 * 60_000);
        break;
      case "open_aging":
        openedAt = new Date(now - 3 * 24 * 60 * 60_000);
        closedAt = null;
        break;
      case "edge_mixed":
        break;
    }

    caseRows.push({ id, openedAt, closedAt, scenario });
    caseInserts.push({
      id,
      organizationId: organization.id,
      customerId: pick(customerIds),
      externalId: `perf-${runId}-${i}`,
      system: IntegrationProvider.zendesk,
      sourceIntegrationId: integration.id,
      subject: `Case ${i + 1}`,
      priority: pick(PRIORITIES),
      tier: pick(TIERS),
      channel: pick(CHANNELS),
      tags: pickSome(TAG_POOL, 3),
      openedAt,
      closedAt,
    });
  }
  await insertBatched(
    "cases",
    caseInserts,
    batchSize,
    (batch) => prisma.case.createMany({ data: batch }),
    onProgress,
  );

  // --- Raw + normalized events -------------------------------------------
  // One RawEvent backs one NormalizedEvent here (simplest 1:1 shape) — real
  // ingestion sometimes derives several NormalizedEvents from one RawEvent,
  // but that distinction doesn't matter for a volume/shape profiling seed.
  let rawEventTotal = 0;
  let normalizedEventTotal = 0;
  for (const caseBatch of chunk(
    caseRows,
    Math.max(1, Math.floor(batchSize / eventsPerCase)),
  )) {
    const rawEventInserts: Prisma.RawEventCreateManyInput[] = [];
    const normalizedEventInserts: Prisma.NormalizedEventCreateManyInput[] = [];
    for (const c of caseBatch) {
      const count = randomInt(
        Math.max(1, eventsPerCase - 10),
        eventsPerCase + 10,
      );
      const spanMs =
        (c.closedAt ?? new Date()).getTime() - c.openedAt.getTime();
      for (let seq = 0; seq < count; seq++) {
        const rawEventId = crypto.randomUUID();
        const occurredAt = new Date(
          c.openedAt.getTime() + Math.floor((spanMs * seq) / count),
        );
        rawEventInserts.push({
          id: rawEventId,
          integrationId: integration.id,
          providerEventId: `${c.id}-${seq}`,
          sourceHash: crypto.randomUUID(),
          payload: { caseId: c.id, seq },
          fetchedAt: occurredAt,
        });
        normalizedEventInserts.push({
          id: crypto.randomUUID(),
          caseId: c.id,
          sourceRawEventId: rawEventId,
          type: pick(EVENT_TYPES),
          occurredAt,
          actor: seq % 2 === 0 ? "agent" : "customer",
          system: IntegrationProvider.zendesk,
          sourceRole: "ticket_source",
          sourceSequence: seq,
        });
      }
    }
    await prisma.rawEvent.createMany({ data: rawEventInserts });
    await prisma.normalizedEvent.createMany({ data: normalizedEventInserts });
    rawEventTotal += rawEventInserts.length;
    normalizedEventTotal += normalizedEventInserts.length;
    onProgress?.(
      `events: ${normalizedEventTotal} normalized (${rawEventTotal} raw)`,
    );
  }

  // --- Commitments (first_response + resolution per case) -----------------
  interface CommitmentRow {
    id: string;
    caseId: string;
    kind: CommitmentKind;
    policyVersionId: string;
    calendarVersionId: string;
    startedAt: Date;
    targetMinutes: number;
    dueAt: Date;
    status: CommitmentStatus;
    closedAt: Date | null;
  }
  const commitmentInserts: CommitmentRow[] = [];
  for (const c of caseRows) {
    for (const [kind, targetMinutes] of [
      [CommitmentKind.first_response, 60],
      [CommitmentKind.resolution, 480],
    ] as const) {
      const dueAt = new Date(c.openedAt.getTime() + targetMinutes * 60_000);
      let status: CommitmentStatus;
      switch (c.scenario) {
        case "on_track":
          status = CommitmentStatus.on_track;
          break;
        case "at_risk":
          status =
            kind === CommitmentKind.resolution
              ? CommitmentStatus.at_risk
              : CommitmentStatus.met;
          break;
        case "first_response_breached":
          status =
            kind === CommitmentKind.first_response
              ? CommitmentStatus.breached
              : CommitmentStatus.met;
          break;
        case "resolution_breached":
          status =
            kind === CommitmentKind.resolution
              ? CommitmentStatus.breached
              : CommitmentStatus.met;
          break;
        case "both_breached":
          status = CommitmentStatus.breached;
          break;
        case "met":
          status = CommitmentStatus.met;
          break;
        case "open_aging":
          status =
            kind === CommitmentKind.resolution
              ? CommitmentStatus.at_risk
              : CommitmentStatus.met;
          break;
        case "edge_mixed":
          if (c.closedAt) {
            status =
              dueAt.getTime() < c.closedAt.getTime()
                ? CommitmentStatus.breached
                : CommitmentStatus.met;
          } else {
            status =
              dueAt.getTime() < now
                ? CommitmentStatus.breached
                : Math.random() < 0.15
                  ? CommitmentStatus.at_risk
                  : CommitmentStatus.on_track;
          }
          break;
      }
      commitmentInserts.push({
        id: crypto.randomUUID(),
        caseId: c.id,
        kind,
        policyVersionId: policyVersion.id,
        calendarVersionId: calendarVersion.id,
        startedAt: c.openedAt,
        targetMinutes,
        dueAt,
        status,
        closedAt: status === "met" || status === "breached" ? c.closedAt : null,
      });
    }
  }
  await insertBatched(
    "commitments",
    commitmentInserts,
    batchSize,
    (batch) => prisma.commitment.createMany({ data: batch }),
    onProgress,
  );

  // --- Evaluations (a short history per commitment) ------------------------
  const evaluationInserts: Prisma.EvaluationCreateManyInput[] = [];
  for (const commitment of commitmentInserts) {
    const snapshots = Math.max(1, evaluationsPerCommitment + randomInt(-1, 1));
    for (let s = 0; s < snapshots; s++) {
      const evaluatedAt = new Date(
        commitment.startedAt.getTime() +
          Math.floor(
            ((commitment.dueAt.getTime() - commitment.startedAt.getTime()) *
              (s + 1)) /
              (snapshots + 1),
          ),
      );
      const elapsedSeconds = Math.max(
        0,
        Math.floor(
          (evaluatedAt.getTime() - commitment.startedAt.getTime()) / 1000,
        ),
      );
      const targetSeconds = commitment.targetMinutes * 60;
      const remainingSeconds = targetSeconds - elapsedSeconds;
      evaluationInserts.push({
        id: crypto.randomUUID(),
        commitmentId: commitment.id,
        evaluatedAt,
        elapsedSeconds,
        remainingSeconds,
        status:
          remainingSeconds < 0
            ? CommitmentStatus.breached
            : remainingSeconds < targetSeconds * 0.2
              ? CommitmentStatus.at_risk
              : CommitmentStatus.on_track,
        breachedBySeconds: remainingSeconds < 0 ? -remainingSeconds : null,
        inputs: { seed: true },
      });
    }
  }
  await insertBatched(
    "evaluations",
    evaluationInserts,
    batchSize,
    (batch) => prisma.evaluation.createMany({ data: batch }),
    onProgress,
  );

  return {
    organizationId: organization.id,
    customers: customerRows.length,
    cases: caseRows.length,
    rawEvents: rawEventTotal,
    normalizedEvents: normalizedEventTotal,
    commitments: commitmentInserts.length,
    evaluations: evaluationInserts.length,
    durationMs: Date.now() - startedAt,
  };
}

function parseArgs(argv: string[]): SeedPerfBaselineOptions {
  const options: SeedPerfBaselineOptions = {};
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    switch (rawKey) {
      case "org-name":
        options.orgName = rawValue;
        break;
      case "user-email":
        options.userEmail = rawValue;
        break;
      case "organization-id":
        options.organizationId = rawValue;
        break;
      case "cases":
        options.cases = Number(rawValue);
        break;
      case "events-per-case":
        options.eventsPerCase = Number(rawValue);
        break;
      case "customers":
        options.customers = Number(rawValue);
        break;
      case "evaluations-per-commitment":
        options.evaluationsPerCommitment = Number(rawValue);
        break;
      case "batch-size":
        options.batchSize = Number(rawValue);
        break;
      case "reset":
        options.reset = true;
        break;
    }
  }
  return options;
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { getPrismaClient } = await import("../index");
  const options = parseArgs(process.argv.slice(2));
  seedPerfBaseline(getPrismaClient(), {
    ...options,
    onProgress: (message) => console.log(message),
  })
    .then((result) => {
      console.log("Seed complete:", result);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("seed-perf-baseline failed:", error);
      process.exit(1);
    });
}
