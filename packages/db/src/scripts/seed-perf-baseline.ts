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
 * The seed is intentionally deterministic at the scenario level: it keeps the
 * large-volume/performance purpose of this file while distributing cases across
 * known SLA scenarios with coherent event lifecycles. Commitment/Evaluation rows
 * are still seed fixtures (the real SLA engine is not invoked), but every generated
 * case has a predictable scenario that can be queried and verified in the UI.
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
  scenarioCounts: Record<PerfScenario, number>;
}

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TIERS = ["free", "standard", "enterprise"] as const;
const CHANNELS = ["email", "web", "chat", "api"] as const;
const TAG_POOL = [
  "billing",
  "bug",
  "onboarding",
  "feature_request",
  "outage",
  "vip",
  "renewal",
] as const;

type PerfScenario =
  | "on_track"
  | "at_risk"
  | "first_response_breached"
  | "resolution_breached"
  | "both_breached"
  | "met"
  | "open_aging"
  | "edge_mixed";

const SCENARIOS: ReadonlyArray<{ name: PerfScenario; weight: number }> = [
  { name: "on_track", weight: 20 },
  { name: "at_risk", weight: 15 },
  { name: "first_response_breached", weight: 15 },
  { name: "resolution_breached", weight: 15 },
  { name: "both_breached", weight: 10 },
  { name: "met", weight: 10 },
  { name: "open_aging", weight: 10 },
  { name: "edge_mixed", weight: 5 },
];

const EVENT_TYPES = [
  "ticket_created",
  "customer_reply",
  "agent_reply",
  "status_changed",
  "ticket_escalated",
  "internal_note",
  "ticket_closed",
] as const;

function scenarioForIndex(index: number, total: number): PerfScenario {
  const position = index % total;
  const target = (position / total) * 100;
  let cursor = 0;
  for (const scenario of SCENARIOS) {
    cursor += scenario.weight;
    if (target < cursor) return scenario.name;
  }
  return "edge_mixed";
}

function deterministicPick<T>(pool: readonly T[], index: number): T {
  return pool[index % pool.length]!;
}

function deterministicTags(index: number): string[] {
  const first = TAG_POOL[index % TAG_POOL.length]!;
  const second = TAG_POOL[(index * 3 + 1) % TAG_POOL.length]!;
  return first === second ? [first] : [first, second];
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
    zendeskOrgId: `zendesk-org-${runId}-${i + 1}`,
    tier: TIERS[i % TIERS.length]!,
  }));
  await insertBatched(
    "customers",
    customerRows,
    batchSize,
    (batch) => prisma.customer.createMany({ data: batch }),
    onProgress,
  );
  const customerIds = customerRows.map((c) => c.id);

  // --- Cases -----------------------------------------------------------------
  // Scenario assignment is deterministic and proportional to SCENARIOS above.
  // This keeps 5k/100k performance runs useful while guaranteeing known buckets.
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  interface CaseRow {
    id: string;
    index: number;
    scenario: PerfScenario;
    openedAt: Date;
    firstResponseAt: Date | null;
    closedAt: Date | null;
  }
  const caseRows: CaseRow[] = [];
  const caseInserts: Prisma.CaseCreateManyInput[] = [];

  for (let i = 0; i < caseCount; i++) {
    const id = crypto.randomUUID();
    const scenario = scenarioForIndex(i, 100);
    const baseAgeMs = Math.floor(((i % 1000) / 1000) * ninetyDaysMs);
    const responseMinutes =
      scenario === "first_response_breached" || scenario === "both_breached"
        ? 90
        : scenario === "at_risk"
          ? 50
          : scenario === "met"
            ? 30
            : scenario === "edge_mixed" && i % 2 === 0
              ? 61
              : 20;

    const resolutionMinutes =
      scenario === "resolution_breached" || scenario === "both_breached"
        ? 600
        : scenario === "met"
          ? 240
          : scenario === "at_risk" || scenario === "open_aging"
            ? 390
            : scenario === "edge_mixed"
              ? 480 + (i % 2) * 30
              : 180;

    const isOpen =
      scenario === "on_track" ||
      scenario === "at_risk" ||
      scenario === "open_aging" ||
      (scenario === "edge_mixed" && i % 2 === 0);
    const minimumAgeMs = Math.max(
      60 * 60_000,
      responseMinutes * 60_000 + 60 * 60_000,
      isOpen ? 0 : (resolutionMinutes + 60) * 60_000,
    );
    const openedAt = new Date(now - Math.max(baseAgeMs, minimumAgeMs));
    const firstResponseAt = new Date(
      openedAt.getTime() + responseMinutes * 60_000,
    );
    const closedAt = isOpen
      ? null
      : new Date(openedAt.getTime() + resolutionMinutes * 60_000);

    caseRows.push({
      id,
      index: i,
      scenario,
      openedAt,
      firstResponseAt,
      closedAt,
    });
    caseInserts.push({
      id,
      organizationId: organization.id,
      customerId: customerIds[i % customerIds.length]!,
      externalId: `perf-${runId}-${String(i + 1).padStart(6, "0")}`,
      system: IntegrationProvider.zendesk,
      subject: `[${scenario}] Case ${i + 1}`,
      priority: deterministicPick(PRIORITIES, i),
      tier: deterministicPick(TIERS, Math.floor(i / 2)),
      channel: deterministicPick(CHANNELS, i),
      tags: deterministicTags(i),
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
  // Events follow a coherent lifecycle per scenario instead of random event types.
  // Extra filler events are deterministic and occur between lifecycle milestones.
  let rawEventTotal = 0;
  let normalizedEventTotal = 0;
  for (const caseBatch of chunk(
    caseRows,
    Math.max(1, Math.floor(batchSize / Math.max(eventsPerCase, 1))),
  )) {
    const rawEventInserts: Prisma.RawEventCreateManyInput[] = [];
    const normalizedEventInserts: Prisma.NormalizedEventCreateManyInput[] = [];

    for (const c of caseBatch) {
      const count = Math.max(5, eventsPerCase);
      const spanEnd = c.closedAt?.getTime() ?? now;
      const spanMs = Math.max(spanEnd - c.openedAt.getTime(), 5 * 60_000);
      const lifecycle: Array<{ type: string; at: Date; actor: string }> = [
        { type: "ticket_created", at: c.openedAt, actor: "customer" },
        {
          type: "customer_reply",
          at: new Date(
            c.openedAt.getTime() + Math.min(5 * 60_000, spanMs / 10),
          ),
          actor: "customer",
        },
      ];

      if (
        c.scenario === "first_response_breached" ||
        c.scenario === "both_breached"
      ) {
        lifecycle.push({
          type: "ticket_escalated",
          at: new Date(c.openedAt.getTime() + 45 * 60_000),
          actor: "system",
        });
      }
      lifecycle.push({
        type: "agent_reply",
        at: c.firstResponseAt!,
        actor: "agent",
      });

      if (
        c.scenario === "resolution_breached" ||
        c.scenario === "both_breached" ||
        c.scenario === "edge_mixed"
      ) {
        lifecycle.push({
          type: "ticket_escalated",
          at: new Date(c.firstResponseAt!.getTime() + 90 * 60_000),
          actor: "agent",
        });
        lifecycle.push({
          type: "internal_note",
          at: new Date(c.firstResponseAt!.getTime() + 120 * 60_000),
          actor: "agent",
        });
      }

      if (c.closedAt) {
        lifecycle.push({
          type: "ticket_closed",
          at: c.closedAt,
          actor: "agent",
        });
      }

      lifecycle.sort((a, b) => a.at.getTime() - b.at.getTime());
      const eventCount = Math.max(count, lifecycle.length);
      for (let seq = 0; seq < eventCount; seq++) {
        const lifecycleEvent = lifecycle[seq];
        const occurredAt =
          lifecycleEvent?.at ??
          new Date(
            c.openedAt.getTime() + Math.floor((spanMs * seq) / eventCount),
          );
        const type =
          lifecycleEvent?.type ??
          (seq % 3 === 0
            ? "status_changed"
            : seq % 3 === 1
              ? "customer_reply"
              : "internal_note");
        const actor =
          lifecycleEvent?.actor ?? (seq % 2 === 0 ? "agent" : "customer");
        const rawEventId = crypto.randomUUID();
        rawEventInserts.push({
          id: rawEventId,
          integrationId: integration.id,
          providerEventId: `${c.id}-${seq}`,
          sourceHash: crypto.randomUUID(),
          payload: { caseId: c.id, seq, scenario: c.scenario, type },
          fetchedAt: occurredAt,
        });
        normalizedEventInserts.push({
          id: crypto.randomUUID(),
          caseId: c.id,
          sourceRawEventId: rawEventId,
          type,
          occurredAt,
          actor,
          system: IntegrationProvider.zendesk,
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
  // Targets are fixed at 60m / 480m. Statuses are scenario-driven so the
  // dashboard has stable buckets instead of random distributions.
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
    const firstResponseStatus =
      c.scenario === "first_response_breached" || c.scenario === "both_breached"
        ? CommitmentStatus.breached
        : c.scenario === "at_risk"
          ? CommitmentStatus.at_risk
          : CommitmentStatus.met;
    const resolutionStatus =
      c.scenario === "resolution_breached" || c.scenario === "both_breached"
        ? CommitmentStatus.breached
        : c.scenario === "at_risk" || c.scenario === "open_aging"
          ? CommitmentStatus.at_risk
          : c.scenario === "on_track"
            ? CommitmentStatus.on_track
            : CommitmentStatus.met;

    for (const [kind, targetMinutes, status] of [
      [CommitmentKind.first_response, 60, firstResponseStatus],
      [CommitmentKind.resolution, 480, resolutionStatus],
    ] as const) {
      const dueAt = new Date(c.openedAt.getTime() + targetMinutes * 60_000);
      const closedAt =
        status === CommitmentStatus.met || status === CommitmentStatus.breached
          ? c.closedAt
          : null;
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
        closedAt,
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

  // --- Evaluations (stable history per commitment) ------------------------
  const evaluationInserts: Prisma.EvaluationCreateManyInput[] = [];
  for (const commitment of commitmentInserts) {
    const snapshots = Math.max(1, evaluationsPerCommitment);
    const finalStatus = commitment.status;
    for (let s = 0; s < snapshots; s++) {
      const progress = (s + 1) / snapshots;
      const evaluatedAt = new Date(
        commitment.startedAt.getTime() +
          Math.floor(
            (Math.min(commitment.dueAt.getTime(), now) -
              commitment.startedAt.getTime()) *
              progress,
          ),
      );
      const targetSeconds = commitment.targetMinutes * 60;
      let elapsedSeconds: number;
      let status: CommitmentStatus;
      let breachedBySeconds: number | null = null;

      if (finalStatus === CommitmentStatus.breached) {
        elapsedSeconds = Math.floor(targetSeconds * (1.1 + progress * 0.9));
        status = CommitmentStatus.breached;
        breachedBySeconds = Math.max(1, elapsedSeconds - targetSeconds);
      } else if (finalStatus === CommitmentStatus.at_risk) {
        elapsedSeconds = Math.floor(targetSeconds * (0.72 + progress * 0.08));
        status = CommitmentStatus.at_risk;
      } else if (finalStatus === CommitmentStatus.on_track) {
        elapsedSeconds = Math.floor(targetSeconds * (0.35 + progress * 0.25));
        status = CommitmentStatus.on_track;
      } else {
        elapsedSeconds = Math.floor(targetSeconds * (0.25 + progress * 0.45));
        status = CommitmentStatus.met;
      }

      evaluationInserts.push({
        id: crypto.randomUUID(),
        commitmentId: commitment.id,
        evaluatedAt,
        elapsedSeconds,
        remainingSeconds: targetSeconds - elapsedSeconds,
        status,
        breachedBySeconds,
        inputs: {
          seed: true,
          scenario: caseRows.find((c) => c.id === commitment.caseId)?.scenario,
        },
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

  const scenarioCounts = Object.fromEntries(
    SCENARIOS.map(({ name }) => [
      name,
      caseRows.filter((c) => c.scenario === name).length,
    ]),
  ) as Record<PerfScenario, number>;

  return {
    organizationId: organization.id,
    customers: customerRows.length,
    cases: caseRows.length,
    rawEvents: rawEventTotal,
    normalizedEvents: normalizedEventTotal,
    commitments: commitmentInserts.length,
    evaluations: evaluationInserts.length,
    durationMs: Date.now() - startedAt,
    scenarioCounts,
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
