"use client";

import { useCallback } from "react";
import { Actions } from "@/actions/client";
import { useBillingActions } from "./billing-actions-context";

/** Opens a hosted provider page (portal or payment-method form), or explains why it cannot. */
export function useProviderSession(kind: "portal" | "payment_method") {
  const { notify } = useBillingActions();
  return useCallback(async () => {
    try {
      const result = await Actions.Billing.providerSession(kind);
      if (result.ok && result.body.url) {
        window.location.assign(result.body.url);
        return;
      }
      notify("Not available", result.body.error ?? "The payment provider could not be reached.", "error");
    } catch {
      notify("Not available", "Could not reach the server. Check your connection and try again.", "error");
    }
  }, [kind, notify]);
}
