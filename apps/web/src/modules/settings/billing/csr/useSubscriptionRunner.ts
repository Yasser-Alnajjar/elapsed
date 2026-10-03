"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Actions } from "@/actions/client";
import type { BillingToastMessage } from "@/components/billing/billing-toast";
import type { SubscriptionActionInput } from "@/lib/billing-validation";
import type { BillingActionsValue } from "./billing-actions-context";

/**
 * Sends one subscription transition to `/api/billing/subscription`, which
 * re-validates it against the current state, and re-reads the page's server
 * data afterwards. Shared by the Billing page and the Review & Subscribe flow
 * so both report success, refusal and a lost connection the same way.
 */
export function useSubscriptionRunner(show: (message: BillingToastMessage) => void) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const run = useCallback<BillingActionsValue["run"]>(
    async (input: SubscriptionActionInput, success: string) => {
      setSending(true);
      try {
        const result = await Actions.Billing.subscription(input);
        if (!result.ok) {
          const error = result.body.error ?? "The billing change could not be made.";
          const code = result.body.code;
          show({ title: code === "conflict" ? "Billing changed" : "Not changed", description: error, tone: "error" });
          if (code === "conflict") startRefresh(() => router.refresh());
          return { ok: false, error, code };
        }
        show({ title: success, description: "Saved and recorded in billing history.", tone: "success" });
        startRefresh(() => router.refresh());
        return { ok: true };
      } catch {
        const error = "Could not reach the server. Check your connection and try again.";
        show({ title: "Not changed", description: error, tone: "error" });
        return { ok: false, error, code: "network" };
      } finally {
        setSending(false);
      }
    },
    [router, show],
  );

  return { run, busy: sending || refreshing, refreshing };
}
