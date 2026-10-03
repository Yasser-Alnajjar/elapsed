"use client";

import { createContext, useContext } from "react";
import type { SubscriptionActionInput } from "@/lib/billing-validation";

export interface BillingRunResult {
  ok: boolean;
  /** The server's message when it refused. */
  error?: string;
  /** The server's error code (`conflict`, `invalid_seats`, …), or `network` when it was unreachable. */
  code?: string;
}

export interface BillingActionsValue {
  /** Owners manage billing; for members every manage control is disabled. */
  canManage: boolean;
  /** Whether a payment provider is connected (portal, payment methods, invoice PDFs). */
  providerAvailable: boolean;
  /** The subscription version this page was rendered from; sent with every change. */
  version: number | null;
  /** A subscription change is in flight; other change controls wait. */
  busy: boolean;
  /**
   * Sends one subscription transition. On success it shows `success` and
   * refreshes the page's server data; on refusal it shows the server's reason
   * and returns it so a dialog can keep it on screen.
   */
  run: (input: SubscriptionActionInput, success: string) => Promise<BillingRunResult>;
  /** Shows a toast. */
  notify: (title: string, description: string, tone?: "success" | "preview" | "error") => void;
}

const BillingActionsContext = createContext<BillingActionsValue>({
  canManage: false,
  providerAvailable: false,
  version: null,
  busy: false,
  run: async () => ({ ok: false }),
  notify: () => {},
});

export const BillingActionsProvider = BillingActionsContext.Provider;

export function useBillingActions(): BillingActionsValue {
  return useContext(BillingActionsContext);
}

/** The `title` a disabled manage control shows a member. */
export const OWNER_ONLY_HINT = "Only an organization owner can manage billing.";

/** The `title` of a control that needs a payment provider. */
export const PROVIDER_HINT = "Available once a payment provider is connected.";
