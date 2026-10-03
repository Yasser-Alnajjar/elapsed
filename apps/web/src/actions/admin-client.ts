import type { IntegrationControl, PlanRecord } from "@/lib/types/admin";
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

async function send<T>(url: string, method: "POST" | "PATCH", payload: unknown): Promise<AdminActionResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

  /** One billing override on one organization; audited as `billing_override`. Errors carry `{ error, code }`. */
  billingAction(organizationId: string, input: AdminBillingActionInput) {
    return send<{ ok?: boolean; code?: string }>(`/api/admin/billing/${organizationId}`, "POST", input);
  },

  /** Reconciles every live subscription. */
  reconcileAllBilling() {
    return send<{ reconciled: number }>("/api/admin/billing", "POST", {});
  },
};
