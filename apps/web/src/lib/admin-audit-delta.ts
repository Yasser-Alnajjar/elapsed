import { formatUtcDate } from "./admin-format";
import { formatIntervalMs } from "./format";
import {
  BETA_ACCESS_LABELS,
  PLAN_LABELS,
  PLAN_STATUS_LABELS,
  RELEASE_STAGE_LABELS,
  type AdminAuditRow,
  type BetaAccessMode,
  type PlanId,
  type PlanStatus,
  type ReleaseStage,
} from "./types/admin";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "./types/integrations";

/** One field that changed: how it read before and after. `null` is "nothing" (rendered as a dash). */
export interface AuditDeltaEntry {
  field: string;
  before: string | null;
  after: string | null;
}

/** A row's metadata read for a person: fields that changed, plus plain facts (like which provider). */
export interface AuditChange {
  entries: AuditDeltaEntry[];
  facts: { label: string; value: string }[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (value === null || value === undefined || value === "" ? null : String(value));

/** Formats one value for the diff; `null` stays null so the view can show a dash. */
type FieldFormat = (value: unknown) => string | null;

const PLAN_FIELDS: { key: string; label: string; format: FieldFormat }[] = [
  { key: "plan", label: "Plan", format: (v) => (text(v) ? (PLAN_LABELS[v as PlanId] ?? String(v)) : "Not recorded") },
  { key: "planStatus", label: "Status", format: (v) => (text(v) ? (PLAN_STATUS_LABELS[v as PlanStatus] ?? String(v)) : null) },
  { key: "trialEndsAt", label: "Trial ends", format: (v) => (typeof v === "string" ? formatUtcDate(v) : null) },
  { key: "billingReference", label: "Billing reference", format: text },
];

const WORKER_FIELDS: { key: string; label: string; format: FieldFormat }[] = [
  { key: "activePollIntervalMs", label: "Active monitoring", format: (v) => (typeof v === "number" ? formatIntervalMs(v) : null) },
  { key: "reconciliationIntervalMs", label: "Reconciliation", format: (v) => (typeof v === "number" ? formatIntervalMs(v) : null) },
];

const AVAILABILITY_FIELDS: { key: string; label: string; format: FieldFormat }[] = [
  { key: "enabled", label: "Enabled", format: (v) => (typeof v === "boolean" ? (v ? "Enabled" : "Disabled") : null) },
  { key: "releaseStage", label: "Release stage", format: (v) => (text(v) ? (RELEASE_STAGE_LABELS[v as ReleaseStage] ?? String(v)) : null) },
  { key: "betaAccess", label: "Beta access", format: (v) => (text(v) ? (BETA_ACCESS_LABELS[v as BetaAccessMode] ?? String(v)) : null) },
  { key: "statusMessage", label: "Customer message", format: text },
];

function diff(metadata: unknown, fields: typeof PLAN_FIELDS): AuditDeltaEntry[] {
  if (!isObject(metadata) || !isObject(metadata.before) || !isObject(metadata.after)) return [];
  const { before, after } = metadata;
  return fields
    .filter(({ key }) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(({ key, label, format }) => ({ field: label, before: format(before[key]), after: format(after[key]) }));
}

/** Reads one audit row's metadata into changes and facts. Unknown shapes give an empty result; the raw JSON is always one click away. */
export function describeAuditChange(row: Pick<AdminAuditRow, "action" | "metadata" | "integrationId">): AuditChange {
  const facts: AuditChange["facts"] = [];

  switch (row.action) {
    case "update_plan":
      return { entries: diff(row.metadata, PLAN_FIELDS), facts };
    case "update_worker_settings":
      return { entries: diff(row.metadata, WORKER_FIELDS), facts };
    case "pause_polling":
    case "resume_polling":
    case "request_renormalize": {
      const provider = isObject(row.metadata) ? text(row.metadata.provider) : null;
      if (provider) facts.push({ label: "Provider", value: INTEGRATION_PROVIDER_LABELS[provider as IntegrationProvider] ?? provider });
      if (row.integrationId) facts.push({ label: "Integration", value: row.integrationId });
      return { entries: [], facts };
    }
    case "apply_guard_override": {
      if (isObject(row.metadata)) {
        facts.push({ label: "Guard", value: text(row.metadata.guard) ?? "mass_lifecycle_change" });
        const hash = text(row.metadata.previewHash);
        if (hash) facts.push({ label: "Preview", value: hash.slice(0, 12) });
      }
      return { entries: [], facts };
    }
    case "update_integration_availability":
    case "add_integration_allowlist":
    case "remove_integration_allowlist": {
      if (isObject(row.metadata)) {
        const provider = text(row.metadata.provider);
        if (provider) facts.push({ label: "Provider", value: INTEGRATION_PROVIDER_LABELS[provider as IntegrationProvider] ?? provider });
        const reason = text(row.metadata.reason);
        if (reason) facts.push({ label: "Reason", value: reason });
        if (row.metadata.pausedPolling === true) facts.push({ label: "Polling", value: "Paused with the removal; resume it separately" });
      }
      return { entries: row.action === "update_integration_availability" ? diff(row.metadata, AVAILABILITY_FIELDS) : [], facts };
    }
    case "enable_custom_provider":
    case "disable_custom_provider": {
      if (isObject(row.metadata) && row.metadata.pausedPolling === true) facts.push({ label: "Polling", value: "Paused with the flag; resume it separately" });
      return { entries: [], facts };
    }
    default:
      return { entries: [], facts };
  }
}
