import { PauseCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PollingPausedBannerProps {
  /** Display name shown in the copy, e.g. "Zendesk", "Jira". */
  provider: string;
}

/**
 * Shown to the customer while a platform operator has paused polling for an
 * integration (N4.5). Honest about the effect: nothing new is fetched, so the
 * integration goes stale and the app's stale-data rules apply (at-risk alerts
 * are marked, breach alerts wait). It is not a customer-side fault and needs
 * no action from them.
 */
export function PollingPausedBanner({ provider }: PollingPausedBannerProps) {
  return (
    <Alert variant="warning">
      <PauseCircle />
      <AlertDescription>
        <p>
          Syncing for {provider} is paused by Elapsed support. No new {provider} data arrives until it is resumed, so
          this integration will show as stale.
        </p>
        <p className="mt-1">You don&apos;t need to do anything. Contact support if you didn&apos;t expect this.</p>
      </AlertDescription>
    </Alert>
  );
}
