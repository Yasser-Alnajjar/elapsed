import { getWorkerSettingsForRead, type PrismaClient } from "@sla/db";
import { latestLifecycleAbort, type AbortedPassPreview } from "@sla/custom-ticket";
import { staleFields } from "@/lib/freshness-data";

/**
 * The customer-facing sync states of plan 09, 6.13. Exactly one is shown on the
 * integration page, the integrations list and the case detail. A long initial
 * import must never look like a failure, and a failure must never look like an
 * import. The stale-data marker is an overlay on any state, not a state.
 */
export type CustomSyncState = "importing_history" | "catching_up" | "up_to_date" | "needs_attention" | "paused" | "disabled";

export type AttentionCause =
  | "reconnect"
  | "permission"
  | "credentials"
  | "provider"
  | "safety_check"
  | "no_progress"
  | "cannot_finish_without_cursor"
  | "processing";

export interface RunSummary {
  id: string;
  startedAt: string;
  outcome: "ok" | "partial" | "failed" | "aborted";
  reasonCode: string | null;
  secondaryReason: string | null;
  recordsFetched: number;
  failureCount: number;
  progress: Record<string, unknown> | null;
}

export interface StateInput {
  flagEnabled: boolean;
  pollingPaused: boolean;
  integrationStatus: "connected" | "disconnected" | "reauth_required" | "permission_denied";
  backfillCompleted: boolean;
  /** Newest first. */
  runs: Pick<RunSummary, "outcome" | "reasonCode" | "progress">[];
}

const PROVIDER_CODES = new Set(["provider_unavailable", "timeout", "unreachable", "tls_error", "blocked_destination", "bad_response", "rate_limited", "redirect", "unsupported_encoding", "response_too_large", "invalid_request", "config_invalid"]);

export function attentionCause(input: StateInput): AttentionCause | null {
  if (input.integrationStatus === "reauth_required") return "reconnect";
  if (input.integrationStatus === "permission_denied") return "permission";
  const latest = input.runs[0];
  if (!latest) return null;
  if (latest.outcome === "partial") {
    const hasCursor = (latest.progress as { hasIncrementalCursor?: unknown } | null)?.hasIncrementalCursor;
    return hasCursor === false ? "cannot_finish_without_cursor" : null;
  }
  if (latest.outcome === "aborted") return latest.reasonCode === "flag_disabled" ? null : "safety_check";
  if (latest.outcome === "failed") {
    const code = latest.reasonCode ?? "";
    if (code === "credentials_unreadable") return "credentials";
    if (code === "no_progress") return "no_progress";
    if (code === "reauth_required") return "reconnect";
    if (code === "permission_denied") return "permission";
    if (PROVIDER_CODES.has(code)) return "provider";
    return "processing";
  }
  return null;
}

/** Derives the one state from the latest runs, the import progress and the operator switches (plan 09, 6.13). */
export function deriveSyncState(input: StateInput): CustomSyncState {
  if (!input.flagEnabled) return "disabled";
  if (input.pollingPaused) return "paused";
  if (attentionCause(input) !== null) return "needs_attention";
  if (!input.backfillCompleted) return "importing_history";
  const latest = input.runs[0];
  if (latest?.outcome === "partial") return "catching_up";
  return "up_to_date";
}

export interface CustomStatus {
  connected: boolean;
  state: CustomSyncState | null;
  attention: AttentionCause | null;
  stale: boolean;
  staleSince: string | null;
  lastSuccessfulSyncAt: string | null;
  activeVersion: number | null;
  slaSupport: unknown;
  versions: { version: number; createdAt: string; note: string | null; active: boolean }[];
  runs: RunSummary[];
  /** Tickets that could not be processed in the latest completed run, with their codes. */
  failedTickets: { recordId: string; code: string }[];
  failedTicketCount: number;
  /** The aborted pass the owner may review, when the latest run is a lifecycle-guard abort. */
  override: AbortedPassPreview | null;
}

const RUNS_SHOWN = 10;

export async function getCustomStatus(prisma: PrismaClient, organizationId: string, now = new Date()): Promise<CustomStatus> {
  const [org, integration] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { customProviderEnabled: true } }),
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "custom" } },
      select: {
        id: true,
        status: true,
        cursor: true,
        pollingPausedAt: true,
        lastSuccessfulSyncAt: true,
        activeConfigVersion: true,
        slaSupport: true,
      },
    }),
  ]);
  if (!integration || integration.status === "disconnected") {
    return { connected: false, state: null, attention: null, stale: false, staleSince: null, lastSuccessfulSyncAt: null, activeVersion: null, slaSupport: null, versions: [], runs: [], failedTickets: [], failedTicketCount: 0, override: null };
  }
  const [runRows, versionRows, settings] = await Promise.all([
    prisma.integrationSyncRun.findMany({ where: { integrationId: integration.id }, orderBy: { startedAt: "desc" }, take: RUNS_SHOWN }),
    prisma.customProviderConfigVersion.findMany({
      where: { integrationId: integration.id },
      orderBy: { version: "desc" },
      take: 20,
      select: { version: true, createdAt: true, note: true },
    }),
    getWorkerSettingsForRead(prisma),
  ]);
  const runs: RunSummary[] = runRows.map((run) => ({
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    outcome: run.outcome,
    reasonCode: run.reasonCode,
    secondaryReason: run.secondaryReason,
    recordsFetched: run.recordsFetched,
    failureCount: run.failureCount,
    progress: (run.progress as Record<string, unknown> | null) ?? null,
  }));
  const backfillCompleted = (integration.cursor as { backfillCompletedAt?: string } | null)?.backfillCompletedAt != null;
  const input: StateInput = {
    flagEnabled: org?.customProviderEnabled === true,
    pollingPaused: integration.pollingPausedAt !== null,
    integrationStatus: integration.status,
    backfillCompleted,
    runs,
  };
  const stale = staleFields({ status: integration.status, lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt }, now.toISOString(), settings);
  const latestCompleted = runRows.find((run) => run.outcome === "ok" || run.outcome === "partial");
  return {
    connected: true,
    state: deriveSyncState(input),
    attention: attentionCause(input),
    stale: stale.stale,
    staleSince: stale.staleSince,
    lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt?.toISOString() ?? null,
    activeVersion: integration.activeConfigVersion,
    slaSupport: integration.slaSupport,
    versions: versionRows.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), note: v.note, active: v.version === integration.activeConfigVersion })),
    runs,
    failedTickets: ((latestCompleted?.failures as { recordId: string; code: string }[] | null) ?? []).slice(0, 50),
    failedTicketCount: latestCompleted?.failureCount ?? 0,
    override: await latestLifecycleAbort(prisma, integration.id),
  };
}
