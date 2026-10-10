import { ShieldAlert } from "lucide-react";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";

interface PermissionDeniedBannerProps {
  /** Display name shown in the banner copy, e.g. "Zendesk", "Jira". */
  provider: string;
}

/** Explanation copy shared by the banner and the integration card's hover popover. */
export function PermissionDeniedMessage({ provider }: PermissionDeniedBannerProps) {
  return (
    <>
      <p>
        {provider} is denying access to the account this integration was connected with, so some data may have
        stopped syncing.
      </p>
      <p className="mt-1">
        Ask a {provider} admin to restore that user&apos;s permissions — no reconnect needed. Syncing resumes on its
        own once access is back.
      </p>
    </>
  );
}

/**
 * Roadmap step 32's counterpart to `ReauthBanner`, with deliberately different
 * advice: the token still works, but the account that connected it lost
 * access on the provider's side — reconnecting would just mint the same
 * restricted token again. The status clears itself on the next clean sync.
 */
export function PermissionDeniedBanner({ provider }: PermissionDeniedBannerProps) {
  return (
    <DismissibleAlert variant="warning">
      <ShieldAlert />
      <AlertDescription>
        <PermissionDeniedMessage provider={provider} />
      </AlertDescription>
    </DismissibleAlert>
  );
}
