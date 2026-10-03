import { Prisma, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  deriveNextReplyCycles,
  evaluateCommitment,
  findFirstResponseEvent,
  matchPolicyVersion,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type NormalizedEvent,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import {
  loadEventsForCases,
  toCommitmentDomain,
  toNormalizedEventDomain,
  type CommitmentRecord,
  type NormalizedEventRecord,
} from "./evaluate-pipeline";
import { latestVersionPerPolicy, toCaseAttributes, type CaseRecord } from "./pipeline";
import { toPolicyVersionDomain } from "./policy-domain";
import { POLICY_SELECT, chunk, loadPolicyContext } from "./tick-context";

/**
 * L1 (evaluation) replay for the provider-neutral core work (N1): re-runs the
 * pure engine over stored rows at a fixed `asOf` and writes one deterministic
 * JSON line per commitment and per case, so a capture taken before a change
 * can be diffed against one taken after it. See
 * implementation-plans/01-provider-neutral-core.md §5. Read-only.
 */

export const REPLAY_FORMAT_VERSION = 1;

const POLICY_MATCH_KINDS: CommitmentKind[] = ["first_response", "next_reply", "resolution"];

export interface ReplayHeader {
  type: "header";
  formatVersion: number;
  gitSha: string;
  asOf: string;
  organizationIds: string[];
}

export interface CommitmentReplayRecord {
  type: "commitment";
  id: string;
  organizationId: string;
  caseId: string;
  kind: CommitmentKind;
  cycleKey: string;
  status: string;
  breachedAt: string | null;
  effectiveDueAt: string | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  clockState: string;
  pauseCause: string | null;
  warnThresholdCrossed: number | null;
  policyVersionId: string;
  calendarVersionId: string;
  evaluationId: string;
  /** What is persisted today. Only used for C-class drift; never diffed between captures. */
  persisted: { status: string; breachedAt: string | null; hasBreachedEvaluation: boolean };
}

export interface CaseReplayRecord {
  type: "case";
  id: string;
  organizationId: string;
  /** Per commitment kind: the policy version `matchPolicyVersion` selects, or null if none (or none targets that kind). */
  policyMatch: Record<string, string | null>;
  nextReplyCycleKeys: string[];
  legSpans: { leg: string; confidence: string; startedAt: string; endedAt: string | null }[];
  legWarnings: { kind: string; at: string }[];
  certainLinkCount: number;
}

export type ReplayRecord = CommitmentReplayRecord | CaseReplayRecord;

/** Fields of each record type that are compared between captures (everything except identity and `persisted`). */
export const COMPARED_FIELDS = {
  commitment: [
    "status",
    "breachedAt",
    "effectiveDueAt",
    "elapsedSeconds",
    "remainingSeconds",
    "clockState",
    "pauseCause",
    "warnThresholdCrossed",
    "policyVersionId",
    "calendarVersionId",
    "evaluationId",
  ],
  case: ["policyMatch", "nextReplyCycleKeys", "legSpans", "legWarnings", "certainLinkCount"],
} as const;

export interface PersistedCommitmentState {
  /** `Commitment.status`. */
  status: string;
  /** The latest persisted Evaluation for the commitment, when there is one. */
  latestEvaluation: { status: string; breachedAt: Date | null } | null;
}

export interface OrgReplayInput {
  organizationId: string;
  asOf: string;
  commitments: (CommitmentRecord & { persisted: PersistedCommitmentState })[];
  cases: (CaseRecord & { openedAt: Date })[];
  events: NormalizedEventRecord[];
  /** Every version a commitment or match may need, including ones frozen onto commitments under since-deactivated policies. */
  policyVersions: SLAPolicyVersion[];
  /** Policies eligible as match candidates for the case-level policy match (not archived or deactivated). */
  activePolicyIds: ReadonlySet<string>;
  calendars: BusinessCalendarVersion[];
  /** Count of `certain`, still-active CaseLinks per case id. */
  certainLinkCountByCaseId: ReadonlyMap<string, number>;
}

function eventsByCase(rows: NormalizedEventRecord[]): Map<string, NormalizedEvent[]> {
  const byCase = new Map<string, NormalizedEvent[]>();
  for (const row of rows) {
    const domain = toNormalizedEventDomain(row);
    const bucket = byCase.get(row.caseId);
    if (bucket) bucket.push(domain);
    else byCase.set(row.caseId, [domain]);
  }
  return byCase;
}

/**
 * Pure: the replay records for one organization, sorted by id within each
 * type (commitments first, then cases). No I/O, so two calls on the same
 * input are identical by construction.
 */
export function buildOrgReplayRecords(input: OrgReplayInput): ReplayRecord[] {
  const { organizationId, asOf } = input;
  const policyVersionsById = new Map(input.policyVersions.map((pv) => [pv.id, pv]));
  const calendarsById = new Map(input.calendars.map((c) => [c.id, c]));
  const activePolicyVersions = latestVersionPerPolicy(
    input.policyVersions.filter((pv) => input.activePolicyIds.has(pv.policyId)),
  );
  const events = eventsByCase(input.events);

  const commitmentRecords: CommitmentReplayRecord[] = [];
  for (const row of input.commitments) {
    const policyVersion = policyVersionsById.get(row.policyVersionId);
    if (!policyVersion) throw new Error(`No SLAPolicyVersion loaded for ${row.policyVersionId}`);
    const calendar = calendarsById.get(row.calendarVersionId);
    if (!calendar) throw new Error(`No BusinessCalendarVersion loaded for ${row.calendarVersionId}`);

    const evaluation = evaluateCommitment(
      toCommitmentDomain(row),
      events.get(row.caseId) ?? [],
      policyVersion,
      calendar,
      asOf,
    );
    const latest = row.persisted.latestEvaluation;
    commitmentRecords.push({
      type: "commitment",
      id: row.id,
      organizationId,
      caseId: row.caseId,
      kind: row.kind,
      cycleKey: row.cycleKey,
      status: evaluation.status,
      // Same rule as `toEvaluationCreateInput`: the breach instant only when breached.
      breachedAt:
        evaluation.status === "breached" && evaluation.effectiveDueAt ? evaluation.effectiveDueAt : null,
      effectiveDueAt: evaluation.effectiveDueAt,
      elapsedSeconds: evaluation.elapsedSeconds,
      remainingSeconds: evaluation.remainingSeconds,
      clockState: evaluation.clock.state,
      pauseCause: evaluation.clock.pauseCause,
      warnThresholdCrossed: evaluation.warnThresholdCrossed ?? null,
      policyVersionId: evaluation.inputs.policyVersionId,
      calendarVersionId: evaluation.inputs.calendarVersionId,
      evaluationId: evaluation.id,
      persisted: {
        status: row.persisted.status,
        breachedAt: latest?.breachedAt?.toISOString() ?? null,
        hasBreachedEvaluation: latest?.status === "breached",
      },
    });
  }

  const caseRecords: CaseReplayRecord[] = input.cases.map((caseRow) => {
    const caseEvents = events.get(caseRow.id) ?? [];
    const matched = matchPolicyVersion(toCaseAttributes(caseRow), activePolicyVersions);
    const policyMatch: Record<string, string | null> = {};
    for (const kind of POLICY_MATCH_KINDS) {
      policyMatch[kind] = matched && matched.targets.some((t) => t.kind === kind) ? matched.id : null;
    }
    const cycles = deriveNextReplyCycles(caseEvents, {
      asOf,
      firstResponseCompletion: findFirstResponseEvent(caseEvents, asOf),
    });
    const legs = deriveLegSpans(caseEvents, { caseOpenedAt: caseRow.openedAt.toISOString() });
    return {
      type: "case",
      id: caseRow.id,
      organizationId,
      policyMatch,
      nextReplyCycleKeys: cycles.map((c) => c.key),
      legSpans: legs.spans.map((s) => ({
        leg: s.leg,
        confidence: s.confidence,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
      legWarnings: legs.warnings.map((w) => ({ kind: w.kind, at: w.at })),
      certainLinkCount: input.certainLinkCountByCaseId.get(caseRow.id) ?? 0,
    };
  });

  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  commitmentRecords.sort(byId);
  caseRecords.sort(byId);
  return [...commitmentRecords, ...caseRecords];
}

/** Serializes a header and records to JSONL. Key order is fixed by how each record is built above. */
export function serializeReplay(header: ReplayHeader, records: readonly ReplayRecord[]): string {
  return [header, ...records].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

export function parseReplay(text: string): { header: ReplayHeader; records: ReplayRecord[] } {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0] ? (JSON.parse(lines[0]) as ReplayHeader) : null;
  if (!first || first.type !== "header") throw new Error("Not a replay capture: missing header line");
  return { header: first, records: lines.slice(1).map((line) => JSON.parse(line) as ReplayRecord) };
}

// --- C-class drift ---------------------------------------------------------

export interface DriftSummary {
  commitments: number;
  statusDrift: number;
  breachedAtDrift: number;
}

/**
 * Pre-existing drift (class C): the current code's recomputation already
 * disagrees with what is persisted. `breachedAt` is only compared where the
 * latest persisted Evaluation is itself `breached`, since only those rows
 * carry it.
 */
export function summarizeDrift(records: readonly ReplayRecord[]): DriftSummary {
  const summary: DriftSummary = { commitments: 0, statusDrift: 0, breachedAtDrift: 0 };
  for (const record of records) {
    if (record.type !== "commitment") continue;
    summary.commitments += 1;
    if (record.status !== record.persisted.status) summary.statusDrift += 1;
    if (record.persisted.hasBreachedEvaluation && record.breachedAt !== record.persisted.breachedAt) {
      summary.breachedAtDrift += 1;
    }
  }
  return summary;
}

// --- Compare ---------------------------------------------------------------

/** One allowlist entry. Omitting `fields` approves every field of that record. */
export interface ApprovedDifference {
  type: "commitment" | "case";
  id: string;
  fields?: string[];
  /** Roadmap decision ID or note; informational. */
  decision?: string;
}

export interface FieldDifference {
  type: "commitment" | "case";
  id: string;
  /** A compared field, or `"<record>"` when the record exists in only one capture. */
  field: string;
  before: unknown;
  after: unknown;
  approved: boolean;
}

export interface CompareResult {
  recordsCompared: number;
  differences: FieldDifference[];
  unapproved: number;
  approved: number;
  /** Per `type.field`, split by approval. */
  byField: Record<string, { unapproved: number; approved: number }>;
}

const key = (r: { type: string; id: string }) => `${r.type}:${r.id}`;

function isApproved(diff: Omit<FieldDifference, "approved">, allow: readonly ApprovedDifference[]): boolean {
  return allow.some(
    (a) =>
      a.type === diff.type &&
      a.id === diff.id &&
      (a.fields === undefined || diff.field === "<record>" || a.fields.includes(diff.field)),
  );
}

export function compareReplays(
  before: readonly ReplayRecord[],
  after: readonly ReplayRecord[],
  approvedDifferences: readonly ApprovedDifference[] = [],
): CompareResult {
  const beforeByKey = new Map(before.map((r) => [key(r), r]));
  const afterByKey = new Map(after.map((r) => [key(r), r]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();

  const differences: FieldDifference[] = [];
  let recordsCompared = 0;
  for (const k of keys) {
    const b = beforeByKey.get(k);
    const a = afterByKey.get(k);
    const ref = (b ?? a)!;
    const pushed = (diff: Omit<FieldDifference, "approved">) =>
      differences.push({ ...diff, approved: isApproved(diff, approvedDifferences) });

    if (!b || !a) {
      pushed({
        type: ref.type,
        id: ref.id,
        field: "<record>",
        before: b ? "present" : "absent",
        after: a ? "present" : "absent",
      });
      continue;
    }
    recordsCompared += 1;
    for (const field of COMPARED_FIELDS[ref.type]) {
      const bv = (b as unknown as Record<string, unknown>)[field];
      const av = (a as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        pushed({ type: ref.type, id: ref.id, field, before: bv, after: av });
      }
    }
  }

  const byField: CompareResult["byField"] = {};
  for (const diff of differences) {
    const bucket = (byField[`${diff.type}.${diff.field}`] ??= { unapproved: 0, approved: 0 });
    if (diff.approved) bucket.approved += 1;
    else bucket.unapproved += 1;
  }
  const approved = differences.filter((d) => d.approved).length;
  return { recordsCompared, differences, unapproved: differences.length - approved, approved, byField };
}

// --- Database loading ------------------------------------------------------

/**
 * Loads one organization's replay input inside a READ ONLY transaction. Uses
 * the readers the pipelines use (`loadPolicyContext`, `loadEventsForCases`)
 * and the same commitment scope as the hourly reconciliation sweep
 * (`runEvaluationPipeline` with `scope: "all"`): non-deleted cases, no
 * cancelled commitments.
 */
export async function loadOrgReplayInput(
  prisma: PrismaClient,
  organizationId: string,
  asOf: string,
): Promise<OrgReplayInput> {
  const cases = await prisma.case.findMany({
    where: { organizationId, deletedAt: null },
    select: {
      id: true,
      priority: true,
      customerId: true,
      tier: true,
      tags: true,
      channel: true,
      system: true,
      attributes: true,
      openedAt: true,
    },
  });
  const caseIds = cases.map((c) => c.id);

  const commitmentRows = await prisma.commitment.findMany({
    where: { case: { organizationId, deletedAt: null }, status: { not: "cancelled" } },
  });

  const policyContext = await loadPolicyContext(prisma, organizationId);
  const policyVersionIds = [...new Set(commitmentRows.map((c) => c.policyVersionId))];
  // Commitments keep the version they froze at creation, which may belong to a policy since archived
  // or deactivated (so absent from `loadPolicyContext`); load those too.
  const extraPolicyRows = await prisma.sLAPolicyVersion.findMany({
    where: {
      id: { in: policyVersionIds.filter((id) => !policyContext.policyVersionRows.some((r) => r.id === id)) },
    },
    include: { policy: { select: POLICY_SELECT }, calendarVersion: true },
  });
  const policyRows = [...policyContext.policyVersionRows, ...extraPolicyRows];
  const activePolicyIds = new Set(policyContext.policyVersionRows.map((r) => r.policyId));

  const calendarVersionIds = new Set(commitmentRows.map((c) => c.calendarVersionId));
  for (const row of policyRows) calendarVersionIds.add(row.calendarVersionId);
  const calendarRows = await prisma.businessCalendarVersion.findMany({
    where: { id: { in: [...calendarVersionIds] } },
  });

  const eventRows = await loadEventsForCases(prisma, caseIds);

  const latestEvaluations = new Map<string, { status: string; breachedAt: Date | null }>();
  for (const ids of chunk(commitmentRows.map((c) => c.id))) {
    const rows = await prisma.$queryRaw<{ commitmentId: string; status: string; breachedAt: Date | null }[]>(
      Prisma.sql`
        SELECT DISTINCT ON ("commitmentId") "commitmentId", "status", "breachedAt"
        FROM "evaluations"
        WHERE "commitmentId" IN (${Prisma.join(ids)})
        ORDER BY "commitmentId", "evaluatedAt" DESC, "id" DESC
      `,
    );
    for (const r of rows) latestEvaluations.set(r.commitmentId, { status: r.status, breachedAt: r.breachedAt });
  }

  const certainLinkCountByCaseId = new Map<string, number>();
  for (const ids of chunk(caseIds)) {
    const groups = await prisma.caseLink.groupBy({
      by: ["caseId"],
      where: { caseId: { in: ids }, confidence: "certain", unlinkedAt: null },
      _count: { _all: true },
    });
    for (const g of groups) certainLinkCountByCaseId.set(g.caseId, g._count._all);
  }

  const policyVersions: SLAPolicyVersion[] = policyRows.map(toPolicyVersionDomain);

  return {
    organizationId,
    asOf,
    commitments: commitmentRows.map((row) => ({
      ...row,
      persisted: { status: row.status, latestEvaluation: latestEvaluations.get(row.id) ?? null },
    })),
    cases,
    events: eventRows,
    policyVersions,
    activePolicyIds,
    calendars: calendarRows.map((row) => ({
      id: row.id,
      version: row.version,
      timezone: row.timezone,
      weekly: row.weekly as unknown as WeeklyWindow[],
      holidays: row.holidays,
      alwaysOpen: row.alwaysOpen,
    })),
    certainLinkCountByCaseId,
  };
}
