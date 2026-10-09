import type {
  AdminIntegrationsData,
  AvailabilityImpact,
  AvailabilityPolicyFields,
  IntegrationControl,
  PlanRecord,
} from "@/lib/types/admin";
import type { IntegrationProvider } from "@/lib/types/integrations";
import type { AdminBillingActionInput } from "@/lib/billing-validation";
import type { WorkerMonitoringData } from "@/lib/types/worker-settings";

/**
 * Browser-side wrappers for the platform-admin API routes (`/api/admin/**`).
 * Kept apart from `./client` so a tenant page's bundle never carries an admin
 * URL; only `modules/admin/**` imports this (`admin-boundary.test.ts`).
 */

interface AdminActionResult<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

async function send<T>(url: string, method: "GET" | "POST" | "PATCH" | "DELETE", payload?: unknown): Promise<AdminActionResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export const AdminClientActions = {
  /** Edits one organization's manual plan record; audited as `update_plan`. */
  updatePlanRecord(organizationId: string, input: PlanRecord) {
    return send<{ changed: boolean; planRecord: PlanRecord }>(`/api/admin/tenants/${organizationId}/plan`, "PATCH", input);
  },

  /** Changes the deployment-wide polling intervals; audited as `update_worker_settings`. */
  saveWorkerSettings(input: { activePollIntervalMs: number; reconciliationIntervalMs: number }) {
    return send<WorkerMonitoringData>("/api/settings/worker", "POST", input);
  },

  /** Pause or resume polling for one integration, or request one full re-normalization. */
  controlIntegration(integrationId: string, action: IntegrationControl) {
    return send<{ ok: boolean }>(`/api/admin/integrations/${integrationId}`, "POST", { action });
  },

  /** Every provider's availability, allowlist, counts and health (N10). */
  listIntegrationAvailability() {
    return send<AdminIntegrationsData>("/api/admin/integrations", "GET");
  },

  /** Changes one provider's availability; compare-and-set on `expectedVersion`; audited. Errors carry `{ error, code }`. */
  updateIntegrationAvailability(
    provider: IntegrationProvider,
    input: Partial<AvailabilityPolicyFields> & { expectedVersion: number; reason: string },
  ) {
    return send<{ changed: boolean; policy: AvailabilityPolicyFields & { version: number } }>(
      `/api/admin/integrations/providers/${provider}`,
      "PATCH",
      input,
    );
  },

  /** Read-only: who would lose access if this change were saved. */
  previewAvailabilityImpact(provider: IntegrationProvider, change: Partial<AvailabilityPolicyFields> & { removeOrganizationId?: string }) {
    return send<AvailabilityImpact>(`/api/admin/integrations/providers/${provider}/impact`, "POST", change);
  },

  /** Adds an organization to a provider's Beta allowlist; audited. */
  addToBetaAllowlist(provider: IntegrationProvider, organizationId: string, reason: string) {
    return send<{ ok: boolean }>(`/api/admin/integrations/providers/${provider}/allowlist`, "POST", { organizationId, reason });
  },

  /** Removes an organization from a provider's Beta allowlist; audited. */
  removeFromBetaAllowlist(provider: IntegrationProvider, organizationId: string, reason: string) {
    return send<{ pausedPolling: boolean }>(`/api/admin/integrations/providers/${provider}/allowlist/${organizationId}`, "DELETE", { reason });
  },

  /** One billing override on one organization; audited as `billing_override`. Errors carry `{ error, code }`. */
  billingAction(organizationId: string, input: AdminBillingActionInput) {
    return send<{ ok?: boolean; code?: string }>(`/api/admin/billing/${organizationId}`, "POST", input);
  },

  /** Reconciles every live subscription. */
  reconcileAllBilling() {
    return send<{ reconciled: number }>("/api/admin/billing", "POST", {});
  },
};
