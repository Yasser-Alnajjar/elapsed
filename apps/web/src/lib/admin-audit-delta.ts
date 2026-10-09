import { formatUtcDate } from "./admin-format";
import { formatIntervalMs } from "./format";
import { PLAN_LABELS, PLAN_STATUS_LABELS, type AdminAuditRow, type PlanId, type PlanStatus } from "./types/admin";
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
    case "enable_custom_provider":
    case "disable_custom_provider": {
      if (isObject(row.metadata) && row.metadata.pausedPolling === true) facts.push({ label: "Polling", value: "Paused with the flag; resume it separately" });
      return { entries: [], facts };
    }
    default:
      return { entries: [], facts };
  }
}
