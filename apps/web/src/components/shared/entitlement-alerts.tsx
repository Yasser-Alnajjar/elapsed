import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getUpgradeCta } from "@/lib/upgrade-cta";

/** The replaceable "how do I upgrade" call to action (`lib/upgrade-cta.ts`): a link when there is somewhere to go, plain text otherwise. */
export function UpgradeCtaLink() {
  const cta = getUpgradeCta();
  if (!cta.href) return <span className="font-medium">{cta.label}.</span>;
  return (
    <a href={cta.href} className="font-medium underline underline-offset-2">
      {cta.label}
    </a>
  );
}

/** Shape of `entitlementWarning` in the invite and policy-create responses. */
export interface EntitlementWarningPayload {
  level: "reached" | "exceeded";
  message: string;
}

/** A soft-limit warning shown beside a creation that succeeded. Informational: it never blocks anything. */
export function EntitlementWarningAlert({ warning }: { warning: EntitlementWarningPayload }) {
  return (
    <Alert variant="warning" data-testid="entitlement-warning" data-level={warning.level}>
      <AlertTriangle />
      <AlertDescription>
        {warning.message} <UpgradeCtaLink />
      </AlertDescription>
    </Alert>
  );
}

const BLOCKED_ACTIONS: Record<string, string> = {
  zendesk: "connect Zendesk",
  jira: "connect Jira",
  linear: "connect Linear",
  intercom: "connect Intercom",
  github: "connect GitHub",
};

/** What the redirect from a blocked connect says was blocked. Only known providers are named; anything else gets the generic wording. */
export function blockedActionLabel(action: string | undefined, provider: string | undefined): string {
  if (action === "connect" && provider && Object.hasOwn(BLOCKED_ACTIONS, provider)) return BLOCKED_ACTIONS[provider]!;
  return "complete that action";
}

/**
 * Shown on the page an owner lands on after a blocked action (`?entitlement=trial_expired`),
 * so the reason is next to what they tried, not only in the layout banner.
 */
export function EntitlementBlockedNotice({ action, provider }: { action?: string; provider?: string }) {
  return (
    <Alert variant="warning" className="mb-4" data-testid="entitlement-blocked">
      <Info />
      <AlertDescription>
        <p>
          We couldn&apos;t {blockedActionLabel(action, provider)} because your trial has ended. Nothing was changed.
        </p>
        <p className="mt-1">
          Your cases, SLA monitoring, alerts and history are unaffected. <UpgradeCtaLink />
        </p>
      </AlertDescription>
    </Alert>
  );
}

